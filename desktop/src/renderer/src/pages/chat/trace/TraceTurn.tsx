// One turn of the Trace in a card: its header (Setup, or Turn n and the
// message that opened it, with its steps, calls, failures and time) folds
// the rows under it.
import { ChevronRight } from 'lucide-react'
import { duration } from '@/layerfs/call-labels'
import { plural } from '@/layerfs/format'
import { cn } from '@/lib/utils'
import type { TraceItem, TraceTurnGroup } from './rows'
import { TraceRow } from './TraceRow'

interface TurnProps {
  chatId: string
  group: TraceTurnGroup
  items: (TraceItem & { only?: TraceRecordList })[]
  open: boolean
  onToggle: () => void
  showCalls: boolean
  focus: string | null
  focusRef: (el: HTMLDivElement | null) => void
}
type TraceRecordList = TraceItem['calls']

export function TraceTurn({ chatId, group, items, open, onToggle, showCalls, focus, focusRef }: TurnProps) {
  const setup = group.turn === 0
  return (
    <section className="overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--card)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn('flex min-h-10 w-full min-w-0 items-center gap-2 px-3 text-left text-13 hover:bg-[var(--surface-hover)]', open && 'border-b border-[var(--border-default)]')}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 font-medium text-[var(--text-primary)]">{setup ? 'Setup' : `Turn ${group.turn}`}</span>
        {group.title && <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{group.title}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3 text-12 tabular-nums text-[var(--text-tertiary)]">
          {!setup && <span>{plural(group.steps, 'step')}</span>}
          {group.calls > 0 && <span>{plural(group.calls, 'LayerFS call')}</span>}
          {group.failed > 0 && <span className="text-destructive">{group.failed} failed</span>}
          {group.ms ? <span>{duration(group.ms)}</span> : null}
        </span>
      </button>
      {open && (
        <div className="flex flex-col py-1">
          {items.length === 0 && <p className="px-4 py-2 text-12 text-[var(--text-tertiary)]">Nothing here matches.</p>}
          {items.map((item) => {
            const focused = !!focus && (item.row.callId ?? item.row.id) === focus
            return (
              <TraceRow
                key={item.row.id}
                ref={focused ? focusRef : undefined}
                chatId={chatId}
                row={item.row}
                calls={item.calls}
                only={item.only}
                showCalls={showCalls}
                focused={focused}
                defaultOpen={focused}
                turnStart={group.start}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
