// A chat's subagents: the header's list of them, and one child's own
// conversation, read-only, in place of the chat's.
import { ArrowLeft, ChevronDown, ChevronRight, GitFork, LoaderCircle, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, ChildRun } from '@shared/agent-api'

import { ConversationMessages } from '@/components/chat/conversation-messages'
import { SayText } from '@/components/chat/markdown'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { agentHost } from '@/host/agent-client'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const ACTIVE = /^(running|pending|queued|paused)$/
export const childActive = (child: ChildRun) => ACTIVE.test(child.state)

/** Re-renders each second while `on`, for running clocks. */
function useTick(on: boolean) {
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
}

/** How long a child has run: its start to its end, or to now while it runs. */
function elapsed(child: ChildRun) {
  if (child.startedAt) return Math.max(0, (child.endedAt && !childActive(child) ? child.endedAt : Date.now()) - child.startedAt)
  return child.durationMs
}

export function useChildFormat() {
  const { t } = useI18n()
  return {
    duration: (ms?: number) => {
      if (ms === undefined) return ''
      const seconds = Math.round(ms / 1000)
      return seconds < 60 ? t('{seconds}s', { seconds }) : t('{minutes}m {seconds}s', { minutes: Math.floor(seconds / 60), seconds: String(seconds % 60).padStart(2, '0') })
    },
    tokens: (n?: number) => n === undefined ? '' : t('{count} tok', { count: n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n }),
  }
}

/** A child's state as a colored dot: running pulses, done is green, failed red, stopped gray. */
function StateDot({ state }: { state: string }) {
  return <span
    aria-hidden="true"
    className={cn(
      'inline-block size-2 shrink-0 rounded-full',
      ACTIVE.test(state) ? 'animate-pulse bg-primary' : /completed|done|complete/.test(state) ? 'bg-success' : /error|failed/.test(state) ? 'bg-destructive' : 'bg-faint',
    )}
  />
}

