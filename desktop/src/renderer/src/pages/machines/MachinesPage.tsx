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
// nothing else. Dev builds can draw it on a simulated host (data/compute-sim.ts).
import { Plus, RotateCw, Server, TriangleAlert } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'

import { SimulatedNote, SimulationPicker, useSimulation } from '@/components/layerfs/Simulation'
import { focusOf, go } from '@/layerfs/go'
import { AddMachineDialog } from '@/pages/machines/AddMachineDialog'
import { MachineTile, NewMachineTile } from '@/pages/machines/MachineCard'
import { MachinePage } from '@/pages/machines/MachinePage'
import type { SandboxOps } from '@/pages/machines/MachineSandboxes'
import { PageHeader } from '@/components/layerfs/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { Notice } from '@/pages/storage/Notice'
import { Button } from '@/components/ui/button'
import { clearingCall } from '@/layerfs/states'
import { addable, downReason, factsOf, type MachineKey, machineOrder, machineState, type Os } from '@/layerfs/compute'
import { type MachineAction, type SimHost, simSandbox, simulate, SIMULATIONS, type SimId } from '@/layerfs/compute-sim'
import { host } from '@/layerfs/client'
import { useHostQuery, usePoll } from '@/layerfs/use-host'
import { cn } from '@/lib/utils'
import type { MachinesView } from '@/layerfs/host-api'

interface ComputePageProps {
  /** Draw a simulated host instead of asking this one (the harness). */
  simulate?: SimId
  /** Opens a project's page by its key, at one of its tabs (a Sandbox's project link). */
  onOpenProject?: (key: string, tab?: string) => void
  /** The machine whose page shows (`machine:<name>`; go.ts); the board without one. */
  focus?: string
  /** Opens a machine's page (null: the board), in this tab or a new one; go.machine without it. */
  onOpenMachine?: (name: string | null, newTab?: boolean) => void
  /** Back where this tab came from, when a machine's page was opened from another page. */
  back?: { label: string; onBack: () => void }
}

type Available = Extract<MachinesView, { available: true }>

/** This computer's OS, from the preload; the host's status is not read for it. */
const osOfWindow = (): Os => {
  const p = window.desktop?.platform
  return p === 'win32' || p === 'linux' ? p : 'darwin'
}

/** The Sandbox rows open at first on a machine's page: those with Workspaces, while they are few (each open row reads sandbox.get). */
const FIRST_OPEN = 12
const firstOpen = (v: Available | null, machine: string | null) => {
  const with_ = v && machine ? v.sandboxes.filter((b) => b.machine === machine && (b.workspaces ?? 0) > 0).map((b) => b.name) : []
  return new Set(with_.length <= FIRST_OPEN ? with_ : [])
}

/** The board's order: machines that need you, then those changing, running, stopped and unknown; native and docker first within each. */
const RANK: Record<MachineKey, number> = { needs: 0, busy: 1, running: 2, stopped: 3, unknown: 4 }

