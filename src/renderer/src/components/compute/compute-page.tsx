import { t, useI18n } from '@/i18n'
// Compute (docs/ui/layerfs-compute.md): the machines this Connect's LayerFS
// home runs on. A header with New machine and Refresh, one line of facts, a
// notice per machine that is down, the Machines table (native and docker
// first), Add a machine, and a footnote on when machines start and stop.
// Machines come with LayerFS 2.0; linked to an older LayerFS the page says so
// and shows nothing else. Dev builds can draw it on a simulated host
// (data/compute-sim.ts).
import { ChevronDown, FlaskConical, Plus, RotateCw, Server, TriangleAlert } from 'lucide-react'
import { type CSSProperties, useMemo, useState } from 'react'

import { AddMachine } from '@/components/compute/add-machine'
import { MachinesTable } from '@/components/compute/machines-table'
import { KindLabel, SectionTitle } from '@/components/compute/target-parts'
import { PageHeader } from '@/components/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { Chip } from '@/components/storage/chips'
import { Notice } from '@/components/storage/notice'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { downReason, factsOf, isVmKind, kindLabel, machineOrder, machineState, type Os, readyKinds } from '@/data/compute'
import { isSimId, type MachineAction, SIM_IDS, simulate, SIMULATIONS, type SimId } from '@/data/compute-sim'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { MachinesView } from '@shared/host-api'

const SIM_KEY = 'connect.compute.simulate'
const LIVE = 'live'
const readSim = (): SimId | null => {
  try {
    const v = localStorage.getItem(SIM_KEY)
    return isSimId(v) ? v : null
  } catch {
    return null
  }
}

