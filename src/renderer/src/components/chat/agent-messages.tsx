import { useI18n, localeTag } from '@/i18n'
import { Brain, Check, ChevronDown, ChevronRight, Copy, FileText, GitFork, LoaderCircle, Square, Terminal, TriangleAlert } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChildRun } from '@shared/agent-api'

import { MessageActions, type ConversationAction } from '@/components/chat/conversation-actions'
import { AttachmentList } from '@/components/chat/attachments'
import { ToolOutputDialog } from '@/components/chat/tool-output'
import { spotlight } from '@/components/motion/spotlight'
import { Markdown, SayText, ThinkingLine } from '@/components/chat/markdown'
import { Button } from '@/components/ui/button'
import { highlight, highlightOutput, type Token } from '@/lib/highlight'
import { cn } from '@/lib/utils'

function HighlightedLines({ lines }: { lines: Token[][] }) {
  return (
    <>
      {lines.map((tokens, i) => (
        <div key={i} className="min-h-[1lh]">
          {tokens.map(([text, cls], j) => (
            <span key={j} className={cls || undefined}>
              {text}
            </span>
          ))}
        </div>
      ))}
    </>
  )
}

function ToolMessage({ message, sessionId, onInspect }: { message: ChatMessage; sessionId?: string; onInspect?: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(message.status === 'error')
  const [outputFocus, setOutputFocus] = useState<HTMLElement | null>(null)
  const running = message.status === 'running'
  const failed = message.status === 'error'
  const command = message.args?.command
  const rawInput = typeof command === 'string' ? command : message.args ? JSON.stringify(message.args, null, 2) : ''
  const preview = typeof command === 'string' ? command.replace(/\s+/g, ' ').trim() : String(message.args?.task ?? message.args?.agent ?? '')
  const isBash = message.toolName === 'bash'
  const Icon = isBash ? Terminal : GitFork

  const inputLines = useMemo(
    () => (rawInput ? highlight(rawInput.replace(/\n$/, ''), isBash ? 'bash' : 'json') : null),
    [rawInput, isBash],
  )
  const outputLines = useMemo(
    () => (message.text ? highlightOutput(message.text.replace(/\n$/, '')) : null),
    [message.text],
  )

  return (
    <div
      onPointerMove={spotlight}
      className={cn(
        'chat-tool chat-glass-card glass-liquid spotlight overflow-hidden rounded-2xl transition-colors',
        failed && 'border-destructive/30',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center gap-2.5 px-4 py-3 text-left text-xs outline-none transition-colors hover:bg-background/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-xl transition-colors',
            failed
              ? 'bg-destructive/10 text-destructive'
              : running
                ? 'bg-primary/10 text-primary'
                : 'bg-foreground/[0.035] text-muted-foreground group-hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="shrink-0 font-mono text-xs font-medium text-foreground">{message.toolName}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{preview}</span>
        {running ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
            <LoaderCircle className="size-3 shrink-0 animate-spin" />

            {t("Running")}
          </span>
        ) : failed ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
            <TriangleAlert className="size-3 shrink-0" />

            {t("Failed")}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/[0.07] px-2 py-1 text-[11px] font-medium text-success"><Check className="size-3" /><span className="hidden sm:inline">{t("Done")}</span></span>
        )}
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--dur-base)', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-foreground/[0.06] p-3">
          {inputLines && (
            <div className="chat-inset max-h-64 overflow-auto rounded-xl border border-foreground/[0.06] px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              <div className="mb-2 font-sans text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">{isBash ? t("COMMAND") : t("TASK")}</div>
              <HighlightedLines lines={inputLines} />
            </div>
          )}
          {outputLines ? (
            <div
              className={cn(
                'chat-inset max-h-80 overflow-auto rounded-xl border border-foreground/[0.06] px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
                failed && 'bg-destructive/[0.04] text-destructive',
              )}
            >
              <div className="mb-2 font-sans text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">{t("OUTPUT")}</div>
              <HighlightedLines lines={outputLines} />
            </div>
          ) : (
            running && <p className="px-4 py-2.5 text-xs text-muted-foreground">{t("Running…")}</p>
          )}
          {sessionId && message.outputArtifact && <Button variant="outline" size="sm" className="rounded-xl" onClick={(event) => { onInspect?.(); setOutputFocus(event.currentTarget) }}><FileText className="size-3.5" />{t("View full output")}<span className="text-[10px] text-muted-foreground">{t("{count} bytes", { count: message.outputArtifact.bytes.toLocaleString(localeTag()) })}</span></Button>}
        </div>
      )}
      {outputFocus && sessionId && message.outputArtifact && <ToolOutputDialog sessionId={sessionId} artifactId={message.outputArtifact.id} returnFocus={outputFocus} onClose={() => setOutputFocus(null)} />}
    </div>
  )
}

