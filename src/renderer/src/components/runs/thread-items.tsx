import { Ban, Check, ChevronDown, CornerDownRight, MessageSquareReply, Send, SquareTerminal, Wrench, X } from 'lucide-react'
import { memo } from 'react'

import { KindChip, Spinner } from '@/components/runs/run-badges'
import { type AgentColor, KIND, clock, duration } from '@/components/runs/run-format'
import { SegmentList } from '@/components/runs/segments'
import { CallStrip, CheckChips, OutputBlock } from '@/components/runs/step-parts'
import { type Entry, type Message, type Sender, kindCounts, targetOf } from '@/components/runs/thread'
import { cn } from '@/lib/utils'

/** A quiet divider where the scenario's phase changes. */
export function PhaseLine({ phase }: { phase: string }) {
  return (
    <div role="separator" className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-border/70" />
      <span className="text-[11px] font-medium tracking-wide text-faint uppercase">{phase}</span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  )
}

const RECEIVED_TITLE: Record<Sender, (from: string) => string> = {
  parent: () => 'Task message received',
  child: (from) => `Reply from ${from}`,
  other: (from) => `Message from ${from}`,
}

/** A message the agent received: folded to a title and time, opening to its text. */
interface ReceivedProps {
  message: Message
  sender: Sender
  script?: boolean
  open: boolean
  onToggle: () => void
}

export function ReceivedCard({ message, sender, script, open, onToggle }: ReceivedProps) {
  const Icon = sender === 'child' ? MessageSquareReply : Send
  const title = script ? 'Task message' : RECEIVED_TITLE[sender](message.from)
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/45 dark:bg-muted/30">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:bg-muted"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm text-muted-foreground">{title}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-sm text-faint">{message.text}</span>}
        {open && <span className="flex-1" />}
        {!script && <span className="shrink-0 text-xs text-faint tabular-nums">{clock(message.at)}</span>}
        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && <p className="px-4 pb-3.5 pl-11 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{message.text}</p>}
    </div>
  )
}

/** Plain text the agent says before its calls. */
export function SayText({ text }: { text: string }) {
  return <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{text}</p>
}

/** The agent's reply: body text, with its time under it. */
export function ReplyText({ text, at }: { text: string; at?: number | null }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{text}</p>
      {at ? <span className="text-xs text-faint tabular-nums">{clock(at)}</span> : null}
    </div>
  )
}

/** A group's state line: "Done in 1 s", "Failed after 2 s", "Running…". */
function groupState(entries: Entry[]): { label: React.ReactNode; tone: 'run' | 'ok' | 'bad' | 'stop' | 'script' } {
  const results = entries.map((e) => e.result).filter((r) => r !== undefined)
  if (results.length === 0) {
    const n = entries.length
    return { label: `${n} call${n === 1 ? '' : 's'}`, tone: 'script' }
  }
  const first = Math.min(...results.map((r) => r.started))
  const last = Math.max(...results.map((r) => r.ended ?? r.started))
  const took = duration(Math.max(0, last - first))
  if (results.some((r) => r.state === 'running')) return { label: 'Running…', tone: 'run' }
  if (results.some((r) => r.state === 'failed')) return { label: `Failed after ${took}`, tone: 'bad' }
  if (results.some((r) => r.state === 'stopped')) return { label: `Stopped after ${took}`, tone: 'stop' }
  return { label: `Done in ${took}`, tone: 'ok' }
}

export const groupFailed = (entries: Entry[]) => entries.some((e) => e.result?.state === 'failed')

interface CallsFoldProps {
  entries: Entry[]
  open: boolean
  onToggle: () => void
}

