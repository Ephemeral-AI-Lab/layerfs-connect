// The Trace tab: one agent's trajectory as a ledger (host/runs/trajectory.js),
// grouped by turn the way dsh lists a conversation. A live session's rows
// come from pi's log (prompts, tokens, model time); a replay's from the
// scenario's script. Turns fold; LayerFS calls fold under their tool call;
// a search keeps the matching rows (and opens their turns). Pages load from
// the newest; "Load earlier" reads the page before. While the session plays,
// its events re-read the loaded rows (at most once a second).
import type { TracePage, TraceRecord, TraceWrite } from '@shared/host-api'
import { ArrowUpRight, ChevronDown, ChevronRight, CircleAlert, Flag, Layers, Search, X } from 'lucide-react'
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { LfsBranch, LfsCommit, LfsFork, LfsLayer, LfsMerge, LfsProject, LfsWorkspace } from '@/components/lfs-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { duration, plural } from '@/components/runs/run-format'
import { bytes, shortId } from '@/data/format'
import { host } from '@/host/client'
import { highlight, highlightOutput, type Token } from '@/lib/highlight'
import { useHostEvents } from '@/host/use-host'
import type { RunEvent } from '@shared/host-api'

const PAGE = 300
const MAX = 3000

/** Where a link from the Trace opens the project's History: a Commit, a Layer on main, or a Branch. */
export interface HistoryTarget {
  commit?: string
  layer?: string
  branch?: string
}

/** Opens the project's History on a checkpoint; absent where the Trace is not under a project. */
const OpenHistory = createContext<((at: HistoryTarget) => void) | undefined>(undefined)

