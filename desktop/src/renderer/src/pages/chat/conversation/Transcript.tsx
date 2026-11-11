// A conversation's turns, read top to bottom: the message that opened each
// (yours, or the task a subagent was given), then the agent's work blocks
// and replies. The chat tab and a subagent's view both show one.
import { memo, useMemo, useState } from 'react'
import type { ChatMessage } from '@/layerfs/agent-api'
import { toTurns } from '@/layerfs/turns'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'
import { WorkBlock } from './WorkBlock'

export const Transcript = memo(function Transcript({ messages, running, opener = 'user' }: { messages: ChatMessage[]; running: boolean; opener?: 'user' | 'task' }) {
  const turns = useMemo(() => toTurns(messages.filter(message => message.details?.kind !== 'compactionSummary'), running), [messages, running])
  return turns.map((turn) => (
    <section key={turn.id} className="flex flex-col gap-1.5">
      {turn.user && (opener === 'task' ? <TaskMessage message={turn.user} /> : <UserMessage message={turn.user} />)}
      {turn.parts.map((part) =>
        part.kind === 'work' ? (
          <WorkBlock key={part.id} work={part} />
        ) : (
          <div key={part.id} className="py-1 text-15 leading-[1.65] text-[var(--text-primary)]">
            <Markdown text={part.text} live={part.live} />
          </div>
        ),
      )}
    </section>
  ))
})

function useClamp(text: string) {
  const [open, setOpen] = useState(false)
  const long = text.length > 600
  return { long, open, toggle: () => setOpen((v) => !v) }
}

const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  const { long, open, toggle } = useClamp(message.text)
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-md bg-[var(--surface-soft,#E8EFF8)] px-3.5 py-2.5 text-14 leading-6 text-[var(--text-primary)]">
        <p className={cn('whitespace-pre-wrap break-words', long && !open && 'line-clamp-6')}>{message.text}</p>
        {long && (
          <button type="button" onClick={toggle} className="mt-1 text-12 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            {open ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
    </div>
  )
})

/** A subagent's opening message: the task its parent gave it. */
const TaskMessage = memo(function TaskMessage({ message }: { message: ChatMessage }) {
  const { long, open, toggle } = useClamp(message.text)
  return (
    <div className="rounded-md border border-dashed border-[var(--border-default)] px-3.5 py-2.5 text-14 leading-6 text-[var(--text-primary)]">
      <p className="mb-0.5 text-11 font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">Task from the main agent</p>
      <p className={cn('whitespace-pre-wrap break-words', long && !open && 'line-clamp-6')}>{message.text}</p>
      {long && (
        <button type="button" onClick={toggle} className="mt-1 text-12 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
})
