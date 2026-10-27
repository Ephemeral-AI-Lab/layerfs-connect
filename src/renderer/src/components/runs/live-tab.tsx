// Live: the project's working sessions, their agents as trees (subagents under
// their parent), connected through the demo's LayerFS project to the Sandboxes
// and Workspaces they mounted. Every LayerFS call is drawn (live-flow.ts): a
// dot leaves the agent in its colour, reaches the Branch row it touched (and
// the Workspace or Sandbox, for workspace and sandbox calls), and comes back
// green or red. Agents' calls come from their trace lines (RunDetail.live and
// the steps' calls, kept current by the host's events); the project's state
// (Branches, Layers, open Sandboxes) is reread every two seconds while a
// session plays.
//
// Folding: the session being watched is open, other working sessions start
// folded, and subagents below the second level start folded under their
// parent. What the user folds or opens is kept per project. A folded card
// stands in for what it hides: their calls start from it.
import type { LiveMount, ProjectState, RunDetail, RunEvent, RunSummary, RunningCall, TraceCall } from '@shared/host-api'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import type { SwitcherAgent } from '@/components/runs/agent-switcher'
import { FAIL_CLASS, FlowEngine, type FlowRoute, type FlowScene, OK_CLASS } from '@/components/runs/live-flow'
import { AgentDot, SessionHint, Spinner } from '@/components/runs/run-badges'
import { type AgentColor, activity, agentColors, ago, duration, isIdle, isLive, plural, runLabel } from '@/components/runs/run-format'
import { treeOrder } from '@/components/runs/thread'
import { applyEvents, useNow } from '@/components/runs/use-run'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

const POLL_MS = 2000
/** Indent per tree level; the guide to a subagent runs in this gutter. */
const INDENT = 28
/** Levels drawn indented; deeper ones line up with the last. */
const MAX_INDENT = 5
/** Subagents at this depth or deeper start folded under their parent. */
const FOLD_DEPTH = 3
/** A finished call older than this is history, not drawn. */
const FRESH_MS = 5000

interface LiveTabProps {
  run: RunDetail
  agents: SwitcherAgent[]
  colorOf: (name: string) => AgentColor
  onOpenAgent: (name: string) => void
  /** Opens an agent of another session of the project. */
  onOpenSession?: (run: string, agent: string) => void
  /** The project's sessions, newest first: a newer one sends this one idle. */
  sessions?: RunSummary[]
}

/** An agent still at work in its session: started and not finished. */
const activeAgent = (a: { parent: string | null; state?: string }) => !a.parent || !['done', 'failed', 'stopped'].includes(a.state ?? '')

const wsKey = (sandbox: string, path: string) => `${sandbox}:${path}`
const agentKey = (run: string, name: string) => `${run}/${name}`

/** One session drawn in Live. */
interface Group {
  run: RunDetail
  agents: SwitcherAgent[]
  colorOf: (name: string) => AgentColor
  /** The session this page shows: open by default. */
  watched: boolean
}

// ---------- data ----------

/** The project's state, reread every POLL_MS while a session plays. */
function useLiveProject(project: string, live: boolean, changed: string) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setTick((n) => n + 1), POLL_MS)
    return () => clearInterval(t)
  }, [live])
  // one more read once a session ends (`changed` moves), so its closed Sandboxes leave
  const q = useHostQuery(() => host.project(project), [project, tick, changed])
  return q.data?.project.name === project ? q.data : undefined
}

