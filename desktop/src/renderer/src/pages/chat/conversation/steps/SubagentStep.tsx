// A subagent call of the agent: the children it started, one line each
// (agent, state, task), each opening that child in the Subagents tab.
import { Bot, ChevronRight, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { childActive, type ChatMessage, type ChildRun } from '@/layerfs/agent-api'
import { useScope } from '../scope'

/** The children a subagent call started: by its run id, else by the call's own id. */
export function childrenOf(message: ChatMessage, children: ChildRun[]): ChildRun[] {
  const details = (message.details ?? {}) as { runId?: string; asyncId?: string }
  const runId = details.runId ?? details.asyncId ?? message.id
  return children.filter((child) => child.runId === runId || child.id.startsWith(`${runId}:`))
}

export function SubagentStep({ message }: { message: ChatMessage }) {
  const { chatId, children, inChild } = useScope()
  const mine = inChild ? [] : childrenOf(message, children)
  const args = (message.args ?? {}) as { agent?: string; task?: string; tasks?: { agent?: string; task?: string }[]; chain?: { agent?: string; task?: string }[] }
  const planned = args.tasks ?? args.chain ?? (args.task ? [{ agent: args.agent, task: args.task }] : [])
  const rows = mine.length ? mine : planned.map((p, i) => ({ id: `${message.id}:${i}`, agent: p.agent ?? 'worker', task: p.task, state: message.status === 'running' ? 'running' : message.status === 'error' ? 'failed' : 'completed' }) as ChildRun)
  const mode = args.chain ? 'chain' : args.tasks ? 'parallel' : null

  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      <div className="flex min-h-7 items-center gap-2 px-2 text-13 text-[var(--text-secondary)]">
        <Bot className="size-3.5 shrink-0 text-[#c45a9a]" />
        <span className="text-[var(--text-primary)]">
          {rows.length === 1 ? 'Handed a task to a subagent' : `Handed tasks to ${rows.length} subagents`}
        </span>
        {mode && <span className="text-12 text-[var(--text-tertiary)]">{mode}</span>}
        {message.status === 'running' && <LoaderCircle className="size-3 animate-spin text-[var(--text-tertiary)]" />}
      </div>
      {rows.map((child) => {
        const known = mine.includes(child)
        const body = (
          <>
            <ChildDot child={child} />
            <span className="shrink-0 font-medium text-[var(--text-primary)]">{child.agent}</span>
            <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{child.task?.split('\n')[0]}</span>
            <span className="shrink-0 text-12 text-[var(--text-tertiary)]">{child.state}</span>
            {known && <ChevronRight className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />}
          </>
        )
        const cls = 'ml-5 flex min-h-8 min-w-0 items-center gap-2 rounded-xs px-2 text-13'
        return known ? (
          <Link key={child.id} to={`/chat/${encodeURIComponent(chatId)}/subagents/${encodeURIComponent(child.id)}`} className={`${cls} hover:bg-[var(--surface-hover)]`}>
            {body}
          </Link>
        ) : (
          <div key={child.id} className={cls}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

/** A child's state as a dot: pulsing while it works, red when it failed. */
export function ChildDot({ child }: { child: ChildRun }) {
  const active = childActive(child)
  const color = active ? 'bg-[var(--ring)]' : child.state === 'failed' ? 'bg-destructive' : child.state === 'stopped' ? 'bg-[var(--text-placeholder)]' : 'bg-success'
  return (
    <span className="relative flex size-2 shrink-0">
      {active && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${color}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${color}`} />
    </span>
  )
}
