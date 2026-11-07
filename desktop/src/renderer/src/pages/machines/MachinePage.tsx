import { fill } from '@/lib/text'
// One machine's page (docs/ui/machines.md), opened from its card on the
// Machines board or any machine link: one scrolling page. Its crumbs (Back to
// where you came from, `Machines / <name>`), its header (kind, name, state,
// size, default image, free disk, Start or Stop and the menu), why it needs
// you, then the Stores | Sandboxes | Details tabs: the Stores its Sandboxes
// can use (the Storage page's Store cards with their project tiles, bare:
// sqlite Stores on its disk, PostgreSQL Stores they reach), or its Sandboxes
// (from any Store; a grid of cards each with its image and its Workspaces as
// rows).
// Then Details (machine-details.tsx): everything LayerFS says about it, in
// cards, with its settings or the danger zone (Remove, refused while it
// holds anything).
import { Server } from 'lucide-react'
import { useState } from 'react'

import { attentionOf, MachineDialogs, MachineMenu, PowerButton, useMachineRun } from '@/pages/machines/MachineCard'
import { MachineData, machineStoreCount } from '@/pages/machines/MachineData'
import { MachineDetails } from '@/pages/machines/MachineDetails'
import { MachineSandboxes, type SandboxOps } from '@/pages/machines/MachineSandboxes'
import { KindLabel } from '@/pages/machines/TargetParts'
import { Tab, TabBar, TabCount, TabPanel } from '@/components/layerfs/motion/tabs'
import { Empty } from '@/components/layerfs/States'
import { Refusal } from '@/components/layerfs/Refusal'
import { StateChip } from '@/components/layerfs/StateChip'
import { Bar } from '@/pages/storage/Meters'
import { Card } from '@/pages/storage/RowParts'
import { Crumbs } from '@/components/layerfs/Crumbs'
import { downReason, gib, kindLabel, machineState, type Os, sizeOf, storesOn } from '@/layerfs/compute'
import type { MachineAction } from '@/layerfs/compute-sim'
import { shortDigest } from '@/layerfs/format'
import { clearingCall } from '@/layerfs/states'
import { cn } from '@/lib/utils'
import type { MachineSandbox, MachinesView } from '@/layerfs/host-api'

type Available = Extract<MachinesView, { available: true }>
/** The page's tabs: what runs here, the Stores they can use, or everything about the machine. */
type Part = 'sandboxes' | 'stores' | 'details'

interface Props {
  name: string
  view: Available
  os: Os
  act: (action: MachineAction) => Promise<void>
  ops: SandboxOps
  /** The Sandbox rows open now, by name. */
  open: Set<string>
  onToggle: (sandbox: string) => void
  /** The Machines board. */
  onBack: () => void
  /** Back where this tab came from (another page), when it came from one. */
  back?: { label: string; onBack: () => void }
  onOpenProject?: (key: string, tab?: string) => void
}

/** A machine's Sandboxes by project key (those with none last), then by name. */
const byProject = (sandboxes: MachineSandbox[]): MachineSandbox[] =>
  [...sandboxes].sort((a, b) => Number(!a.project) - Number(!b.project) || (a.project ?? '').localeCompare(b.project ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }))

