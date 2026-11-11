// One bash call of the agent. Folded, it reads as the chain of LayerFS calls
// it made (fork → exec npm test ✗ → merge not reached); plain shell reads as
// its first line. Open, it shows the script segment by segment, each with a
// bar in its kind's colour and the calls the trace recorded for it, then the
// output.
import { ChevronRight, ListTree, LoaderCircle, Terminal } from 'lucide-react'
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LfsIcon } from '@/components/layerfs/LfsIcons'
import type { ChatMessage, StepCall, StepSegment } from '@/layerfs/agent-api'
import { callColor, callIcon, callTarget, callVerb, duration, KIND_COLOR, matchCalls } from '@/layerfs/call-labels'
import { cn } from '@/lib/utils'
import { useScope } from '../scope'
import { ShellOutput } from './ShellOutput'
import { OperationList, opSummary } from '@/components/layerfs/Operations'

const firstLine = (command: string) =>
  command
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#')) ?? command.trim()

/** The calls in order, runs of the same call folded into one link: [method, calls[]]. */
function chain(calls: StepCall[]) {
  const links: { method: string; calls: StepCall[] }[] = []
  for (const call of calls) {
    const last = links.at(-1)
    if (last?.method === call.method) last.calls.push(call)
    else links.push({ method: call.method, calls: [call] })
  }
  return links
}

function Mark({ ok, running }: { ok: boolean | null; running?: boolean }) {
  if (running || ok === null) return <LoaderCircle className="size-3 animate-spin text-[var(--text-tertiary)]" />
  return ok ? <span className="text-success">✓</span> : <span className="text-destructive">✗</span>
}

