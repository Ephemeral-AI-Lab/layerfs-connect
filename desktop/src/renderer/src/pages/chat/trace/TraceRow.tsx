// One Trace row: a badge for what it is, its headline, chips (LayerFS calls,
// checkpoints, exit code), how long it took and how it ended. Click opens its
// detail; a tool row's LayerFS calls sit under it, folded to a count.
import { ChevronRight, Layers, LoaderCircle } from 'lucide-react'
import { forwardRef, useState } from 'react'
import { LfsIcon } from '@/components/layerfs/LfsIcons'
import { callColor, callIcon, duration } from '@/layerfs/call-labels'
import type { TraceRecord } from '@/layerfs/trace-api'
import { cn } from '@/lib/utils'
import { failed } from './rows'
import { CallDetail, TraceDetail } from './TraceDetail'

const BADGE: Record<string, string> = {
  System: '#6b7a8f',
  You: '#3f86d9',
  Context: '#6b7a8f',
  Model: '#5b6ad0',
  Script: '#8a7a5c',
  Reply: '#2f8a5b',
  Bash: '#3c3f43',
  Subagent: '#c45a9a',
  Check: '#c7772f',
}

function badgeOf(row: TraceRecord) {
  switch (row.kind) {
    case 'system':
      return 'System'
    case 'user':
      return row.source === 'user' || !row.source ? 'You' : 'Context'
    case 'context':
      return 'Context'
    case 'assistant':
      return row.scripted ? 'Script' : row.final && row.text ? 'Reply' : 'Model'
    case 'tool':
      return row.tool === 'bash' || !row.tool ? 'Bash' : row.tool
    case 'subagent':
      return 'Subagent'
    case 'check':
      return 'Check'
    default:
      return 'LayerFS'
  }
}

export function Badge({ label }: { label: string }) {
  const color = BADGE[label] ?? '#6b7a8f'
  return (
    <span
      className="inline-flex h-[18px] w-[64px] shrink-0 items-center justify-center truncate rounded-[5px] px-1 text-[10.5px] font-medium uppercase tracking-[0.04em]"
      style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {label}
    </span>
  )
}

export function Mark({ row }: { row: TraceRecord }) {
  if (row.status === 'running' || row.status === 'starting') return <LoaderCircle className="size-3 animate-spin text-[var(--text-tertiary)]" />
  if (failed(row)) return <span className="text-destructive">✗</span>
  if (row.status === 'stopped') return <span className="text-[var(--text-tertiary)]">■</span>
  return <span className="text-success">✓</span>
}

/** "#3", "#3–#5", "#1, #4" */
export function checkpointLabel(points: number[]) {
  if (!points.length) return ''
  const runs: [number, number][] = []
  for (const p of points) {
    const last = runs.at(-1)
    if (last && p === last[1] + 1) last[1] = p
    else runs.push([p, p])
  }
  return runs.map(([a, b]) => (a === b ? `#${a}` : `#${a}–#${b}`)).join(', ')
}

function headline(row: TraceRecord): { text: string; mono?: boolean; quiet?: boolean } {
  if (row.kind === 'system') return { text: row.title || 'System prompt' }
  if (row.kind === 'assistant') {
    if (row.title) return { text: row.title }
    if (row.thinking) return { text: row.thinking.split('\n')[0], quiet: true }
    return { text: row.scripted ? 'Scripted step' : 'Called tools', quiet: true }
  }
  if (row.kind === 'subagent' && (!row.title || row.title === 'subagent')) return { text: subagentHeadline(row.text) }
  if (row.kind === 'tool') return { text: row.title, mono: !row.text?.startsWith('#') && row.title === row.text?.split('\n')[0] }
  return { text: row.title || row.text?.split('\n')[0] || '' }
}

/** A subagent call's agents and task, from its arguments: "builder, tester, reviewer" or "builder: Fork the…". */
function subagentHeadline(text: string | null | undefined) {
  try {
    const args = JSON.parse(text ?? '') as { agent?: string; task?: string; tasks?: { agent?: string }[]; chain?: { agent?: string }[] }
    const list = args.tasks ?? args.chain
    if (list?.length) return `${list.map((t) => t.agent ?? 'worker').join(args.chain ? ' → ' : ', ')}`
    if (args.task) return `${args.agent ?? 'worker'}: ${args.task.split('\n')[0]}`
  } catch {
    // a task given as plain text
  }
  return text?.split('\n')[0] || 'Subagent'
}

interface RowProps {
  chatId: string
  row: TraceRecord
  calls: TraceRecord[]
  /** Calls a filter kept: shown open, the others hidden. */
  only?: TraceRecord[]
  showCalls: boolean
  focused: boolean
  defaultOpen?: boolean
  turnStart: number | null
}

