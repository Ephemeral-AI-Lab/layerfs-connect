import type { AgentState, RunState, SegmentKind } from '@shared/host-api'
import { Ban, Check, LoaderCircle, X } from 'lucide-react'

import { AGENT_TONE, KIND, KIND_ORDER, RUN_LABEL, RUN_TONE } from '@/components/runs/run-format'
import { Chip, type Tone } from '@/components/storage/chips'
import { cn } from '@/lib/utils'

const DOT: Record<Tone, string> = {
  neutral: 'bg-idle',
  success: 'bg-success',
  info: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-destructive',
}

/** A state dot; it pulses while live. */
export function StateDot({ tone, live, label, className }: { tone: Tone; live?: boolean; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} title={label} className={cn('relative flex size-2 shrink-0', className)}>
      {live && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', DOT[tone])} />}
      <span className={cn('relative size-2 rounded-full', DOT[tone])} />
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

const RUN_ICON = { passed: Check, failed: X, stopped: Ban } as const

export function RunStateBadge({ state }: { state: RunState }) {
  const live = state === 'running' || state === 'starting'
  const icon = live ? undefined : RUN_ICON[state]
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
        'inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        KIND[kind].chip,
        className,
      )}
    >
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

/** A thin progress bar. */
export function Progress({ done, of, tone = 'info', className }: { done: number; of: number; tone?: Tone; className?: string }) {
  const pct = of > 0 ? Math.min(100, (done / of) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={of}
      aria-valuenow={done}
      className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', DOT[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}