export const BashStep = memo(function BashStep({ message }: { message: ChatMessage }) {
  const { chatId, focus, inChild, childId } = useScope()
  const focused = focus === message.id
  const [open, setOpen] = useState(focused)
  const root = useRef<HTMLDivElement>(null)
  // opened from the Trace: open, and bring it into view
  useEffect(() => {
    if (!focused) return
    setOpen(true)
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'center' }))
  }, [focused])
  const ops = message.operations
  const chatPath = `/chat/${encodeURIComponent(chatId)}${childId ? `/subagents/${encodeURIComponent(childId)}` : ''}`
  const command = String(message.args?.command ?? '')
  const segments = message.view?.segments ?? []
  const calls = message.view?.calls ?? []
  const running = message.status === 'running'
  const failed = message.status === 'error' || calls.some((c) => c.ok === false)
  const total = calls.reduce((n, c) => n + (c.ms ?? 0), 0)
  const links = chain(calls)
  const exec = segments.find((s) => s.call === 'workspace.exec' && s.detail)?.detail
  const { bySegment, missing, other } = useMemo(() => matchCalls(segments, calls), [segments, calls])
  const notReached = [...missing.values()].flat()

  return (
    <div ref={root} className={cn('scroll-mt-4 rounded-xs', open && 'bg-[var(--card)] ring-1 ring-[var(--border-default)]', focused && 'ring-2 ring-[var(--ring)]')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group/step flex min-h-8 w-full items-center gap-2 rounded-xs px-2 py-1 text-left text-13 hover:bg-[var(--surface-hover)]"
      >
        <ChevronRight className={cn('size-3 shrink-0 text-[var(--text-tertiary)] transition-transform', open && 'rotate-90')} />
        {links.length ? (
          <>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
            {links.map((link, i) => {
              const ok = link.calls.every((c) => c.ok) ? true : link.calls.some((c) => c.ok === false) ? false : null
              return (
                <Fragment key={i}>
                  {i > 0 && <span className="shrink-0 text-[var(--text-placeholder)]">→</span>}
                  <span className="flex shrink-0 items-center gap-1" title={link.method}>
                    <LfsIcon name={callIcon(link.method)} className="size-3.5 text-[var(--text-secondary)]" />
                    <span className="text-[var(--text-primary)]">{callVerb(link.method)}</span>
                    {link.method === 'workspace.exec' && exec && link.calls.length === 1 && (
                      <code className="max-w-[18ch] truncate font-mono text-12 text-[var(--text-secondary)]">{exec}</code>
                    )}
                    {link.calls.length > 1 && <span className="text-[var(--text-tertiary)]">×{link.calls.length}</span>}
                    {ok === false && <span className="text-destructive">✗</span>}
                  </span>
                </Fragment>
              )
            })}
          </span>
          {notReached.length > 0 && !running && <span className="shrink-0 text-12 text-[var(--text-tertiary)]">{notReached.length} not run</span>}
          </>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Terminal className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
            <code className="truncate font-mono text-12 text-[var(--text-primary)]">{firstLine(command)}</code>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1.5 text-12 tabular-nums text-[var(--text-tertiary)]">
          {ops && ops.count > 0 ? <span title={opSummary(ops)} className={cn(ops.unknown > 0 && 'text-[var(--warning,#b7791f)]')}>{ops.count} {ops.count === 1 ? 'op' : 'ops'} · {ops.links} {ops.links === 1 ? 'link' : 'links'}</span> : calls.length > 0 && <span>{calls.length} {calls.length === 1 ? 'call' : 'calls'}</span>}
          {total > 0 && <span>{duration(total)}</span>}
          <Mark ok={running ? null : !failed} running={running} />
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--border-default)]">
          <Script segments={segments} command={command} bySegment={bySegment} missing={missing} done={!running} />
          {other.length > 0 && (
            <div className="border-t border-[var(--border-default)] px-3 py-2">
              <p className="mb-1 text-11 font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">Other calls</p>
              {other.map((call) => (
                <CallRow key={call.id} call={call} />
              ))}
            </div>
          )}
          {ops && ops.count > 0 && (
            <div className="border-t border-[var(--border-default)] py-1">
              <p className="px-3 pt-1 text-11 font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">{opSummary(ops)}</p>
              <OperationList ops={ops} chatPath={chatPath} />
            </div>
          )}
          <ShellOutput chatId={chatId} message={message} />
          {(!inChild || childId) && (
            <div className="flex justify-end border-t border-[var(--border-default)] px-3 py-1.5">
              <Link to={`/chat/${encodeURIComponent(chatId)}${childId ? `/subagents/${encodeURIComponent(childId)}` : ''}/trace?at=${encodeURIComponent(message.id)}`} className="flex items-center gap-1 text-12 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                <ListTree className="size-3.5" /> Open in Trace
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/** The script, a row per segment: bar, numbered lines, and its calls on the right. */
function Script({ segments, command, bySegment, missing, done }: {
  segments: StepSegment[]
  command: string
  bySegment: Map<number, StepCall[]>
  missing: Map<number, string[]>
  done: boolean
}) {
  const lines = command.split('\n')
  const rows = segments.length ? segments : [{ kind: 'local', form: 'shell', text: command, lines: [1, lines.length] } as StepSegment]
  return (
    <div className="max-h-[420px] overflow-auto py-1.5 text-12">
      {rows.map((segment, index) => {
        const mine = bySegment.get(index) ?? []
        const lost = done ? (missing.get(index) ?? []) : []
        const color = KIND_COLOR[segment.kind] ?? 'transparent'
        return (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)] gap-x-4 @min-[640px]/chat:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="flex min-w-0">
              <span aria-hidden="true" className="my-0.5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
              <pre className="min-w-0 flex-1 font-mono leading-5 text-[var(--text-secondary)]">
                {lines.slice(segment.lines[0] - 1, segment.lines[1]).map((line, k) => (
                  <div key={k} className="flex">
                    <span className="w-9 shrink-0 select-none pr-2 text-right text-[var(--text-placeholder)]">{segment.lines[0] + k}</span>
                    <span className={cn('min-w-0 whitespace-pre-wrap break-all', segment.kind !== 'local' && 'text-[var(--text-primary)]')}>{line || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
            <div className="flex min-w-0 flex-col justify-start py-0.5 pl-12 pr-3 @min-[640px]/chat:pl-0">
              {mine.map((call) => (
                <CallRow key={call.id} call={call} detail={call.method === 'workspace.exec' ? segment.detail : undefined} />
              ))}
              {lost.map((method, k) => (
                <div key={`lost-${k}`} className="flex h-5 items-center gap-1.5 text-[var(--text-tertiary)]">
                  <LfsIcon name={callIcon(method)} className="size-3.5 opacity-50" />
                  <span>{method}</span>
                  <span className="italic">not run</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CallRow({ call, detail }: { call: StepCall; detail?: string }) {
  const target = callTarget(call, detail)
  return (
    <div className="flex min-h-5 min-w-0 items-center gap-1.5 leading-5" title={call.code ? `${call.method}: ${call.code}` : call.method}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: callColor(call.method) }} />
      <span className="shrink-0 font-medium text-[var(--text-primary)]">{call.method}</span>
      {target && (
        <code className={cn('min-w-0 truncate font-mono text-[var(--text-secondary)]', call.method === 'workspace.exec' && 'before:content-["↳_"]')}>{target}</code>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums text-[var(--text-tertiary)]">
        {call.ok === false && call.code && <span className="text-destructive">{call.code}</span>}
        <span>{duration(call.ms)}</span>
        <Mark ok={call.ok} />
      </span>
    </div>
  )
}
