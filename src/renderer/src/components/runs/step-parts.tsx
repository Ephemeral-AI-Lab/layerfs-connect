import type { CheckResult, StepResult, StepView, TraceCall } from '@shared/host-api'
import { Check, ChevronRight, CircleDashed, Scissors, X } from 'lucide-react'
import { useState } from 'react'

import { KindChip } from '@/components/runs/run-badges'
import { duration, methodKind, ms } from '@/components/runs/run-format'
import { cn } from '@/lib/utils'

const OUTPUT_LINES = 40

const short = (id: string | null | undefined) => (id && id.length > 12 ? id.slice(0, 10) : id)

/** One stream (stdout or stderr), cut to the first lines until opened. */
function Stream({ name, text }: { name: 'stdout' | 'stderr' | 'answer'; text: string }) {
  const [all, setAll] = useState(false)
  const lines = text.replace(/\n+$/, '').split('\n')
  const cut = !all && lines.length > OUTPUT_LINES
  return (
    <div className="flex flex-col">
      {name !== 'answer' && (
        <span className={cn('px-3 pt-1.5 font-mono text-[10px] tracking-wide uppercase', name === 'stderr' ? 'text-destructive/80' : 'text-faint')}>
          {name}
        </span>
      )}
      <pre
        className={cn(
          'overflow-x-auto px-3 py-1.5 font-mono text-xs leading-[1.55] whitespace-pre',
          name === 'stderr' ? 'text-destructive' : 'text-foreground/85',
        )}
      >
        {(cut ? lines.slice(0, OUTPUT_LINES) : lines).join('\n')}
      </pre>
      {lines.length > OUTPUT_LINES && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="mx-3 mb-1.5 w-fit text-[11px] font-medium text-primary outline-none hover:underline focus-visible:underline"
        >
          {all ? 'Show the first 40 lines' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  )
}

/** stdout and stderr (or a tool's answer) in a collapsible monospace block. */
export function OutputBlock({ result, defaultOpen = true }: { result: StepResult; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const answer = result.output ?? ''
  const count = [stdout, stderr, answer].reduce((n, t) => n + (t.trim() ? t.replace(/\n+$/, '').split('\n').length : 0), 0)
  if (count === 0) return null
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/25">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
      >
        <ChevronRight aria-hidden="true" className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {answer && !stdout && !stderr ? 'Answer' : 'Output'}
        <span className="font-normal text-faint">
          {count} line{count === 1 ? '' : 's'}
        </span>
        {result.truncated && (
          <span title="The host kept only the first part of this output" className="ml-auto flex items-center gap-1 font-normal text-warning">
            <Scissors aria-hidden="true" className="size-3" /> truncated by the host
          </span>
        )}
      </button>
      {open && (
        <div className="border-t bg-card/60">
          {stdout.trim() && <Stream name="stdout" text={stdout} />}
          {stderr.trim() && <Stream name="stderr" text={stderr} />}
          {answer.trim() && <Stream name="answer" text={answer} />}
        </div>
      )}
    </div>
  )
}

function CallResult({ call }: { call: TraceCall }) {
  if (call.ok === null) return <span className="text-faint">…</span>
  return call.ok ? (
    <span className="text-success">{call.kind ?? 'ok'}</span>
  ) : (
    <span className="text-destructive">{call.code ?? call.kind ?? 'failed'}</span>
  )
}

/** The LayerFS calls a step made: a compact strip that opens to a table. */
export function CallStrip({ calls }: { calls: TraceCall[] }) {
  const [open, setOpen] = useState(false)
  if (calls.length === 0) return null
  const total = calls.reduce((n, c) => n + (c.ms ?? 0), 0)
  const failed = calls.filter((c) => c.ok === false).length
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full min-w-0 items-center gap-1.5 text-left outline-none"
      >
        <ChevronRight aria-hidden="true" className={cn('size-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
          {calls.length} LayerFS call{calls.length === 1 ? '' : 's'}
        </span>
        <span className="shrink-0 text-[11px] text-faint tabular-nums">{duration(total)}</span>
        {failed > 0 && <span className="shrink-0 text-[11px] text-destructive">{failed} failed</span>}
        {!open && (
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {calls.slice(0, 6).map((c) => (
              <span
                key={c.id}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded px-1 font-mono text-[10.5px] leading-4',
                  c.ok === false ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
                )}
              >
                {c.method}
              </span>
            ))}
            {calls.length > 6 && <span className="shrink-0 text-[11px] text-faint">+{calls.length - 6}</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="bg-muted/40 text-faint">
              <tr>
                {['method', 'result', 'ms', 'branch', 'commit', 'sandbox', 'path'].map((h) => (
                  <th key={h} className="px-2 py-1 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="px-2 py-1">
                    <KindChip kind={methodKind(c.method)} className="h-[18px] text-[10.5px]">
                      {c.method}
                    </KindChip>
                  </td>
                  <td className="px-2 py-1">
                    <CallResult call={c} />
                  </td>
                  <td className="px-2 py-1 text-muted-foreground tabular-nums">{ms(c.ms)}</td>
                  <td className="px-2 py-1 text-muted-foreground">{c.branch ?? ''}</td>
                  <td className="px-2 py-1 text-muted-foreground" title={c.commit ?? undefined}>
                    {short(c.commit) ?? ''}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground" title={c.sandbox ?? undefined}>
                    {short(c.sandbox) ?? ''}
                  </td>
                  <td className="max-w-48 truncate px-2 py-1 text-muted-foreground" title={c.path ?? undefined}>
                    {c.path ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type Mark = 'ok' | 'bad' | 'wait'

function CheckChip({ mark, children, title }: { mark: Mark; children: React.ReactNode; title?: string }) {
  const Icon = mark === 'ok' ? Check : mark === 'bad' ? X : CircleDashed
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-md px-1.5 font-mono text-[11px] whitespace-nowrap ring-1 ring-inset',
        mark === 'ok' && 'bg-success/10 text-success ring-success/20',
        mark === 'bad' && 'bg-destructive/10 text-destructive ring-destructive/25',
        mark === 'wait' && 'bg-muted text-muted-foreground ring-foreground/10',
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
      {children}
    </span>
  )
}

const callMatches = (c: TraceCall, method: string, code?: string) =>
  c.method === method && (!code || c.kind === code || c.code === code)

/** exit, each expected code (found or missing), commits captured and other checks. */
export function CheckChips({ view, result }: { view?: StepView; result: StepResult }) {
  const running = result.state === 'running'
  const byName = new Map<string, CheckResult>()
  for (const c of result.checks) byName.set(c.name, c)
  const chips: React.ReactNode[] = []

  if (result.exitCode !== undefined && result.exitCode !== null) {
    const want = view?.exit ?? 0
    const check = byName.get('exit')
    const ok = check ? check.ok : result.exitCode === want
    chips.push(
      <CheckChip key="exit" mark={ok ? 'ok' : 'bad'} title={check?.detail ?? (want ? `expected exit ${want}` : undefined)}>
        exit {result.exitCode}
        {want !== 0 && <span className="opacity-70">/ want {want}</span>}
      </CheckChip>,
    )
  }
  for (const e of view?.expect ?? []) {
    const at = e.indexOf(':')
    const method = at < 0 ? e : e.slice(0, at)
    const code = at < 0 ? undefined : e.slice(at + 1)
    // The host's expect check is the verdict; the trace shows which code is missing.
    const found = byName.get('expect')?.ok === true || result.calls.some((c) => callMatches(c, method, code))
    chips.push(
      <CheckChip key={`x:${e}`} mark={found ? 'ok' : running ? 'wait' : 'bad'} title={found ? 'found in the trace' : running ? 'not seen yet' : 'missing from the trace'}>
        {e}
      </CheckChip>,
    )
  }
  for (const c of result.checks) {
    if (c.name === 'exit' || (c.name === 'expect' && view?.expect?.length)) continue
    chips.push(
      <CheckChip key={`c:${c.name}`} mark={c.ok ? 'ok' : 'bad'} title={c.detail}>
        {c.name}
        {c.name === 'commits' && c.detail && <span className="max-w-64 truncate opacity-75">{c.detail}</span>}
      </CheckChip>,
    )
  }
  const failures = result.checks.filter((c) => !c.ok && c.detail)
  if (chips.length === 0 && failures.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {chips.length > 0 && <div className="flex flex-wrap items-center gap-1">{chips}</div>}
      {failures.map((c) => (
        <p key={c.name} className="text-xs text-destructive">
          <span className="font-medium">{c.name}:</span> {c.detail}
        </p>
      ))}
    </div>
  )
}