/** Other sessions of the project, loaded and kept current from the host's events. */
function useRunDetails(idsKey: string): RunDetail[] {
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey])
  const [runs, setRuns] = useState<ReadonlyMap<string, RunDetail>>(() => new Map())
  const queue = useRef<RunEvent[]>([])
  const frame = useRef(0)
  const orphans = useRef(new Map<string, Map<string, TraceCall[]>>())

  useEffect(() => {
    let alive = true
    setRuns((m) => {
      const next = new Map([...m].filter(([id]) => ids.includes(id)))
      return next.size === m.size ? m : next
    })
    for (const id of ids)
      host.run(id).then(
        (detail) => alive && setRuns((m) => (m.has(id) ? m : new Map(m).set(id, detail))),
        () => {},
      )
    return () => {
      alive = false
    }
  }, [ids])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  useHostEvents((e) => {
    const id = e.type === 'run' ? e.run.id : e.run
    if (!ids.includes(id)) return
    queue.current.push(e)
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const events = queue.current
      queue.current = []
      setRuns((m) => {
        const byRun = new Map<string, RunEvent[]>()
        for (const ev of events) {
          const rid = ev.type === 'run' ? ev.run.id : ev.run
          byRun.set(rid, [...(byRun.get(rid) ?? []), ev])
        }
        let next: Map<string, RunDetail> | null = null
        for (const [rid, evs] of byRun) {
          const run = m.get(rid)
          if (!run) continue
          let o = orphans.current.get(rid)
          if (!o) orphans.current.set(rid, (o = new Map()))
          next ??= new Map(m)
          next.set(rid, applyEvents(run, evs, o))
        }
        return next ?? m
      })
    })
  })

  return useMemo(() => ids.flatMap((id) => runs.get(id) ?? []), [ids, runs])
}

const foldStore = (project: string) => `layerfs-connect:live-folds:${project}`
const MAX_FOLDS = 200

function readFolds(project: string): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(foldStore(project)) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/**
 * What the user folded or opened in this project, over the defaults:
 * "s:<run>" for a session, "a:<name>" for an agent (by name, so a replay keeps it).
 */
function useFolds(project: string) {
  const [over, setOver] = useState(() => readFolds(project))
  useEffect(() => setOver(readFolds(project)), [project])
  const set = useCallback(
    (key: string, folded: boolean) =>
      setOver((o) => {
        const { [key]: _, ...rest } = o
        const entries = Object.entries({ ...rest, [key]: folded })
        const next = Object.fromEntries(entries.slice(-MAX_FOLDS))
        try {
          localStorage.setItem(foldStore(project), JSON.stringify(next))
        } catch {
          // folds then last only as long as the page
        }
        return next
      }),
    [project],
  )
  return { over, set }
}
type Folds = ReturnType<typeof useFolds>

interface WsView {
  key: string
  sandbox: string
  path: string
  branch: string | null
  mount: (LiveMount & { run: string }) | null
}

interface SandboxView {
  id: string
  name: string | null
  state: string
  madeBy: { run: string; agent: string } | null
  workspaces: WsView[]
}

