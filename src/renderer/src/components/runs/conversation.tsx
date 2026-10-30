import { memo, useCallback, useEffect, useRef, useState } from 'react'

import type { AgentColor } from '@/components/runs/run-format'
import type { Item, Turn } from '@/components/runs/thread'
import { CallsFold, ReceivedCard, ReplyText, SayText, ThreadChip, UserMessage } from '@/components/runs/thread-items'
import { Windowed, WindowedScroller } from '@/components/runs/windowed-list'
import { cn } from '@/lib/utils'

/** Folds the reader opened or closed, by item key; the rest keep their default. */
export type Folds = Map<string, boolean>

interface TurnProps {
  turn: Turn
  folds: Folds
  onToggle: (key: string, fallback: boolean) => void
  colorOf: (name: string) => AgentColor
  onOpenAgent?: (name: string) => void
  script?: boolean
  /** True for an item that arrived while the reader watched: its text streams in. */
  fresh: (key: string) => boolean
}

type Block = Item | { type: 'chips'; key: string; items: Extract<Item, { type: 'chip' }>[] }

/** Neighbouring chips share one wrapping row. */
function blocks(items: Item[]): Block[] {
  const out: Block[] = []
  for (const item of items) {
    const last = out[out.length - 1]
    if (item.type !== 'chip') out.push(item)
    else if (last?.type === 'chips') last.items.push(item)
    else out.push({ type: 'chips', key: item.key, items: [item] })
  }
  return out
}

const TurnView = memo(function TurnView({ turn, folds, onToggle, colorOf, onOpenAgent, script, fresh }: TurnProps) {
  return (
    <div className="flex flex-col gap-3">
      {blocks(turn.items).map((item) => {
        switch (item.type) {
          case 'chips':
            return (
              <div key={item.key} className="flex flex-wrap gap-2">
                {item.items.map((c) => (
                  <ThreadChip key={c.key} entry={c.entry} colorOf={colorOf} onOpenAgent={onOpenAgent} />
                ))}
              </div>
            )
          case 'user':
            return <UserMessage key={item.key} text={item.text} />
          case 'received': {
            const open = folds.get(item.key) ?? false
            return (
              <ReceivedCard
                key={item.key}
                message={item.message}
                sender={item.sender}
                script={script}
                open={open}
                onToggle={() => onToggle(item.key, false)}
              />
            )
          }
          case 'say':
            return <SayText key={item.key} text={item.text} stream={fresh(item.key)} />
          case 'calls':
            return <CallsFold key={item.key} id={item.key} entries={item.entries} folds={folds} onToggle={onToggle} />
          case 'chip':
            return null
          case 'reply':
            return <ReplyText key={item.key} text={item.text} at={item.entry.result?.ended ?? item.entry.result?.started} stream={fresh(item.key)} />
        }
      })}
    </div>
  )
})

// A turn's height before it was ever drawn: a received card, a fold line, a reply.
const ESTIMATE = 110

interface ConversationProps {
  turns: Turn[]
  colorOf: (name: string) => AgentColor
  onOpenAgent?: (name: string) => void
  /** Follow the newest turn while true. A run opens at its newest turn, like a chat; a script at its start. */
  live: boolean
  /** A demo's script: no times, and "Task message" for the prompt. */
  script?: boolean
  /** Shown when there are no turns. */
  empty?: React.ReactNode
  /** Under the last turn, inside the scroller. */
  footer?: React.ReactNode
  className?: string
}

/** One agent's thread in a centred column, windowed by turn. */
export function Conversation({ turns, colorOf, onOpenAgent, live, script, empty, footer, className }: ConversationProps) {
  const [folds, setFolds] = useState<Folds>(() => new Map())
  const onToggle = useCallback(
    (key: string, fallback: boolean) =>
      setFolds((m) => {
        const next = new Map(m)
        next.set(key, !(m.get(key) ?? fallback))
        return next
      }),
    [],
  )
  // What was there when the thread opened is shown whole; what arrives later, while it plays, streams in once.
  const seen = useRef<Set<string> | null>(null)
  seen.current ??= new Set(turns.flatMap((t) => t.items.map((i) => i.key)))
  useEffect(() => {
    for (const t of turns) for (const i of t.items) seen.current?.add(i.key)
  }, [turns])
  const fresh = useCallback((key: string) => live && !seen.current?.has(key), [live])
  const last = turns[turns.length - 1]
  const version = `${turns.length}:${last?.items.length}:${last?.items[last.items.length - 1]?.key}`
  return (
    <WindowedScroller follow={live} startAtEnd={!script} version={version} className={cn('h-full overflow-y-auto', className)}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-6 pb-10">
        {turns.length === 0 && empty}
        {turns.map((turn) => (
          <Windowed key={turn.key} id={turn.key} estimate={ESTIMATE}>
            <TurnView turn={turn} folds={folds} onToggle={onToggle} colorOf={colorOf} onOpenAgent={onOpenAgent} script={script} fresh={fresh} />
          </Windowed>
        ))}
        {footer}
      </div>
    </WindowedScroller>
  )
}