/** Dev builds only: draw the page on a simulated host. */
function SimulationPicker({ value, onChange }: { value: SimId | null; onChange: (v: SimId | null) => void }) {
  useI18n()
  return (
    <Select value={value ?? LIVE} onValueChange={(v) => onChange(isSimId(v) ? v : null)}>
      <SelectTrigger size="sm" aria-label={t('Simulate a host')} className="h-8 rounded-full px-3 text-xs">
        <FlaskConical aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={LIVE}>{t('Live host')}</SelectItem>
        {SIM_IDS.map((id) => (
          <SelectItem key={id} value={id}>
            {t(SIMULATIONS[id].label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface ComputePageProps {
  /** Draw a simulated host instead of asking this one (the harness). */
  simulate?: SimId
}

/** This computer's OS, from the preload; the host's status is not read for it. */
const osOfWindow = (): Os => {
  const p = (window as unknown as { connect?: { platform?: string } }).connect?.platform
  return p === 'win32' || p === 'linux' ? p : 'darwin'
}

export function ComputePage({ simulate: given }: ComputePageProps) {
  useI18n()
  const [picked, setPicked] = useState<SimId | null>(() => (import.meta.env.DEV ? readSim() : null))
  const sim = given ?? picked
  const pick = (v: SimId | null) => {
    setPicked(v)
    setSimView(null)
    try {
      if (v) localStorage.setItem(SIM_KEY, v)
      else localStorage.removeItem(SIM_KEY)
    } catch {
      /* the choice just isn't remembered */
    }
  }

  const live = useHostQuery(() => (sim ? Promise.resolve(null) : host.machines()), [sim])
  // a simulated host's actions change a copy in memory
  const [simView, setSimView] = useState<MachinesView | null>(null)
  const simulated = sim ? SIMULATIONS[sim] : null
  const view: MachinesView | null | undefined = simulated ? (simView ?? simulated.view) : live.data
  const os: Os = simulated?.os ?? osOfWindow()

  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const showMachine = (name: string) => {
    setOpen(name)
    requestAnimationFrame(() => document.getElementById(`machine-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const startAdding = (platform: string) => {
    setAdding(platform)
    requestAnimationFrame(() => document.getElementById(`add-${platform}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const act = async (action: MachineAction) => {
    if (simulated) {
      setSimView((v) => simulate(v ?? simulated.view, action))
      return
    }
    if (action.kind === 'create') await host.createMachine(action.input)
    else if (action.kind === 'remove') await host.removeMachine(action.name)
    else if (action.kind === 'move') await host.moveStore(action.store, action.machine)
    else await host.updateMachine(action.name, action.changes)
    live.reload()
  }
  const refresh = () => (simulated ? setSimView(null) : live.reload())

  const available = view?.available ? view : null
  const facts = useMemo(() => (available ? factsOf(available) : null), [available])
  const down = available ? machineOrder(available.machines).filter((m) => machineState(m, available.status[m.name]).key === 'down') : []
  const ready = available ? readyKinds(available.canCreate) : []

  return (
    <div className="h-svh min-w-0 overflow-y-auto">
      <PageHeader
        sticky
        className="page-header-solid"
        width="max-w-5xl"
        title={t('Compute')}
        actions={
          <div className="flex items-center gap-2">
            {import.meta.env.DEV && !given && <SimulationPicker value={picked} onChange={pick} />}
            {available && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="rounded-full px-3.5" disabled={ready.length === 0}>
                    <Plus />
                    {t('New machine')}
                    <ChevronDown className="size-3.5 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuLabel className="text-xs">{t('Ready on this computer')}</DropdownMenuLabel>
                  {ready.map((c) => (
                    <DropdownMenuItem key={c.platform} onSelect={() => startAdding(c.platform)}>
                      <KindLabel platform={c.platform} os={os} hideName />
                      <span>{t(c.platform === 'ssh' ? 'Connect an SSH host' : '{kind} VM', { kind: t(kindLabel(c.platform)) })}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" size="sm" className="rounded-full px-3.5" onClick={refresh}>
              <RotateCw />
              {t('Refresh')}
            </Button>
          </div>
        }
      />
      <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-4 px-4 pt-2 pb-12 @min-[30rem]/workspace:px-6 @min-[56rem]/workspace:px-8">
        {simulated && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Chip tone="warning" icon={FlaskConical}>
              {t('Simulated')}
            </Chip>
            {t('{label}: sample data, not this machine.', { label: t(simulated.label) })}
          </p>
        )}
        {!view ? (
          live.error ? (
            <LoadError error={live.error} what={t('the machines')} onRetry={live.reload} />
          ) : (
            <Loading label={t('Reading the machines')} />
          )
        ) : !available ? (
          <Empty icon={Server} title={t('Machines come with LayerFS 2.0')} className="glass-liquid rounded-2xl border-solid">
            {t('This Connect links LayerFS {version}, which has no machines. Projects still run where this home keeps them; this page fills in once Connect links LayerFS 2.0.', { version: view.layerfs ?? '1.x' })}
          </Empty>
        ) : (
          <>
            <p className="reveal flex min-h-9 flex-wrap items-center gap-y-1 text-[13px] text-muted-foreground tabular-nums" style={{ '--i': 0 } as CSSProperties}>
              {[
                <span>{t('{n} ready', { n: facts!.ready })}</span>,
                <span className={cn(facts!.running > 0 && 'text-foreground')}>{t('{n} running', { n: facts!.running })}</span>,
                <span>{t('{n} idle', { n: facts!.idle })}</span>,
                facts!.starting > 0 && <span>{t('{n} starting', { n: facts!.starting })}</span>,
                <span>{t(facts!.sandboxes === 1 ? '1 Sandbox' : '{n} Sandboxes', { n: facts!.sandboxes })}</span>,
                facts!.down > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
                    {t(facts!.down === 1 ? '1 needs you' : '{n} need you', { n: facts!.down })}
                  </span>
                ),
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

            {down.map((m) => (
              <Notice
                key={m.name}
                tone="danger"
                icon={TriangleAlert}
                title={t('{machine} is down', { machine: m.name })}
                actions={
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => showMachine(m.name)}>
                    {t('Show')}
                  </Button>
                }
              >
                <span className="block break-words">{downReason(m, available.status[m.name]) ?? t('It does not answer.')}</span>
                {m.stores.length > 0 && <span className="block text-muted-foreground">{t(m.stores.length === 1 ? 'Its Store can’t be used until it answers.' : 'Its {n} Stores can’t be used until it answers.', { n: m.stores.length })}</span>}
              </Notice>
            ))}

            <section className="flex flex-col gap-2.5 pt-2" aria-labelledby="machines-title">
              <SectionTitle id="machines-title" aside={String(available.machines.length)}>
                {t('Machines')}
              </SectionTitle>
              <MachinesTable key={sim ?? 'live'} view={available} os={os} open={open} onOpen={setOpen} act={act} />
            </section>

            <section className="flex flex-col gap-2.5 pt-4" aria-labelledby="add-title">
              <SectionTitle id="add-title">{t('Add a machine')}</SectionTitle>
              <AddMachine canCreate={available.canCreate.filter((c) => isVmKind(c.platform) || c.platform === 'ssh')} machines={available.machines} os={os} open={adding} onOpen={setAdding} act={act} onMade={showMachine} layerfs={available.layerfs} />
            </section>

            <p className="px-1 pt-2 text-xs text-faint">{t('Machines start on the first call that needs them and stop after 10 idle minutes.')}</p>
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