export const AgentMessage = memo(function AgentMessage({ message, sessionId, disabled = false, running = false, onAction, collapseThinking = false, onInspect }: {
  message: ChatMessage
  sessionId?: string
  disabled?: boolean
  running?: boolean
  collapseThinking?: boolean
  onInspect?: () => void
  onAction?: (action: Exclude<ConversationAction, 'duplicate'>, message: ChatMessage, returnFocus: HTMLElement | null) => void
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(message.status === 'running')
  useEffect(() => { if (collapseThinking) setThinkingOpen(false) }, [collapseThinking])

  if (message.role === 'user') {
    return (
      <div className="group/message flex flex-col items-end py-1" data-entry-id={message.entryId}>
        <div onPointerMove={spotlight} className="chat-user-message chat-glass-card glass-liquid spotlight max-w-[90%] rounded-2xl px-5 py-3.5 sm:max-w-[84%]">
          {!!message.attachments?.length && <div className="mb-2"><AttachmentList attachments={message.attachments} /></div>}
          <Markdown text={message.text} className="text-[14px] leading-[1.75] text-foreground" />
        </div>
        {message.status === 'running' && <p className="mt-1.5 pr-1 text-right text-[11px] text-muted-foreground">{t("Queued")}</p>}
        {onAction && <MessageActions message={message} disabled={disabled} running={running} onAction={onAction} />}
      </div>
    )
  }
  if (message.role === 'tool') return <ToolMessage message={message} sessionId={sessionId} onInspect={onInspect} />
  if (!message.text && !message.thinking && message.status !== 'running') return null

  return (
    <div className="group/message min-w-0 py-1">
      <div aria-busy={message.status === 'running'} onPointerMove={spotlight} className="chat-assistant-message chat-glass-card glass-liquid spotlight w-full min-w-0 space-y-3 rounded-2xl px-4 py-3.5 sm:px-5">
        {message.thinking && (
          <div className="chat-inset overflow-hidden rounded-xl border border-foreground/[0.06] text-xs text-muted-foreground">
            <button
              type="button"
              aria-expanded={thinkingOpen}
              onClick={() => setThinkingOpen(!thinkingOpen)}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Brain className="size-3.5 shrink-0" />
              <span>{message.status === 'running' ? t("Thinking…") : t("Reasoning")}</span>
              <ChevronDown className={cn('ml-auto size-3.5 transition-transform duration-(--dur-base)', thinkingOpen && 'rotate-180')} />
            </button>
            {thinkingOpen && (
              <div className="max-h-72 overflow-auto border-t border-foreground/[0.05] px-3.5 py-3 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                <Markdown text={message.thinking} />
              </div>
            )}
          </div>
        )}
        {message.text ? <Markdown text={message.text} className="chat-message-body text-[14px] leading-[1.8] text-foreground" /> : message.status === 'running' && !message.thinking ? <ThinkingLine /> : null}
        {message.status === 'error' && <p role="alert" className="text-xs text-destructive">{t("The response ended with an error.")}</p>}
        {message.text && message.status !== 'running' && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-xs"
              title={t("Copy response")}
              aria-label={t("Copy response")}
              className="size-6 rounded-xl text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              onClick={() => {
                void navigator.clipboard.writeText(message.text).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1800)
                })
              }}
            >
              {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
            </Button>
            {message.usage && (
              <span className="tabular-nums">
                {t("{input} in · {output} out", { input: message.usage.input.toLocaleString(localeTag()), output: message.usage.output.toLocaleString(localeTag()) })}
                {message.usage.cost > 0 ? ` · $${message.usage.cost.toFixed(4)}` : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export function ChildRuns({ children, onStop }: { children: ChildRun[]; onStop?: (id: string) => Promise<void> }) {
  const { t } = useI18n()
  const [stopping, setStopping] = useState<string | null>(null)
  const stopInFlight = useRef(false)
  const [error, setError] = useState('')
  async function stop(id: string) {
    if (stopInFlight.current || !onStop) return
    stopInFlight.current = true
    setStopping(id); setError('')
    try { await onStop(id) } catch (e) { setError((e as Error).message) } finally { stopInFlight.current = false; setStopping(null) }
  }
  if (!children.length) return null
  return (
    <section
      aria-label={t("Subagents")}
      onPointerMove={spotlight}
      className="chat-glass-card glass-liquid spotlight space-y-3 rounded-2xl p-4"
    >
      <div className="flex items-center gap-2 px-1 text-xs font-medium text-foreground">
        <GitFork className="size-3.5" />
        <span>{t("Subagents")}</span>
        <span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[10.5px] text-muted-foreground tabular-nums">
          {children.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {error && <p role="alert" className="text-xs text-destructive">{t(error)}</p>}
        {children.map((child) => (
          <details key={child.id} className="chat-inset group/child overflow-hidden rounded-xl border border-foreground/[0.06] px-3.5 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="font-medium text-foreground">{child.agent}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  /running|pending|queued/.test(child.state)
                    ? 'bg-primary/10 text-primary'
                    : /error|failed/.test(child.state)
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-foreground/[0.05] text-muted-foreground',
                )}
              >
                {t(child.state)}
              </span>
              {child.task && <span className="min-w-0 flex-1 truncate text-muted-foreground">{child.task.slice(0, 100)}</span>}
              {onStop && /^(running|pending|queued|paused)$/.test(child.state) && <button type="button" aria-label={t("Stop run {name}", { name: child.agent })} title={t("Stop this run and any linked child tasks")} disabled={!!stopping} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void stop(child.runId ?? child.id) }} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-lg px-2 text-[10px] text-muted-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{stopping === (child.runId ?? child.id) ? <LoaderCircle className="size-3 animate-spin" /> : <Square className="size-2.5" />}{t("Stop run")}</button>}
              <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-open/child:rotate-180" />
            </summary>
            {child.task && <p className="mt-2.5 border-t border-foreground/[0.05] pt-2.5 whitespace-pre-wrap text-xs text-muted-foreground">{child.task}</p>}
            {child.text && (
              <div className="mt-2.5 border-t border-foreground/[0.05] pt-2.5">
                <SayText text={child.text} />
              </div>
            )}
          </details>
        ))}
      </div>
    </section>
  )
}
