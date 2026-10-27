// The Trace tab: one agent's trajectory as a ledger (host/runs/trajectory.js),
// grouped by turn the way dsh lists a conversation. A live session's rows
// come from pi's log (prompts, tokens, model time); a replay's from the
// scenario's script. Turns fold; LayerFS calls fold under their tool call;
// a search keeps the matching rows (and opens their turns). Pages load from
// the newest; "Load earlier" reads the page before. While the session plays,
// its events re-read the loaded rows (at most once a second).
import type { TracePage, TraceRecord } from '@shared/host-api'
import { ChevronDown, ChevronRight, CircleAlert, Layers, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { duration, plural } from '@/components/runs/run-format'
import { host } from '@/host/client'
import { highlight, highlightOutput, type Token } from '@/lib/highlight'
import { useHostEvents } from '@/host/use-host'
import type { RunEvent } from '@shared/host-api'

const PAGE = 300
const MAX = 3000

interface Props {
  runId: string
  agent: string
  /** The session still plays: re-read on its events. */
  live: boolean
  /** When the session started: rows show their time from it. */
  started: number
}

const KIND: Record<TraceRecord['kind'], { label: string; tone: string }> = {
  system: { label: 'System', tone: 'text-muted-foreground bg-foreground/[0.06] ring-foreground/10' },
  user: { label: 'User', tone: 'text-primary bg-primary/10 ring-primary/20' },
  context: { label: 'Context', tone: 'text-agent-tester bg-agent-tester/10 ring-agent-tester/25' },
  assistant: { label: 'Model', tone: 'text-agent-reviewer bg-agent-reviewer/10 ring-agent-reviewer/25' },
  tool: { label: 'Tool', tone: 'text-foreground/80 bg-foreground/[0.06] ring-foreground/15' },
  subagent: { label: 'Subagent', tone: 'text-agent-builder bg-agent-builder/10 ring-agent-builder/25' },
  layerfs: { label: 'LayerFS', tone: 'text-agent-docs bg-agent-docs/10 ring-agent-docs/25' },
  check: { label: 'Check', tone: 'text-success bg-success/10 ring-success/20' },
}

const forRun = (e: RunEvent, id: string) => (e.type === 'run' ? e.run.id === id : e.run === id)
const tokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const offset = (at: number | null, started: number) => (at === null ? '' : `+${duration(at - started)}`)

function matches(r: TraceRecord, q: string): boolean {
  const hay = [r.title, r.text, r.output, r.thinking, r.error, r.tool, r.outcome, r.from, r.child, ...Object.values(r.args ?? {})]
  return hay.some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
}

/** The loaded rows: the newest page first, then earlier pages on request, re-read while live. */
function useTrace(runId: string, agent: string, live: boolean) {
  const [page, setPage] = useState<TracePage | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const loaded = useRef(PAGE)
  const seq = useRef(0)

  const read = useCallback(() => {
    const n = ++seq.current
    host.trace(runId, { agent, limit: Math.min(MAX, loaded.current) }).then(
      (p) => n === seq.current && (setPage(p), setError(null)),
      (e: unknown) => n === seq.current && setError(e instanceof Error ? e : new Error(String(e))),
    )
  }, [runId, agent])

  useEffect(() => {
    loaded.current = PAGE
    setPage(null)
    read()
  }, [read])

  // a burst of events re-reads once
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useHostEvents((e) => {
    if (!live || !forRun(e, runId) || timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      read()
    }, 1000)
  })
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const earlier = useCallback(async () => {
    if (!page || page.from === 0) return
    setLoadingEarlier(true)
    try {
      const before = await host.trace(runId, { agent, before: page.from, limit: PAGE })
      loaded.current = Math.min(MAX, loaded.current + before.records.length)
      seq.current++
      setPage((p) => (p ? { ...p, from: before.from, records: [...before.records, ...p.records] } : p))
    } finally {
      setLoadingEarlier(false)
    }
  }, [page, runId, agent])

  return { page, error, earlier, loadingEarlier }
}

