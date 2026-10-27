import type { CheckResult, SegmentKind, TraceCall } from '@shared/host-api'
import { Check, CircleDashed, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { KindChip } from '@/components/runs/run-badges'
import { type AgentColor, KIND, KIND_ORDER, methodKind, stepNo } from '@/components/runs/run-format'
import { Windowed, WindowedScroller } from '@/components/runs/windowed-list'
import { cn } from '@/lib/utils'

const CHUNK = 40
const ROW = 30

function time(start: string): string {
  const d = new Date(start)
  if (Number.isNaN(d.getTime())) return start
  return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** The final checks of a run. */
export function FinalChecks({ checks, live }: { checks: CheckResult[]; live: boolean }) {
  if (checks.length === 0)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleDashed aria-hidden="true" className="size-4 text-faint" />
        {live ? 'Final checks run after the root agent’s last step.' : 'This run has no final checks.'}
      </p>
    )
  const passed = checks.filter((c) => c.ok).length
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {passed} of {checks.length} passed
      </p>
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
        {checks.map((c, i) => (
          <li key={`${c.name}:${i}`} className="flex items-start gap-2.5 px-3 py-2">
            {c.ok ? (
              <Check aria-label="passed" className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={2.5} />
            ) : (
              <X aria-label="failed" className="mt-0.5 size-4 shrink-0 text-destructive" strokeWidth={2.5} />
            )}
            <span className="font-mono text-[13px] font-medium">{c.name}</span>
            <span className={cn('min-w-0 flex-1 text-[13px] break-words', c.ok ? 'text-muted-foreground' : 'text-destructive')}>{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Family = SegmentKind | 'all' | 'failed'

interface TraceTabProps {
  calls: TraceCall[]
  checks: CheckResult[]
  live: boolean
  colorOf: (name: string) => AgentColor
  onOpenStep: (step: string) => void
}

const COLS = 'grid grid-cols-[6.5rem_7rem_3.5rem_minmax(9rem,1fr)_minmax(6rem,0.8fr)_4rem] items-center gap-3 px-4'

/** Every LayerFS call of the run, filterable by method family, and the final checks. */
export function TraceTab({ calls, checks, live, colorOf, onOpenStep }: TraceTabProps) {
  const [family, setFamily] = useState<Family>('all')
  const counts = useMemo(() => {
    const c: Partial<Record<SegmentKind, number>> = {}
    for (const call of calls) {
      const k = methodKind(call.method)
      c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [calls])
  const failed = calls.filter((c) => c.ok === false).length
  const rows = useMemo(
    () =>
      family === 'all'
        ? calls
        : family === 'failed'
          ? calls.filter((c) => c.ok === false)
          : calls.filter((c) => methodKind(c.method) === family),
    [calls, family],
  )
  const chunks = useMemo(() => {
    const out: TraceCall[][] = []
    for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK))
    return out
  }, [rows])

  const filters: { id: Family; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: calls.length },
    ...KIND_ORDER.filter((k) => counts[k]).map((k) => ({ id: k, label: KIND[k].label, count: counts[k] ?? 0 })),
    ...(failed ? [{ id: 'failed' as const, label: 'Failed', count: failed }] : []),
  ]

  return (
    <WindowedScroller follow={false} startAtEnd={false} version={rows.length} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-semibold">Checks</h2>
          <FinalChecks checks={checks} live={live} />
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-[13px] font-semibold">LayerFS calls</h2>
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={family === f.id}
                onClick={() => setFamily(f.id)}
                className={cn(
                  'flex h-6 items-center gap-1.5 rounded-md px-2 text-xs ring-1 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  family === f.id ? 'bg-foreground text-background ring-foreground' : 'bg-card text-muted-foreground ring-border hover:text-foreground',
                  f.id === 'failed' && family !== f.id && 'text-destructive',
                )}
              >
                {f.id !== 'all' && f.id !== 'failed' && <span aria-hidden="true" className={cn('size-1.5 rounded-full', KIND[f.id].dot)} />}
                {f.label}
                <span className="tabular-nums opacity-70">{f.count}</span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {calls.length === 0 ? (live ? 'No LayerFS calls yet.' : 'This run made no LayerFS calls.') : 'No calls of this kind.'}
            </p>
          ) : (
            <div role="table" aria-label="LayerFS calls" className="overflow-hidden rounded-lg border bg-card">
              <div role="row" className={cn(COLS, 'h-8 border-b bg-muted/40 text-[11px] text-faint')}>
                <span role="columnheader">time</span>
                <span role="columnheader">agent</span>
                <span role="columnheader">step</span>
                <span role="columnheader">method</span>
                <span role="columnheader">result</span>
                <span role="columnheader" className="text-right">
                  ms
                </span>
              </div>
              {chunks.map((chunk, i) => (
                <Windowed key={`${family}:${i}`} id={`${family}:${i}:${chunk.length}`} estimate={chunk.length * ROW}>
                  {chunk.map((c) => {
                    const color = colorOf(c.agent)
                    const index = Number(c.step.split(':').pop())
                    return (
                      <div
                        key={c.id}
                        role="row"
                        tabIndex={0}
                        onClick={() => onOpenStep(c.step)}
                        onKeyDown={(e) => e.key === 'Enter' && onOpenStep(c.step)}
                        title="Show this step in the transcript"
                        className={cn(COLS, 'h-[30px] cursor-pointer border-b border-border/50 font-mono text-[11.5px] outline-none last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/60')}
                      >
                        <span role="cell" className="text-muted-foreground tabular-nums">
                          {time(c.start)}
                        </span>
                        <span role="cell" className="flex min-w-0 items-center gap-1.5 font-sans text-xs">
                          <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', color.dot)} />
                          <span className="truncate">{c.agent}</span>
                        </span>
                        <span role="cell" className="text-muted-foreground tabular-nums">
                          {Number.isFinite(index) ? stepNo(index) : c.step}
                        </span>
                        <span role="cell" className="min-w-0">
                          <KindChip kind={methodKind(c.method)} className="h-[18px] max-w-full truncate text-[10.5px]">
                            {c.method}
                          </KindChip>
                        </span>
                        <span role="cell" className={cn('truncate', c.ok === false ? 'text-destructive' : c.ok ? 'text-success' : 'text-faint')}>
                          {c.ok === null ? '…' : c.ok ? (c.kind ?? 'ok') : (c.code ?? c.kind ?? 'failed')}
                        </span>
                        <span role="cell" className="text-right text-muted-foreground tabular-nums">
                          {c.ms ?? '–'}
                        </span>
                      </div>
                    )
                  })}
                </Windowed>
              ))}
            </div>
          )}
        </section>
      </div>
    </WindowedScroller>
  )
}
