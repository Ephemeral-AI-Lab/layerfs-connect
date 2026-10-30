// A run's Trace: one agent's trajectory as a ledger (host/runs/trajectory.js),
// grouped by turn. Turns fold; LayerFS calls fold under their tool call; a
// search keeps the matching rows (and opens their turns). Pages load from the
// newest; "Load earlier" reads the page before. While the run plays, its
// events re-read the loaded rows (at most once a second).
import type { RunEvent, TracePage, TraceRecord, TraceWrite } from '@shared/host-api'
import { ArrowUpRight, ChevronRight, CircleAlert, Flag, Layers, Search, X } from 'lucide-react'
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { LfsBranch, LfsCommit, LfsFork, LfsLayer, LfsMerge, LfsProject, LfsWorkspace } from '@/components/lfs-icons'
import { spotlight } from '@/components/motion/spotlight'
import { LoadError, Loading } from '@/components/projects/states'
import { duration, plural } from '@/components/runs/run-format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { bytes, shortId } from '@/data/format'
import { host } from '@/host/client'
import { useHostEvents } from '@/host/use-host'
import { t, useI18n } from '@/i18n'
import { highlight, highlightOutput, type Token } from '@/lib/highlight'
import { cn } from '@/lib/utils'

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
  /** The run still plays: re-read on its events. */
  live: boolean
  /** When the run started: rows show their time from it. */
  started: number
  /** Opens the project's History on an auto-checkpoint's Commit. */
  onOpenHistory?: (at: HistoryTarget) => void
}

const KIND: Record<TraceRecord['kind'], { label: string; tone: string }> = {
  system: { label: 'System', tone: 'text-muted-foreground bg-foreground/[0.05] ring-foreground/10' },
  user: { label: 'User', tone: 'text-primary bg-primary/10 ring-primary/20' },
  context: { label: 'Context', tone: 'text-agent-tester bg-agent-tester/10 ring-agent-tester/25' },
  assistant: { label: 'Model', tone: 'text-agent-reviewer bg-agent-reviewer/10 ring-agent-reviewer/25' },
  tool: { label: 'Tool', tone: 'text-foreground/80 bg-foreground/[0.05] ring-foreground/15' },
  subagent: { label: 'Subagent', tone: 'text-agent-builder bg-agent-builder/10 ring-agent-builder/25' },
  layerfs: { label: 'LayerFS', tone: 'text-agent-docs bg-agent-docs/10 ring-agent-docs/25' },
  check: { label: 'Check', tone: 'text-success bg-success/10 ring-success/20' },
}

const forRun = (e: RunEvent, id: string) => (e.type === 'run' ? e.run.id === id : e.type === 'run-removed' ? e.id === id : e.run === id)
const offset = (at: number | null, started: number) => (at === null ? '' : `+${duration(at - started)}`)

function matches(r: TraceRecord, q: string): boolean {
  const hay = [
    r.title,
    r.text,
    r.output,
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
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      setLoadingEarlier(false)
    }
  }, [page, runId, agent])

  return { page, error, earlier, loadingEarlier, read }
}

interface Turn {
  turn: number
  rows: TraceRecord[]
  opener: TraceRecord | null
  start: number | null
  end: number | null
  steps: number
  tools: number
  layerfs: number
  failed: number
}

function turnsOf(records: TraceRecord[]): Turn[] {
  const out: Turn[] = []
  for (const r of records) {
    let turn = out.at(-1)
    if (!turn || turn.turn !== r.turn) out.push((turn = { turn: r.turn, rows: [], opener: null, start: null, end: null, steps: 0, tools: 0, layerfs: 0, failed: 0 }))
    turn.rows.push(r)
    if (!turn.opener && (r.opens || r.kind === 'system')) turn.opener = r
    if (r.start !== null) {
      turn.start = turn.start === null ? r.start : Math.min(turn.start, r.start)
      turn.end = Math.max(turn.end ?? r.start, r.start + (r.ms ?? 0))
    }
    if (r.kind === 'assistant') turn.steps++
    else if (r.kind === 'tool' || r.kind === 'subagent') turn.tools++
    else if (r.kind === 'layerfs') turn.layerfs++
    if (r.status === 'failed') turn.failed++
  }
  return out
}

