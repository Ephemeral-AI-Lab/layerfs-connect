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
import './live.css'

import type { LiveMount, ProjectState, RunDetail, RunEvent, RunSummary, RunningCall, TraceCall } from '@shared/host-api'
import { Activity, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsAgent, LfsBranch, LfsCommit, LfsSandbox, LfsStore, LfsWorkspace } from '@/components/lfs-icons'
import { CountUp, revealStyle } from '@/components/motion'
import type { SwitcherAgent } from '@/components/runs/agent-switcher'
import { FAIL_CLASS, FlowEngine, type FlowRoute, type FlowScene, OK_CLASS } from '@/components/runs/live-flow'
import { AgentDot, SessionHint, Spinner } from '@/components/runs/run-badges'
import { Chip } from '@/components/storage/chips'
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
  const lastEnded = `the last finished ${ago(run.ended ?? run.started, now)}`

  let summary: string
  if (groups.length > 1)
    summary = `${plural(groups.length, 'session')} · ${working} of ${plural(all.length, 'agent')} working · ${plural(inFlight, 'call')} in flight`
  else if (live && run.state === 'starting') summary = `${run.phase ?? 'Starting'}: ${run.project} from the demo's fixture`
  else if (groups.length === 1 && isLive(groups[0].run.state))
    summary = `${working} of ${plural(groups[0].agents.length, 'agent')} working · ${plural(inFlight, 'call')} in flight`
  else if (groups.length === 0) summary = `No agent working · ${lastEnded}`
  else summary = `Agents finished ${ago(groups[0].run.ended ?? groups[0].run.started, now)} · Workspaces unmounted, Sandboxes closed · History keeps its Commits`

  const status = run.state === 'starting' ? 'Starting' : anyLive ? 'Live' : groups.length ? 'Ended' : 'Idle'

  return (
    <div className="h-full overflow-y-auto [overflow-anchor:none]">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-5 py-5 xl:px-8 xl:py-6">
        <section aria-label="Live" className="surface rounded-2xl">
          <header className="flex items-center gap-3 border-b px-5 py-3 xl:px-6">
            <Chip tone={anyLive ? 'info' : 'neutral'} live={anyLive}>
              {status}
            </Chip>
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground tabular-nums">{summary}</p>
            <span className="hidden shrink-0 items-center gap-3.5 text-xs text-faint lg:flex">
              <span className="flex items-center gap-1.5">
                <LfsStore className="size-3.5" />
                Local SQLite Store
              </span>
              <span className="flex items-center gap-1.5">
                <LfsSandbox className="size-3.5" />
                Docker Sandboxes
              </span>
            </span>
          </header>

          <dl className="grid grid-cols-5 divide-x border-b">
            <StatTile icon={<LfsAgent className="size-4" />} value={working} label="agents working" hot />
            <StatTile icon={<Activity aria-hidden="true" className="size-4 text-muted-foreground" />} value={inFlight} label="calls in flight" hot />
            <StatTile icon={<LfsSandbox className="size-4" />} value={sandboxes.length} label="Sandboxes open" />
            <StatTile icon={<LfsWorkspace className="size-4" />} value={mounted} label="Workspaces mounted" />
            <StatTile icon={<LfsCommit className="size-4" />} value={state ? commits : null} label="Commits" />
          </dl>

          <FlowGraph
            run={run}
            state={state}
            groups={groups}
            sandboxes={sandboxes}
            folds={folds}
            now={now}
            live={anyLive}
            busy={inFlight > 0}
            idleNote={lastEnded}
            onOpen={(g, name) => (g.watched ? onOpenAgent(name) : onOpenSession?.(g.run.id, name))}
          />

          <footer className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t px-5 py-4 xl:px-6">
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              Each agent has only bash and the subagent tools. Its <code className="font-mono text-foreground/80">layerfs</code> calls go
              straight to the project's Store, through the Branch they touch; a Workspace mounts a Branch inside a Sandbox, where{' '}
              <code className="font-mono text-foreground/80">workspace exec</code> runs. A dot goes out with each call and comes back green,
              or red when it failed.
            </p>
            <Legend />
          </footer>
        </section>
      </div>
    </div>
  )
}

