import { Ban, CheckCircle2, ChevronDown, CornerDownRight, MessageSquareReply, Send } from 'lucide-react'
import { type ComponentType, memo, useEffect, useState } from 'react'

import {
  LfsBranch,
  LfsCommit,
  LfsConflict,
  LfsExec,
  LfsFork,
  LfsMerge,
  LfsMount,
  LfsPublish,
  LfsSandbox,
  LfsWorkspace,
} from '@/components/lfs-icons'
import { spotlight } from '@/components/motion/spotlight'
import { InlineText, Markdown, StepBlock } from '@/components/runs/blocks'
import { KindChip, Spinner } from '@/components/runs/run-badges'
import { type AgentColor, KIND, clock, duration } from '@/components/runs/run-format'
import { type Entry, type Message, type Sender, kindCounts, targetOf } from '@/components/runs/thread'
import { cn } from '@/lib/utils'
import type { SegmentKind } from '@shared/host-api'
import { t, useI18n } from '@/i18n'

/** The user's request, as a chat shows what you sent. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div onPointerMove={spotlight} className="glass-liquid spotlight max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm">
        <Markdown text={text} className="text-[15px] leading-relaxed text-foreground" />
      </div>
    </div>
  )
}

/** Words shown per tick and the tick: about 20 words a second, a model's pace. */
const STREAM_TOKENS = 2
const STREAM_MS = 45

const Cursor = () => <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-foreground/60" />

/**
 * `text` as Markdown, streamed word by word when `stream` is true as it
 * mounts (text that arrived while the reader watched); whole otherwise. A
 * later change of `stream` does not restart or cut it.
 */
export function Streamed({ text, stream, className }: { text: string; stream?: boolean; className?: string }) {
  const [animate] = useState(!!stream)
  const tokens = animate ? text.split(/(\s+)/) : []
  const [shown, setShown] = useState(0)
  const done = !animate || shown >= tokens.length
  useEffect(() => {
    if (done) return
    const t = setInterval(() => setShown((n) => n + STREAM_TOKENS), STREAM_MS)
    return () => clearInterval(t)
  }, [done])
  if (done) return <Markdown text={text} className={className} />
  return <Markdown text={tokens.slice(0, shown).join('')} tail={<Cursor />} className={className} />
}

/** The agent between steps: a model thinking. */
export function ThinkingLine() {
  const { t } = useI18n()
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      <span className="animate-pulse">{t('Thinking…')}</span>
    </p>
  )
}

const RECEIVED_TITLE: Record<Sender, (from: string) => string> = {
  parent: () => t('Task message received'),
  child: (from) => t('Reply from {name}', { name: from }),
  other: (from) => t('Message from {name}', { name: from }),
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
  const title = script ? t('Task message') : RECEIVED_TITLE[sender](message.from)
  return (
    <div onPointerMove={spotlight} className="glass-liquid spotlight overflow-hidden rounded-2xl shadow-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-foreground/[0.02] focus-visible:bg-muted/60"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-medium text-foreground/85">{title}</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            <InlineText text={message.text.replace(/\s+/g, ' ')} />
          </span>
        )}
        {open && <span className="flex-1" />}
        {!script && <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">{clock(message.at)}</span>}
        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 text-faint transition-transform duration-(--dur-base)', open && 'rotate-180')} />
      </button>
      {open && <Markdown text={message.text} className="border-t border-foreground/[0.05] px-4 pt-3 pb-3.5 pl-11 text-sm leading-relaxed text-foreground/90" />}
    </div>
  )
}

/** Plain text the agent says before its calls. */
export function SayText({ text, stream }: { text: string; stream?: boolean }) {
  return (
    <Streamed text={text} stream={stream} className="px-1 text-[14.5px] leading-relaxed text-foreground/90" />
  )
}

/** The agent's reply: body text in a clean conclusion card, with its time alongside it. */
export function ReplyText({ text, at, stream }: { text: string; at?: number | null; stream?: boolean }) {
  return (
    <div
      onPointerMove={spotlight}
      className="glass-liquid spotlight flex items-start gap-3 rounded-2xl px-4 py-3 shadow-xs"
    >
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
        <CheckCircle2 aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Streamed text={text} stream={stream} className="text-[14.5px] leading-relaxed text-foreground/95" />
      </div>
      {at ? <span className="mt-1 shrink-0 font-mono text-[11px] text-faint tabular-nums">{clock(at)}</span> : null}
    </div>
  )
}