export function MachinePage({ name, view, os, act, ops, open, onToggle, onBack, back: backTo, onOpenProject }: Props) {
  const { run, pending, error } = useMachineRun(act)
  const [dialog, setDialog] = useState<'settings' | 'remove' | null>(null)
  const [chosen, setChosen] = useState<Part | null>(null)
  const m = view.machines.find((x) => x.name === name)
  const back = <Crumbs back={backTo} items={[{ label: 'Machines', onClick: onBack, title: 'All machines' }, { label: name }]} />
  if (!m)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Empty icon={Server} title={`No machine named ${name}`} className="glass-liquid rounded-2xl border-solid">
          {'It was removed, or this home never had it.'}
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
  const storeCount = machineStoreCount(m, stores, view.postgresql ?? [])
  // the tabs open on Stores, the first; on Sandboxes only when it holds no Store and something runs here
  const part = chosen ?? (storeCount === 0 && sandboxes.length > 0 ? 'sandboxes' : 'stores')
  const setPart = (next: Part) => setChosen(next)
  const attention = attentionOf(m, live)
  const disk = m.disk && live?.freeDisk != null ? Math.max(0, m.disk - live.freeDisk) / m.disk : null
  // the disk bar says what is free; the size line leaves it out then
  const size = sizeOf(m, os, disk !== null ? undefined : live)
  const calls = clearingCall('machine', m.name, state.op)

  const facts = (
    <>
      <span className="truncate">{fill(size.text, size.values)}</span>
      {live?.toolVersion && (
        <>
          <span aria-hidden="true" className="text-faint">·</span>
          <span className="shrink-0">{live.toolVersion}</span>
        </>
      )}
      {m.image && (
        <>
          <span aria-hidden="true" className="text-faint">·</span>
          <span className="truncate" title={m.image}>{`default image ${m.image.startsWith('/') ? m.image.slice(m.image.lastIndexOf('/') + 1) : shortDigest(m.image)}`}</span>
        </>
      )}
      {disk !== null && (
        <>
          <span aria-hidden="true" className="text-faint">·</span>
          <span className="flex shrink-0 items-center gap-1.5" title={`${gib(live!.freeDisk)} free of ${gib(m.disk)}`}>
            <Bar share={disk} tone={disk > 0.9 ? 'danger' : disk > 0.75 ? 'warning' : 'brand'} className="w-16" />
            {`${gib(live!.freeDisk)} free`}
          </span>
        </>
      )}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* one thin row, as a Store's page: back, Machines / the machine, its kind and state, its facts, Start or Stop and the menu */}
        <header className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Crumbs back={backTo} items={[{ label: 'Machines', onClick: onBack, title: 'All machines' }]} />
          <span aria-hidden="true" className="shrink-0 text-faint">/</span>
          <KindLabel platform={m.platform} os={os} hideName className="shrink-0 [&>span]:size-4 [&>span]:rounded-3xs [&>span_svg]:size-2.5" />
          <h1 className="min-w-0 truncate text-base-plus leading-6 font-strong tracking-tight">{m.name}</h1>
          <span className="shrink-0 rounded-full bg-foreground/[0.05] px-2 py-px text-xs font-medium text-muted-foreground">{fill(kindLabel(m.platform))}</span>
          <StateChip entity="machine" state={state.state} op={state.op} className="shrink" />
          <span className="ml-1 flex min-w-0 flex-1 items-center gap-x-1.5 overflow-hidden text-sm whitespace-nowrap text-muted-foreground tabular-nums">{facts}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <PowerButton m={m} pending={pending} run={run} className="h-7 px-2.5" />
            <MachineMenu m={m} pending={pending} run={run} onDialog={setDialog} />
          </span>
        </header>
        {(reason || error !== null || state.state === 'unresolved') && (
          <div className={cn('flex flex-col gap-1 rounded-lg-plus px-3.5 py-2.5 text-sm', attention === 'danger' ? 'bg-destructive/[0.06] text-destructive' : 'bg-muted/60')}>
            {reason && <p className="break-words">{reason}</p>}
            {state.state === 'unresolved' && <p className="font-mono text-xs-plus">{`see ${calls.status} · clear: ${calls.clear}`}</p>}
            {m.stores.length > 0 && attention === 'danger' && <p className="text-muted-foreground">{fill(m.stores.length === 1 ? 'Its Store can’t be used until it answers.' : 'Its {n} Stores can’t be used until it answers.', { n: m.stores.length })}</p>}
            {error !== null && <Refusal error={error} />}
          </div>
        )}
      </div>

      <section aria-label={'Stores and Sandboxes'} className="flex flex-col gap-4">
        <TabBar
          aria-label={'Stores and Sandboxes'}
          variant="line"
          end={
            <span className="text-sm text-muted-foreground tabular-nums">
              {part === 'stores'
                ? 'Stores its Sandboxes can use'
                : part === 'details'
                  ? null
                  : sandboxes.length > 0
                    ? fill(workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: workspaces })
                    : null}
            </span>
          }
        >
          <Tab active={part === 'stores'} onClick={() => setPart('stores')}>
            {'Stores'}
            {storeCount > 0 && <TabCount>{storeCount}</TabCount>}
          </Tab>
          <Tab active={part === 'sandboxes'} onClick={() => setPart('sandboxes')}>
            {'Sandboxes'}
            {sandboxes.length > 0 && <TabCount>{sandboxes.length}</TabCount>}
          </Tab>
          <Tab active={part === 'details'} onClick={() => setPart('details')}>
            {'Details'}
          </Tab>
        </TabBar>
        <TabPanel id={part}>
          <div role="tabpanel" aria-label={part === 'stores' ? 'Stores' : part === 'details' ? 'Details' : 'Sandboxes'}>
            {part === 'details' ? (
              <MachineDetails
                m={m}
                live={live}
                platform={view.platforms.find((p) => p.platform === m.platform)}
                layerfs={view.layerfs}
                sandboxes={sandboxes}
                stores={stores}
                postgresql={(view.postgresql ?? []).length}
                pending={pending}
                onSettings={() => setDialog('settings')}
                onRemove={() => setDialog('remove')}
              />
            ) : part === 'stores' ? (
              <MachineData m={m} sqlite={stores} postgresql={view.postgresql ?? []} running={running} onOpenProject={onOpenProject} />
            ) : sandboxes.length === 0 ? (
              <Card index={1} className="p-2">
                <p className="px-2 py-3 text-md text-muted-foreground">{m.platform === 'native' && os === 'win32' ? 'Native on Windows keeps records only; Sandboxes run on docker.' : 'Nothing runs here. A project’s Sandboxes tab starts one on any machine.'}</p>
              </Card>
            ) : (
              <MachineSandboxes sandboxes={sandboxes} ops={ops} machineImage={m.image} open={open} onToggle={onToggle} onOpenProject={onOpenProject} />
            )}
          </div>
        </TabPanel>
      </section>

      <MachineDialogs m={m} os={os} dialog={dialog} onClose={() => setDialog(null)} pending={pending} run={run} onRemoved={onBack} />
    </div>
  )
}