/** One reading of the strip: a number that counts to each new value; a live one lights up while above zero. */
function StatTile({ icon, value, label, hot }: { icon: React.ReactNode; value: number | null; label: string; hot?: boolean }) {
  const lit = hot && !!value
  return (
    <div className="relative flex min-w-0 items-center gap-3 px-4 py-3.5 xl:px-5">
      <span
        aria-hidden="true"
        className={cn(
          'hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border ring-inset transition-shadow duration-(--dur-base) xl:flex',
          lit && 'live-glow',
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col-reverse">
        <dt className="truncate text-xs text-muted-foreground">{label}</dt>
        <dd>
          <CountUp value={value} ms={500} className={cn('text-xl leading-7 font-semibold tracking-tight', lit && 'text-brand')} />
        </dd>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          'bg-brand absolute inset-x-4 bottom-[-1px] h-px origin-left transition-[opacity,transform] duration-(--dur-slow) ease-out-expo',
          lit ? 'scale-x-100 opacity-80' : 'scale-x-0 opacity-0',
        )}
      />
    </div>
  )
}

/** What the marks on the diagram mean. */
function Legend() {
  return (
    <ul aria-label="Legend" className="ml-auto flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="flex -space-x-0.5">
          <span className="size-2 rounded-full bg-primary ring-2 ring-card" />
          <span className="size-2 rounded-full bg-agent-builder ring-2 ring-card" />
          <span className="size-2 rounded-full bg-agent-docs ring-2 ring-card" />
        </span>
        A call, in its agent's colour
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        Came back
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
        Failed
      </li>
      <li className="flex items-center gap-2">
        <svg aria-hidden="true" viewBox="0 0 22 6" className="h-1.5 w-5.5 text-faint">
          <path d="M1 3 H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Workspace mounted
      </li>
    </ul>
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
  /** A session of the project plays. */
  live: boolean
  /** A call is in flight. */
  busy: boolean
  /** When the last session finished, for the idle placeholder. */
  idleNote: string
  onOpen: (group: Group, name: string) => void
}

function FlowGraph({ run, state, groups, sandboxes, folds, now, live, busy, idleNote, onOpen }: GraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const engine = useRef<FlowEngine | null>(null)
  const many = groups.length > 1
  const layouts = useMemo(() => groups.map((g) => layoutGroup(g, folds.over, many)), [groups, folds.over, many])
  const rows = useMemo(() => new Set(hubRows(state).map((b) => b.name)), [state])
  const workspaces = useMemo(() => new Set(sandboxes.flatMap((s) => s.workspaces.map((w) => w.key))), [sandboxes])
  const noAgents = layouts.length === 0
  const noSandboxes = sandboxes.length === 0

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
    // placeholders stay joined to the project, so the idle diagram still reads as one system
    const ghosts: [string, string][] = []
    if (noAgents) ghosts.push(['ghost-agents', 'hub'])
    if (noSandboxes) ghosts.push(['hub', 'ghost-sandboxes'])
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
      ghosts,
    }
  }, [layouts, sandboxes, rows, noAgents, noSandboxes])
  useLayoutEffect(() => engine.current?.setScene(scene))

  useTraffic(engine, groups, rows, workspaces)

  const agentCount = groups.reduce((n, g) => n + g.agents.filter(activeAgent).length, 0)

  return (
    <div className="overflow-x-auto">
      <div
        ref={box}
        className="live-field relative grid min-h-[24rem] min-w-[740px] grid-cols-[minmax(13.5rem,19rem)_minmax(2.25rem,1fr)_minmax(11.5rem,14.5rem)_minmax(2.25rem,1fr)_minmax(15.5rem,26rem)] items-center px-5 py-8 xl:px-6"
      >
        <svg ref={svg} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible" />

        <div className="relative z-10 flex min-w-0 flex-col gap-3">
          <ZoneLabel label="Agents" count={noAgents ? undefined : agentCount} />
          {noAgents && <IdleAgents note={idleNote} />}
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
          <HubNode run={run} state={state} live={live} busy={busy} />
        </div>
        <span />
        <div className="relative z-10 flex min-w-0 flex-col gap-3">
          <ZoneLabel label="Sandboxes" count={noSandboxes ? undefined : sandboxes.length} />
          {noSandboxes ? (
            <IdleSandboxes />
          ) : (
            sandboxes.map((s, i) => <SandboxNode key={s.id} index={i} sandbox={s} groups={groups} many={many} now={now} />)
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

function ZoneLabel({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-1 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
      <span>{label}</span>
      {count !== undefined && (
        <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 tracking-normal text-muted-foreground tabular-nums">{count}</span>
      )}
      <span aria-hidden="true" className="h-px flex-1 bg-linear-to-r from-border to-transparent" />
    </div>
  )
}

/** No session working: a quiet sketch of where agents will show, joined to the project. */
function IdleAgents({ note }: { note: string }) {
  return (
    <div data-anchor="ghost-agents" className="reveal rounded-xl border border-dashed bg-card/60 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 ring-1 ring-border ring-inset">
          <LfsAgent className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">No agent working</p>
          <p className="truncate text-xs text-muted-foreground first-letter:uppercase">{note}</p>
        </div>
      </div>
      <div aria-hidden="true" className="mt-4 flex flex-col gap-1.5">
        {[
          [0, '58%'],
          [1, '44%'],
          [1, '36%'],
        ].map(([depth, width], i) => (
          <div
            key={i}
            style={{ marginLeft: Number(depth) * 20 }}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-background/40 px-2.5 py-2"
          >
            <span className="size-4 shrink-0 rounded-[5px] bg-muted" />
            <span className="h-1.5 rounded-full bg-muted" style={{ width }} />
          </div>
        ))}
      </div>
      <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">
        Replay starts a session. Its agents show here as a tree, and every call they make travels to the project.
      </p>
    </div>
  )
}

function IdleSandboxes() {
  return (
    <div data-anchor="ghost-sandboxes" className="reveal flex items-start gap-3 rounded-xl border border-dashed bg-card/60 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 ring-1 ring-border ring-inset">
        <LfsSandbox className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">No Sandbox open</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">One opens when an agent creates it to mount a Workspace.</p>
      </div>
    </div>
  )
}

function Avatar({ name, color, small, working }: { name: string; color: AgentColor; small?: boolean; working?: boolean }) {
  return (
    <span
      title={small ? name : undefined}
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold uppercase ring-1 ring-inset',
        color.soft,
        color.text,
        color.ring,
        small
          ? cn('size-[18px] rounded-[5px] text-[10px] transition-opacity duration-(--dur-base)', !working && 'opacity-45')
          : 'size-7 rounded-lg text-[12px]',
      )}
    >
      {name.slice(0, 1)}
    </span>
  )
}

/** A row of small avatars, the busy ones lit. */
function Avatars({ agents, colorOf, max = 8 }: { agents: SwitcherAgent[]; colorOf: (name: string) => AgentColor; max?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {agents.slice(0, max).map((a) => (
        <Avatar key={a.name} name={a.name} color={colorOf(a.name)} small working={a.state === 'running'} />
      ))}
      {agents.length > max && <span className="ml-0.5 text-[11px] text-faint tabular-nums">+{agents.length - max}</span>}
    </span>
  )
}

/** A session's live dot: glowing while it plays. */
const SessionDot = ({ live }: { live: boolean }) => (
  <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', live ? 'pulse-ring bg-primary text-primary' : 'bg-faint')} />
)

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

  const agentNodes = nodes
    .filter((n) => n.visible)
    .map((n, i) => (
      <AgentNode
        key={n.key}
        index={i}
        run={run}
        node={n}
        calls={runningOf.get(n.agent.name) ?? []}
        last={run.live.last[n.agent.name]}
        now={now}
        colorOf={group.colorOf}
        onOpen={() => onOpen(n.agent.name)}
        onFold={() => onFold(`a:${n.agent.name}`, !n.folded)}
      />
    ))

  if (!many) return <div className="flex flex-col gap-2">{agentNodes}</div>

  if (folded)
    return (
      <button
        type="button"
        data-anchor={`session-${run.id}`}
        data-busy={working > 0 || undefined}
        onClick={fold}
        aria-expanded={false}
        className="reveal relative flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 text-left text-xs text-muted-foreground shadow-elev-1 outline-none transition-[border-color,box-shadow] duration-(--dur-base) hover:border-foreground/20 hover:shadow-elev-2 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="live-aura text-primary" />
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight aria-hidden="true" className="chevron size-3.5 shrink-0 text-faint" />
          <SessionDot live={live} />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{runLabel(run)}</span>
          {group.watched && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] leading-4 font-medium text-primary">this session</span>}
        </span>
        <span className="flex min-w-0 items-center gap-2 pl-5.5">
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {working} of {plural(nodes.length, 'agent')} working
          </span>
          <Avatars agents={nodes.map((n) => n.agent)} colorOf={group.colorOf} max={6} />
        </span>
      </button>
    )

  return (
    <div className={cn('reveal flex flex-col gap-2 rounded-2xl border p-2', group.watched ? 'border-primary/20 bg-primary/[0.03]' : 'bg-muted/25')}>
      <button
        type="button"
        onClick={fold}
        aria-expanded
        className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs text-muted-foreground outline-none transition-colors duration-(--dur-fast) hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight aria-hidden="true" className="chevron size-3.5 shrink-0 text-faint" />
        <SessionDot live={live} />
        <span className="min-w-0 truncate font-medium text-foreground">{runLabel(run)}</span>
        {/* the counts give way first, then the session's name */}
        <span className="min-w-0 shrink-[8] truncate tabular-nums">
          {plural(nodes.length, 'agent')} · {working} working
        </span>
        {group.watched && (
          <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] leading-4 font-medium text-primary">this session</span>
        )}
      </button>
      {agentNodes}
    </div>
  )
}