/** Open Sandboxes: the project's, joined with the ones the sessions' agents made and the Workspaces they mounted. */
function sandboxViews(state: ProjectState | undefined, groups: Group[]): SandboxView[] {
  const out = new Map<string, SandboxView>()
  const made = new Map<string, { run: string; agent: string }>()
  for (const g of groups) for (const s of g.run.live.sandboxes) made.set(s.id, { run: g.run.id, agent: s.agent })
  for (const s of state?.sandboxes ?? []) {
    if (s.state === 'gone' || s.state === 'exited') continue
    out.set(s.id, {
      id: s.id,
      name: s.name,
      state: s.state,
      madeBy: made.get(s.id) ?? null,
      workspaces: s.workspaces.map((w) => ({ key: wsKey(s.id, w.path), sandbox: s.id, path: w.path, branch: w.branch || null, mount: null })),
    })
  }
  for (const [id, by] of made) if (!out.has(id)) out.set(id, { id, name: null, state: 'running', madeBy: by, workspaces: [] })
  for (const g of groups)
    for (const m of g.run.live.mounts) {
      let s = out.get(m.sandbox)
      if (!s) {
        s = { id: m.sandbox, name: null, state: 'running', madeBy: null, workspaces: [] }
        out.set(m.sandbox, s)
      }
      const key = wsKey(m.sandbox, m.path)
      const mount = { ...m, run: g.run.id }
      const w = s.workspaces.find((x) => x.key === key)
      if (w) Object.assign(w, { mount, branch: w.branch ?? m.branch })
      else s.workspaces.push({ key, sandbox: m.sandbox, path: m.path, branch: m.branch, mount })
    }
  return [...out.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
}

/** A session's agents as a tree, with what is folded and where each agent's calls start. */
interface TreeNode {
  agent: SwitcherAgent
  key: string
  depth: number
  parent: string | null
  /** Subagents at any depth, still at work. */
  below: SwitcherAgent[]
  hasKids: boolean
  folded: boolean
  visible: boolean
}

interface GroupLayout {
  group: Group
  folded: boolean
  nodes: TreeNode[]
  /** The anchor an agent's calls start from, for every agent of the session (finished ones too). */
  origin: (name: string) => string
}

function layoutGroup(group: Group, folds: Folds['over'], many: boolean): GroupLayout {
  const rid = group.run.id
  // a lone session has no header to open it again, so it never folds
  const folded = many && (folds[`s:${rid}`] ?? !group.watched)
  const shown = group.agents.filter(activeAgent)
  const order = treeOrder(shown, (a) => a.name, (a) => a.parent)
  const parentOf = new Map<string, string | null>()
  const names = new Set(shown.map((a) => a.name))
  for (const { item } of order) parentOf.set(item.name, item.parent && names.has(item.parent) && item.parent !== item.name ? item.parent : null)
  const kids = new Map<string, SwitcherAgent[]>()
  for (const { item } of order) {
    const p = parentOf.get(item.name)
    if (p) kids.set(p, [...(kids.get(p) ?? []), item])
  }
  const below = (name: string): SwitcherAgent[] => (kids.get(name) ?? []).flatMap((k) => [k, ...below(k.name)])
  const foldedAgent = new Map<string, boolean>()
  for (const { item, depth } of order) foldedAgent.set(item.name, folds[`a:${item.name}`] ?? (depth >= FOLD_DEPTH - 1 && kids.has(item.name)))

  const originShown = new Map<string, string>()
  const nodes: TreeNode[] = order.map(({ item, depth }) => {
    const chain: string[] = []
    for (let p = parentOf.get(item.name); p; p = parentOf.get(p) ?? null) chain.unshift(p)
    const top = chain.find((p) => foldedAgent.get(p))
    const key = agentKey(rid, item.name)
    originShown.set(item.name, folded ? `session-${rid}` : top ? `agent-${agentKey(rid, top)}` : `agent-${key}`)
    return {
      agent: item,
      key,
      depth,
      parent: parentOf.get(item.name) ?? null,
      below: below(item.name),
      hasKids: kids.has(item.name),
      folded: foldedAgent.get(item.name) ?? false,
      visible: !folded && !top,
    }
  })
  const all = new Map(group.agents.map((a) => [a.name, a]))
  const origin = (name: string): string => {
    const seen = new Set<string>()
    for (let n: string | null = name; n && !seen.has(n); n = all.get(n)?.parent ?? null) {
      seen.add(n)
      const o = originShown.get(n)
      if (o) return o
    }
    return folded ? `session-${rid}` : `agent-${agentKey(rid, order[0]?.item.name ?? 'root')}`
  }
  return { group, folded, nodes, origin }
}

/** Where a call travels on the graph; null for calls that do not reach LayerFS (subagent tools, jobs). */
function routeOf(
  g: Group,
  c: { agent: string; method: string; branch?: string | null; sandbox?: string | null; path?: string | null },
  rows: Set<string>,
  workspaces: Set<string>,
): FlowRoute | null {
  const family = c.method.split('.')[0]
  if (family === 'agent' || family === 'job') return null
  let branch = c.branch ?? null
  let to: string | null = null
  if (c.sandbox && family === 'workspace' && c.path) {
    const key = wsKey(c.sandbox, c.path)
    to = workspaces.has(key) ? `ws-${key}` : `sandbox-${c.sandbox}`
    branch ??= g.run.live.mounts.find((m) => m.sandbox === c.sandbox && m.path === c.path)?.branch ?? null
  } else if (c.sandbox && (family === 'sandbox' || family === 'workspace')) to = `sandbox-${c.sandbox}`
  return { agent: agentKey(g.run.id, c.agent), via: branch && rows.has(branch) ? `branch-${branch}` : null, to }
}

/** Open Branches as the hub lists them: main first. */
function hubRows(state: ProjectState | undefined) {
  return (state?.branches ?? []).filter((b) => b.state === 'open').sort((a, b) => Number(b.name === 'main') - Number(a.name === 'main'))
}

// ---------- the tab ----------

export function LiveTab({ run, agents, colorOf, onOpenAgent, onOpenSession, sessions = [] }: LiveTabProps) {
  const project = run.project
  const mine = sessions.filter((r) => r.project === project && r.id !== run.id)
  const anyLive = isLive(run.state) || mine.some((r) => isLive(r.state))
  // ticks slowly after the sessions end too, so they go idle on time
  const now = useNow(true, anyLive ? 1000 : 10_000)
  const idle = isIdle(run, sessions, now)

  // other sessions still working on this project, playing ones first
  const otherIds = mine
    .filter((r) => !isIdle(r, sessions, now))
    .sort((a, b) => Number(isLive(b.state)) - Number(isLive(a.state)) || b.started - a.started)
    .map((r) => r.id)
    .join(',')
  const others = useRunDetails(otherIds)
  const state = useLiveProject(project, anyLive, [run.state, ...others.map((o) => o.state)].join(','))

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = idle ? [] : [{ run, agents, colorOf, watched: true }]
    for (const o of others)
      out.push({
        run: o,
        agents: o.agents.map((a) => ({ ...a, activity: activity(a, o.live.running.find((c) => c.agent === a.name), now) })),
        colorOf: agentColors(o.agents.map((a) => a.name)),
        watched: false,
      })
    return out
  }, [idle, run, agents, colorOf, others, now])

  const sandboxes = useMemo(() => sandboxViews(state, groups), [state, groups])
  const folds = useFolds(project)

  const all = groups.flatMap((g) => g.agents)
  const working = all.filter((a) => a.state === 'running').length
  const inFlight = groups.reduce((n, g) => n + g.run.live.running.length, 0)
  const mounted = sandboxes.reduce((n, s) => n + s.workspaces.length, 0)
  const commits = state?.branches.reduce((n, b) => n + b.commits, 0) ?? 0
  const live = isLive(run.state)

  let summary: string
  if (groups.length > 1)
    summary = `${plural(groups.length, 'session')} · ${working} of ${plural(all.length, 'agent')} working · ${plural(inFlight, 'call')} in flight`
  else if (live && run.state === 'starting') summary = `${run.phase ?? 'Starting'}: ${run.project} from the demo's fixture`
  else if (groups.length === 1 && isLive(groups[0].run.state))
    summary = `${working} of ${plural(groups[0].agents.length, 'agent')} working · ${plural(inFlight, 'call')} in flight`
  else if (groups.length === 0) summary = `No agent working · the last finished ${ago(run.ended ?? run.started, now)}`
  else summary = `Agents finished ${ago(groups[0].run.ended ?? groups[0].run.started, now)} · Workspaces unmounted, Sandboxes closed · History keeps its Commits`

  return (
    <div className="h-full overflow-y-auto [overflow-anchor:none]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-8 py-6">
        <section aria-label="Live" className="rounded-2xl border bg-card/60">
          <header className="flex items-center gap-3 border-b px-6 py-3">
            {anyLive && <Spinner className="size-3.5 text-primary" />}
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summary}</p>
            <span className="shrink-0 text-xs text-faint">Local SQLite Store · Docker Sandboxes</span>
          </header>

          <FlowGraph
            run={run}
            state={state}
            groups={groups}
            sandboxes={sandboxes}
            folds={folds}
            now={now}
            onOpen={(g, name) => (g.watched ? onOpenAgent(name) : onOpenSession?.(g.run.id, name))}
          />

          <footer className="flex flex-wrap items-end gap-x-8 gap-y-3 border-t px-6 py-4">
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              Each agent has only bash and the subagent tools. Its <code className="font-mono">layerfs</code> calls go
              straight to the project's Store, through the Branch they touch; a Workspace mounts a Branch inside a
              Sandbox, where <code className="font-mono">workspace exec</code> runs. A dot goes out with each call and
              comes back green, or red when it failed.
            </p>
            <div className="ml-auto flex gap-7">
              <Stat value={working} label="agents working" />
              <Stat value={inFlight} label="calls in flight" />
              <Stat value={sandboxes.length} label="Sandboxes open" />
              <Stat value={mounted} label="Workspaces mounted" />
              <Stat value={commits} label="Commits" />
            </div>
          </footer>
        </section>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