export const TraceRow = forwardRef<HTMLDivElement, RowProps>(function TraceRow({ chatId, row, calls, only, showCalls, focused, defaultOpen = false, turnStart }, ref) {
  const [open, setOpen] = useState(defaultOpen)
  const [callsOpen, setCallsOpen] = useState<boolean | null>(null)
  const head = headline(row)
  const listed = only ?? calls
  const callsShown = only ? true : (callsOpen ?? showCalls)
  const refused = row.writes?.filter((w) => w.status === 'failed').length ?? 0
  const offset = turnStart !== null && row.start !== null ? `+${duration(Math.max(0, row.start - turnStart)) || '0s'} into the turn` : undefined

  return (
    <div ref={ref} className={cn('scroll-mt-28 rounded-xs', focused && 'ring-2 ring-[var(--ring)]', open && 'bg-[var(--surface-soft,#F2F6FB)]')}>
      <div className="flex min-h-8 items-center gap-2 pr-2.5 text-13">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={offset}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-xs py-1 pl-2 text-left hover:bg-[var(--surface-hover)]"
        >
          <ChevronRight className={cn('size-3 shrink-0 text-[var(--text-tertiary)] transition-transform', open && 'rotate-90')} />
          <Badge label={badgeOf(row)} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              head.mono ? 'font-mono text-12 text-[var(--text-primary)]' : 'text-[var(--text-primary)]',
              head.quiet && 'italic text-[var(--text-tertiary)]',
            )}
          >
            {head.text}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-2 text-12 tabular-nums text-[var(--text-tertiary)]">
          {row.kind === 'system' && row.sections?.length ? <span className="hidden @min-[720px]/chat:inline">{row.sections.length} sections</span> : null}
          {row.checkpoints && row.checkpoints.length > 0 && (
            <span title="Auto-checkpoints this call made" className="rounded-full bg-[var(--surface-hover)] px-1.5 font-mono text-11 text-[var(--text-secondary)]">
              {checkpointLabel(row.checkpoints)}
            </span>
          )}
          {refused > 0 && <span className="text-destructive">{refused} refused</span>}
          {row.kind === 'tool' && row.exitCode != null && row.exitCode !== 0 && <span className="text-destructive">exit {row.exitCode}</span>}
          {calls.length > 0 && (
            <button
              type="button"
              aria-expanded={callsShown}
              onClick={() => setCallsOpen(!callsShown)}
              title={callsShown ? 'Hide its LayerFS calls' : 'Show its LayerFS calls'}
              className={cn('flex h-6 items-center gap-1 rounded-full px-1.5 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]', callsShown && 'text-[var(--text-secondary)]')}
            >
              <Layers className="size-3.5" />
              {only ? `${only.length}/${calls.length}` : calls.length}
            </button>
          )}
          <span className="w-12 text-right">{duration(row.ms)}</span>
          <span className="flex w-3 justify-center">
            <Mark row={row} />
          </span>
        </span>
      </div>
      {open && <TraceDetail chatId={chatId} row={row} />}
      {callsShown && listed.length > 0 && (
        <div className="mb-1 ml-[30px] border-l border-[var(--border-default)] pl-2">
          {listed.map((call) => (
            <CallLine key={call.id} call={call} defaultOpen={!!only} />
          ))}
        </div>
      )}
    </div>
  )
})

/** What a LayerFS call acted on: its branch, Sandbox or path. */
function target(call: TraceRecord) {
  const a = call.args ?? {}
  if (call.title === 'workspace.mount') return [a.sandbox, a.branch].filter(Boolean).join(' ← ')
  return a.branch ?? a.sandbox ?? a.path ?? a.name ?? ''
}

function CallLine({ call, defaultOpen }: { call: TraceRecord; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const bad = failed(call)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-xs px-2 text-left text-12 hover:bg-[var(--surface-hover)]"
      >
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: callColor(call.title) }} />
        <LfsIcon name={callIcon(call.title)} className="size-3.5 shrink-0 text-[var(--text-secondary)]" />
        <span className="shrink-0 font-medium text-[var(--text-primary)]">{call.title}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[var(--text-secondary)]">{target(call)}</code>
        <span className="flex shrink-0 items-center gap-2 tabular-nums text-[var(--text-tertiary)]">
          {call.writeKind && <span className="rounded-full bg-[var(--surface-hover)] px-1.5 text-11">{call.writeKind}</span>}
          {call.outcome && <span className={cn(bad && 'text-destructive')}>{call.outcome}</span>}
          <span className="w-12 text-right">{duration(call.ms)}</span>
          <span className="flex w-3 justify-center">
            <Mark row={call} />
          </span>
        </span>
      </button>
      {open && <CallDetail call={call} />}
    </div>
  )
}
