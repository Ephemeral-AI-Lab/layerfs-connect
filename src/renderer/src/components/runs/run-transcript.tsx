import type { RunDetail, StepResult, StepView } from '@shared/host-api'
import { memo, useMemo } from 'react'

import { type AgentColor, stepKey } from '@/components/runs/run-format'
import { type Message, MessageBubble, StepCard } from '@/components/runs/step-card'
import { Windowed, WindowedScroller } from '@/components/runs/windowed-list'

export type TranscriptItem =
  | { type: 'phase'; key: string; phase: string; agent: string }
  | { type: 'step'; key: string; result: StepResult; view?: StepView }
  | { type: 'message'; key: string; message: Message }

const said = (agent: string, text: string) => `${agent}\u0000${text.trim()}`

/** Steps in start order with their phase dividers, and messages in place. */
export function transcriptItems(run: RunDetail, views: Map<string, StepView>, agent: string | null, root: string | null): TranscriptItem[] {
  const steps = agent ? run.steps.filter((s) => s.agent === agent) : run.steps
  // Messages a send_message or reply step already shows are not repeated.
  const shown = new Set<string>()
  for (const s of run.steps) {
    const v = views.get(stepKey(s.agent, s.index))
    if (v && (v.tool === 'send_message' || v.tool === 'reply')) shown.add(said(s.agent, v.text || v.say || ''))
  }
  const messages = run.messages
    .filter((m) => !shown.has(said(m.from, m.text)))
    .filter((m) => !agent || m.from === agent || m.to === agent)
    .sort((a, b) => a.at - b.at)

  const items: TranscriptItem[] = []
  let m = 0
  let phase: string | null = null
  const pushMessagesUntil = (at: number) => {
    for (; m < messages.length && messages[m].at <= at; m++)
      items.push({ type: 'message', key: `m:${messages[m].at}:${messages[m].from}:${m}`, message: messages[m] })
  }
  for (const s of steps) {
    pushMessagesUntil(s.started)
    const key = stepKey(s.agent, s.index)
    const view = views.get(key)
    if (view?.phase) {
      const label = agent || s.agent === root ? view.phase : `${s.agent} · ${view.phase}`
      if (label !== phase) items.push({ type: 'phase', key: `p:${key}`, phase: view.phase, agent: s.agent })
      phase = label
    }
    items.push({ type: 'step', key: `s:${key}`, result: s, view })
  }
  pushMessagesUntil(Infinity)
  return items
}

function PhaseDivider({ phase, agent, color, showAgent }: { phase: string; agent: string; color: AgentColor; showAgent: boolean }) {
  return (
    <div role="separator" className="flex items-center gap-3 pt-3 pb-1">
      <span className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {showAgent && (
          <>
            <span aria-hidden="true" className={`size-1.5 rounded-full ${color.dot}`} />
            <span className={color.text}>{agent}</span>
            <span className="text-faint">·</span>
          </>
        )}
        {phase}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

const ESTIMATE = { phase: 40, step: 280, message: 84 } as const

interface TranscriptProps {
  items: TranscriptItem[]
  colorOf: (name: string) => AgentColor
  parents: Map<string, string | null>
  live: boolean
  root: string | null
  filtered: boolean
  /** Shown before the first item (an empty state) and after the last (final checks). */
  empty?: React.ReactNode
  footer?: React.ReactNode
}

export const Transcript = memo(function Transcript({ items, colorOf, parents, live, root, filtered, empty, footer }: TranscriptProps) {
  const last = items[items.length - 1]
  const version = useMemo(() => `${items.length}:${last?.key}:${last?.type === 'step' ? last.result.state : ''}`, [items.length, last])
  return (
    <WindowedScroller follow={live} startAtEnd={live} version={version} className="h-full overflow-y-auto">
      <ol aria-label="Transcript" className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
        {items.map((item) => (
          <li key={item.key}>
            <Windowed id={item.key} estimate={ESTIMATE[item.type]}>
              {item.type === 'phase' ? (
                <PhaseDivider phase={item.phase} agent={item.agent} color={colorOf(item.agent)} showAgent={!filtered && item.agent !== root} />
              ) : item.type === 'message' ? (
                <MessageBubble from={item.message.from} to={item.message.to} text={item.message.text} colorOf={colorOf} />
              ) : (
                <StepCard
                  result={item.result}
                  view={item.view}
                  color={colorOf(item.result.agent)}
                  colorOf={colorOf}
                  parent={parents.get(item.result.agent) ?? null}
                />
              )}
            </Windowed>
          </li>
        ))}
        {items.length === 0 && empty && <li>{empty}</li>}
        {footer && <li>{footer}</li>}
      </ol>
    </WindowedScroller>
  )
})