/** A group's state line: "Done in 1 s", "Stopped after 2 s", "Running…". Pass or fail is the scenario's, not shown. */
function groupState(entries: Entry[]): { label: React.ReactNode; tone: 'run' | 'ok' | 'stop' | 'script' } {
  const results = entries.map((e) => e.result).filter((r) => r !== undefined)
  if (results.length === 0) {
    const n = entries.length
    return { label: t(n === 1 ? '{n} call' : '{n} calls', { n }), tone: 'script' }
  }
  const first = Math.min(...results.map((r) => r.started))
  const last = Math.max(...results.map((r) => r.ended ?? r.started))
  const took = duration(Math.max(0, last - first))
  if (results.some((r) => r.state === 'running')) return { label: t('Running…'), tone: 'run' }
  if (results.some((r) => r.state === 'stopped')) return { label: t('Stopped after {time}', { time: took }), tone: 'stop' }
  return { label: t('Done in {time}', { time: took }), tone: 'ok' }
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
  const counts = kindCounts(entries).slice(0, 4)

  return (
    <div className="flex flex-col gap-1.5">
      {entries.length > 1 && (
        <div className="flex min-w-0 items-center justify-between gap-3 px-1.5 text-xs whitespace-nowrap text-faint tabular-nums">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 font-medium',
                state.tone === 'stop' ? 'text-warning' : 'text-muted-foreground',
              )}
            >
              {state.tone === 'run' && <Spinner className="size-3" />}
              {state.label}
            </span>
            <span aria-hidden="true" className="text-border">·</span>
            <span className="shrink-0 text-muted-foreground">{entries.length} calls</span>
          </div>
          {counts.length > 0 && (
            <div className="hidden min-w-0 items-center gap-2.5 overflow-hidden sm:flex">
              {counts.map(([kind, n]) => (
                <span key={kind} className="inline-flex items-center gap-1 text-[11.5px] text-faint">
                  <span aria-hidden="true" className={cn('size-1.5 rounded-full opacity-65', KIND[kind].dot)} />
                  <span>{KIND[kind].label}</span>
                  <span>{n}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <ol
        onPointerMove={spotlight}
        className="glass-liquid spotlight divide-y divide-foreground/[0.05] overflow-hidden rounded-2xl"
      >
        {shown.map((e) => {
          const fallback = e.result?.state === 'failed'
          return (
            <StepRow
              key={e.key}
              entry={e}
              open={folds.get(`s:${e.key}`) ?? fallback}
              onToggle={() => onToggle(`s:${e.key}`, fallback)}
              full={folds.get(`f:${e.key}`) ?? false}
              onFull={() => onToggle(`f:${e.key}`, false)}
            />
          )
        })}
        {(hidden > 0 || (all && entries.length > ROWS)) && (
          <li>
            <button
              type="button"
              onClick={() => onToggle(id, failed)}
              className="flex w-full items-center justify-center gap-1.5 bg-foreground/[0.015] px-4 py-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.035] hover:text-foreground focus-visible:bg-muted/60"
            >
              <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform duration-(--dur-base)', hidden === 0 && 'rotate-180')} />
              <span>{hidden > 0 ? t(hidden === 1 ? 'Show {n} more call' : 'Show {n} more calls', { n: hidden }) : t('Show fewer calls')}</span>
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

/** Semantic icon for a step based on its LayerFS calls. */
function stepIcon(calls: { call: string; kind: SegmentKind }[], hasConflict: boolean): ComponentType<{ className?: string }> {
  if (hasConflict) return LfsConflict
  const names = calls.map((c) => c.call)
  if (names.includes('branch.publish')) return LfsPublish
  if (names.includes('branch.merge')) return LfsMerge
  if (names.includes('branch.fork')) return LfsFork
  if (names.includes('workspace.commit')) return LfsCommit
  if (names.some((n) => n.startsWith('fs.write') || n.startsWith('fs.edit') || n.startsWith('fs.apply'))) return LfsCommit
  if (names.includes('workspace.mount')) return LfsMount
  if (names.includes('workspace.unmount') || names.includes('sandbox.close')) return LfsSandbox
  if (names.includes('workspace.exec')) return LfsExec
  if (names.some((n) => n.startsWith('sandbox.'))) return LfsSandbox
  if (names.some((n) => n.startsWith('workspace.'))) return LfsWorkspace
  if (names.some((n) => n.startsWith('branch.') || n.startsWith('fs.'))) return LfsBranch
  return LfsExec
}

/** A step's one-line title: its description, else its command's first line. */
const titleOf = (entry: Entry) =>
  entry.view?.description || entry.view?.text.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() || entry.view?.tool || 'bash'

interface StepRowProps {
  entry: Entry
  open: boolean
  onToggle: () => void
  /** The opened detail shows everything: setup lines and all output. */
  full: boolean
  onFull: () => void
}

/** One call: status, what it did, its LayerFS calls and duration; opens to the detail. */
function StepRow({ entry, open, onToggle, full, onFull }: StepRowProps) {
  const calls = callsOf(entry)
  const r = entry.result
  const refusedCall = r?.calls.find((c) => c.ok === false)
  const hasConflict = Boolean(refusedCall || (r?.exitCode !== null && r?.exitCode !== undefined && r.exitCode !== 0))
  const Icon = stepIcon(calls, hasConflict)
  const ms = r?.ended ? Math.max(0, r.ended - r.started) : null

  return (
    <li className="transition-colors hover:bg-foreground/[0.02]">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:bg-muted/60"
      >
        <RowMark entry={entry} Icon={Icon} />

        <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground/90 transition-colors group-hover:text-foreground" title={titleOf(entry)}>
          <InlineText text={titleOf(entry)} />
        </span>

        {hasConflict && (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-warning/10 px-2 text-[11px] font-medium text-warning">
            {refusedCall?.code ?? 'refused'}
          </span>
        )}

        <span className="hidden min-w-0 shrink items-center gap-1.5 overflow-hidden md:flex">
          {calls.slice(0, 2).map((c) => (
            <KindChip key={c.call} kind={c.kind}>
              {c.call}
            </KindChip>
          ))}
          {calls.length > 2 && <span className="font-mono text-[11px] text-faint">+{calls.length - 2}</span>}
        </span>

        <span className="w-13 shrink-0 text-right font-mono text-[11.5px] text-faint tabular-nums">
          {ms !== null ? duration(ms) : null}
        </span>

        <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0 text-faint/60 transition-all duration-(--dur-base) group-hover:text-foreground', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 pr-4 pb-3.5 pl-11">
          {entry.view?.note && <p className="text-xs text-muted-foreground italic">{entry.view.note}</p>}
          <StepBlock view={entry.view} result={entry.result} full={full} onFull={onFull} />
        </div>
      )}
    </li>
  )
}

/** A row's status and semantic LayerFS icon. */
function RowMark({
  entry,
  Icon,
}: {
  entry: Entry
  Icon: ComponentType<{ className?: string }>
}) {
  const r = entry.result
  if (r?.state === 'running') return <Spinner className="size-4" />
  if (r?.state === 'stopped') return <Ban aria-label="stopped" className="size-4 shrink-0 text-warning" strokeWidth={2.25} />
  return <Icon className="size-4 shrink-0 opacity-85 transition-opacity group-hover:opacity-100" />
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
  const verb = t(view?.tool === 'subagent' ? 'Started' : view?.tool === 'interrupt_agent' ? 'Interrupted' : 'Message to')
  const text = view?.tool === 'send_message' ? view.text.replace(/\s+/g, ' ').trim() : ''
  return (
    <button
      type="button"
      onPointerMove={spotlight}
      onClick={() => onOpenAgent?.(other)}
      title={view?.tool === 'send_message' ? view.text : t('Show {name}’s conversation', { name: other })}
      className={cn(
        'glass-liquid spotlight flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-full px-3.5 py-1 text-[13px] text-muted-foreground shadow-2xs outline-none transition-colors hover:border-foreground/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
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
