// The Trace's toolbar, pinned over its rows: the totals, a search over
// commands, output and paths, and switches for LayerFS calls and failures.
import { CircleX, Layers, Search, X } from 'lucide-react'
import { plural } from '@/layerfs/format'
import { cn } from '@/lib/utils'
import type { TraceTotals } from './rows'

interface ToolbarProps {
  totals: TraceTotals
  checkpoints: number
  /** Rows not loaded yet, older than the ones counted. */
  partial: { shown: number; total: number } | null
  query: string
  onQuery: (q: string) => void
  showCalls: boolean
  onShowCalls: (v: boolean) => void
  failures: boolean
  onFailures: (v: boolean) => void
  allOpen: boolean
  onAll: (open: boolean) => void
}

function Toggle({ on, onClick, children, title, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-12 transition-colors disabled:opacity-40',
        on ? 'border-[var(--ring)] bg-[color-mix(in_srgb,var(--ring)_8%,transparent)] text-[var(--text-primary)]' : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
      )}
    >
      {children}
    </button>
  )
}

export function TraceToolbar({ totals, checkpoints, partial, query, onQuery, showCalls, onShowCalls, failures, onFailures, allOpen, onAll }: ToolbarProps) {
  return (
    <div className="flex flex-col gap-2 pb-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-12 tabular-nums text-[var(--text-tertiary)]">
        <span>{plural(totals.turns, 'turn')}</span>
        <span>{plural(totals.steps, 'step')}</span>
        <span>{plural(totals.tools, 'tool call')}</span>
        <span>{plural(totals.calls, 'LayerFS call')}</span>
        {checkpoints > 0 && <span>{plural(checkpoints, 'auto-checkpoint')}</span>}
        {totals.failed > 0 && <span className="text-destructive">{totals.failed} failed</span>}
        {partial && <span className="italic">counts cover the newest {partial.shown} of {partial.total} rows</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex h-7 min-w-[200px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--text-tertiary)]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
            placeholder="Search commands, output, paths…"
            aria-label="Search the trace"
            className="h-7 w-full rounded-full border border-[var(--border-default)] bg-[var(--card)] pl-8 pr-7 text-12 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--ring)]"
          />
          {query && (
            <button type="button" aria-label="Clear the search" onClick={() => onQuery('')} className="absolute right-1.5 flex size-5 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <X className="size-3" />
            </button>
          )}
        </label>
        <Toggle on={showCalls} onClick={() => onShowCalls(!showCalls)} title="Show every tool call's LayerFS calls">
          <Layers className="size-3.5" /> LayerFS calls
        </Toggle>
        <Toggle on={failures} onClick={() => onFailures(!failures)} disabled={!totals.failed && !failures} title="Only what failed">
          <CircleX className="size-3.5" /> Failures
        </Toggle>
        <button type="button" onClick={() => onAll(!allOpen)} className="h-7 shrink-0 px-1.5 text-12 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          {allOpen ? 'Fold all' : 'Expand all'}
        </button>
      </div>
    </div>
  )
}
