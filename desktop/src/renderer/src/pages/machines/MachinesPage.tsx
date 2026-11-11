import { DoctorAction } from '@/components/doctor/DoctorPanel'
import { StaleRead } from '@/components/layerfs/StaleRead'
import { fill } from '@/lib/text'
// Machines (docs/ui/machines.md): the machines this Connect's LayerFS
// home runs on, the home of machines, Sandboxes and Workspaces. The board: a
// header with New machine and Refresh, one line of facts, a notice per
// machine that needs you, and a grid of machine cards (those that need you
// first), ending with a New machine card. A card opens the machine's page
// (machine-page.tsx: its Sandboxes and Workspaces, Stores and facts) in the
// same tab, so Back returns to the board.
// Stores are only linked here: Storage pushes, pulls and moves them. Machines
// come with LayerFS 2.0; linked to an older LayerFS the page says so and shows
import { Plus, RotateCw, Server } from 'lucide-react'
import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { focusOf, go } from '@/layerfs/go'
import { AddMachineDialog } from '@/pages/machines/AddMachineDialog'
import { MachineTile } from '@/pages/machines/MachineCard'
import { MachinePage } from '@/pages/machines/MachinePage'
import type { SandboxOps } from '@/pages/machines/MachineSandboxes'
import { PageHeader } from '@/components/layerfs/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { Button } from '@/components/ui/button'
import { addable, factsOf, type MachineKey, machineOrder, machineState, type Os } from '@/layerfs/compute'
import type { MachineAction } from '@/layerfs/machine-actions'
import { clearMachineProgress, performMachineStartup, useMachineStartups } from '@/layerfs/use-machine-progress'
import { host } from '@/layerfs/client'
import { useHostQuery, usePoll } from '@/layerfs/use-host'
import { cn } from '@/lib/utils'
import type { MachinesView } from '@/layerfs/host-api'

interface ComputePageProps {
  restoreScroll?: number
  /** Opens a project's page by its key, at one of its tabs (a Sandbox's project link). */
  onOpenProject?: (key: string, tab?: string) => void
  /** The machine whose page shows (`machine:<name>`; go.ts); the board without one. */
  focus?: string
  /** Opens a machine's page (null: the board), in this tab or a new one; go.machine without it. */
  onOpenMachine?: (name: string | null, newTab?: boolean) => void
  /** Back where this tab came from, when a machine's page was opened from another page. */
  back?: { label: string; onBack: () => void }
}

/** This computer's OS, from the preload; the host's status is not read for it. */
const osOfWindow = (): Os => {
  const p = window.desktop?.platform
  return p === 'win32' || p === 'linux' ? p : 'darwin'
}

/** The board's order: machines that need you, then those changing, running, stopped and unknown; native and docker first within each. */
const RANK: Record<MachineKey, number> = { needs: 0, busy: 1, running: 2, stopped: 3, unknown: 4 }