interface Props {
  runId: string
  agent: string
  /** The session still plays: re-read on its events. */
  live: boolean
  /** When the session started: rows show their time from it. */
  started: number
  /** Opens the project's History on an auto-checkpoint's Commit. */
  onOpenHistory?: (at: HistoryTarget) => void
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
  const hay = [
    r.title,
    r.text,
    r.output,
    r.thinking,
    r.error,
    r.tool,
    r.outcome,
    r.from,
    r.child,
    ...Object.values(r.args ?? {}),
    ...(r.writes ?? []).flatMap((w) => [w.message, w.branch, w.path, w.commit, w.from, w.onto, w.with, w.method]),
    ...(r.checkpoints ?? []).map((n) => `auto-checkpoint #${n}`),
  ]
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

export function TraceView({ runId, agent, live, started, onOpenHistory }: Props) {
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
    const writes: Partial<Record<TraceWrite['kind'], number>> = {}
    let checkpoints = 0
    for (const r of records) {
      checkpoints += r.checkpoints?.length ?? 0
      for (const w of r.writes ?? []) if (w.status === 'ok') writes[w.kind] = (writes[w.kind] ?? 0) + 1
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
      writes,
      checkpoints,
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
    <OpenHistory.Provider value={onOpenHistory}>
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
          {totals.checkpoints > 0 && (
            <Stat
              label={`${plural(totals.checkpoints, 'auto-checkpoint')}${page.checkpoints && page.checkpoints > totals.checkpoints ? ` of ${page.checkpoints} in the session` : ''} (${WRITE_ORDER.filter((k) => totals.writes[k])
                .map((k) => `${totals.writes[k]} ${WRITE[k].short}`)
                .join(' · ')})`}
              title="Auto-checkpoints: each write that changed the project's store (Branch file op, Workspace commit, fork, merge, publish), numbered across the session's agents in the order they ended; refused writes are not counted"
            />
          )}
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
    </OpenHistory.Provider>
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

/** A tool's badge: short enough for the badge's width (the full name shows on hover). */
const TOOL_LABEL: Record<string, string> = { send_message: 'Message', list_agents: 'Agents' }
const toolLabel = (tool: string) => TOOL_LABEL[tool] ?? tool.replace(/^job_/, 'job ').replaceAll('_', ' ')

/** What a row says in one line when its title is empty. */
function headline(r: TraceRecord): string {
  if (r.title) return r.title
  if (r.kind === 'assistant') return r.error ? r.error : r.toolOnly ? 'tool call only' : r.final ? '(empty reply)' : ''
  return r.tool ?? r.kind
}

function Row({ r, started, open, onOpen, callsOpen, onCalls }: { r: TraceRecord; started: number; open: boolean; onOpen: () => void; callsOpen: boolean; onCalls?: () => void }) {
  const k = KIND[r.kind]
  const nested = r.kind === 'layerfs'
  const label = r.kind === 'assistant' && r.scripted ? 'Script' : r.kind === 'assistant' && r.final ? 'Reply' : r.kind === 'tool' && r.tool && r.tool !== 'bash' ? toolLabel(r.tool) : k.label
  const tone = r.kind === 'check' && r.status === 'failed' ? 'text-destructive bg-destructive/10 ring-destructive/20' : k.tone
  const hasDetail = Boolean(r.text || r.output || r.thinking || r.error || r.checks?.length || r.writes?.length || (r.args && Object.keys(r.args).length) || r.sections?.length || r.usage)
  return (
    <li className={`group/row border-b border-border/40 last:border-b-0 ${nested ? 'bg-foreground/[0.015]' : ''}`}>
      <div className={`flex items-center gap-2 py-1.5 pr-3 text-[13px] ${nested ? 'pl-12' : 'pl-3'}`}>
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[r.status]}`} title={r.status} />
        <span title={r.kind === 'tool' && r.tool ? r.tool : undefined} className={`w-16 shrink-0 truncate rounded px-1 text-center text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset ${tone}`}>
          {label}
        </span>
        <button
          type="button"
          onClick={hasDetail ? onOpen : undefined}
          aria-expanded={hasDetail ? open : undefined}
          className={`min-w-0 flex-1 truncate text-left ${nested ? 'font-mono text-xs' : ''} ${hasDetail ? 'cursor-pointer hover:text-primary' : 'cursor-default'} ${!r.title ? 'text-muted-foreground italic' : ''}`}
        >
          {headline(r)}
          {nested && r.writeKind && <WriteIcon kind={r.writeKind} className="mr-1 inline-block size-3 align-[-2px] text-primary" />}
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
          {!!r.writes?.length && <CheckpointChip r={r} writes={r.writes} onOpen={onOpen} />}
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

/** The kinds of write, as the Trace tab names them. */
const WRITE: Record<TraceWrite['kind'], { label: string; short: string; tone: string; hint: string }> = {
  file: { label: 'Branch write', short: 'file', tone: 'bg-agent-docs/10 text-agent-docs ring-agent-docs/25', hint: 'a Branch file op, committed straight to the Branch' },
  workspace: { label: 'Workspace commit', short: 'Workspace', tone: 'bg-primary/10 text-primary ring-primary/20', hint: 'the Workspace’s changes, saved to the Branch it is mounted on' },
  fork: { label: 'Fork', short: 'fork', tone: 'bg-agent-builder/10 text-agent-builder ring-agent-builder/25', hint: 'a new Branch' },
  merge: { label: 'Merge', short: 'merge', tone: 'bg-agent-reviewer/10 text-agent-reviewer ring-agent-reviewer/25', hint: 'two Branches merged into a new one' },
  publish: { label: 'Publish', short: 'publish', tone: 'bg-agent-tester/10 text-agent-tester ring-agent-tester/25', hint: 'a Branch added to main as a Layer' },
  init: { label: 'Init', short: 'init', tone: 'bg-foreground/[0.06] text-foreground/80 ring-foreground/15', hint: 'the project made from a folder' },
}
const WRITE_ORDER: TraceWrite['kind'][] = ['file', 'workspace', 'fork', 'merge', 'publish', 'init']

function WriteIcon({ kind, className }: { kind: TraceWrite['kind']; className?: string }) {
  const Icon = kind === 'fork' ? LfsFork : kind === 'merge' ? LfsMerge : kind === 'publish' ? LfsLayer : kind === 'init' ? LfsProject : LfsCommit
  return <Icon aria-hidden="true" className={className} />
}

/** One line of what a write did. */
function writeSummary(w: TraceWrite): string {
  const b = w.branch ?? '?'
  switch (w.kind) {
    case 'fork':
      return `${b} from ${w.from ?? 'main'}`
    case 'merge':
      return `${w.onto ?? '?'} + ${w.with ?? '?'} → ${b}`
    case 'publish':
      return `${b} → ${w.trunk ?? 'main'}`
    case 'file':
      return `${b} ${w.path ?? ''}`.trim()
    case 'workspace':
      return `${b} from ${w.workspace ?? '?'}`
    default:
      return b
  }
}

/** A link into the project's History: a filled pill that fills in on hover, so it reads as clickable. */
const LINK_PILL =
  'inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-primary/15 px-1.5 leading-5 font-semibold text-primary underline decoration-primary/40 decoration-dotted underline-offset-2 outline-none transition-colors hover:bg-primary hover:text-primary-foreground hover:no-underline focus-visible:ring-2 focus-visible:ring-ring'

/** Checkpoint numbers as ranges: [3, 4, 7] → "#3–#4, #7". */
function numbers(ns: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < ns.length;) {
    let j = i
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++
    parts.push(j > i ? `#${ns[i]}–#${ns[j]}` : `#${ns[i]}`)
    i = j + 1
  }
  return parts.join(', ')
}

/**
 * A checkpoint's place in the project's history, as a link to it: its Commit
 * (a Branch write, Workspace commit or merge), the Layer a publish added to
 * main (a scenario run's publish: its trunk Branch), a fork's new Branch.
 */
function historyTarget(w: TraceWrite): HistoryTarget | null {
  return w.status !== 'ok'
      ? null
      : w.kind === 'publish'
        ? w.layer
          ? { layer: w.layer }
          : w.trunk
            ? { branch: w.trunk, commit: w.commit ?? undefined }
            : w.commit
              ? { commit: w.commit }
              : null
        : w.commit
          ? { commit: w.commit, branch: w.branch ?? undefined }
          : w.kind === 'fork' && w.branch
            ? { branch: w.branch }
            : null
}

function HistoryLink({ w, open }: { w: TraceWrite; open?: (at: HistoryTarget) => void }) {
  const at = historyTarget(w)
  const id = at?.layer ?? at?.commit ?? null
  const Icon = at?.layer ? LfsLayer : at?.commit ? LfsCommit : LfsBranch
  const label = id ? shortId(id) : (at?.branch ?? null)
  if (!at || !label) return w.commit ? <span className="shrink-0 font-mono text-faint">{shortId(w.commit)}</span> : null
  const title = `${at.layer ? `Layer ${at.layer}` : at.commit ? `Commit ${at.commit}` : `Branch ${at.branch}`}${open ? ' — open it in the project’s History' : ''}`
  if (!open)
    return (
      <span className="flex shrink-0 items-center gap-1 font-mono text-foreground" title={title}>
        <Icon aria-hidden="true" className="size-3 text-faint" />
        {label}
      </span>
    )
  return (
    <button
      type="button"
      onClick={() => open(at)}
      title={title}
      className={`${LINK_PILL} font-mono`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </button>
  )
}

/** A tool row's mark: the session's auto-checkpoints its writes made, and any refused writes. */
function CheckpointChip({ r, writes, onOpen }: { r: TraceRecord; writes: TraceWrite[]; onOpen: () => void }) {
  const open = useContext(OpenHistory)
  const made = r.checkpoints ?? []
  // up to four numbers, each a link to its place in History; more, and the chip opens the row's list of them
  const links = open && made.length <= 4 ? writes.filter((w) => w.checkpoint !== null) : null
  const refused = writes.filter((w) => w.checkpoint === null).length
  const title = writes.map((w) => `${w.checkpoint !== null ? `#${w.checkpoint}` : 'refused'} ${WRITE[w.kind].label}: ${writeSummary(w)}${w.status === 'failed' ? ` (${w.outcome})` : ''}`).join('\n')
  return (
    <span className="flex items-center gap-1">
      {made.length > 0 && (
        <span className="flex items-center gap-1 font-medium text-primary">
          <Flag aria-hidden="true" className="size-3" />
          <span className="mr-0.5">{made.length === 1 ? 'Auto-checkpoint' : 'Auto-checkpoints'}</span>
          {links
            ? links.map((w, i) => {
                const at = historyTarget(w)
                return (
                  <Fragment key={w.checkpoint}>
                    {i > 0 && ' '}
                    {at ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          open?.(at)
                        }}
                        title={`Open #${w.checkpoint} in the project’s History — ${WRITE[w.kind].label}: ${writeSummary(w)}`}
                        className={LINK_PILL}
                      >
                        #{w.checkpoint}
                        <ArrowUpRight aria-hidden="true" className="size-3" />
                      </button>
                    ) : (
                      `#${w.checkpoint}`
                    )}
                  </Fragment>
                )
              })
            : (
                <button type="button" onClick={onOpen} title="Show its checkpoints, each a link to History" className={LINK_PILL}>
                  {numbers(made)}
                  <ChevronDown aria-hidden="true" className="size-3" />
                </button>
              )}
        </span>
      )}
      {refused > 0 && (
        <span className="rounded-full px-1.5 text-destructive ring-1 ring-destructive/25 ring-inset" title={title}>
          {refused} refused
        </span>
      )}
    </span>
  )
}

/**
 * A tool call's writes: each successful one an auto-checkpoint of the session,
 * and refused attempts (which changed nothing). Numbers skipped between two of
 * its checkpoints are other agents' writes, made meanwhile.
 */
function Writes({ writes, checkpoints }: { writes: TraceWrite[]; checkpoints: number[] }) {
  const open = useContext(OpenHistory)
  // after each checkpoint, the session's checkpoints made before this call's next one
  const gapAfter = new Map<number, [number, number]>()
  checkpoints.forEach((n, i) => {
    const next = checkpoints[i + 1]
    if (next !== undefined && next > n + 1) gapAfter.set(n, [n + 1, next - 1])
  })
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wide text-faint uppercase">{checkpoints.length ? `${checkpoints.length === 1 ? 'Auto-checkpoint' : 'Auto-checkpoints'} ${numbers(checkpoints)}` : 'Refused writes'}</span>
      <ol className="flex flex-col divide-y divide-border/50 rounded-md bg-foreground/[0.04] text-xs">
        {writes.map((w, i) => {
          const k = WRITE[w.kind]
          const failed = w.status === 'failed'
          const gap = w.checkpoint !== null ? gapAfter.get(w.checkpoint) : undefined
          return (
            <Fragment key={`${w.method}:${w.start}:${i}`}>
              <li className={`flex flex-col gap-0.5 px-2.5 py-1.5 ${failed ? 'bg-destructive/[0.05]' : ''}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`w-8 shrink-0 font-mono tabular-nums ${failed ? 'text-destructive' : 'text-primary'}`} title={w.checkpoint === null ? 'Refused: changed nothing' : `Auto-checkpoint ${w.checkpoint} of the session`}>
                    {w.checkpoint !== null ? `#${w.checkpoint}` : '—'}
                  </span>
                  <span className={`shrink-0 rounded px-1 text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset ${k.tone}`} title={`${w.method}: ${k.hint}`}>
                    {k.label}
                  </span>
                  <HistoryLink w={w} open={open} />
                  {w.kind === 'merge' ? (
                    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                      <LfsMerge aria-hidden="true" className="size-3 shrink-0 text-faint" />
                      <span className="truncate font-mono">
                        {w.onto ?? '?'} + {w.with ?? '?'} → {w.branch ?? '?'}
                      </span>
                    </span>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                      <LfsBranch aria-hidden="true" className="size-3 shrink-0 text-faint" />
                      <span className="truncate font-mono">{w.branch ?? 'Branch unknown'}</span>
                    </span>
                  )}
                  {w.kind === 'fork' && w.from && <span className="shrink-0 font-mono text-faint">from {w.from}</span>}
                  {w.kind === 'publish' && (
                    <span className="shrink-0 text-faint" title={w.trunk ? 'A scenario run publishes to its own trunk Branch, which joins main once the run passed' : undefined}>
                      → {w.trunk ? `${w.trunk} (the run's main)` : 'main'}
                      {w.layer ? ` as Layer ${shortId(w.layer)}` : ''}
                    </span>
                  )}
                  {w.kind === 'file' && w.path && <span className="min-w-0 truncate font-mono text-muted-foreground">{w.path}</span>}
                  {w.kind === 'workspace' && w.workspace && (
                    <span className="flex min-w-0 items-center gap-1 text-muted-foreground" title="Sandbox:path of the Workspace">
                      <LfsWorkspace aria-hidden="true" className="size-3 shrink-0 text-faint" />
                      <span className="truncate font-mono">{w.workspace}</span>
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-faint tabular-nums">
                    {w.outcome && <span className={failed ? 'font-medium text-destructive' : ''}>{w.outcome}</span>}
                    {w.kind === 'file' && <span className="font-mono">{w.method}</span>}
                    {w.sizes?.stored != null && <span title={`${w.sizes.logical ?? '?'} bytes in the tree, ${w.sizes.stored} new bytes stored`}>+{bytes(w.sizes.stored)}</span>}
                    {w.ms !== null && <span>{duration(w.ms)}</span>}
                  </span>
                </div>
                {w.message && (
                  <p className={`truncate pl-0.5 ${failed ? 'text-destructive' : 'text-foreground/85'}`} title={w.message}>
                    {w.message}
                  </p>
                )}
              </li>
              {gap && (
                <li className="px-2.5 py-1 text-[11px] text-faint italic">
                  {gap[0] === gap[1] ? `#${gap[0]}` : `#${gap[0]}–#${gap[1]}`} in between: {gap[1] - gap[0] + 1 === 1 ? 'another agent’s checkpoint' : 'other agents’ checkpoints'}, made meanwhile
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </div>
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
      {r.writes && r.writes.length > 0 && <Writes writes={r.writes} checkpoints={r.checkpoints ?? []} />}
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