// ---------- the graph ----------

interface GraphProps {
  run: RunDetail
  state: ProjectState | undefined
  groups: Group[]
  sandboxes: SandboxView[]
  folds: Folds
  now: number
  onOpen: (group: Group, name: string) => void
}

function FlowGraph({ run, state, groups, sandboxes, folds, now, onOpen }: GraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const engine = useRef<FlowEngine | null>(null)
  const many = groups.length > 1
  const layouts = useMemo(() => groups.map((g) => layoutGroup(g, folds.over, many)), [groups, folds.over, many])
  const rows = useMemo(() => new Set(hubRows(state).map((b) => b.name)), [state])
  const workspaces = useMemo(() => new Set(sandboxes.flatMap((s) => s.workspaces.map((w) => w.key))), [sandboxes])

  useLayoutEffect(() => {
    const e = new FlowEngine(box.current!, svg.current!)
    engine.current = e
    return () => {
      e.dispose()
      engine.current = null
    }
  }, [])

  // The scene follows every render: cards move as agents come, go and fold.
  const scene = useMemo<FlowScene>(() => {
    const byRun = new Map(layouts.map((l) => [l.group.run.id, l]))
    const split = (key: string) => {
      const i = key.indexOf('/')
      return { l: byRun.get(key.slice(0, i)), name: key.slice(i + 1) }
    }
    const mounts: FlowScene['mounts'] = []
    for (const s of sandboxes)
      for (const w of s.workspaces)
        if (w.mount)
          mounts.push({
            key: w.key,
            route: { agent: agentKey(w.mount.run, w.mount.agent), via: w.branch && rows.has(w.branch) ? `branch-${w.branch}` : null, to: `ws-${w.key}` },
          })
    const tree: FlowScene['tree'] = []
    for (const l of layouts)
      for (const n of l.nodes)
        if (n.visible && n.parent) tree.push([`agent-${n.key}`, `agent-${agentKey(l.group.run.id, n.parent)}`])
    return {
      origin: (key) => {
        const { l, name } = split(key)
        return l ? l.origin(name) : `agent-${key}`
      },
      color: (key) => {
        const { l, name } = split(key)
        return l ? l.group.colorOf(name).text : 'text-primary'
      },
      mounts,
      tree,
    }
  }, [layouts, sandboxes, rows])
  useLayoutEffect(() => engine.current?.setScene(scene))

  useTraffic(engine, groups, rows, workspaces)

  return (
    <div className="overflow-x-auto">
      <div
        ref={box}
        className="relative grid min-w-[960px] grid-cols-[minmax(15rem,19rem)_minmax(2.5rem,1fr)_minmax(12rem,14rem)_minmax(2.5rem,1fr)_minmax(19rem,26rem)] items-center px-6 py-7"
      >
        <svg ref={svg} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" />

        <div className="relative z-10 flex flex-col gap-3">
          <ColumnLabel>Agents</ColumnLabel>
          {layouts.length === 0 && (
            <div className="flex items-center gap-2.5 rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground">
              No agent working. Replay starts a session.
            </div>
          )}
          {layouts.map((l) => (
            <SessionGroup
              key={l.group.run.id}
              layout={l}
              many={many}
              now={now}
              onOpen={(name) => onOpen(l.group, name)}
              onFold={(key, folded) => folds.set(key, folded)}
            />
          ))}
        </div>
        <span />
        <div className="relative z-10">
          <HubNode run={run} state={state} />
        </div>
        <span />
        <div className="relative z-10 flex flex-col gap-3">
          <ColumnLabel>Sandboxes</ColumnLabel>
          {sandboxes.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground">
              <LfsSandbox className="size-4" />
              No Sandbox open. One opens when an agent creates it to mount a Workspace.
            </div>
          ) : (
            sandboxes.map((s) => <SandboxNode key={s.id} sandbox={s} groups={groups} many={many} now={now} />)
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Sends a dot for every call: out when it starts (or when it ends, for one
 * that ended before Live saw it running), back once it ends. Calls already
 * there when a session first shows are history and are not drawn.
 */
function useTraffic(engine: React.RefObject<FlowEngine | null>, groups: Group[], rows: Set<string>, workspaces: Set<string>) {
  const seen = useRef(new Map<string, Set<string>>())
  const out = useRef(new Map<string, Promise<void>>())
  useEffect(() => {
    const e = engine.current
    if (!e) return
    for (const g of groups) {
      const rid = g.run.id
      let done = seen.current.get(rid)
      const first = !done
      if (!done) seen.current.set(rid, (done = new Set()))
      for (const c of g.run.live.running) {
        const key = `${rid}/${c.agent}:${c.id}`
        if (out.current.has(key)) continue
        const route = first ? null : routeOf(g, c, rows, workspaces)
        out.current.set(key, route ? e.send(route) : Promise.resolve())
      }
      for (const step of g.run.steps)
        for (const c of step.calls) {
          const id = `${c.agent}:${c.id}`
          if (done.has(id)) continue
          done.add(id)
          const key = `${rid}/${id}`
          const pending = out.current.get(key)
          out.current.delete(key)
          if (first) continue
          const ended = (Date.parse(c.start) || 0) + (c.ms ?? 0)
          if (!pending && Date.now() - ended > FRESH_MS) continue
          const route = routeOf(g, c, rows, workspaces)
          if (!route) continue
          void (pending ?? e.send(route)).then(() => e.send(route, { back: true, color: c.ok === false ? FAIL_CLASS : OK_CLASS }))
        }
    }
  }, [engine, groups, rows, workspaces])
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1 text-[11px] font-medium tracking-wide text-faint uppercase">{children}</span>
}

function Avatar({ name, color, small, working }: { name: string; color: AgentColor; small?: boolean; working?: boolean }) {
  return (
    <span
      title={small ? name : undefined}
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold uppercase',
        color.soft,
        color.text,
        small ? cn('size-[18px] rounded-[5px] text-[10px]', working ? 'ring-1 ring-current' : 'opacity-50') : 'size-6 rounded-md text-[12px]',
      )}
    >
      {name.slice(0, 1)}
    </span>
  )
}

function SessionGroup({
  layout,
  many,
  now,
  onOpen,
  onFold,
}: {
  layout: GroupLayout
  many: boolean
  now: number
  onOpen: (name: string) => void
  onFold: (key: string, folded: boolean) => void
}) {
  const { group, folded, nodes } = layout
  const { run } = group
  const runningOf = useMemo(() => {
    const map = new Map<string, RunningCall[]>()
    for (const c of run.live.running) map.set(c.agent, [...(map.get(c.agent) ?? []), c])
    return map
  }, [run.live.running])
  const working = nodes.filter((n) => n.agent.state === 'running').length
  const live = isLive(run.state)
  const fold = () => onFold(`s:${run.id}`, !folded)

  return (
    <div className="flex flex-col gap-2">
      {many &&
        (folded ? (
          <button
            type="button"
            data-anchor={`session-${run.id}`}
            onClick={fold}
            aria-expanded={false}
            className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border bg-card px-3 py-2.5 text-left text-xs text-muted-foreground outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight aria-hidden="true" className="size-3.5 text-faint" />
            <span aria-hidden="true" className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-primary' : 'bg-faint')} />
            <span className="text-sm font-medium text-foreground">{runLabel(run)}</span>
            <span>
              {working} of {plural(nodes.length, 'agent')} working
            </span>
            <span className="ml-auto flex gap-0.5">
              {nodes.map((n) => (
                <Avatar key={n.key} name={n.agent.name} color={group.colorOf(n.agent.name)} small working={n.agent.state === 'running'} />
              ))}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={fold}
            aria-expanded
            className="flex items-center gap-2 rounded-md px-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown aria-hidden="true" className="size-3.5 text-faint" />
            <span aria-hidden="true" className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-primary' : 'bg-faint')} />
            <span className="font-medium text-foreground">{runLabel(run)}</span>
            <span>
              {plural(nodes.length, 'agent')} · {working} working
            </span>
            {group.watched && <span className="text-faint">· this session</span>}
          </button>
        ))}
      {!folded &&
        nodes
          .filter((n) => n.visible)
          .map((n) => (
            <AgentNode
              key={n.key}
              run={run}
              node={n}
              calls={runningOf.get(n.agent.name) ?? []}
              last={run.live.last[n.agent.name]}
              now={now}
              colorOf={group.colorOf}
              onOpen={() => onOpen(n.agent.name)}
              onFold={() => onFold(`a:${n.agent.name}`, !n.folded)}
            />
          ))}
    </div>
  )
}

function callTarget(c: { branch?: string | null; path?: string | null; sandbox?: string | null; command?: string | null }) {
  if (c.command) return c.command
  if (c.sandbox && c.path) return `${c.sandbox}:${c.path}`
  return c.branch ?? c.path ?? null
}

function AgentNode({
  run,
  node,
  calls,
  last,
  now,
  colorOf,
  onOpen,
  onFold,
}: {
  /** The session the agent works in, shown on hover. */
  run: RunSummary
  node: TreeNode
  calls: RunningCall[]
  last: RunDetail['live']['last'][string] | undefined
  now: number
  colorOf: (name: string) => AgentColor
  onOpen: () => void
  onFold: () => void
}) {
  const { agent, depth, folded, below, hasKids } = node
  const state = agent.state ?? 'waiting'
  const call = calls[0]
  const active = state === 'running'
  const busyBelow = below.filter((a) => a.state === 'running').length
  return (
    <div
      data-anchor={`agent-${node.key}`}
      style={{ marginLeft: Math.min(depth, MAX_INDENT) * INDENT }}
      className={cn(
        'relative min-w-0 rounded-xl border bg-card transition-[border-color,box-shadow]',
        active ? 'border-foreground/20 shadow-sm' : 'hover:border-foreground/20',
      )}
    >
      <SessionHint run={run} now={now}>
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full min-w-0 flex-col gap-1 rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={agent.name} color={colorOf(agent.name)} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
            {hasKids && <span aria-hidden="true" className="w-10 shrink-0" />}
            <AgentDot state={state} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 pl-8 text-xs text-muted-foreground">
            {call ? (
              <>
                <Spinner className="size-3 shrink-0" />
                <span className="shrink-0 font-mono text-foreground">{call.method}</span>
                <span className="min-w-0 truncate font-mono text-faint">{callTarget(call)}</span>
                <span className="ml-auto shrink-0 tabular-nums">{duration(now - call.start)}</span>
              </>
            ) : agent.thinking || state === 'running' || state === 'idle' || !last ? (
              <span className="text-faint tabular-nums">{activity(agent, undefined, now)}</span>
            ) : (
              <>
                <span className={cn('shrink-0 font-mono', last.ok ? '' : 'text-destructive')}>{last.method}</span>
                <span className="truncate text-faint">
                  {last.ok ? '' : `${last.code ?? 'failed'} · `}
                  {ago(last.at, now)}
                </span>
              </>
            )}
          </span>
          {folded && below.length > 0 && (
            <span className="flex min-w-0 items-center gap-1 pl-8 text-[11px] text-muted-foreground">
              {below.slice(0, 6).map((a) => (
                <Avatar key={a.name} name={a.name} color={colorOf(a.name)} small working={a.state === 'running'} />
              ))}
              <span className="ml-1 truncate">
                {plural(below.length, 'subagent')} · {busyBelow} working
              </span>
            </span>
          )}
        </button>
      </SessionHint>
      {hasKids && (
        <button
          type="button"
          onClick={onFold}
          aria-expanded={!folded}
          aria-label={`${folded ? 'Show' : 'Fold'} ${agent.name}'s ${plural(below.length, 'subagent')}`}
          className="absolute top-[11px] right-7 flex h-5 items-center gap-0.5 rounded-md border bg-muted/40 px-1.5 text-[11px] text-muted-foreground tabular-nums outline-none hover:border-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {below.length}
          {folded ? <ChevronRight aria-hidden="true" className="size-3" /> : <ChevronDown aria-hidden="true" className="size-3" />}
        </button>
      )}
    </div>
  )
}

function HubNode({ run, state }: { run: RunDetail; state: ProjectState | undefined }) {
  const branches = state?.branches ?? []
  const rows = hubRows(state)
  const layers = state?.layers.length ?? 0
  return (
    <div
      data-anchor="hub"
      className="flex flex-col items-center gap-2.5 rounded-2xl border-2 border-foreground/15 bg-card px-4 pt-5 pb-4 text-center"
    >
      <LayerfsMark className="size-12" />
      <span className="max-w-full truncate font-mono text-base font-semibold">{run.project}</span>
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium">LayerFS project · local SQLite</span>
      {state ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          main L{Math.max(0, layers - 1)} · {branches.length} Branch{branches.length === 1 ? '' : 'es'}
        </span>
      ) : (
        <span className="text-xs text-faint">{run.state === 'starting' ? (run.phase ?? 'Starting') : 'Reading…'}</span>
      )}
      {rows.length > 0 && (
        <ul className="flex max-h-48 w-full flex-col gap-0.5 overflow-y-auto border-t pt-2 text-left">
          {rows.map((b) => (
            <li key={b.name} data-anchor={`branch-${b.name}`} className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs">
              <LfsBranch className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="shrink-0 text-faint tabular-nums">{b.commits}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SandboxNode({ sandbox, groups, many, now }: { sandbox: SandboxView; groups: Group[]; many: boolean; now: number }) {
  const groupOf = (rid: string) => groups.find((g) => g.run.id === rid)
  const execOf = (w: WsView) => {
    if (!w.mount) return undefined
    for (const g of groups)
      for (const c of g.run.live.running)
        if (c.method === 'workspace.exec' && c.sandbox === w.sandbox && c.path === w.path) return { call: c, group: g }
    return undefined
  }
  const busy = sandbox.workspaces.some((w) => execOf(w))
  const maker = sandbox.madeBy && groupOf(sandbox.madeBy.run)
  return (
    <div data-anchor={`sandbox-${sandbox.id}`} className={cn('overflow-hidden rounded-xl border bg-card', busy && 'border-foreground/25 shadow-sm')}>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <LfsSandbox className="size-4" />
        <span className="shrink-0 text-sm font-medium">Sandbox {sandbox.id}</span>
        {sandbox.name && <span className="min-w-0 truncate font-mono text-[11px] text-faint">{sandbox.name}</span>}
        <span className="ml-auto shrink-0 text-xs text-faint">
          {sandbox.madeBy ? `made by ${sandbox.madeBy.agent}${many && maker ? ` · ${runLabel(maker.run)}` : ''}` : sandbox.state}
        </span>
      </div>
      {sandbox.workspaces.length === 0 ? (
        <div className="flex items-center gap-2 border-t bg-muted/30 px-3.5 py-2 text-xs text-faint">
          <LfsWorkspace className="size-3.5" />
          No Workspace mounted
        </div>
      ) : (
        sandbox.workspaces.map((w) => {
          const exec = execOf(w)
          const mount = w.mount
          const owner = mount && groupOf(mount.run)
          return (
            <div key={w.key} data-anchor={`ws-${w.key}`} className="flex flex-col gap-1 border-t bg-muted/30 px-3.5 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <LfsWorkspace className="size-3.5" />
                <span className="shrink-0 font-mono">{w.path}</span>
                {w.branch && (
                  <span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
                    <LfsBranch className="size-3.5" />
                    <span className="truncate">{w.branch}</span>
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {mount ? (
                    <>
                      <span aria-hidden="true" className={cn('size-2 rounded-full', owner?.colorOf(mount.agent).dot ?? 'bg-faint')} />
                      {mount.agent}
                    </>
                  ) : (
                    <span className="text-faint">mounted</span>
                  )}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 pl-5.5 text-muted-foreground">
                {exec ? (
                  <>
                    <Spinner className="size-3 shrink-0" />
                    <span className="shrink-0 font-medium text-foreground">exec</span>
                    <span className="min-w-0 truncate font-mono">{exec.call.command ?? ''}</span>
                    {exec.call.agent !== mount?.agent && <span className="shrink-0 text-faint">by {exec.call.agent}</span>}
                    <span className="ml-auto shrink-0 tabular-nums">{duration(now - exec.call.start)}</span>
                  </>
                ) : mount?.last ? (
                  <>
                    <span className="shrink-0">idle · last</span>
                    <span className="min-w-0 truncate font-mono text-faint">{mount.last.command ?? 'exec'}</span>
                    <span className={cn('ml-auto shrink-0', mount.last.kind && mount.last.kind !== 'exit:0' && 'text-warning')}>
                      {mount.last.kind ?? ''}
                    </span>
                  </>
                ) : (
                  <span className="text-faint">idle · mounted {mount ? ago(mount.since, now) : ''}</span>
                )}
                {mount && mount.commits > 0 && <span className="shrink-0 text-faint">· {plural(mount.commits, 'commit')}</span>}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}
