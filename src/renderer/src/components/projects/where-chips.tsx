// A project's two relationships, as link chips (docs/ui/layerfs-projects.md):
// "Stored in" names its one Store (opens the Store's page on Storage); "Runs
// on" lists the machines its Sandboxes run on (each opens the machine's page).
// A project lives in one Store but may run in any number of Sandboxes on any
// machines, a PostgreSQL Store's projects especially, so a machine is never
// drawn as the Store's child here. A chip's click stays its own, so a row
// around it does not open.
import { Cpu } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect } from 'react'

import { LfsStore } from '@/components/lfs-icons'
import { go } from '@/components/tabs/go'
import { host, onProjectsChanged } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { MachineSandbox, MachinesView } from '@shared/host-api'

const CHIP = 'inline-flex h-[22px] max-w-full min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.04] px-2 text-[11.5px] text-foreground/85 ring-1 ring-foreground/[0.07] ring-inset outline-none transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

function LinkChip({ icon, title, onClick, className, children }: { icon: ReactNode; title: string; onClick: () => void; className?: string; children: ReactNode }) {
  const click = (e: MouseEvent) => {
    e.stopPropagation()
    onClick()
  }
  return (
    <button type="button" title={title} onClick={click} onKeyDown={(e) => e.stopPropagation()} className={cn(CHIP, className)}>
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}

/** A machine as a chip that opens its page on Machines. */
export function MachineChip({ machine, label, title, className }: { machine: string; label?: ReactNode; title?: string; className?: string }) {
  const { t } = useI18n()
  return (
    <LinkChip icon={<Cpu aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />} title={title ?? t('Open {machine} on Machines', { machine })} onClick={() => go.machine(machine)} className={className}>
      {label ?? machine}
    </LinkChip>
  )
}

/** A Store as a chip that opens its page on Storage. */
export function StoreChip({ store, className }: { store: string; className?: string }) {
  const { t } = useI18n()
  return (
    <LinkChip icon={<LfsStore className="size-3 shrink-0 text-muted-foreground" />} title={t('Open {store} on Storage', { store })} onClick={() => go.store(store)} className={className}>
      {store}
    </LinkChip>
  )
}

// ---------- Runs on ----------

/** One machine a project runs on, and how many of its Sandboxes are there. */
export interface RunsOn {
  machine: string
  sandboxes: number
}

/** A project's Sandboxes by machine: those that still exist, the most Sandboxes first. */
export function runsOn(sandboxes: readonly { machine: string | null; state?: string | null }[] | undefined): RunsOn[] {
  const by = new Map<string, number>()
  for (const b of sandboxes ?? []) if (b.machine && b.state !== 'gone') by.set(b.machine, (by.get(b.machine) ?? 0) + 1)
  return [...by].map(([machine, n]) => ({ machine, sandboxes: n })).sort((a, b) => b.sandboxes - a.sandboxes || a.machine.localeCompare(b.machine))
}

/** sandbox.list by project key; null when the machines were not read (1.x, refused, not yet). */
export function sandboxesByProject(view: MachinesView | null | undefined): Map<string, MachineSandbox[]> | null {
  if (!view?.available) return null
  const by = new Map<string, MachineSandbox[]>()
  for (const b of view.sandboxes) if (b.project) by.set(b.project, [...(by.get(b.project) ?? []), b])
  return by
}

/**
 * The host's machines (for where each project runs), read on mount, when
 * `tick` changes and when projects change; a simulated host's view instead
 * when given (nothing is asked then).
 */
export function useMachinesView(simulated: MachinesView | null, tick = 0): MachinesView | null | undefined {
  const read = useHostQuery(() => (simulated ? Promise.resolve(null) : host.machines()), [simulated, tick], simulated ? undefined : 'machines')
  const { reload } = read
  useEffect(() => (simulated ? undefined : onProjectsChanged(reload)), [simulated, reload])
  return simulated ?? read.data
}

/** `▤ native ×2  ▤ docker`: the machines a project runs on, each a link; "not running" with none. */
export function RunsOnChips({ runs, max = 3, className }: { runs: RunsOn[] | null; max?: number; className?: string }) {
  const { t } = useI18n()
  if (!runs) return <span className="text-xs text-faint">—</span>
  if (runs.length === 0) return <span className={cn('text-xs text-faint', className)}>{t('not running')}</span>
  const shown = runs.slice(0, max)
  const more = runs.length - shown.length
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((r) => (
        <MachineChip
          key={r.machine}
          machine={r.machine}
          title={t(r.sandboxes === 1 ? '1 Sandbox on {machine}' : '{n} Sandboxes on {machine}', { n: r.sandboxes, machine: r.machine })}
          label={r.sandboxes > 1 ? <>{r.machine} <span className="text-muted-foreground tabular-nums">×{r.sandboxes}</span></> : r.machine}
          className="shrink"
        />
      ))}
      {more > 0 && <span className="text-[11px] text-muted-foreground tabular-nums" title={runs.slice(max).map((r) => r.machine).join(', ')}>+{more}</span>}
    </span>
  )
}