/** A turn's tool calls folded to one line, opening to each call. */
export const CallsFold = memo(function CallsFold({ entries, open, onToggle }: CallsFoldProps) {
  const state = groupState(entries)
  const kinds = kindCounts(entries)
  return (
    <div className={cn('flex flex-col', !open && 'border-b border-border/70')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="group flex w-full min-w-0 items-center gap-3 py-2.5 text-left outline-none">
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-sm group-hover:text-foreground group-focus-visible:text-foreground',
            state.tone === 'bad' ? 'text-destructive' : state.tone === 'stop' ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {state.tone === 'run' && <Spinner />}
          {state.label}
          <ChevronDown aria-hidden="true" className={cn('size-3.5 text-faint transition-transform', open && 'rotate-180')} />
        </span>
        <span className="flex min-w-0 items-center gap-x-2.5 overflow-hidden text-xs whitespace-nowrap text-faint">
          {kinds.slice(0, 5).map(([kind, n]) => (
            <span key={kind} className="flex items-center gap-1">
              <span aria-hidden="true" className={cn('size-1.5 rounded-full', KIND[kind].dot)} />
              {KIND[kind].label} ×{n}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <ol className="mb-2 flex flex-col gap-3 border-l-2 border-border/70 pt-1 pb-1 pl-4">
          {entries.map((e) => (
            <li key={e.key}>
              <StepDetail entry={e} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
})

function StepMark({ entry }: { entry: Entry }) {
  const r = entry.result
  if (!r) return null
  if (r.state === 'running') return <Spinner />
  const Icon = r.state === 'ok' ? Check : r.state === 'failed' ? X : Ban
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-xs tabular-nums',
        r.state === 'ok' ? 'text-muted-foreground' : r.state === 'failed' ? 'text-destructive' : 'text-warning',
      )}
    >
      <Icon aria-hidden="true" className={cn('size-3.5', r.state === 'ok' && 'text-success')} strokeWidth={2.5} />
      {r.ended ? duration(r.ended - r.started) : null}
    </span>
  )
}

/** One call opened: what it does, its segments, LayerFS calls, checks and output. */
function StepDetail({ entry }: { entry: Entry }) {
  const { view, result } = entry
  const bash = !view || view.tool === 'bash'
  const Icon = bash ? SquareTerminal : Wrench
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={view?.description}>
          {view?.description ?? (bash ? 'bash' : view.tool)}
        </span>
        {view && <KindChip kind={view.kind} />}
        <StepMark entry={entry} />
      </div>
      {view?.note && <p className="text-xs text-muted-foreground italic">{view.note}</p>}
      {view && view.segments.length > 0 && <SegmentList segments={view.segments} />}
      {result ? (
        <>
          <CallStrip calls={result.calls} />
          <CheckChips view={view} result={result} />
          <OutputBlock result={result} defaultOpen={result.state === 'failed'} />
        </>
      ) : (
        view?.expect &&
        view.expect.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[11px] text-faint">expects</span>
            {view.expect.map((x) => (
              <span key={x} className="rounded-md bg-muted px-1.5 font-mono text-[11px] leading-5 text-muted-foreground ring-1 ring-foreground/10 ring-inset">
                {x}
              </span>
            ))}
          </div>
        )
      )}
    </div>
  )
}

interface ChipProps {
  entry: Entry
  colorOf: (name: string) => AgentColor
  onOpenAgent?: (name: string) => void
}

/** A subagent tool in the thread: "→ Started ava", "→ Message to ben: …". Opens that agent. */
export function ThreadChip({ entry, colorOf, onOpenAgent }: ChipProps) {
  const { view, result } = entry
  const other = targetOf(view) ?? '?'
  const verb = view?.tool === 'subagent' ? 'Started' : view?.tool === 'interrupt_agent' ? 'Interrupted' : 'Message to'
  const text = view?.tool === 'send_message' ? view.text.replace(/\s+/g, ' ').trim() : ''
  const failed = result?.state === 'failed'
  return (
    <button
      type="button"
      onClick={() => onOpenAgent?.(other)}
      title={view?.tool === 'send_message' ? view.text : `Show ${other}'s conversation`}
      className={cn(
        'flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-[13px] text-muted-foreground outline-none hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        failed && 'border-destructive/40 text-destructive',
      )}
    >
      <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
      <span className="shrink-0">{verb}</span>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', colorOf(other).dot)} />
      <span className={cn('shrink-0 font-medium', colorOf(other).text)}>
        {other}
        {text && <span className="text-faint">:</span>}
      </span>
      {text && <span className="min-w-0 truncate font-mono text-xs text-foreground/80">{text}</span>}
      {result?.state === 'running' && <Spinner className="size-3" />}
    </button>
  )
}
