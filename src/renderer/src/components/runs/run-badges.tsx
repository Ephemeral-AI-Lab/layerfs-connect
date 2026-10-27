import type { AgentState, RunState, RunSummary, SegmentKind } from '@shared/host-api'
import { Ban, LoaderCircle } from 'lucide-react'

import { AGENT_TONE, KIND, KIND_ORDER, RUN_LABEL, RUN_TONE, ago, isLive, runLabel } from '@/components/runs/run-format'
import { Chip, DOT, type Tone } from '@/components/storage/chips'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** A state dot; while live it glows and sends out a ring (`pulse-ring`), at rest it is still. */
export function StateDot({ tone, live, label, className }: { tone: Tone; live?: boolean; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={cn('relative flex size-2 shrink-0', className)}>
      <span
        className={cn(
          'size-2 rounded-full transition-colors duration-(--dur-base)',
          DOT[tone],
          live ? 'pulse-ring' : 'shadow-[0_0_0_2.5px_color-mix(in_oklab,currentColor_13%,transparent)]',
        )}
      />
    </span>
  )
}

export function RunDot({ state, className }: { state: RunState; className?: string }) {
  return (
    <StateDot
      tone={RUN_TONE[state]}
      live={state === 'running' || state === 'starting'}
      label={RUN_LABEL[state]}
      className={className}
    />
  )
}

export function AgentDot({ state }: { state: AgentState }) {
  return <StateDot tone={AGENT_TONE[state]} live={state === 'running'} label={state} />
}

export function RunStateBadge({ state }: { state: RunState }) {
  const live = state === 'running' || state === 'starting'
  const icon = state === 'stopped' ? Ban : undefined
  return (
    <Chip tone={RUN_TONE[state]} live={live} icon={icon}>
      {RUN_LABEL[state]}
    </Chip>
  )
}

/** A kind chip: "workspace.exec", "fs", … coloured by segment kind. */
export function KindChip({ kind, children, className }: { kind: SegmentKind; children?: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full pr-2 pl-1.5 font-mono text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        KIND[kind].chip,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', KIND[kind].dot)} />
      {children ?? KIND[kind].label}
    </span>
  )
}

/** What each kind colour means. */
export function KindLegend({ kinds, counts, className }: { kinds?: SegmentKind[]; counts?: Partial<Record<SegmentKind, number>>; className?: string }) {
  const shown = KIND_ORDER.filter((k) => !kinds || kinds.includes(k))
  return (
    <ul aria-label="Kinds" className={cn('flex flex-wrap gap-x-3 gap-y-1.5', className)}>
      {shown.map((k) => (
        <li key={k} title={KIND[k].about} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className={cn('size-2 rounded-[3px]', KIND[k].dot)} />
          <span className="text-foreground/85">{KIND[k].label}</span>
          {counts?.[k] !== undefined && <span className="text-faint tabular-nums">{counts[k]}</span>}
        </li>
      ))}
    </ul>
  )
}

export const Spinner = ({ className }: { className?: string }) => (
  <LoaderCircle aria-label="Running" className={cn('size-3.5 shrink-0 animate-spin text-primary', className)} />
)

/**
 * Shows, on hover or focus, the session an agent belongs to: "Session 7 ·
 * playing" or "Session 7 · started 5 min ago". Pages name the project and the
 * agent; the session is a detail behind them.
 */
export function SessionHint({ run, now, children }: { run: Pick<RunSummary, 'id' | 'project' | 'replay' | 'state' | 'started'>; now?: number; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        {runLabel(run)} · {isLive(run.state) ? 'playing' : `started ${ago(run.started, now)}`}
      </TooltipContent>
    </Tooltip>
  )
}