/** The chat header's "N subagents" button and its list; a row opens that child. */
export function SubagentsMenu({ children, open, onOpenChange, current, onOpen }: {
  children: ChildRun[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The child open now, if any. */
  current: string | null
  onOpen: (id: string) => void
}) {
  const { t } = useI18n()
  const format = useChildFormat()
  const running = children.filter(childActive).length
  useTick(open && running > 0)
  if (!children.length) return null
  return <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-subagents-menu
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-foreground/[0.05] aria-expanded:text-foreground"
      >
        {running > 0 ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : <GitFork className="size-3.5" />}
        <span>{t('{count} subagents', { count: children.length })}</span>
        <ChevronDown className="size-3.5 opacity-60 transition-transform duration-(--dur-base) in-aria-expanded:rotate-180" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="chat-popover w-[min(26rem,calc(100vw-2rem))] p-1.5">
      <DropdownMenuLabel className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
        {running ? t('{running} of {count} running', { running, count: children.length }) : t('Subagents')}
      </DropdownMenuLabel>
      <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
        {children.map((child) => <DropdownMenuItem
          key={child.id}
          data-child={child.id}
          onSelect={() => onOpen(child.id)}
          className={cn('flex items-center gap-3 rounded-xl px-2.5 py-2', current === child.id && 'bg-foreground/[0.05]')}
        >
          <StateDot state={child.state} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-foreground">{child.agent}</span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {[child.task?.split('\n')[0], t(child.state)].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end text-[11px] text-muted-foreground tabular-nums">
            <span>{format.tokens(child.tokens)}</span>
            <span>{format.duration(elapsed(child))}</span>
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-faint" />
        </DropdownMenuItem>)}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
}

/** The line in the conversation that says subagents ran, and opens the header's list. */
export function SubagentsSummary({ children, onOpen }: { children: ChildRun[]; onOpen: () => void }) {
  const { t } = useI18n()
  if (!children.length) return null
  const running = children.filter(childActive).length
  const failed = children.filter((child) => /error|failed/.test(child.state)).length
  return <button
    type="button"
    onClick={onOpen}
    className="chat-inset inline-flex w-fit items-center gap-2 self-start rounded-xl border border-foreground/[0.06] px-3 py-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
  >
    {running ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : <GitFork className="size-3.5" />}
    <span className="font-medium text-foreground">{t('{count} subagents', { count: children.length })}</span>
    <span>{[running && t('{count} running', { count: running }), failed && t('{count} failed', { count: failed }), !running && !failed && t('all finished')].filter(Boolean).join(' · ')}</span>
    <ChevronRight className="size-3.5" />
  </button>
}

/**
 * One child's own conversation, read-only, with its task and numbers on top.
 * It reloads as the child changes; a background child's conversation shows
 * once its session file exists, its latest output until then.
 */
export function ChildConversationView({ sessionId, child, onBack, onStop }: {
  sessionId: string
  child: ChildRun
  onBack: () => void
  onStop?: (runId: string) => Promise<void>
}) {
  const { t } = useI18n()
  const format = useChildFormat()
  const [messages, setMessages] = useState<ChatMessage[]>()
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const active = childActive(child)
  const latestTaskComplete = /^(completed|done|complete|passed)$/.test(child.state) && !child.error && !error
  useTick(active)
  // reload when the child's numbers or state change, at most twice a second
  const version = `${child.state}:${child.turns}:${child.tokens}:${child.endedAt}:${child.conversation}`
  const latest = useRef(0)
  useEffect(() => {
    const request = ++latest.current
    const timer = setTimeout(() => {
      agentHost.child(sessionId, child.id)
        .then((result) => { if (latest.current === request) { setMessages(result.messages); setError('') } })
        .catch((cause: Error) => { if (latest.current === request) setError(cause.message) })
    }, messages ? 500 : 0)
    return () => clearTimeout(timer)
  }, [sessionId, child.id, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const facts = [
    child.model,
    format.tokens(child.tokens),
    child.cost ? `$${child.cost.toFixed(4)}` : '',
    child.turns !== undefined ? t(child.turns === 1 ? '1 turn' : '{count} turns', { count: child.turns }) : '',
    child.toolCount !== undefined ? t(child.toolCount === 1 ? '1 tool call' : '{count} tool calls', { count: child.toolCount }) : '',
    format.duration(elapsed(child)),
  ].filter(Boolean)

  return <div className="chat-content-gutter min-h-0 flex-1 overflow-y-auto pt-3 pb-8" data-child-view={child.id}>
    <div className="flex w-full min-w-0 flex-col gap-5">
      <div className="chat-glass-card glass-liquid flex flex-col gap-2.5 rounded-2xl px-4 py-3.5">
        <div className="flex items-center gap-2">
          <StateDot state={child.state} />
          <span className="text-sm font-semibold text-foreground">{child.agent}</span>
          <span className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">{t(child.state)}</span>
          {active && child.currentTool && <span className="truncate font-mono text-[11px] text-muted-foreground">{child.currentTool}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {active && onStop && <Button size="xs" variant="ghost" disabled={stopping} onClick={async () => {
              setStopping(true)
              try { await onStop(child.runId ?? child.id) } catch (cause) { setError((cause as Error).message) } finally { setStopping(false) }
            }}>{stopping ? <LoaderCircle className="size-3 animate-spin" /> : <Square className="size-2.5" />}{t('Stop run')}</Button>}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">{facts.join(' · ')}</p>
        {child.task && <button type="button" onClick={() => setTaskOpen(!taskOpen)} className="text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <span className="font-medium text-foreground">{t('Task')}: </span>
          <span className={cn('whitespace-pre-wrap', !taskOpen && 'line-clamp-2')}>{child.task}</span>
        </button>}
        {child.error && <p role="alert" className="text-xs text-destructive">{child.error}</p>}
      </div>

      {error && <p role="alert" className="text-xs text-destructive">{t(error)}</p>}
      {!messages && !error && <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin text-primary" />{t('Loading…')}</div>}
      {messages?.length === 0 && <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-foreground/10 px-4 py-4 text-xs text-muted-foreground">
        <span>{active ? t('This subagent’s conversation shows here once it saves; its latest output is below.') : t('This subagent left no conversation to show.')}</span>
        {child.text && <div className="text-foreground"><SayText text={child.text} /></div>}
      </div>}
      {messages && <ConversationMessages
        key={`${sessionId}:${child.id}`}
        messages={messages}
        sessionId={sessionId}
        disabled
        running={active}
        latestTaskComplete={latestTaskComplete}
      />}
    </div>

    <div className="pointer-events-none sticky bottom-0 mt-6 flex w-full justify-center">
      <button
        type="button"
        onClick={onBack}
        className="pointer-events-auto glass-liquid inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-foreground shadow-[var(--elev-1)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-3.5" />{t('Read-only · Back to the main chat')}
      </button>
    </div>
  </div>
}