/** A name cut in the middle when it does not fit, so its end (usually what tells Branches apart) stays; the full name on hover. */
function MiddleTruncate({ text, className, tail = 8 }: { text: string; className?: string; tail?: number }) {
  const cut = text.length > tail + 4 ? text.length - tail : text.length
  return (
    <span title={text} className={cn('flex min-w-0 whitespace-nowrap', className)}>
      <span className="min-w-0 truncate">{text.slice(0, cut)}</span>
      {cut < text.length && <span className="shrink-0">{text.slice(cut)}</span>}
    </span>
  )
}

function callTarget(c: { branch?: string | null; path?: string | null; sandbox?: string | null; command?: string | null }) {
  if (c.command) return c.command
  if (c.sandbox && c.path) return `${c.sandbox}:${c.path}`
  return c.branch ?? c.path ?? null
}

function AgentNode({
  index,
  run,
  node,
  calls,
  last,
  now,
  colorOf,
  onOpen,
  onFold,
}: {
  /** Its place among the session's cards, for the entrance stagger. */
  index: number
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
  const color = colorOf(agent.name)
  return (
    <div
      data-anchor={`agent-${node.key}`}
      data-busy={active || undefined}
      style={revealStyle(index, { marginLeft: Math.min(depth, MAX_INDENT) * INDENT })}
      className={cn(
        'reveal relative min-w-0 rounded-xl border bg-card shadow-elev-1 transition-[border-color,box-shadow] duration-(--dur-base)',
        'hover:border-foreground/20 hover:shadow-elev-2',
      )}
    >
      <span aria-hidden="true" className={cn('live-aura', color.text)} />
      <span aria-hidden="true" className={cn('live-accent', color.text)} />
      <SessionHint run={run} now={now}>
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full min-w-0 flex-col gap-1.5 rounded-xl py-2.5 pr-3 pl-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar name={agent.name} color={color} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
            {hasKids && <span aria-hidden="true" className="w-10 shrink-0" />}
            <AgentDot state={state} />
          </span>
          <span className="flex h-4 min-w-0 items-center gap-1.5 pl-9.5 text-xs text-muted-foreground">
            {call ? (
              <>
                <Spinner className={cn('size-3', color.text)} />
                <span className="shrink-0 font-mono text-[11px] text-foreground">{call.method}</span>
                <span className="min-w-0 truncate font-mono text-[11px] text-faint">{callTarget(call)}</span>
                <span className="ml-auto shrink-0 tabular-nums">{duration(now - call.start)}</span>
              </>
            ) : agent.thinking || state === 'running' || state === 'idle' || !last ? (
              <span className="truncate text-faint tabular-nums">{activity(agent, undefined, now)}</span>
            ) : (
              <>
                <span className={cn('shrink-0 font-mono text-[11px]', last.ok ? '' : 'text-destructive')}>{last.method}</span>
                <span className="truncate text-faint tabular-nums">
                  {last.ok ? '' : `${last.code ?? 'failed'} · `}
                  {ago(last.at, now)}
                </span>
              </>
            )}
          </span>
          {folded && below.length > 0 && (
            <span className="flex min-w-0 items-center gap-1.5 pl-9.5 text-[11px] text-muted-foreground">
              <Avatars agents={below} colorOf={colorOf} max={6} />
              <span className="truncate tabular-nums">
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
          className="absolute top-[13px] right-7 flex h-5 items-center gap-0.5 rounded-full border bg-background/70 pr-1 pl-1.5 text-[11px] text-muted-foreground tabular-nums outline-none transition-colors duration-(--dur-fast) hover:border-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {below.length}
          <ChevronRight aria-hidden="true" className="chevron size-3" />
        </button>
      )}
    </div>
  )
}

function HubNode({ run, state, live, busy }: { run: RunDetail; state: ProjectState | undefined; live: boolean; busy: boolean }) {
  const branches = state?.branches ?? []
  const rows = hubRows(state)
  const layers = state?.layers.length ?? 0
  return (
    <div className="relative" data-live={live || undefined} data-busy={busy || undefined}>
      <div aria-hidden="true" className="live-halo" />
      <div
        data-anchor="hub"
        className={cn('live-hub-card @container relative flex flex-col items-center rounded-2xl px-3 pt-5 pb-3 text-center', live && 'live-border')}
      >
        <span data-anchor="hub-core" className="live-core flex size-16 items-center justify-center rounded-full bg-card shadow-elev-1 ring-1 ring-border">
          <LayerfsMark className="size-10" />
        </span>
        <span className="mt-3 max-w-full truncate font-mono text-base font-semibold tracking-tight">{run.project}</span>
        <span
          title="LayerFS project · local SQLite"
          className="mt-1.5 max-w-full truncate rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground ring-1 ring-border ring-inset"
        >
          {/* a narrow card keeps the part that differs between projects */}
          <span className="@max-[12.5rem]:hidden">LayerFS project · </span>local SQLite
        </span>
        {state ? (
          <dl className="mt-3 grid w-full grid-cols-2 divide-x rounded-lg border bg-muted/30 py-1.5">
            <div className="flex flex-col-reverse items-center">
              <dt className="text-[10px] text-faint">main</dt>
              <dd className="text-sm font-semibold tabular-nums">
                L<CountUp value={Math.max(0, layers - 1)} ms={600} />
              </dd>
            </div>
            <div className="flex flex-col-reverse items-center">
              <dt className="text-[10px] text-faint">{branches.length === 1 ? 'Branch' : 'Branches'}</dt>
              <dd className="text-sm font-semibold">
                <CountUp value={branches.length} ms={600} />
              </dd>
            </div>
          </dl>
        ) : (
          <span className="mt-3 flex h-[42px] w-full items-center justify-center rounded-lg border border-dashed text-xs text-faint">
            {run.state === 'starting' ? (run.phase ?? 'Starting') : 'Reading…'}
          </span>
        )}
        {rows.length > 0 && (
          <ul aria-label="Open Branches" className="mt-2 flex max-h-52 w-full flex-col gap-px overflow-y-auto text-left">
            {rows.map((b) => (
              <li
                key={b.name}
                data-anchor={`branch-${b.name}`}
                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors duration-(--dur-fast) hover:bg-muted/60"
              >
                <LfsBranch className="size-3.5" />
                <MiddleTruncate text={b.name} className={cn('flex-1', b.name === 'main' ? 'font-medium' : 'text-foreground/85')} />
                <CountUp value={b.commits} ms={600} className="shrink-0 text-[11px] text-faint" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SandboxNode({ index, sandbox, groups, many, now }: { index: number; sandbox: SandboxView; groups: Group[]; many: boolean; now: number }) {
  const groupOf = (rid: string) => groups.find((g) => g.run.id === rid)
  const execOf = (w: WsView) => {
    if (!w.mount) return undefined
    for (const g of groups)
      for (const c of g.run.live.running)
        if (c.method === 'workspace.exec' && c.sandbox === w.sandbox && c.path === w.path) return { call: c, group: g }
    return undefined
  }
  const execs = sandbox.workspaces.map(execOf)
  const first = execs.find((e) => e)
  const maker = sandbox.madeBy && groupOf(sandbox.madeBy.run)
  return (
    <div
      data-anchor={`sandbox-${sandbox.id}`}
      data-busy={first ? true : undefined}
      style={revealStyle(index)}
      className="reveal-scale relative rounded-xl border bg-card shadow-elev-1 transition-[border-color,box-shadow] duration-(--dur-base) hover:border-foreground/20"
    >
      <span aria-hidden="true" className={cn('live-aura', first ? first.group.colorOf(first.call.agent).text : 'text-primary')} />
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 ring-1 ring-border ring-inset">
          <LfsSandbox className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm font-medium">Sandbox {sandbox.id}</span>
            {sandbox.name && <span className="min-w-0 truncate font-mono text-[11px] text-faint">{sandbox.name}</span>}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {sandbox.madeBy ? (
              <>
                made by <span className="text-foreground/85">{sandbox.madeBy.agent}</span>
                {many && maker ? ` · ${runLabel(maker.run)}` : ''}
              </>
            ) : (
              sandbox.state
            )}
          </span>
        </span>
        {sandbox.madeBy && maker && (
          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', maker.colorOf(sandbox.madeBy.agent).dot)} />
        )}
      </div>
      {sandbox.workspaces.length === 0 ? (
        <div className="flex items-center gap-2 rounded-b-[11px] border-t bg-muted/30 px-3 py-2 text-xs text-faint">
          <LfsWorkspace className="size-3.5" />
          No Workspace mounted
        </div>
      ) : (
        sandbox.workspaces.map((w, i) => {
          const exec = execs[i]
          const mount = w.mount
          const owner = mount && groupOf(mount.run)
          const ownerColor = mount && owner ? owner.colorOf(mount.agent) : null
          const execColor = exec ? exec.group.colorOf(exec.call.agent) : null
          return (
            <div
              key={w.key}
              data-anchor={`ws-${w.key}`}
              className={cn(
                'relative flex flex-col gap-1 border-t px-3 py-2 text-xs transition-colors duration-(--dur-base) last:rounded-b-[11px]',
                execColor ? execColor.soft : 'bg-muted/30',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <LfsWorkspace className="size-3.5" />
                <span className="shrink-0 font-mono text-[11px]">{w.path}</span>
                {w.branch && (
                  <span className="flex min-w-0 items-center gap-1 rounded-md bg-background/70 px-1.5 py-px text-muted-foreground ring-1 ring-border ring-inset">
                    <LfsBranch className="size-3" />
                    <MiddleTruncate text={w.branch} className="text-[11px]" />
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  {mount ? (
                    <>
                      <span aria-hidden="true" className={cn('size-2 rounded-full', ownerColor?.dot ?? 'bg-faint')} />
                      <span className="text-foreground/85">{mount.agent}</span>
                    </>
                  ) : (
                    <span className="text-faint">mounted</span>
                  )}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 pl-5.5 text-muted-foreground">
                {exec ? (
                  <>
                    <Spinner className={cn('size-3', execColor?.text)} />
                    <span className="shrink-0 font-medium text-foreground">exec</span>
                    <span className="min-w-0 truncate font-mono text-[11px]">{exec.call.command ?? ''}</span>
                    {exec.call.agent !== mount?.agent && <span className="shrink-0 text-faint">by {exec.call.agent}</span>}
                    <span className="ml-auto shrink-0 tabular-nums">{duration(now - exec.call.start)}</span>
                  </>
                ) : mount?.last ? (
                  <>
                    <span className="shrink-0">idle · last</span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-faint">{mount.last.command ?? 'exec'}</span>
                    <span
                      className={cn(
                        'ml-auto shrink-0 font-mono text-[11px]',
                        mount.last.kind && mount.last.kind !== 'exit:0' ? 'text-warning' : 'text-faint',
                      )}
                    >
                      {mount.last.kind ?? ''}
                    </span>
                  </>
                ) : (
                  <span className="text-faint tabular-nums">idle · mounted {mount ? ago(mount.since, now) : ''}</span>
                )}
                {mount && mount.commits > 0 && <span className="shrink-0 text-faint tabular-nums">· {plural(mount.commits, 'commit')}</span>}
              </span>
              {exec && <span aria-hidden="true" className={cn('live-exec', execColor?.text)} />}
            </div>
          )
        })
      )}
    </div>
  )
}