/** The Machines page; App still names it ComputePage. */
export function ComputePage({ simulate: given, onOpenProject, focus, onOpenMachine, back }: ComputePageProps) {
  const picked = useSimulation()
  const sim = given ?? picked
  // another host picked: its own copy, its own open rows
  useEffect(() => {
    setSim(null)
    setOpenBoxes(null)
  }, [sim])

  const live = useHostQuery(() => (sim ? Promise.resolve(null) : host.machines()), [sim])
  // a simulated host's actions change a copy in memory; the ref keeps the latest for actions in a row (a create, then a start)
  const [simHost, setSimHost] = useState<SimHost | null>(null)
  const simRef = useRef<SimHost | null>(null)
  const setSim = (h: SimHost | null) => {
    simRef.current = h
    setSimHost(h)
  }
  const simulated = sim ? SIMULATIONS[sim] : null
  const simNow = simulated ? (simHost ?? simulated) : null
  const view: MachinesView | null | undefined = simNow ? simNow.view : live.data
  const os: Os = simulated?.os ?? osOfWindow()

  const [adding, setAdding] = useState(false)
  const [openBoxes, setOpenBoxes] = useState<Set<string> | null>(null)
  const available = view?.available ? view : null
  const f = focusOf(focus)
  const detail = f?.kind === 'machine' ? f.name : null
  // another machine's page: its own open rows
  useEffect(() => setOpenBoxes(null), [detail])
  const open = openBoxes ?? firstOpen(available, detail)
  const toggle = (name: string) => {
    const next = new Set(open)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setOpenBoxes(next)
  }
  const showMachine = (name: string | null, newTab = false) => (onOpenMachine ? onOpenMachine(name, newTab) : name ? go.machine(name) : undefined)

  const act = async (action: MachineAction) => {
    if (simulated) {
      setSim(simulate(simRef.current ?? simulated, action))
      return
    }
    if (action.kind === 'create') await host.createMachine(action.input)
    else if (action.kind === 'remove') await host.removeMachine(action.name)
    else if (action.kind === 'start') await host.startMachine(action.name)
    else if (action.kind === 'stop') await host.stopMachine(action.name)
    else if (action.kind === 'close') await host.closeSandbox(action.sandbox, action.force)
    else if (action.kind === 'unmount') await host.unmountWorkspace(action.ws, false)
    else await host.updateMachine(action.name, action.changes)
    live.reload()
  }
  const ops: SandboxOps = {
    read: async (name) => (simulated ? simSandbox(simRef.current ?? simulated, name) : host.sandbox(name)),
    close: async (name, force) => {
      if (simulated) return act({ kind: 'close', sandbox: name, force }).then(() => [])
      const done = await host.closeSandbox(name, force)
      live.reload()
      return done.unknown ?? []
    },
    unmount: (ws) => act({ kind: 'unmount', ws }),
  }
  const refresh = () => (simulated ? setSim(null) : live.reload())

  // machine.list and sandbox.list carry state and op (§8.9); a simulated host is not read
  usePoll(live.reload, undefined, !simulated)
  const facts = useMemo(() => (available ? factsOf(available) : null), [available])
  // failed, missing or unresolved: each gets a notice with what LayerFS says and the call that clears it
  const machines = available ? machineOrder(available.machines).sort((a, b) => RANK[machineState(a, available.status[a.name]).key] - RANK[machineState(b, available.status[b.name]).key]) : []
  const down = available ? machines.filter((m) => machineState(m, available.status[m.name]).key === 'needs') : []

  if (detail && available)
    return (
      <div className="h-svh min-w-0 overflow-y-auto">
        <div className="mx-auto flex min-w-0 flex-col gap-4 px-4 pt-1.5 pb-12 @min-[480px]/workspace:px-5">
          {simulated && <SimulatedNote sim={simulated} />}
          <MachinePage key={`${sim ?? 'live'}:${detail}`} name={detail} view={available} os={os} act={act} ops={ops} open={open} onToggle={toggle} onBack={() => showMachine(null)} back={back} onOpenProject={onOpenProject} />
        </div>
      </div>
    )

  return (
    <div className="h-svh min-w-0 overflow-y-auto">
      <PageHeader
        sticky
        className="page-header-solid"
        title={'Machines'}
        actions={
          <div className="flex items-center gap-2">
            {!given && <SimulationPicker />}
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
        {simulated && <SimulatedNote sim={simulated} />}
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
                facts!.busy > 0 && <span>{`${facts!.busy} creating or removing`}</span>,
                facts!.unknown > 0 && <span>{`${facts!.unknown} unknown`}</span>,
                <span>{fill(facts!.sandboxes === 1 ? '1 Sandbox' : '{n} Sandboxes', { n: facts!.sandboxes })}</span>,
                <span>{fill(facts!.workspaces === 1 ? '1 Workspace' : '{n} Workspaces', { n: facts!.workspaces })}</span>,
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

            {down.map((m) => {
              const st = machineState(m, available.status[m.name])
              const calls = clearingCall('machine', m.name, st.op)
              return (
              <Notice
                key={m.name}
                tone="danger"
                icon={TriangleAlert}
                title={st.state === 'unresolved' ? `${m.name}: unresolved ${st.op?.name ?? 'operation'}` : `${m.name} is ${st.label.toLowerCase()}`}
                actions={
                  <Button size="sm" variant="outline" className="rounded-lg-plus" onClick={() => showMachine(m.name)}>
                    {'Show'}
                  </Button>
                }
              >
                {downReason(m, available.status[m.name]) && <span className="block break-words">{downReason(m, available.status[m.name])}</span>}
                {st.state === 'unresolved' && (
                  <span className="block font-mono text-xs-plus text-muted-foreground">
                    {`see ${calls.status} · clear: ${calls.clear}`}
                  </span>
                )}
                {m.stores.length > 0 && <span className="block text-muted-foreground">{fill(m.stores.length === 1 ? 'Its Store can’t be used until it answers.' : 'Its {n} Stores can’t be used until it answers.', { n: m.stores.length })}</span>}
              </Notice>
              )
            })}

            <section className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4" aria-label={'Machines'}>
              {machines.map((m, i) => (
                <MachineTile key={`${sim ?? 'live'}:${m.name}`} m={m} view={available} os={os} index={Math.min(i + 2, 12)} act={act} onOpen={(newTab) => showMachine(m.name, newTab)} />
              ))}
              <NewMachineTile index={Math.min(machines.length + 2, 13)} kinds={addable(available.platforms).filter((p) => p.ready).map((p) => p.platform)} onClick={() => setAdding(true)} />
            </section>

            <p className="px-1 pt-2 text-sm text-faint">{'Machine power is manual: a machine runs between Start and Stop, and nothing starts or stops one by itself. Reading this page starts nothing.'}</p>
            <AddMachineDialog key={sim ?? 'live'} open={adding} onOpenChange={setAdding} platforms={addable(available.platforms)} machines={available.machines} os={os} act={act} onMade={showMachine} layerfs={available.layerfs} />
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