/** The Machines page; App still names it ComputePage. */
export function ComputePage({ onOpenProject, focus, onOpenMachine, back, restoreScroll }: ComputePageProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const restored = useRef<string | null>(null)
  const live = useHostQuery(() => host.machines(), [], 'machines')
  const view: MachinesView | null | undefined = live.data
  const os: Os = osOfWindow()

  const [adding, setAdding] = useState(false)
  const startups = useMachineStartups()
  const starting = new Set(startups.filter(operation => operation.status === 'running').map(operation => operation.name))
  const available = view?.available ? view : null
  const f = focusOf(focus)
  const detail = f?.kind === 'machine' ? f.name : null
  const showMachine = (name: string | null, newTab = false) => (onOpenMachine ? onOpenMachine(name, newTab) : name ? go.machine(name) : undefined)

  const act = async (action: MachineAction) => {
    try {
      if (action.kind === 'create') await performMachineStartup({ kind: 'create', name: action.input.name, platform: action.input.platform }, activity => host.createMachine(action.input, activity))
      else if (action.kind === 'remove') { await host.removeMachine(action.name); clearMachineProgress(action.name) }
      else if (action.kind === 'start') await performMachineStartup({ kind: 'start', name: action.name, platform: available?.machines.find(machine => machine.name === action.name)?.platform ?? 'unknown' }, activity => host.startMachine(action.name, activity))
      else if (action.kind === 'stop') { await host.stopMachine(action.name); clearMachineProgress(action.name) }
      else if (action.kind === 'close') await host.closeSandbox(action.sandbox, action.force)
      else if (action.kind === 'unmount') await host.unmountWorkspace(action.ws, false)
      else await host.updateMachine(action.name, action.changes)
    } finally {
      // A refusal can follow a real side effect (for example a worker protocol mismatch).
      live.reload()
    }
  }
  const ops: SandboxOps = {
    read: async (name) => host.sandbox(name),
    close: async (name, force) => {
      try {
        const done = await host.closeSandbox(name, force)
        return done.unknown ?? []
      } finally { live.reload() }
    },
    unmount: (ws) => act({ kind: 'unmount', ws }),
  }
  const refresh = () => live.reload()

  usePoll(live.reload)
  useLayoutEffect(() => {
    const key = `${detail ?? 'board'}:${restoreScroll}`
    if (!available || restored.current === key || restoreScroll === undefined) return
    restored.current = key
    if (scrollRef.current) scrollRef.current.scrollTop = restoreScroll
  }, [available, restoreScroll, detail])
  const facts = useMemo(() => (available ? factsOf(available) : null), [available])
  // failed, missing or unresolved: each gets a notice with what LayerFS says and the call that clears it
  const machines = available ? machineOrder(available.machines).sort((a, b) => (starting.has(a.name) ? RANK.busy : RANK[machineState(a, available.status[a.name]).key]) - (starting.has(b.name) ? RANK.busy : RANK[machineState(b, available.status[b.name]).key])) : []

  if (detail && available)
    return (
      <div className="h-svh min-w-0 overflow-y-auto" ref={scrollRef} data-machine-scroll>
        <div className="mx-auto flex min-w-0 flex-col gap-4 px-4 pt-1.5 pb-12 @min-[480px]/workspace:px-5">
          <MachinePage key={`${detail}`} name={detail} view={available} os={os} act={act} ops={ops} onChanged={live.reload} onBack={() => showMachine(null)} back={back} onOpenProject={onOpenProject} />
        </div>
      </div>
    )

  return (
    <div className="h-svh min-w-0 overflow-y-auto" ref={scrollRef} data-machine-scroll>
      <PageHeader
        sticky
        className="page-header-solid"
        title={'Machines'}
        actions={
          <div className="flex items-center gap-2">
            <DoctorAction target="host" label="Diagnose this host" />
            {available && (
              <Button size="sm" className="rounded-full px-3.5" onClick={() => setAdding(true)}>
                <Plus />
                {'New machine'}
              </Button>
            )}
            <Button variant="outline" size="sm" className="rounded-full px-3.5" onClick={refresh}>
              <RotateCw />
              {'Refresh'}
            </Button>
          </div>
        }
      />
      <div className="mx-auto flex min-w-0 flex-col gap-4 px-4 pt-2 pb-12 @min-[480px]/workspace:px-5">
        {view && <StaleRead error={live.error} observedAt={live.observedAt} />}
        {available && Object.entries(available.readErrors ?? {}).map(([name, read]) => <p key={name} role="status" className="text-sm text-destructive">{name} could not be read ({new Date(read.at).toLocaleTimeString()}): {read.error.code}</p>)}
        {!view ? (
          live.error ? (
            <LoadError error={live.error} what={'the machines'} onRetry={live.reload} />
          ) : (
            <Loading label={'Reading the machines'} />
          )
        ) : !available ? (
          <Empty icon={Server} title={'Machines come with LayerFS 2.0'} className="glass-liquid rounded-2xl border-solid">
            {`This Connect links LayerFS ${view.layerfs ?? '1.x'}, which has no machines. Projects still run where this home keeps them; this page fills in once Connect links LayerFS 2.0.`}
          </Empty>
        ) : (
          <>
            <p className="reveal flex min-h-9 flex-wrap items-center gap-y-1 text-md text-muted-foreground tabular-nums" style={{ '--i': 0 } as CSSProperties}>
              {[
                <span className={cn(facts!.running > 0 && 'text-foreground')}>{`${facts!.running} running`}</span>,
                <span>{`${facts!.stopped} stopped`}</span>,
                starting.size > 0 && <span>{`${starting.size} ${starting.size === 1 ? 'startup' : 'startups'} in progress`}</span>,
                facts!.busy > 0 && <span>{`${facts!.busy} creating or removing`}</span>,
                facts!.unknown > 0 && <span>{`${facts!.unknown} unknown`}</span>,
                <span>{fill(facts!.sandboxes === 1 ? '1 Sandbox' : '{n} Sandboxes', { n: facts!.sandboxes })}</span>,
                <span>{available.sandboxes.some((b) => b.workspaces == null) ? 'Workspace count unknown' : fill(facts!.workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: facts!.workspaces })}</span>,
                facts!.needs > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
                    {fill(facts!.needs === 1 ? '1 needs you' : '{n} need you', { n: facts!.needs })}
                  </span>
                ),
                facts!.ops > 0 && <span className="text-foreground">{fill(facts!.ops === 1 ? '1 operation in flight' : '{n} operations in flight', { n: facts!.ops })}</span>,
              ]
                .filter(Boolean)
                .map((part, i) => (
                  // each part carries its dot, so a wrapped line starts with one instead of ending on one
                  <span key={i} className="inline-flex items-center whitespace-nowrap">
                    {i > 0 && <Dot />}
                    {part}
                  </span>
                ))}
            </p>

            <section className="machine-board-grid" aria-label={'Machines'}>
              {machines.map((m, i) => (
                <MachineTile key={`${m.name}`} m={m} view={available} os={os} index={Math.min(i + 2, 12)} act={act} onOpen={(newTab) => showMachine(m.name, newTab)} />
              ))}
            </section>

            <p className="px-1 pt-2 text-sm text-faint">{'Machine power is manual: a machine runs between Start and Stop, and nothing starts or stops one by itself. Reading this page starts nothing.'}</p>
            <AddMachineDialog open={adding} onOpenChange={setAdding} platforms={addable(available.platforms)} machines={available.machines} os={os} act={act} onMade={showMachine} layerfs={available.layerfs} />
          </>
        )}
      </div>
    </div>
  )
}

const Dot = () => (
  <span aria-hidden="true" className="px-2 text-faint">
    ·
  </span>
)