const toggled = <T,>(set: Set<T>, v: T) => {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

export function TraceView({ runId, agent, live, started, onOpenHistory }: Props) {
  useI18n()
  const { page, error, earlier, loadingEarlier, read } = useTrace(runId, agent, live)
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
    const writes: Partial<Record<TraceWrite['kind'], number>> = {}
    let checkpoints = 0
    for (const r of records) {
      checkpoints += r.checkpoints?.length ?? 0
      for (const w of r.writes ?? []) if (w.status === 'ok') writes[w.kind] = (writes[w.kind] ?? 0) + 1
    }
    return {
      turns: allTurns.filter((x) => x.turn > 0).length,
      steps: allTurns.reduce((n, x) => n + x.steps, 0),
      tools: allTurns.reduce((n, x) => n + x.tools, 0),
      layerfs: allTurns.reduce((n, x) => n + x.layerfs, 0),
      failed: allTurns.reduce((n, x) => n + x.failed, 0),
      writes,
      checkpoints,
    }
  }, [records, allTurns])

  // by default the last turn and the setup are open; a long trace folds the rest
  const isFolded = (turn: number) => {
    if (filtering) return false
    return folded.get(turn) ?? (allTurns.length > 4 && turn !== lastTurn && turn !== 0)
  }
  const foldAll = (fold: boolean) => setFolded(new Map(allTurns.map((x) => [x.turn, fold])))

  if (error && !page) return <LoadError error={error} what={t('the trace')} onRetry={read} className="mx-auto mt-6 w-full max-w-4xl" />
  if (!page) return <Loading label={t('Reading the trace')} />

  return (
    <OpenHistory.Provider value={onOpenHistory}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 pt-3 pb-12">
        {/* the toolbar: what the agent did in numbers, then fold and search */}
        <div className="glass-liquid sticky top-2 z-10 flex flex-col gap-2.5 rounded-2xl px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>{plural(totals.turns, 'turn')}</span>
            <span>{plural(totals.steps, 'step')}</span>
            <span>{t(totals.tools === 1 ? '{n} tool call' : '{n} tool calls', { n: totals.tools })}</span>
            <span>{t(totals.layerfs === 1 ? '{n} LayerFS call' : '{n} LayerFS calls', { n: totals.layerfs })}</span>
            {totals.checkpoints > 0 && (
              <span title={t('Auto-checkpoints: each write that changed the project’s Store, numbered across the run’s agents in the order they ended; refused writes are not counted')}>
                {t(totals.checkpoints === 1 ? '{n} auto-checkpoint' : '{n} auto-checkpoints', { n: totals.checkpoints })}
                {page.checkpoints && page.checkpoints > totals.checkpoints ? ` ${t('of {n} in the run', { n: page.checkpoints })}` : ''} (
                {WRITE_ORDER.filter((k) => totals.writes[k])
                  .map((k) => `${totals.writes[k]} ${t(WRITE[k].short)}`)
                  .join(' · ')}
                )
              </span>
            )}
            {totals.failed > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <CircleAlert aria-hidden="true" className="size-3.5" />
                {t('{n} failed', { n: totals.failed })}
              </span>
            )}
            {page.from > 0 && <span>{t('counts cover the {n} newest of {total} rows', { n: page.records.length, total: page.total })}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="group/search relative min-w-48 flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/search:text-primary" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && query && setQuery('')}
                placeholder={t('Search commands, output, paths…')}
                aria-label={t('Search the trace')}
                className="h-8 rounded-xl pr-8 pl-8.5 text-xs"
              />
              {query && (
                <button type="button" aria-label={t('Clear search')} onClick={() => setQuery('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Toggle on={showCalls} onClick={() => setShowCalls((v) => !v)} title={t('Show every tool call’s LayerFS calls')}>
              <Layers aria-hidden="true" className="size-3.5" />
              {t('LayerFS calls')}
            </Toggle>
            <Toggle on={failuresOnly} onClick={() => setFailuresOnly((v) => !v)} title={t('Only rows that failed')}>
              <CircleAlert aria-hidden="true" className="size-3.5" />
              {t('Failures')}
            </Toggle>
            <Button variant="ghost" size="sm" className="h-8 rounded-xl px-2.5 text-xs" onClick={() => foldAll(false)} disabled={filtering}>
              {t('Expand all')}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 rounded-xl px-2.5 text-xs" onClick={() => foldAll(true)} disabled={filtering}>
              {t('Fold all')}
            </Button>
          </div>
        </div>

        {error && <p role="alert" className="rounded-xl bg-destructive/[0.06] px-3.5 py-2.5 text-xs text-destructive">{error.message}</p>}

        {page.from > 0 && (
          <Button variant="outline" size="sm" className="self-center rounded-xl text-xs" onClick={() => void earlier()} disabled={loadingEarlier}>
            {loadingEarlier ? t('Loading…') : t('Load earlier ({n} more)', { n: page.from })}
          </Button>
        )}

        {records.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{live ? t('{name} has not started yet.', { name: agent }) : t('{name} left no trace.', { name: agent })}</p>}
        {filtering && records.length > 0 && turns.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t('No rows match.')}</p>}

        {turns.map((turn) => {
          const fold = isFolded(turn.turn)
          return (
            <section key={turn.turn} onPointerMove={spotlight} className="glass-liquid spotlight overflow-hidden rounded-2xl">
              <button
                type="button"
                aria-expanded={!fold}
                onClick={() => setFolded((m) => new Map(m).set(turn.turn, !fold))}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm outline-none transition-colors hover:bg-foreground/[0.02] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <ChevronRight aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-base)', !fold && 'rotate-90')} />
                <span className="shrink-0 font-semibold">{turn.turn === 0 ? t('Setup') : t('Turn {n}', { n: turn.turn })}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{turn.opener && turn.opener.kind !== 'system' ? turn.opener.title : ''}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {turn.steps > 0 && <span>{plural(turn.steps, 'step')}</span>}
                  {turn.tools > 0 && <span>{plural(turn.tools, 'call')}</span>}
                  {turn.failed > 0 && <span className="text-destructive">{t('{n} failed', { n: turn.failed })}</span>}
                  {turn.start !== null && turn.end !== null && turn.turn > 0 && <span>{duration(turn.end - turn.start)}</span>}
                </span>
              </button>
              {!fold && (
                <ol className="border-t border-foreground/[0.06]">
                  {turn.rows.map((r) => {
                    if (r.kind === 'layerfs' && !showCalls && !filtering && !(r.parent && openCalls.has(r.parent))) return null
                    // a scripted step that says nothing is its tool row alone
                    if (r.kind === 'assistant' && r.scripted && r.toolOnly) return null
                    return (
                      <Row
                        key={r.id}
                        r={r}
                        started={started}
                        open={openRows.has(r.id)}
                        onOpen={() => setOpenRows((s) => toggled(s, r.id))}
                        callsOpen={showCalls || filtering || openCalls.has(r.id)}
                        onCalls={showCalls || filtering ? undefined : () => setOpenCalls((s) => toggled(s, r.id))}
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

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium ring-1 ring-inset outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'bg-primary/10 text-primary ring-primary/25' : 'text-muted-foreground ring-foreground/10 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

const STATUS_DOT: Record<TraceRecord['status'], string> = {
  ok: 'bg-success/70',
  failed: 'bg-destructive',
  running: 'bg-primary motion-safe:animate-pulse',
  starting: 'bg-primary motion-safe:animate-pulse',
  stopped: 'bg-warning',
}

/** A tool's badge: short enough for the badge's width (the full name shows on hover). */
const TOOL_LABEL: Record<string, string> = { send_message: 'Message', list_agents: 'Agents' }
const toolLabel = (tool: string) => TOOL_LABEL[tool] ?? tool.replace(/^job_/, 'job ').replaceAll('_', ' ')

/** What a row says in one line when its title is empty. */
function headline(r: TraceRecord): string {
  if (r.title) return r.title
  if (r.kind === 'assistant') return r.error ? r.error : r.toolOnly ? t('tool call only') : r.final ? t('(empty reply)') : ''
  return r.tool ?? r.kind
}

function Row({ r, started, open, onOpen, callsOpen, onCalls }: { r: TraceRecord; started: number; open: boolean; onOpen: () => void; callsOpen: boolean; onCalls?: () => void }) {
  const k = KIND[r.kind]
  const nested = r.kind === 'layerfs'
  const label = r.kind === 'assistant' && r.scripted ? 'Script' : r.kind === 'assistant' && r.final ? 'Reply' : r.kind === 'tool' && r.tool && r.tool !== 'bash' ? toolLabel(r.tool) : k.label
  const tone = r.kind === 'check' && r.status === 'failed' ? 'text-destructive bg-destructive/10 ring-destructive/20' : k.tone
  const hasDetail = Boolean(r.text || r.output || r.error || r.checks?.length || r.writes?.length || (r.args && Object.keys(r.args).length))
  return (
    <li className={cn('group/row border-b border-foreground/[0.05] last:border-b-0', nested && 'bg-foreground/[0.015]')}>
      <div className={cn('flex items-center gap-2 py-1.5 pr-4 text-[13px]', nested ? 'pl-12' : 'pl-4')}>
        <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[r.status])} title={t(r.status)} />
        <span title={r.kind === 'tool' && r.tool ? r.tool : undefined} className={cn('w-16 shrink-0 truncate rounded-full px-1.5 text-center text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset', tone)}>
          {t(label)}
        </span>
        <button
          type="button"
          onClick={hasDetail ? onOpen : undefined}
          aria-expanded={hasDetail ? open : undefined}
          className={cn('min-w-0 flex-1 truncate rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', nested && 'font-mono text-xs', hasDetail ? 'cursor-pointer hover:text-primary' : 'cursor-default', !r.title && 'text-muted-foreground italic')}
        >
          {headline(r)}
          {nested && r.writeKind && <WriteIcon kind={r.writeKind} className="ml-1 inline-block size-3 align-[-2px] text-primary" />}
          {nested && r.outcome && <span className={cn('ml-2 not-italic', r.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{r.outcome}</span>}
          {nested && r.args && Object.keys(r.args).length > 0 && <span className="ml-2 text-muted-foreground">{Object.values(r.args).join(' ')}</span>}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {r.kind === 'tool' && r.exitCode !== null && r.exitCode !== undefined && r.exitCode !== 0 && <span className="text-destructive">{t('exit {code}', { code: r.exitCode })}</span>}
          {!!r.writes?.length && <CheckpointChip r={r} writes={r.writes} onOpen={onOpen} />}
          {!!r.calls && (
            <button
              type="button"
              onClick={onCalls}
              disabled={!onCalls}
              title={onCalls ? (callsOpen ? t('Fold its LayerFS calls') : t('Show its LayerFS calls')) : undefined}
              className={cn('flex items-center gap-1 rounded-full px-1.5 ring-1 ring-inset', callsOpen ? 'text-agent-docs ring-agent-docs/30' : 'ring-foreground/10', onCalls && 'hover:text-agent-docs')}
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
      <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{t(label)}</span>
      <div className={cn('chat-inset max-h-80 overflow-auto rounded-xl border border-foreground/[0.06] px-3 py-2 text-xs break-words whitespace-pre-wrap', mono && 'font-mono')}>{children}</div>
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

/** The kinds of write, as the Trace names them. */
const WRITE: Record<TraceWrite['kind'], { label: string; short: string; tone: string; hint: string }> = {
  file: { label: 'Branch write', short: 'file', tone: 'bg-agent-docs/10 text-agent-docs ring-agent-docs/25', hint: 'a Branch file op, committed straight to the Branch' },
  workspace: { label: 'Workspace commit', short: 'Workspace', tone: 'bg-primary/10 text-primary ring-primary/20', hint: 'the Workspace’s changes, saved to the Branch it is mounted on' },
  fork: { label: 'Fork', short: 'fork', tone: 'bg-agent-builder/10 text-agent-builder ring-agent-builder/25', hint: 'a new Branch' },
  merge: { label: 'Merge', short: 'merge', tone: 'bg-agent-reviewer/10 text-agent-reviewer ring-agent-reviewer/25', hint: 'two Branches merged into a new one' },
  publish: { label: 'Publish', short: 'publish', tone: 'bg-agent-tester/10 text-agent-tester ring-agent-tester/25', hint: 'a Branch added to main as a Layer' },
  init: { label: 'Init', short: 'init', tone: 'bg-foreground/[0.05] text-foreground/80 ring-foreground/15', hint: 'the project made from a folder' },
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
      return `${b} ← ${w.from ?? 'main'}`
    case 'merge':
      return `${w.onto ?? '?'} + ${w.with ?? '?'} → ${b}`
    case 'publish':
      return `${b} → ${w.trunk ?? 'main'}`
    case 'file':
      return `${b} ${w.path ?? ''}`.trim()
    case 'workspace':
      return `${b} ← ${w.workspace ?? '?'}`
    default:
      return b
  }
}

/** A link into the project's History: a tinted pill that fills on hover, so it reads as clickable. */
const LINK_PILL =
  'inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-primary/10 px-1.5 leading-5 font-semibold text-primary outline-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring'

/** Checkpoint numbers as ranges: [3, 4, 7] → "#3–#4, #7". */
function numbers(ns: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < ns.length; ) {
    let j = i
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++
    parts.push(j > i ? `#${ns[i]}–#${ns[j]}` : `#${ns[i]}`)
    i = j + 1
  }
  return parts.join(', ')
}

/**
 * A checkpoint's place in the project's history: its Commit (a Branch write,
 * Workspace commit or merge), the run's trunk Branch a publish went to (or
 * the Layer it added to main), a fork's new Branch.
 */
function historyTarget(w: TraceWrite): HistoryTarget | null {
  if (w.status !== 'ok') return null
  if (w.kind === 'publish') return w.layer ? { layer: w.layer } : w.trunk ? { branch: w.trunk, commit: w.commit ?? undefined } : w.commit ? { commit: w.commit } : null
  if (w.commit) return { commit: w.commit, branch: w.branch ?? undefined }
  return w.kind === 'fork' && w.branch ? { branch: w.branch } : null
}

function HistoryLink({ w, open }: { w: TraceWrite; open?: (at: HistoryTarget) => void }) {
  const at = historyTarget(w)
  const id = at?.layer ?? at?.commit ?? null
  const Icon = at?.layer ? LfsLayer : at?.commit ? LfsCommit : LfsBranch
  const label = id ? shortId(id) : (at?.branch ?? null)
  if (!at || !label) return w.commit ? <span className="shrink-0 font-mono text-muted-foreground">{shortId(w.commit)}</span> : null
  const title = at.layer ? t('Layer {id}', { id: at.layer }) : at.commit ? t('Commit {id}', { id: at.commit }) : t('Branch {name}', { name: at.branch ?? '' })
  if (!open)
    return (
      <span className="flex shrink-0 items-center gap-1 font-mono text-foreground" title={title}>
        <Icon aria-hidden="true" className="size-3 text-muted-foreground" />
        {label}
      </span>
    )
  return (
    <button type="button" onClick={() => open(at)} title={`${title} · ${t('Open in History')}`} className={cn(LINK_PILL, 'font-mono')}>
      <Icon aria-hidden="true" className="size-3" />
      {label}
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </button>
  )
}

/** A tool row's mark: the run's auto-checkpoints its writes made, and any refused writes. */
function CheckpointChip({ r, writes, onOpen }: { r: TraceRecord; writes: TraceWrite[]; onOpen: () => void }) {
  const open = useContext(OpenHistory)
  const made = r.checkpoints ?? []
  // up to four numbers, each a link to its place in History; more, and the chip opens the row's list of them
  const links = open && made.length <= 4 ? writes.filter((w) => w.checkpoint !== null) : null
  const refused = writes.filter((w) => w.checkpoint === null).length
  const title = writes.map((w) => `${w.checkpoint !== null ? `#${w.checkpoint}` : t('refused')} ${t(WRITE[w.kind].label)}: ${writeSummary(w)}${w.status === 'failed' ? ` (${w.outcome})` : ''}`).join('\n')
  return (
    <span className="flex items-center gap-1">
      {made.length > 0 && (
        <span className="flex items-center gap-1 font-medium text-primary">
          <Flag aria-hidden="true" className="size-3" />
          {links ? (
            links.map((w, i) => {
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
                      title={`${t('Open in History')} · ${t(WRITE[w.kind].label)}: ${writeSummary(w)}`}
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
          ) : (
            <button type="button" onClick={onOpen} title={title} className={LINK_PILL}>
              {numbers(made)}
            </button>
          )}
        </span>
      )}
      {refused > 0 && (
        <span className="rounded-full px-1.5 text-destructive ring-1 ring-destructive/25 ring-inset" title={title}>
          {t('{n} refused', { n: refused })}
        </span>
      )}
    </span>
  )
}

/**
 * A tool call's writes: each successful one an auto-checkpoint of the run,
 * and refused attempts (which changed nothing). Numbers skipped between two of
 * its checkpoints are other agents' writes, made meanwhile.
 */
function Writes({ writes, checkpoints }: { writes: TraceWrite[]; checkpoints: number[] }) {
  const open = useContext(OpenHistory)
  // after each checkpoint, the run's checkpoints made before this call's next one
  const gapAfter = new Map<number, [number, number]>()
  checkpoints.forEach((n, i) => {
    const next = checkpoints[i + 1]
    if (next !== undefined && next > n + 1) gapAfter.set(n, [n + 1, next - 1])
  })
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {checkpoints.length ? `${t(checkpoints.length === 1 ? 'Auto-checkpoint' : 'Auto-checkpoints')} ${numbers(checkpoints)}` : t('Refused writes')}
      </span>
      <ol className="chat-inset flex flex-col divide-y divide-foreground/[0.05] rounded-xl border border-foreground/[0.06] text-xs">
        {writes.map((w, i) => {
          const k = WRITE[w.kind]
          const failed = w.status === 'failed'
          const gap = w.checkpoint !== null ? gapAfter.get(w.checkpoint) : undefined
          return (
            <Fragment key={`${w.method}:${w.start}:${i}`}>
              <li className={cn('flex flex-col gap-0.5 px-3 py-1.5', failed && 'bg-destructive/[0.05]')}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('w-8 shrink-0 font-mono tabular-nums', failed ? 'text-destructive' : 'text-primary')}>{w.checkpoint !== null ? `#${w.checkpoint}` : '—'}</span>
                  <span className={cn('shrink-0 rounded-full px-1.5 text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset', k.tone)} title={`${w.method}: ${t(k.hint)}`}>
                    {t(k.label)}
                  </span>
                  <HistoryLink w={w} open={open} />
                  <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                    {w.kind === 'merge' ? <LfsMerge aria-hidden="true" className="size-3 shrink-0" /> : w.kind === 'workspace' ? <LfsWorkspace aria-hidden="true" className="size-3 shrink-0" /> : <LfsBranch aria-hidden="true" className="size-3 shrink-0" />}
                    <span className="truncate font-mono">{writeSummary(w)}</span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground tabular-nums">
                    {w.outcome && <span className={cn(failed && 'font-medium text-destructive')}>{w.outcome}</span>}
                    {w.kind === 'file' && <span className="font-mono">{w.method}</span>}
                    {w.sizes?.stored != null && <span title={t('{logical} bytes in the tree, {stored} new bytes stored', { logical: w.sizes.logical ?? '?', stored: w.sizes.stored })}>+{bytes(w.sizes.stored)}</span>}
                    {w.ms !== null && <span>{duration(w.ms)}</span>}
                  </span>
                </div>
                {w.message && (
                  <p className={cn('truncate pl-0.5', failed ? 'text-destructive' : 'text-foreground/85')} title={w.message}>
                    {w.message}
                  </p>
                )}
              </li>
              {gap && (
                <li className="px-3 py-1 text-[11px] text-muted-foreground italic">
                  {gap[0] === gap[1] ? `#${gap[0]}` : `#${gap[0]}–#${gap[1]}`} {t('in between: other agents’ checkpoints, made meanwhile')}
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
  const textLabel = r.kind === 'tool' ? 'Command' : r.kind === 'subagent' ? 'Task' : r.kind === 'assistant' ? 'Says' : r.kind === 'system' ? 'Prompt' : r.kind === 'check' ? 'Detail' : 'Message'
  return (
    <div className="flex flex-col gap-2 px-4 pt-1 pb-3 pl-[6.5rem]">
      {r.error && <Block label="Error">{r.error}</Block>}
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
            <div key={c.name} className={cn(!c.ok && 'text-destructive')}>
              {c.ok ? '✓' : '✗'} {c.name}: {c.detail}
            </div>
          ))}
        </Block>
      )}
    </div>
  )
}
