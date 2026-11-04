import { t, useI18n } from '@/i18n'
// One machine's page (docs/ui/layerfs-compute.md), opened from its card on the
// Machines board or any machine link: one scrolling page. Its crumbs (Back to
// where you came from, `Machines / <name>`), its header (kind, name, state,
// size, default image, free disk, Start or Stop and the menu), why it needs
// you, then the Stores its Sandboxes can use (tabs: the sqlite Stores pushed
// to its disk and the PostgreSQL Stores they reach), then its Sandboxes (from
// any Store; the page's main part), a grid of cards each with its image and
// its Workspaces as rows. Then its facts with the danger zone (Remove or
// Disconnect, refused while it holds anything).
import { Server, Trash2, Unplug } from 'lucide-react'
import { useState } from 'react'

import { attentionOf, heldWords, MachineDialogs, MachineFacts, MachineMenu, PowerButton, useMachineRun } from '@/components/compute/machine-card'
import { MachineData } from '@/components/compute/machine-data'
import { MachineSandboxes, type SandboxOps } from '@/components/compute/machine-sandboxes'
import { KindLabel, SectionTitle } from '@/components/compute/target-parts'
import { Empty } from '@/components/projects/states'
import { Refusal } from '@/components/refusal'
import { StateChip } from '@/components/state-chip'
import { Bar } from '@/components/storage/meters'
import { Card } from '@/components/storage/overview/row-parts'
import { Crumbs } from '@/components/tabs/crumbs'
import { Button } from '@/components/ui/button'
import { BUILT_IN, downReason, gib, inUse, kindLabel, machineState, type Os, sizeOf, storesOn } from '@/data/compute'
import type { MachineAction } from '@/data/compute-sim'
import { shortDigest } from '@/data/format'
import { clearingCall } from '@/data/states'
import { cn } from '@/lib/utils'
import type { AgentSessionSummary } from '@shared/agent-api'
import type { MachineSandbox, MachinesView } from '@shared/host-api'

type Available = Extract<MachinesView, { available: true }>

interface Props {
  name: string
  view: Available
  os: Os
  act: (action: MachineAction) => Promise<void>
  ops: SandboxOps
  chats?: AgentSessionSummary[]
  /** The Sandbox rows open now, by name. */
  open: Set<string>
  onToggle: (sandbox: string) => void
  /** The Machines board. */
  onBack: () => void
  /** Back where this tab came from (another page), when it came from one. */
  back?: { label: string; onBack: () => void }
  onOpenProject?: (key: string, tab?: string) => void
  onOpenChat?: (session: string) => void
}

/** A machine's Sandboxes by project key (those with none last), then by name. */
const byProject = (sandboxes: MachineSandbox[]): MachineSandbox[] =>
  [...sandboxes].sort((a, b) => Number(!a.project) - Number(!b.project) || (a.project ?? '').localeCompare(b.project ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }))

