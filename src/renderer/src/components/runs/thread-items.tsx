import { Ban, Check, ChevronDown, CornerDownRight, MessageSquareReply, Send, Wrench, X } from 'lucide-react'
import { memo, useEffect, useState } from 'react'

import { KindChip, Spinner } from '@/components/runs/run-badges'
import { type AgentColor, KIND, clock, duration } from '@/components/runs/run-format'
import { SegmentList } from '@/components/runs/segments'
import { CallStrip, CheckChips, OutputBlock } from '@/components/runs/step-parts'
import { type Entry, type Message, type Sender, kindCounts, targetOf } from '@/components/runs/thread'
import { cn } from '@/lib/utils'
import type { SegmentKind } from '@shared/host-api'

/** The user's request, as a chat shows what you sent. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  )
}

/** Words shown per tick and the tick: about 20 words a second, a model's pace. */
const STREAM_TOKENS = 2
const STREAM_MS = 45

/**
 * `text`, streamed word by word when `stream` is true as it mounts (text
 * that arrived while the reader watched); whole otherwise. A later change of
 * `stream` does not restart or cut it.
 */
function Streamed({ text, stream }: { text: string; stream?: boolean }) {
  const [animate] = useState(!!stream)
  const tokens = animate ? text.split(/(\s+)/) : []
  const [shown, setShown] = useState(0)
  const done = !animate || shown >= tokens.length
  useEffect(() => {
    if (done) return
    const t = setInterval(() => setShown((n) => n + STREAM_TOKENS), STREAM_MS)
    return () => clearInterval(t)
  }, [done])
  if (done) return <>{text}</>
  return (
    <>
      {tokens.slice(0, shown).join('')}
      <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/60" />
    </>
  )
}

/** The agent between steps: a model thinking. */
export function ThinkingLine() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      <span className="animate-pulse">Thinking…</span>
    </p>
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
export function SayText({ text, stream }: { text: string; stream?: boolean }) {
  return (
    <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
      <Streamed text={text} stream={stream} />
    </p>
  )
}

/** The agent's reply: body text, with its time under it. */
export function ReplyText({ text, at, stream }: { text: string; at?: number | null; stream?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
        <Streamed text={text} stream={stream} />
      </p>
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

/** Rows a long group shows before "Show N more". */
const ROWS = 6

interface CallsFoldProps {
  /** The group's key: its "show all" fold. A row's own key is `s:<entry key>`. */
  id: string
  entries: Entry[]
  folds: Map<string, boolean>
  onToggle: (key: string, fallback: boolean) => void
}

/**
 * A turn's tool calls: one compact row per call (what it did, its LayerFS
 * calls, how long it took), each opening to its detail. Several calls get a
 * summary line above them; a long group shows its first rows and
 * "Show N more". A failed call opens by default.
 */
export const CallsFold = memo(function CallsFold({ id, entries, folds, onToggle }: CallsFoldProps) {
  const state = groupState(entries)
  const failed = groupFailed(entries)
  const all = folds.get(id) ?? failed
  const shown = all || entries.length <= ROWS ? entries : entries.slice(0, ROWS - 1)
  const hidden = entries.length - shown.length
  return (
    <div className="flex flex-col gap-1.5">
      {entries.length > 1 && (
        <div className="flex min-w-0 items-center gap-2 px-1 text-xs whitespace-nowrap text-faint">
          <span
            className={cn(
              'flex shrink-0 items-center gap-1.5',
              state.tone === 'bad' ? 'text-destructive' : state.tone === 'stop' ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {state.tone === 'run' && <Spinner className="size-3" />}
            {state.label}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{entries.length} calls</span>
          <span className="flex min-w-0 items-center gap-x-2 overflow-hidden">
            {kindCounts(entries)
              .slice(0, 5)
              .map(([kind, n]) => (
                <span key={kind} className="flex items-center gap-1">
                  <span aria-hidden="true" className={cn('size-1.5 rounded-full', KIND[kind].dot)} />
                  {KIND[kind].label} {n}
                </span>
              ))}
          </span>
        </div>
      )}
      <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {shown.map((e) => {
          const fallback = e.result?.state === 'failed'
          return (
            <StepRow
              key={e.key}
              entry={e}
              open={folds.get(`s:${e.key}`) ?? fallback}
              onToggle={() => onToggle(`s:${e.key}`, fallback)}
            />
          )
        })}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => onToggle(id, failed)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/60"
            >
              <ChevronDown aria-hidden="true" className="size-3.5" />
              Show {hidden} more call{hidden === 1 ? '' : 's'}
            </button>
          </li>
        )}
      </ol>
    </div>
  )
})

/** The distinct LayerFS calls a step's script makes, in order. */
function callsOf(entry: Entry): { call: string; kind: SegmentKind }[] {
  const seen = new Map<string, SegmentKind>()
  for (const seg of entry.view?.segments ?? []) if (seg.call && !seen.has(seg.call)) seen.set(seg.call, seg.kind)
  return [...seen].map(([call, kind]) => ({ call, kind }))
}

/** A step's one-line title: its description, else its command's first line. */
const titleOf = (entry: Entry) =>
  entry.view?.description || entry.view?.text.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() || entry.view?.tool || 'bash'

interface StepRowProps {
  entry: Entry
  open: boolean
  onToggle: () => void
}

/** One call: status, what it did, its LayerFS calls and duration; opens to the detail. */
function StepRow({ entry, open, onToggle }: StepRowProps) {
  const calls = callsOf(entry)
  const r = entry.result
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/60"
      >
        <RowMark entry={entry} />
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', r?.state === 'failed' && 'text-destructive')} title={titleOf(entry)}>
          {titleOf(entry)}
        </span>
        <span className="hidden min-w-0 shrink items-center gap-1 overflow-hidden md:flex">
          {calls.slice(0, 3).map((c) => (
            <KindChip key={c.call} kind={c.kind}>
              {c.call}
            </KindChip>
          ))}
          {calls.length > 3 && <span className="text-[11px] text-faint">+{calls.length - 3}</span>}
        </span>
        <span className="w-14 shrink-0 text-right text-xs text-faint tabular-nums">
          {r?.ended ? duration(r.ended - r.started) : null}
        </span>
        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 text-faint transition-transform group-hover:text-muted-foreground', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border/60 bg-muted/25 px-3 py-3 dark:bg-muted/15">
          <StepDetail entry={entry} />
        </div>
      )}
    </li>
  )
}

/** A row's status: a spinner, a check, a cross, a stop, or a dot in a script. */
function RowMark({ entry }: { entry: Entry }) {
  const r = entry.result
  if (!r) return <span aria-hidden="true" className="mx-1 size-1.5 shrink-0 rounded-full bg-faint/60" />
  if (r.state === 'running') return <Spinner className="size-3.5" />
  const Icon = r.state === 'ok' ? Check : r.state === 'failed' ? X : Ban
  return (
    <Icon
      aria-label={r.state}
      className={cn('size-3.5 shrink-0', r.state === 'ok' ? 'text-success' : r.state === 'failed' ? 'text-destructive' : 'text-warning')}
      strokeWidth={2.5}
    />
  )
}

/** One call opened: what it does, its segments, LayerFS calls, checks and output. */
function StepDetail({ entry }: { entry: Entry }) {
  const { view, result } = entry
  const bash = !view || view.tool === 'bash'
  return (
    <div className="flex flex-col gap-2">
      {!bash && (
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          <Wrench aria-hidden="true" className="size-3.5 shrink-0" />
          {view?.tool}
        </div>
      )}
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
