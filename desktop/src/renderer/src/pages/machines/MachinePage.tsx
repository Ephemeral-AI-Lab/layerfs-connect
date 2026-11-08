import { fill } from '@/lib/text'
// One machine console: persistent hardware header, square Sandbox grid by
// default, an alternate Stores view, and a disclosure for technical details.
import { ArrowLeft, ArrowRight, ChevronRight, Settings2, Server } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { attentionOf, MachineDialogs, MachineMenu, PowerButton, useMachineRun } from '@/pages/machines/MachineCard'
import { MachineData, machineStoreCount } from '@/pages/machines/MachineData'
import { MachineDetails } from '@/pages/machines/MachineDetails'
import { MachineSandboxes, type SandboxOps } from '@/pages/machines/MachineSandboxes'
import { KindLabel } from '@/pages/machines/TargetParts'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/layerfs/States'
import { Refusal } from '@/components/layerfs/Refusal'
import { StateChip } from '@/components/layerfs/StateChip'
import { Card } from '@/pages/storage/RowParts'
import { Crumbs } from '@/components/layerfs/Crumbs'
import { downReason, gib, kindLabel, machineState, type Os, sizeOf, storesOn } from '@/layerfs/compute'
import type { MachineAction } from '@/layerfs/compute-sim'
import { clearingCall } from '@/layerfs/states'
import { cn } from '@/lib/utils'
import type { MachineSandbox, MachinesView } from '@/layerfs/host-api'

type Available = Extract<MachinesView, { available: true }>
type Part = 'sandboxes' | 'stores'

interface Props {
  name: string
  view: Available
  os: Os
  act: (action: MachineAction) => Promise<void>
  ops: SandboxOps
  /** The Machines board. */
  onBack: () => void
  /** Back where this tab came from (another page), when it came from one. */
  back?: { label: string; onBack: () => void }
  onOpenProject?: (key: string, tab?: string) => void
}

/** A machine's Sandboxes by project key (those with none last), then by name. */
const byProject = (sandboxes: MachineSandbox[]): MachineSandbox[] =>
  [...sandboxes].sort((a, b) => Number(!a.project) - Number(!b.project) || (a.project ?? '').localeCompare(b.project ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }))

