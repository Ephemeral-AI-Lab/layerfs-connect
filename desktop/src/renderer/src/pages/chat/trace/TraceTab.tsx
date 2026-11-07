// The Trace tab: everything the agent was given and did, row by row, in turn
// cards under a pinned toolbar. Long traces open on their last turn; Load
// earlier reads older rows. ?at=<tool call id> (a step's "Open in Trace")
// opens that row and scrolls to it.
import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ChatDetail } from '@/layerfs/agent-api'
import { useTrace } from '@/layerfs/use-trace'
import { filterItems, groupTrace, totals } from './rows'
import { TraceToolbar } from './TraceToolbar'
import { TraceTurn } from './TraceTurn'

export function TraceTab({ chat }: { chat: ChatDetail }) {
  const { page, records, earlier, loadEarlier, loadingOlder, error } = useTrace(chat.id)
  const [params] = useSearchParams()
  const focus = params.get('at')
  const [query, setQuery] = useState('')
  const [failures, setFailures] = useState(false)
  const [showCalls, setShowCalls] = useState(false)
  const [opened, setOpened] = useState<Map<number, boolean>>(new Map())

  const groups = useMemo(() => groupTrace(records), [records])
  const sum = useMemo(() => totals(records), [records])
  const filtering = !!query.trim() || failures
  const focusTurn = focus ? groups.find((g) => g.items.some((i) => i.row.callId === focus))?.turn : undefined
  const lastTurn = groups.at(-1)?.turn

  // a turn is open when you opened it, else when a filter or the focus needs it, else the last (all when few)
  const isOpen = (turn: number) => opened.get(turn) ?? (filtering || turn === focusTurn || turn === lastTurn || groups.length <= 3)
  const allOpen = groups.every((g) => isOpen(g.turn))
  const toggle = (turn: number) => setOpened((m) => new Map(m).set(turn, !isOpen(turn)))
  const setAll = (open: boolean) => setOpened(new Map(groups.map((g) => [g.turn, open])))

  // scroll the focused row into view once it is drawn
  const [scrolled, setScrolled] = useState<string | null>(null)
  const focusRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !focus || scrolled === focus) return
      requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))
      setScrolled(focus)
    },
    [focus, scrolled],
  )
  useEffect(() => setScrolled(null), [focus])

  if (!page) {
    return (
      <div className="flex flex-1 items-center justify-center text-13 text-[var(--text-tertiary)]">
        {error ? `The trace could not load: ${error}` : <LoaderCircle className="size-4 animate-spin" />}
      </div>
    )
  }

  const shown = groups.map((g) => ({ group: g, items: filterItems(g.items, { query, failures }) })).filter((g) => !filtering || g.items.length > 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] px-5 pb-10">
        <div className="sticky top-0 z-10 bg-content-area pt-4">
          <TraceToolbar
            totals={sum}
            checkpoints={page.checkpoints ?? 0}
            partial={earlier > 0 ? { shown: records.length, total: page.total } : null}
            query={query}
            onQuery={setQuery}
            showCalls={showCalls}
            onShowCalls={setShowCalls}
            failures={failures}
            onFailures={setFailures}
            allOpen={allOpen}
            onAll={setAll}
          />
        </div>
        {error && <p role="alert" className="mb-2 text-12 text-destructive">{error}</p>}
        {earlier > 0 && (
          <button
            type="button"
            onClick={() => void loadEarlier()}
            disabled={loadingOlder}
            className="mb-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-default)] text-12 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {loadingOlder && <LoaderCircle className="size-3 animate-spin" />}
            Load earlier ({Math.min(earlier, 300)} more of {earlier})
          </button>
        )}
        {records.length === 0 ? (
          <p className="py-16 text-center text-13 text-[var(--text-tertiary)]">Nothing has run in this chat yet.</p>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-13 text-[var(--text-tertiary)]">Nothing in the trace matches.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map(({ group, items }) => (
              <TraceTurn
                key={group.turn}
                chatId={chat.id}
                group={group}
                items={items}
                open={isOpen(group.turn)}
                onToggle={() => toggle(group.turn)}
                showCalls={showCalls}
                focus={focus}
                focusRef={focusRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
