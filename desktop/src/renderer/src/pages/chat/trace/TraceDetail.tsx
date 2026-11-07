// A Trace row opened: what it was given and what came back. Blocks by kind:
// the error, the command / task / text / prompt, the writes it made (its
// auto-checkpoints), its output, checks and token use, and a link to the
// same step in the chat or to the subagent it started.
import { ArrowUpRight, CircleCheck, CircleX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { duration } from '@/layerfs/call-labels'
import { bytes } from '@/layerfs/format'
import type { TraceRecord, TraceWrite } from '@/layerfs/trace-api'
import { cn } from '@/lib/utils'

function Block({ label, children, tone }: { label: string; children: ReactNode; tone?: 'error' }) {
  return (
    <div className="flex flex-col gap-1">
      <p className={cn('text-11 font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]', tone === 'error' && 'text-destructive')}>{label}</p>
      {children}
    </div>
  )
}

function Pre({ children, tall }: { children: ReactNode; tall?: boolean }) {
  return (
    <pre className={cn('overflow-auto whitespace-pre-wrap break-words rounded-xs border border-[var(--border-default)] bg-[var(--card)] px-3 py-2 font-mono text-12 leading-5 text-[var(--text-secondary)]', tall ? 'max-h-[360px]' : 'max-h-[240px]')}>
      {children}
    </pre>
  )
}

const TEXT_LABEL: Partial<Record<TraceRecord['kind'], string>> = {
  system: 'Prompt',
  user: 'Message',
  context: 'Context',
  assistant: 'Says',
  tool: 'Command',
  subagent: 'Task',
}

const WRITE_LABEL: Record<TraceWrite['kind'], string> = {
  file: 'Branch write',
  workspace: 'Workspace commit',
  fork: 'Fork',
  merge: 'Merge',
  publish: 'Publish',
  init: 'Init',
}

const short = (v: string | null) => (v && /^[0-9a-f]{16,}$/.test(v) ? v.slice(0, 10) : v)

function writeTarget(w: TraceWrite) {
  if (w.kind === 'merge') return [w.onto, w.with].filter(Boolean).join(' + ') + (w.branch ? ` → ${w.branch}` : '')
  if (w.kind === 'publish') return [w.branch, w.trunk ? `→ ${w.trunk}` : w.layer ? `→ layer ${short(w.layer)}` : null].filter(Boolean).join(' ')
  return w.path ?? w.branch ?? w.workspace ?? ''
}

export function TraceDetail({ chatId, row }: { chatId: string; row: TraceRecord }) {
  const label = TEXT_LABEL[row.kind]
  const writes = row.writes ?? []
  return (
    <div className="flex flex-col gap-3 px-3 pb-3 pl-[34px] pt-1 text-13">
      {row.error && (
        <Block label="Error" tone="error">
          <Pre>{row.error}</Pre>
        </Block>
      )}
      {row.kind === 'system' && row.sections?.length ? (
        <p className="flex flex-wrap gap-1.5 text-12 text-[var(--text-tertiary)]">
          {row.sections.map((s) => (
            <span key={s} className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5">{s}</span>
          ))}
        </p>
      ) : null}
      {row.thinking && (
        <Block label="Thinking">
          <Pre>{row.thinking}</Pre>
        </Block>
      )}
      {label && row.text && (
        <Block label={label}>
          <Pre tall={row.kind === 'tool'}>{row.text}</Pre>
        </Block>
      )}
      {writes.length > 0 && (
        <Block label={writes.some((w) => w.checkpoint !== null) ? 'Auto-checkpoints' : 'Refused writes'}>
          <div className="flex flex-col rounded-xs border border-[var(--border-default)] bg-[var(--card)] py-1">
            {writes.map((w, i) => (
              <div key={i} className="flex min-h-7 min-w-0 items-center gap-2 px-3 text-12">
                <span className="w-8 shrink-0 font-mono text-[var(--text-secondary)]">{w.checkpoint !== null ? `#${w.checkpoint}` : '—'}</span>
                <span className="w-32 shrink-0 text-[var(--text-primary)]">{WRITE_LABEL[w.kind]}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-[var(--text-secondary)]" title={w.message ?? undefined}>{writeTarget(w)}</code>
                <span className="flex shrink-0 items-center gap-2 tabular-nums text-[var(--text-tertiary)]">
                  {w.commit && <code className="font-mono">{short(w.commit)}</code>}
                  {w.sizes?.logical != null && <span>{bytes(w.sizes.logical)}</span>}
                  <span className={cn(w.status === 'failed' && 'text-destructive')}>{w.outcome}</span>
                  <span className="w-10 text-right">{duration(w.ms)}</span>
                </span>
              </div>
            ))}
          </div>
        </Block>
      )}
      {row.output && (
        <Block label={row.kind === 'subagent' ? 'Answer' : 'Output'}>
          <Pre tall>{row.output}</Pre>
        </Block>
      )}
      {row.checks && row.checks.length > 0 && (
        <Block label="Checks">
          <ul className="flex flex-col gap-1">
            {row.checks.map((check) => (
              <li key={check.name} className="flex gap-2 text-12 leading-5">
                {check.ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
                <span className="shrink-0 font-mono text-[var(--text-secondary)]">{check.name}</span>
                <span className="min-w-0 text-[var(--text-tertiary)]">{check.detail}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      {row.kind === 'assistant' && (row.model || row.usage) && (
        <p className="flex flex-wrap gap-x-3 text-12 tabular-nums text-[var(--text-tertiary)]">
          {row.model && <span>{row.model}</span>}
          {row.usage && (row.usage.input > 0 || row.usage.output > 0) && (
            <>
              <span>{row.usage.input.toLocaleString()} in</span>
              <span>{row.usage.output.toLocaleString()} out</span>
              {row.usage.cacheRead > 0 && <span>{row.usage.cacheRead.toLocaleString()} cached</span>}
              {row.usage.cost > 0 && <span>${row.usage.cost.toFixed(4)}</span>}
            </>
          )}
          {row.stopReason && <span>stop: {row.stopReason}</span>}
        </p>
      )}
      {(row.kind === 'tool' || row.kind === 'subagent') && row.callId && (
        <div className="flex gap-3 text-12">
          <Link to={`/chat/${encodeURIComponent(chatId)}?at=${encodeURIComponent(row.callId)}`} className="flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <ArrowUpRight className="size-3.5" /> Show in chat
          </Link>
          {row.kind === 'subagent' && (
            <Link to={`/chat/${encodeURIComponent(chatId)}/subagents`} className="flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <ArrowUpRight className="size-3.5" /> Open in Subagents
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/** A LayerFS call opened: its arguments, `key: value`. */
export function CallDetail({ call }: { call: TraceRecord }) {
  const args = Object.entries(call.args ?? {})
  return (
    <div className="px-2 pb-2 pl-[30px] pt-0.5">
      <Pre>
        {args.length ? args.map(([k, v]) => `${k}: ${v}`).join('\n') : 'No arguments recorded.'}
        {call.error ? `\n\nerror: ${call.error}` : ''}
      </Pre>
    </div>
  )
}