export function MachinePage({ name, view, os, act, ops, chats, open, onToggle, onBack, back: backTo, onOpenProject, onOpenChat }: Props) {
  useI18n()
  const { run, pending, error } = useMachineRun(act)
  const [dialog, setDialog] = useState<'settings' | 'remove' | null>(null)
  const m = view.machines.find((x) => x.name === name)
  const back = <Crumbs back={backTo} items={[{ label: t('Machines'), onClick: onBack, title: t('All machines') }, { label: name }]} />
  if (!m)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Empty icon={Server} title={t('No machine named {name}', { name })} className="glass-liquid rounded-2xl border-solid">
          {t('It was removed or disconnected, or this home never had it.')}
        </Empty>
      </div>
    )

  const live = view.status[m.name]
  const state = machineState(m, live)
  const reason = downReason(m, live)
  const stores = storesOn(view, m)
  // a sandbox.list() that omits one still shows its name from the machine
  const sandboxes = byProject(m.sandboxes.map((b) => view.sandboxes.find((x) => x.name === b) ?? { name: b, machine: m.name, project: null, workspaces: null }))
  const running = new Set(sandboxes.flatMap((b) => (b.project ? [b.project] : [])))
  const workspaces = sandboxes.reduce((n, b) => n + (b.workspaces ?? 0), 0)
  const attention = attentionOf(m, live)
  const held = inUse(m)
  const ssh = m.platform === 'ssh'
  const disk = m.disk && live?.freeDisk != null ? Math.max(0, m.disk - live.freeDisk) / m.disk : null
  // the disk bar says what is free; the size line leaves it out then
  const size = sizeOf(m, os, disk !== null ? undefined : live)
  const calls = clearingCall('machine', m.name, state.op, m.platform)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* compact, like a project's: Back, `Machines / <name>` with its kind and state, the actions; then one facts line */}
        <header className="reveal flex min-w-0 flex-col gap-1" style={{ '--i': 0 } as React.CSSProperties}>
          <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
              <Crumbs back={backTo} items={[{ label: t('Machines'), onClick: onBack, title: t('All machines') }]} className="shrink-0" />
              <span aria-hidden="true" className="shrink-0 text-[13px] text-faint">/</span>
              <KindLabel platform={m.platform} os={os} hideName className="ml-1 shrink-0 [&>span]:size-5 [&>span]:rounded-md [&>span_svg]:size-3" />
              <h1 className="truncate px-1 text-[15px] leading-6 font-semibold tracking-[-0.011em]">{m.name}</h1>
              <span className="shrink-0 text-xs text-muted-foreground">{t(kindLabel(m.platform))}</span>
              <StateChip entity="machine" state={state.state} op={state.op} className="ml-1" />
            </div>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <PowerButton m={m} pending={pending} run={run} className="h-7 px-2.5" />
              <MachineMenu m={m} pending={pending} run={run} onDialog={setDialog} />
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>
              {t(size.text, size.values)}
              {live?.toolVersion && <span className="text-faint"> · {live.toolVersion}</span>}
              {m.image && (
                <span title={m.image}>
                  {' · '}
                  {t('default image {image}', { image: m.image.startsWith('/') ? m.image.slice(m.image.lastIndexOf('/') + 1) : shortDigest(m.image) })}
                </span>
              )}
            </span>
            {disk !== null && (
              <span className="flex max-w-xs min-w-40 flex-1 items-center gap-2 text-[11px]">
                <Bar share={disk} tone={disk > 0.9 ? 'danger' : disk > 0.75 ? 'warning' : 'brand'} className="flex-1" />
                <span className="shrink-0">{t('{free} free of {disk}', { free: gib(live!.freeDisk), disk: gib(m.disk) })}</span>
              </span>
            )}
          </div>
        </header>
        {(reason || error !== null || state.state === 'unresolved') && (
          <div className={cn('flex flex-col gap-1 rounded-xl px-3.5 py-2.5 text-xs', attention === 'danger' ? 'bg-destructive/[0.06] text-destructive' : 'bg-muted/60')}>
            {reason && <p className="break-words">{reason}</p>}
            {state.state === 'unresolved' && <p className="font-mono text-[11.5px]">{t('see {status} · clear: {clear}', { status: calls.status, clear: calls.clear })}</p>}
            {m.stores.length > 0 && attention === 'danger' && <p className="text-muted-foreground">{t(m.stores.length === 1 ? 'Its Store can’t be used until it answers.' : 'Its {n} Stores can’t be used until it answers.', { n: m.stores.length })}</p>}
            {error !== null && <Refusal error={error} />}
          </div>
        )}
      </div>

      <MachineData id="machine-data" m={m} sqlite={stores} postgresql={view.postgresql ?? []} running={running} onOpenProject={onOpenProject} />

      <section aria-labelledby="machine-running" className="flex flex-col gap-2">
        <SectionTitle id="machine-running" aside={sandboxes.length > 0 ? t('{sandboxes} · {workspaces}', { sandboxes: t(sandboxes.length === 1 ? '1 Sandbox' : '{n} Sandboxes', { n: sandboxes.length }), workspaces: t(workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: workspaces }) }) : undefined}>
          {t('Sandboxes')}
        </SectionTitle>
        {sandboxes.length === 0 ? (
          <Card index={2} className="p-2">
            <p className="px-2 py-3 text-[13px] text-muted-foreground">{m.platform === 'native' && os === 'win32' ? t('Native on Windows keeps records only; Sandboxes run on docker.') : t('Nothing runs here. A project’s Sandboxes tab starts one on any machine.')}</p>
          </Card>
        ) : (
          <MachineSandboxes sandboxes={sandboxes} ops={ops} machineImage={m.image} chats={chats} open={open} onToggle={onToggle} onOpenProject={onOpenProject} onOpenChat={onOpenChat} />
        )}
      </section>

      <section aria-labelledby="machine-details" className="flex flex-col gap-2">
        <SectionTitle id="machine-details">{t('Details')}</SectionTitle>
        <Card index={3} className="flex flex-col gap-4 p-4">
          <MachineFacts m={m} live={live} />
          {BUILT_IN.has(m.platform) ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.06] pt-3 text-xs text-muted-foreground">
              <Button size="sm" variant="outline" className="h-7 rounded-lg px-2.5 text-xs" onClick={() => setDialog('settings')}>
                {t('Update settings…')}
              </Button>
              {t('Built in · can’t be removed')}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 border-t border-destructive/15 pt-3 text-xs">
              <span className="font-medium text-destructive">{t('Danger zone')}</span>
              <Button size="sm" variant="outline" className="h-7 rounded-lg border-destructive/30 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!!held || pending !== null} onClick={() => setDialog('remove')}>
                {ssh ? <Unplug className="size-3.5" /> : <Trash2 className="size-3.5" />}
                {t(ssh ? 'Disconnect {name}…' : 'Remove {name}…', { name: m.name })}
              </Button>
              {held && <span className="text-muted-foreground">{heldWords(held)}</span>}
            </div>
          )}
        </Card>
      </section>

      <MachineDialogs m={m} os={os} dialog={dialog} onClose={() => setDialog(null)} pending={pending} run={run} onRemoved={onBack} />
    </div>
  )
}