export function MachinePage({ name, view, os, act, ops, onBack, back: backTo, onOpenProject }: Props) {
  const { run, pending, error } = useMachineRun(act)
  const [dialog, setDialog] = useState<'settings' | 'remove' | null>(null)
  const [tabParams, setTabParams] = useSearchParams()
  const requested = tabParams.get('view')
  const sampleMetrics = import.meta.env.DEV && tabParams.get('metrics') === 'sample'
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
  const knownWorkspaces = sandboxes.reduce((n, b) => n + (b.workspaces ?? 0), 0)
  const workspaces = sandboxes.some((b) => b.workspaces == null) ? 'Unknown' : knownWorkspaces
  const storeCount = machineStoreCount(m, stores, view.postgresql ?? [])
  const part: Part = requested === 'stores' ? 'stores' : 'sandboxes'
  const setPart = (next: Part) => setTabParams(prev => { const params = new URLSearchParams(prev); params.set('view',next); return params }, { replace: true })
  const attention = attentionOf(m, live)
  // the disk bar says what is free; the size line leaves it out then
  const size = sizeOf(m, os, live)
  const calls = clearingCall('machine', m.name, state.op)

  return (
    <div className="machine-workbench">
      <div className="machine-console">
        <div className="machine-console-nav">
          <Crumbs back={backTo} items={[{ label: 'Machines', onClick: onBack, title: 'All machines' }]} />
          <div className="flex items-center gap-1.5">
            <PowerButton m={m} pending={pending} run={run} className="h-7 px-2.5" />
            {(m.platform === 'native' || m.platform === 'docker') && <Button variant="ghost" size="sm" onClick={() => setDialog('settings')} disabled={pending !== null}>
              <Settings2 className="size-3.5" /> Settings
            </Button>}
            <MachineMenu m={m} pending={pending} run={run} onDialog={setDialog} />
          </div>
        </div>
        <header className="machine-console-identity">
          <KindLabel platform={m.platform} os={os} hideName className="shrink-0 [&>span]:size-8 [&>span_svg]:size-4" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-medium tracking-tight" title={m.name}>{m.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{fill(kindLabel(m.platform))} · {fill(size.text, size.values)}</p>
          </div>
          <StateChip entity="machine" state={state.state} op={state.op} />
        </header>
        <div className="machine-hardware-line">
          <dl className="machine-hardware" aria-label="Machine resources">
            {m.platform === 'native' ? <div><dt>Resources</dt><dd>Shared with this computer</dd></div> : <>
              <div><dt>CPU</dt><dd>{m.cpus ?? 'Not reported'}</dd></div>
              <div><dt>Memory</dt><dd>{m.memory != null ? gib(m.memory) : 'Not reported'}</dd></div>
              <div><dt>Disk</dt><dd>{m.disk != null ? gib(m.disk) : 'Not reported'}</dd></div>
            </>}
            {live?.freeDisk != null && <div><dt>Free disk (guest)</dt><dd className="flex items-center gap-2">
              {gib(live.freeDisk)}
            </dd></div>}
          </dl>
        </div>
        <details className="machine-technical" open={requested === 'details' ? true : undefined}>
          <summary><ChevronRight className="size-3.5" /> Technical details</summary>
          <div className="pt-4">
            <MachineDetails m={m} live={live} platform={view.platforms.find(p => p.platform === m.platform)}
              layerfs={view.layerfs} sandboxes={sandboxes} stores={stores} postgresql={(view.postgresql ?? []).length}
              pending={pending} onSettings={() => setDialog('settings')} onRemove={() => setDialog('remove')} />
          </div>
        </details>
        {(reason || error !== null || state.state === 'unresolved') && (
          <div className={cn('flex flex-col gap-1 rounded-lg-plus px-3.5 py-2.5 text-sm', attention === 'danger' ? 'bg-destructive/[0.06] text-destructive' : 'bg-muted/60')}>
            {reason && <p className="break-words">{reason}</p>}
            {state.state === 'unresolved' && <p className="font-mono text-xs-plus">{`see ${calls.status} · clear: ${calls.clear}`}</p>}
            {m.stores.length > 0 && attention === 'danger' && <p className="text-muted-foreground">{fill(m.stores.length === 1 ? 'Its Store can’t be used until it answers.' : 'Its {n} Stores can’t be used until it answers.', { n: m.stores.length })}</p>}
            {error !== null && <Refusal error={error} />}
          </div>
        )}
      </div>

      <section aria-labelledby="machine-content-heading" className="machine-inventory">
        <div className="machine-view-heading">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="machine-content-heading" className="machine-section-label">
              {part === 'sandboxes' ? 'Sandboxes' : 'Stores'}
              <span className="text-faint"> · </span>
              <span className="text-muted-foreground">{part === 'sandboxes' ? sandboxes.length : storeCount}</span>
            </h2>
            <span className="text-xs text-muted-foreground">
              {part === 'sandboxes'
                ? `${workspaces} ${workspaces === 1 ? 'Workspace' : 'Workspaces'}`
                : 'Local SQLite and supported PostgreSQL Stores'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {import.meta.env.DEV && part === 'sandboxes' && <Button variant="ghost" size="sm" aria-pressed={sampleMetrics} onClick={() => setTabParams(prev => {
              const params = new URLSearchParams(prev)
              if (sampleMetrics) params.set('metrics', 'off')
              else params.set('metrics', 'sample')
              return params
            }, { replace: true })}>{sampleMetrics ? 'Hide sample readings' : 'Preview sample readings'}</Button>}
          <Button variant="outline" size="sm" className="machine-view-switch" onClick={() => setPart(part === 'sandboxes' ? 'stores' : 'sandboxes')}>
            {part === 'stores' && <ArrowLeft className="size-3.5" />}
            {part === 'sandboxes' ? `Stores ${storeCount}` : `Sandboxes ${sandboxes.length}`}
            {part === 'sandboxes' && <ArrowRight className="size-3.5" />}
          </Button>
          </div>
        </div>
        {part === 'stores' ? (
          <MachineData m={m} sqlite={stores} postgresql={view.postgresql ?? []} running={running} onOpenProject={onOpenProject} />
        ) : sandboxes.length === 0 ? (
          <Card index={1} className="p-2">
            <p className="px-2 py-3 text-md text-muted-foreground">{m.platform === 'native' && os === 'win32' ? 'Native on Windows keeps records only; Sandboxes run on docker.' : 'Nothing runs here. Open a project’s Sandboxes tab to create one on this machine.'}</p>
          </Card>
        ) : (
          <MachineSandboxes sampleMetrics={sampleMetrics} sandboxes={sandboxes} ops={ops} onOpenProject={onOpenProject} />
        )}
      </section>

      <MachineDialogs m={m} os={os} dialog={dialog} onClose={() => setDialog(null)} pending={pending} run={run} onRemoved={onBack} />
    </div>
  )
}