interface Turn {
  turn: number
  rows: TraceRecord[]
  opener: TraceRecord | null
  start: number | null
  end: number | null
  requests: number
  tools: number
  layerfs: number
  failed: number
}

function turnsOf(records: TraceRecord[]): Turn[] {
  const out: Turn[] = []
  for (const r of records) {
    let t = out.at(-1)
    if (!t || t.turn !== r.turn) out.push((t = { turn: r.turn, rows: [], opener: null, start: null, end: null, requests: 0, tools: 0, layerfs: 0, failed: 0 }))
    t.rows.push(r)
    if (!t.opener && (r.opens || r.kind === 'system')) t.opener = r
    if (r.start !== null) {
      t.start = t.start === null ? r.start : Math.min(t.start, r.start)
      t.end = Math.max(t.end ?? r.start, r.start + (r.ms ?? 0))
    }
    if (r.kind === 'assistant') t.requests++
    else if (r.kind === 'tool' || r.kind === 'subagent') t.tools++
    else if (r.kind === 'layerfs') t.layerfs++
    if (r.status === 'failed') t.failed++
  }
  return out
}

export function TraceView({ runId, agent, live, started }: Props) {
  const { page, error, earlier, loadingEarlier } = useTrace(runId, agent, live)
  const [query, setQuery] = useState('')
  const [showCalls, setShowCalls] = useState(false)
  const [failuresOnly, setFailuresOnly] = useState(false)
  /** turn -> folded (true) or open (false); unset follows the default */
  const [folded, setFolded] = useState<Map<number, boolean>>(new Map())
  /** tool rows whose LayerFS calls are open while calls are folded */
  const [openCalls, setOpenCalls] = useState<Set<string>>(new Set())
  const [openRows, setOpenRows] = useState<Set<string>>(new Set())

  useEffect(() => {
    setFolded(new Map())
    setOpenCalls(new Set())
    setOpenRows(new Set())
  }, [agent])

  const records = useMemo(() => page?.records ?? [], [page])
  const q = query.trim().toLowerCase()
  const filtering = q !== '' || failuresOnly
  const kept = useMemo(() => {
    if (!filtering) return records
    const ids = new Set<string>()
    for (const r of records) {
      if ((q && !matches(r, q)) || (failuresOnly && r.status !== 'failed')) continue
      ids.add(r.id)
      if (r.parent) ids.add(r.parent)
    }
    return records.filter((r) => ids.has(r.id))
  }, [records, q, failuresOnly, filtering])
  const turns = useMemo(() => turnsOf(kept), [kept])
  const allTurns = useMemo(() => turnsOf(records), [records])
  const lastTurn = allTurns.at(-1)?.turn ?? 0

  const totals = useMemo(() => {
    let input = 0
    let output = 0
    let cost = 0
    let model = 0
    for (const r of records) {
      if (r.usage) (input += r.usage.input + r.usage.cacheRead), (output += r.usage.output), (cost += r.usage.cost)
      if (r.kind === 'assistant' && r.ms !== null) model += r.ms
    }
    const t = allTurns
    return {
      turns: t.filter((x) => x.turn > 0).length,
      requests: t.reduce((n, x) => n + x.requests, 0),
      tools: t.reduce((n, x) => n + x.tools, 0),
      layerfs: t.reduce((n, x) => n + x.layerfs, 0),
      failed: t.reduce((n, x) => n + x.failed, 0),
      input,
      output,
      cost,
      model,
    }
  }, [records, allTurns])

  // by default the last turn and the setup are open; a long session folds the rest
  const isFolded = (turn: number) => {
    if (filtering) return false
    const set = folded.get(turn)
    if (set !== undefined) return set
    return allTurns.length > 4 && turn !== lastTurn && turn !== 0
  }
  const foldAll = (fold: boolean) => setFolded(new Map(allTurns.map((t) => [t.turn, fold])))
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    return next
  }

  if (error && !page) return <p className="px-8 py-10 text-center text-sm text-destructive">Trace did not load: {error.message}</p>
  if (!page) return <p className="px-8 py-10 text-center text-sm text-muted-foreground">Reading the trace…</p>

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3 px-8 pt-3 pb-12">
      {/* the toolbar: what the agent did in numbers, then fold and search */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-col gap-2 bg-background/90 px-2 pt-1 pb-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded px-1 text-[10px] font-medium tracking-wide text-faint uppercase ring-1 ring-border ring-inset">
            {page.kind === 'live' ? 'model' : 'scripted'}
          </span>
          <Stat label={plural(totals.turns, 'turn')} />
          <Stat label={plural(totals.requests, page.kind === 'live' ? 'request' : 'step')} />
          <Stat label={plural(totals.tools, 'tool call')} />
          <Stat label={plural(totals.layerfs, 'LayerFS call')} />
          {page.kind === 'live' && totals.requests > 0 && (
            <>
              <Stat label={`${tokens(totals.input)} in · ${tokens(totals.output)} out`} title="Tokens: input (with cache reads) and output" />
              {totals.cost > 0 && <Stat label={`$${totals.cost.toFixed(totals.cost < 1 ? 3 : 2)}`} title="Cost pi reported" />}
              <Stat label={`${duration(totals.model)} model`} title="Time spent in model requests" />
            </>
          )}
          {totals.failed > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <CircleAlert aria-hidden="true" className="size-3.5" />
              {totals.failed} failed
            </span>
          )}
          {page.from > 0 && <span className="text-faint">counts cover the {page.records.length} newest of {page.total} rows</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts, output, paths…" aria-label="Search the trace" className="h-7 pr-7 pl-8 text-xs" />
            {query && (
              <button type="button" aria-label="Clear the search" onClick={() => setQuery('')} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-faint hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Toggle on={showCalls} onClick={() => setShowCalls((v) => !v)} title="Show every tool call's LayerFS calls">
            <Layers aria-hidden="true" className="size-3.5" /> LayerFS calls
          </Toggle>
          <Toggle on={failuresOnly} onClick={() => setFailuresOnly((v) => !v)} title="Only rows that failed">
            <CircleAlert aria-hidden="true" className="size-3.5" /> Failures
          </Toggle>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => foldAll(false)} disabled={filtering}>
            Expand all
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => foldAll(true)} disabled={filtering}>
            Fold all
          </Button>
        </div>
      </div>

      {page.from > 0 && (
        <Button variant="outline" size="sm" className="self-center text-xs" onClick={() => void earlier()} disabled={loadingEarlier}>
          {loadingEarlier ? 'Loading…' : `Load earlier (${page.from} more)`}
        </Button>
      )}

      {filtering && turns.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No rows match.</p>}

      {turns.map((t) => {
        const fold = isFolded(t.turn)
        return (
          <section key={t.turn} className="surface overflow-hidden rounded-xl">
            <button
              type="button"
              aria-expanded={!fold}
              onClick={() => setFolded((m) => new Map(m).set(t.turn, !fold))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
            >
              {fold ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-faint" /> : <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-faint" />}
              <span className="shrink-0 font-semibold">{t.turn === 0 ? 'Setup' : `Turn ${t.turn}`}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.opener && t.opener.kind !== 'system' ? t.opener.title : ''}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-faint tabular-nums">
                {t.requests > 0 && <span>{plural(t.requests, page.kind === 'live' ? 'request' : 'step')}</span>}
                {t.tools > 0 && <span>{plural(t.tools, 'call')}</span>}
                {t.failed > 0 && <span className="text-destructive">{t.failed} failed</span>}
                {t.start !== null && t.end !== null && t.turn > 0 && <span>{duration(t.end - t.start)}</span>}
              </span>
            </button>
            {!fold && (
              <ol className="border-t border-border/60">
                {t.rows.map((r) => {
                  if (r.kind === 'layerfs' && !showCalls && !filtering && !(r.parent && openCalls.has(r.parent))) return null
                  // a scripted step that says nothing is its tool row alone
                  if (r.kind === 'assistant' && r.scripted && r.toolOnly) return null
                  return (
                    <Row
                      key={r.id}
                      r={r}
                      started={started}
                      open={openRows.has(r.id)}
                      onOpen={() => setOpenRows((s) => toggle(s, r.id))}
                      callsOpen={showCalls || filtering || openCalls.has(r.id)}
                      onCalls={showCalls || filtering ? undefined : () => setOpenCalls((s) => toggle(s, r.id))}
                    />
                  )
                })}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Stat({ label, title }: { label: string; title?: string }) {
  return (
    <span className="tabular-nums" title={title}>
      {label}
    </span>
  )
}

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium ring-1 transition-colors ring-inset ${on ? 'bg-primary/10 text-primary ring-primary/25' : 'text-muted-foreground ring-border hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

const STATUS_DOT: Record<TraceRecord['status'], string> = {
  ok: 'bg-success/70',
  failed: 'bg-destructive',
  running: 'bg-primary animate-pulse',
  starting: 'bg-primary animate-pulse',
  stopped: 'bg-warning',
}

/** What a row says in one line when its title is empty. */
function headline(r: TraceRecord): string {
  if (r.title) return r.title
  if (r.kind === 'assistant') return r.error ? r.error : r.toolOnly ? 'tool call only' : r.final ? '(empty reply)' : ''
  return r.tool ?? r.kind
}

function Row({ r, started, open, onOpen, callsOpen, onCalls }: { r: TraceRecord; started: number; open: boolean; onOpen: () => void; callsOpen: boolean; onCalls?: () => void }) {
  const k = KIND[r.kind]
  const nested = r.kind === 'layerfs'
  const label = r.kind === 'assistant' && r.scripted ? 'Script' : r.kind === 'assistant' && r.final ? 'Reply' : r.kind === 'tool' && r.tool && r.tool !== 'bash' ? r.tool : k.label
  const tone = r.kind === 'check' && r.status === 'failed' ? 'text-destructive bg-destructive/10 ring-destructive/20' : k.tone
  const hasDetail = Boolean(r.text || r.output || r.thinking || r.error || r.checks?.length || (r.args && Object.keys(r.args).length) || r.sections?.length || r.usage)
  return (
    <li className={`group/row border-b border-border/40 last:border-b-0 ${nested ? 'bg-foreground/[0.015]' : ''}`}>
      <div className={`flex items-center gap-2 py-1.5 pr-3 text-[13px] ${nested ? 'pl-12' : 'pl-3'}`}>
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[r.status]}`} title={r.status} />
        <span className={`w-16 shrink-0 rounded px-1 text-center text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset ${tone}`}>{label}</span>
        <button
          type="button"
          onClick={hasDetail ? onOpen : undefined}
          aria-expanded={hasDetail ? open : undefined}
          className={`min-w-0 flex-1 truncate text-left ${nested ? 'font-mono text-xs' : ''} ${hasDetail ? 'cursor-pointer hover:text-primary' : 'cursor-default'} ${!r.title ? 'text-muted-foreground italic' : ''}`}
        >
          {headline(r)}
          {nested && r.outcome && <span className={`ml-2 not-italic ${r.status === 'failed' ? 'text-destructive' : 'text-faint'}`}>{r.outcome}</span>}
          {nested && r.args && Object.keys(r.args).length > 0 && <span className="ml-2 text-faint">{Object.values(r.args).join(' ')}</span>}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-xs text-faint tabular-nums">
          {r.usage && (
            <span title={`input ${r.usage.input}, cache read ${r.usage.cacheRead}, output ${r.usage.output}${r.usage.reasoning ? `, reasoning ${r.usage.reasoning}` : ''}`}>
              {tokens(r.usage.input + r.usage.cacheRead)}→{tokens(r.usage.output)}
            </span>
          )}
          {r.kind === 'tool' && r.exitCode !== null && r.exitCode !== undefined && r.exitCode !== 0 && <span className="text-destructive">exit {r.exitCode}</span>}
          {!!r.calls && (
            <button
              type="button"
              onClick={onCalls}
              disabled={!onCalls}
              title={onCalls ? (callsOpen ? 'Fold its LayerFS calls' : 'Show its LayerFS calls') : undefined}
              className={`flex items-center gap-1 rounded-full px-1.5 ring-1 ring-inset ${callsOpen ? 'text-agent-docs ring-agent-docs/30' : 'ring-border'} ${onCalls ? 'hover:text-agent-docs' : ''}`}
            >
              <Layers aria-hidden="true" className="size-3" />
              {r.calls}
            </button>
          )}
          {r.ms !== null && <span>{duration(r.ms)}</span>}
          <span className="hidden w-16 text-right whitespace-nowrap group-hover/row:inline">{offset(r.start, started)}</span>
        </span>
      </div>
      {open && hasDetail && <Detail r={r} />}
    </li>
  )
}

function Block({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wide text-faint uppercase">{label}</span>
      <div className={`max-h-80 overflow-auto rounded-md bg-foreground/[0.04] px-2.5 py-2 text-xs break-words whitespace-pre-wrap ${mono ? 'font-mono' : ''}`}>{children}</div>
    </div>
  )
}

/** Highlighted lines: a command (bash, its heredoc scripts in their language, LayerFS operations marked) or a call's output. */
function Code({ lines }: { lines: Token[][] }) {
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

function Detail({ r }: { r: TraceRecord }) {
  const command = r.kind === 'tool' && r.text ? highlight(r.text.replace(/\n$/, ''), r.tool === 'bash' || !r.tool ? 'bash' : 'text') : null
  const output = r.output ? highlightOutput(r.output.replace(/\n$/, '')) : null
  const textLabel = r.kind === 'tool' ? 'Command' : r.kind === 'subagent' ? 'Task' : r.kind === 'assistant' ? (r.scripted ? 'Says' : 'Text') : r.kind === 'system' ? 'Prompt' : r.kind === 'check' ? 'Detail' : 'Message'
  return (
    <div className="flex flex-col gap-2 px-3 pt-1 pb-3 pl-[6.25rem]">
      {r.kind === 'system' && (r.model || r.sections?.length) && (
        <p className="text-xs text-muted-foreground">
          {r.model && <>Model {r.model}{r.thinking ? ` · thinking ${r.thinking}` : ''}</>}
          {r.sections?.length ? <> · sections: {r.sections.join(', ')}</> : null}
        </p>
      )}
      {r.kind === 'assistant' && (r.model || r.stopReason) && (
        <p className="text-xs text-muted-foreground">
          {[r.model, r.stopReason && `stop: ${r.stopReason}`, r.usage && `${r.usage.input} in · ${r.usage.cacheRead} cached · ${r.usage.output} out${r.usage.reasoning ? ` · ${r.usage.reasoning} reasoning` : ''}`, r.usage?.cost ? `$${r.usage.cost.toFixed(4)}` : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {r.error && <Block label="Error">{r.error}</Block>}
      {r.thinking && r.kind === 'assistant' && <Block label="Thinking">{r.thinking}</Block>}
      {command ? (
        <Block label={textLabel} mono>
          <Code lines={command} />
        </Block>
      ) : (
        r.text && <Block label={textLabel}>{r.text}</Block>
      )}
      {output && (
        <Block label="Output" mono>
          <Code lines={output} />
        </Block>
      )}
      {r.args && Object.keys(r.args).length > 0 && (
        <Block label="Arguments" mono>
          {Object.entries(r.args)
            .map(([key, v]) => `${key}: ${v}`)
            .join('\n')}
        </Block>
      )}
      {r.checks && r.checks.length > 0 && (
        <Block label="Checks">
          {r.checks.map((c) => (
            <div key={c.name} className={c.ok ? '' : 'text-destructive'}>
              {c.ok ? '✓' : '✗'} {c.name}: {c.detail}
            </div>
          ))}
        </Block>
      )}
    </div>
  )
}
