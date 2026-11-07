// The agent's work between two replies: its thinking and tool calls in one
// block. Open while it runs; folded afterwards to "Worked 1m 04s · 9 LayerFS
// calls · 3 steps", with a ✗ when a step failed.
import { Brain, ChevronRight, LoaderCircle, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ChatMessage } from '@/layerfs/agent-api'
import { duration } from '@/layerfs/call-labels'
import { blockCalls, blockSpan, type TurnPart } from '@/layerfs/turns'
import { cn } from '@/lib/utils'
import { useScope } from './scope'
import { BashStep } from './steps/BashStep'
import { SubagentStep } from './steps/SubagentStep'

type Work = Extract<TurnPart, { kind: 'work' }>

export function WorkBlock({ work }: { work: Work }) {
  const { focus } = useScope()
  const [opened, setOpened] = useState<boolean | null>(null)
  const holdsFocus = !!focus && work.items.some((i) => i.kind === 'step' && i.message.id === focus)
  const open = opened ?? (work.live || holdsFocus)
  // a step opened from the Trace opens its block, even one you folded
  useEffect(() => {
    if (holdsFocus) setOpened(true)
  }, [holdsFocus, focus])
  const steps = work.items.filter((i) => i.kind === 'step')
  const calls = blockCalls(work.items)
  const span = blockSpan(work.items)
  const failed = steps.some((i) => i.kind === 'step' && (i.message.status === 'error' || i.message.view?.calls.some((c) => c.ok === false)))

  // only thinking: one quiet line
  if (!steps.length) {
    return work.items.map((item) => (item.kind === 'thinking' ? <Thinking key={item.id} text={item.text} live={item.live} /> : null))
  }

  const summary = [
    work.live ? 'Working' : span ? `Worked ${duration(span)}` : 'Worked',
    calls.length ? `${calls.length} LayerFS ${calls.length === 1 ? 'call' : 'calls'}` : null,
    `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpened(!open)}
        className="flex h-7 items-center gap-1.5 rounded-full pr-2 text-13 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {work.live && <LoaderCircle className="size-3.5 animate-spin" />}
        <span>{summary}</span>
        {failed && !work.live && <span className="text-destructive">✗</span>}
      </button>
      {open && (
        <div className="ml-[7px] mt-1 flex flex-col gap-0.5 border-l border-[var(--border-default)] pl-3">
          {work.items.map((item) =>
            item.kind === 'thinking' ? (
              <Thinking key={item.id} text={item.text} live={item.live} />
            ) : item.message.toolName === 'bash' ? (
              <BashStep key={item.message.id} message={item.message} />
            ) : item.message.toolName === 'subagent' ? (
              <SubagentStep key={item.message.id} message={item.message} />
            ) : (
              <OtherStep key={item.message.id} message={item.message} />
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** The model's thinking: "Thought" folded, its text in grey when open. */
function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  const lastLine = text.trim().split('\n').at(-1) ?? ''
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-7 w-full min-w-0 items-center gap-1.5 px-2 text-left text-13 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      >
        <Brain className="size-3.5 shrink-0" />
        <span className="shrink-0">{live ? 'Thinking…' : 'Thought'}</span>
        {!open && live && <span className="min-w-0 truncate italic opacity-80">{lastLine}</span>}
      </button>
      {open && <p className="whitespace-pre-wrap px-2 pb-2 pl-7 text-13 leading-5 text-[var(--text-tertiary)]">{text.trim()}</p>}
    </div>
  )
}

/** A tool other than bash (the subagent tools): its name, first argument and result. */
function OtherStep({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const args = message.args ?? {}
  const first = Object.values(args).find((v) => typeof v === 'string') as string | undefined
  return (
    <div className={cn('rounded-xs', open && 'bg-[var(--card)] ring-1 ring-[var(--border-default)]')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-8 w-full items-center gap-2 rounded-xs px-2 py-1 text-left text-13 hover:bg-[var(--surface-hover)]"
      >
        <ChevronRight className={cn('size-3 shrink-0 text-[var(--text-tertiary)] transition-transform', open && 'rotate-90')} />
        <Wrench className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <span className="font-medium text-[var(--text-primary)]">{message.toolName}</span>
        {first && <span className="min-w-0 truncate text-[var(--text-secondary)]">{first.split('\n')[0]}</span>}
        <span className="ml-auto shrink-0 text-12">
          {message.status === 'running' ? <LoaderCircle className="size-3 animate-spin" /> : message.status === 'error' ? <span className="text-destructive">✗</span> : <span className="text-success">✓</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border-default)] px-3 py-2 font-mono text-12 leading-5 text-[var(--text-secondary)]">
          <pre className="whitespace-pre-wrap">{JSON.stringify(args, null, 2)}</pre>
          {message.text && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap border-t border-[var(--border-default)] pt-2">{message.text}</pre>}
        </div>
      )}
    </div>
  )
}
