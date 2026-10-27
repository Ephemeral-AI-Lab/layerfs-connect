// Live: the replay's sessions (its agents) connected to the demo's LayerFS
// project, and the project to the Sandboxes and Workspaces they mounted. The
// agents' trace lines say who holds which Workspace and which calls run now
// (RunDetail.live, kept current by the host's events); the project's state
// (Branches, Layers, open Sandboxes) is reread every two seconds while the
// replay plays.
import type { LiveMount, ProjectState, RunDetail, RunningCall, TraceCall } from '@shared/host-api'
import { Box, FolderOpen, GitBranch } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import type { SwitcherAgent } from '@/components/runs/agent-switcher'
import { AgentDot, Spinner } from '@/components/runs/run-badges'
import { type AgentColor, KIND, ago, duration, isLive, methodKind } from '@/components/runs/run-format'
import { treeOrder } from '@/components/runs/thread'
import { useNow } from '@/components/runs/use-run'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

const POLL_MS = 2000
const FEED = 14

interface LiveTabProps {
  run: RunDetail
  agents: SwitcherAgent[]
  colorOf: (name: string) => AgentColor
  onOpenAgent: (name: string) => void
}

/** The project's state, reread every POLL_MS while the replay plays. */
function useLiveProject(run: RunDetail) {
  const live = isLive(run.state)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setTick((n) => n + 1), POLL_MS)
    return () => clearInterval(t)
  }, [live])
  // one more read once the replay ends, so the closed Sandboxes leave
  const q = useHostQuery(() => host.project(run.project), [run.project, tick, run.state])
  return q.data?.project.name === run.project ? q.data : undefined
}

const wsKey = (sandbox: string, path: string) => `${sandbox}:${path}`

interface SandboxView {
  id: string
  name: string | null
  state: string
  madeBy: string | null
  workspaces: { key: string; sandbox: string; path: string; branch: string | null; mount: LiveMount | null }[]
}

/** Open Sandboxes: the project's, joined with the ones the agents made and the Workspaces they mounted. */
function sandboxViews(state: ProjectState | undefined, run: RunDetail): SandboxView[] {
  const out = new Map<string, SandboxView>()
  const made = new Map(run.live.sandboxes.map((s) => [s.id, s.agent]))
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
  for (const s of run.live.sandboxes)
    if (!out.has(s.id)) out.set(s.id, { id: s.id, name: null, state: 'running', madeBy: s.agent, workspaces: [] })
  for (const m of run.live.mounts) {
    let s = out.get(m.sandbox)
    if (!s) {
      s = { id: m.sandbox, name: null, state: 'running', madeBy: null, workspaces: [] }
      out.set(m.sandbox, s)
    }
    const key = wsKey(m.sandbox, m.path)
    const w = s.workspaces.find((x) => x.key === key)
    if (w) Object.assign(w, { mount: m, branch: w.branch ?? m.branch })
    else s.workspaces.push({ key, sandbox: m.sandbox, path: m.path, branch: m.branch, mount: m })
  }
  return [...out.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
}

export function LiveTab({ run, agents, colorOf, onOpenAgent }: LiveTabProps) {
  const state = useLiveProject(run)
  const live = isLive(run.state)
  const now = useNow(live)
  const sandboxes = useMemo(() => sandboxViews(state, run), [state, run])
  const running = run.live.running
  const runningOf = useMemo(() => {
    const map = new Map<string, RunningCall[]>()
    for (const c of running) map.set(c.agent, [...(map.get(c.agent) ?? []), c])
    return map
  }, [running])
  const execOn = useMemo(() => {
    const map = new Map<string, RunningCall>()
    for (const c of running) if (c.method === 'workspace.exec' && c.sandbox && c.path) map.set(wsKey(c.sandbox, c.path), c)
    return map
  }, [running])
  const mounted = sandboxes.reduce((n, s) => n + s.workspaces.length, 0)
  const working = agents.filter((a) => a.state === 'running').length
  const commits = state?.branches.reduce((n, b) => n + b.commits, 0) ?? 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-8 py-6">
        <section aria-label="Live" className="rounded-2xl border bg-card/60">
          <header className="flex items-center gap-3 border-b px-6 py-3">
            {live && <Spinner className="size-3.5 text-primary" />}
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {live ? (
                run.state === 'starting' ? (
                  `${run.phase ?? 'Starting'}: ${run.project} from the demo's fixture`
                ) : (
                  <>
                    {working} of {agents.length} session{agents.length === 1 ? '' : 's'} working · {running.length} call
                    {running.length === 1 ? '' : 's'} in flight
                  </>
                )
              ) : (
                `${run.state === 'passed' ? 'Passed' : run.state === 'failed' ? 'Failed' : 'Stopped'} ${ago(run.ended ?? run.started, now)} · Workspaces unmounted, Sandboxes closed · History keeps its Commits`
              )}
            </p>
            <span className="shrink-0 text-xs text-faint">Local SQLite Store · Docker Sandboxes</span>
          </header>

          <FlowGraph
            run={run}
            state={state}
            agents={agents}
            sandboxes={sandboxes}
            runningOf={runningOf}
            execOn={execOn}
            now={now}
            colorOf={colorOf}
            onOpenAgent={onOpenAgent}
          />

          <footer className="flex flex-wrap items-end gap-x-8 gap-y-3 border-t px-6 py-4">
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              Each session is one agent with bash and the subagent tools. Its <code className="font-mono">layerfs</code> calls go
              straight to the project's Store; a Workspace mounts a Branch inside a Sandbox, where{' '}
              <code className="font-mono">workspace exec</code> runs.
            </p>
            <div className="ml-auto flex gap-7">
              <Stat value={working} label="sessions working" />
              <Stat value={running.length} label="calls in flight" />
              <Stat value={sandboxes.length} label="Sandboxes open" />
              <Stat value={mounted} label="Workspaces mounted" />
              <Stat value={commits} label="Commits" />
            </div>
          </footer>
        </section>

        <Activity run={run} now={now} colorOf={colorOf} onOpenAgent={onOpenAgent} />
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
  agents: SwitcherAgent[]
  sandboxes: SandboxView[]
  runningOf: Map<string, RunningCall[]>
  execOn: Map<string, RunningCall>
  now: number
  colorOf: (name: string) => AgentColor
  onOpenAgent: (name: string) => void
}

interface Edge {
  id: string
  d: string
  /** The agent whose call travels on it; none for a resting link. */
  agent?: string
  active?: boolean
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = (b.x - a.x) / 2
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Store calls: the ones that do not run in a Workspace. */
const storeCall = (c: RunningCall) => !c.method.startsWith('workspace.') && !c.method.startsWith('sandbox.')

function FlowGraph({ run, state, agents, sandboxes, runningOf, execOn, now, colorOf, onOpenAgent }: GraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edge[]>([])
  const nodes = useMemo(() => treeOrder(agents, (a) => a.name, (a) => a.parent), [agents])

  // Edges follow the cards, so they are measured after layout.
  const shape = [
    agents.map((a) => `${a.name}:${a.state}:${(runningOf.get(a.name) ?? []).filter(storeCall).length}`).join(','),
    sandboxes.map((s) => `${s.id}[${s.workspaces.map((w) => `${w.key}:${w.mount?.agent ?? ''}:${execOn.has(w.key)}`).join(',')}]`).join(','),
  ].join('|')
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const measure = () => {
      const origin = root.getBoundingClientRect()
      const at = (anchor: string, side: 'left' | 'right') => {
        const el = root.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`)
        if (!el) return undefined
        const r = el.getBoundingClientRect()
        return { x: (side === 'right' ? r.right : r.left) - origin.left, y: r.top + r.height / 2 - origin.top }
      }
      const hubIn = at('hub', 'left')
      const hubOut = at('hub', 'right')
      if (!hubIn || !hubOut) return
      const next: Edge[] = []
      for (const a of agents) {
        const from = at(`agent-${a.name}`, 'right')
        if (!from || a.state === undefined || a.state === 'waiting') continue
        const active = (runningOf.get(a.name) ?? []).some(storeCall)
        next.push({ id: `a-${a.name}`, d: curve(from, hubIn), agent: a.state === 'running' ? a.name : undefined, active })
      }
      if (sandboxes.length === 0) {
        const to = at('sandbox-none', 'left')
        if (to) next.push({ id: 'none', d: curve(hubOut, to) })
      }
      for (const s of sandboxes) {
        if (s.workspaces.length === 0) {
          const to = at(`sandbox-${s.id}`, 'left')
          if (to) next.push({ id: `s-${s.id}`, d: curve(hubOut, to) })
        }
        for (const w of s.workspaces) {
          const to = at(`ws-${w.key}`, 'left')
          if (to) next.push({ id: `w-${w.key}`, d: curve(hubOut, to), agent: w.mount?.agent, active: execOn.has(w.key) })
        }
      }
      setEdges(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
    // `shape` stands in for the parts of the state that move cards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape])

  const motion = !reducedMotion()

  return (
    <div className="overflow-x-auto">
      <div
        ref={box}
        className="relative grid min-w-[880px] grid-cols-[minmax(13rem,16rem)_minmax(2.5rem,1fr)_minmax(12rem,14rem)_minmax(2.5rem,1fr)_minmax(19rem,26rem)] items-center px-6 py-7"
      >
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
          {edges
            .filter((e) => !e.agent)
            .map((e) => (
              <path key={e.id} d={e.d} fill="none" className="stroke-border" strokeWidth={1.5} />
            ))}
          {edges
            .filter((e) => e.agent)
            .map((e) => (
              <g key={e.id} className={colorOf(e.agent!).text}>
                <path
                  d={e.d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={e.active ? 2 : 1.5}
                  strokeOpacity={e.active ? 1 : 0.45}
                  className={e.active ? 'flow-dash' : undefined}
                />
                {e.active && motion && (
                  <circle r={3.5} fill="currentColor">
                    <animateMotion dur="1.4s" repeatCount="indefinite" path={e.d} />
                  </circle>
                )}
              </g>
            ))}
        </svg>

        <div className="relative z-10 flex flex-col gap-3">
          <ColumnLabel>Sessions</ColumnLabel>
          {nodes.map(({ item: a, depth }) => (
            <SessionNode
              key={a.name}
              agent={a}
              depth={depth}
              calls={runningOf.get(a.name) ?? []}
              last={run.live.last[a.name]}
              now={now}
              color={colorOf(a.name)}
              onOpen={() => onOpenAgent(a.name)}
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
            <div
              data-anchor="sandbox-none"
              className="flex items-center gap-2.5 rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground"
            >
              <Box aria-hidden="true" className="size-4 shrink-0 text-faint" />
              No Sandbox open. One opens when an agent creates it to mount a Workspace.
            </div>
          ) : (
            sandboxes.map((s) => <SandboxNode key={s.id} sandbox={s} execOn={execOn} now={now} colorOf={colorOf} />)
          )}
        </div>
      </div>
    </div>
  )
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1 text-[11px] font-medium tracking-wide text-faint uppercase">{children}</span>
}

function callTarget(c: { branch?: string | null; path?: string | null; sandbox?: string | null; command?: string | null }) {
  if (c.command) return c.command
  if (c.sandbox && c.path) return `${c.sandbox}:${c.path}`
  return c.branch ?? c.path ?? null
}

function SessionNode({
  agent,
  depth,
  calls,
  last,
  now,
  color,
  onOpen,
}: {
  agent: SwitcherAgent
  depth: number
  calls: RunningCall[]
  last: RunDetail['live']['last'][string] | undefined
  now: number
  color: AgentColor
  onOpen: () => void
}) {
  const state = agent.state ?? 'waiting'
  const call = calls[0]
  const active = state === 'running'
  return (
    <button
      type="button"
      data-anchor={`agent-${agent.name}`}
      onClick={onOpen}
      title={`Open ${agent.name}'s conversation`}
      style={{ marginLeft: Math.min(depth, 3) * 12 }}
      className={cn(
        'flex flex-col gap-1 rounded-xl border bg-card px-3 py-2.5 text-left outline-none transition-[border-color,box-shadow,opacity] focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-foreground/20 shadow-sm' : state === 'waiting' ? 'opacity-60 hover:opacity-100' : 'hover:border-foreground/20',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold uppercase', color.soft, color.text)}>
          {agent.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
        <AgentDot state={state} />
        <span className="text-[11px] text-faint tabular-nums">
          {agent.done ?? 0}/{agent.of}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 pl-8 text-xs text-muted-foreground">
        {call ? (
          <>
            <Spinner className="size-3 shrink-0" />
            <span className="shrink-0 font-mono text-foreground">{call.method}</span>
            <span className="min-w-0 truncate font-mono text-faint">{callTarget(call)}</span>
            <span className="ml-auto shrink-0 tabular-nums">{duration(now - call.start)}</span>
          </>
        ) : state === 'waiting' ? (
          'not started yet'
        ) : last ? (
          <>
            <span className={cn('shrink-0 font-mono', last.ok ? '' : 'text-destructive')}>{last.method}</span>
            <span className="truncate text-faint">{last.ok ? '' : `${last.code ?? 'failed'} · `}{ago(last.at, now)}</span>
          </>
        ) : (
          <span className="text-faint">{state === 'running' ? 'thinking in bash…' : state}</span>
        )}
      </span>
    </button>
  )
}

function HubNode({ run, state }: { run: RunDetail; state: ProjectState | undefined }) {
  const branches = state?.branches ?? []
  const open = branches.filter((b) => b.state === 'open' && b.name !== 'main')
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
      {open.length > 0 && (
        <ul className="flex max-h-40 w-full flex-col gap-1 overflow-y-auto border-t pt-2.5 text-left">
          {open.map((b) => (
            <li key={b.name} className="flex min-w-0 items-center gap-1.5 text-xs">
              <GitBranch aria-hidden="true" className="size-3 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="shrink-0 text-faint tabular-nums">{b.commits}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SandboxNode({
  sandbox,
  execOn,
  now,
  colorOf,
}: {
  sandbox: SandboxView
  execOn: Map<string, RunningCall>
  now: number
  colorOf: (name: string) => AgentColor
}) {
  const busy = sandbox.workspaces.some((w) => execOn.has(w.key))
  return (
    <div
      data-anchor={`sandbox-${sandbox.id}`}
      className={cn('overflow-hidden rounded-xl border bg-card', busy && 'border-foreground/25 shadow-sm')}
    >
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <Box aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-medium">Sandbox {sandbox.id}</span>
        {sandbox.name && <span className="min-w-0 truncate font-mono text-[11px] text-faint">{sandbox.name}</span>}
        <span className="ml-auto shrink-0 text-xs text-faint">
          {sandbox.madeBy ? `made by ${sandbox.madeBy}` : sandbox.state}
        </span>
      </div>
      {sandbox.workspaces.length === 0 ? (
        <div className="flex items-center gap-2 border-t bg-muted/30 px-3.5 py-2 text-xs text-faint">
          <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
          No Workspace mounted
        </div>
      ) : (
        sandbox.workspaces.map((w) => {
          const exec = execOn.get(w.key)
          const agent = w.mount?.agent
          return (
            <div key={w.key} data-anchor={`ws-${w.key}`} className="flex flex-col gap-1 border-t bg-muted/30 px-3.5 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
                <span className="shrink-0 font-mono">{w.path}</span>
                {w.branch && (
                  <span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
                    <GitBranch aria-hidden="true" className="size-3 shrink-0" />
                    <span className="truncate">{w.branch}</span>
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {agent ? (
                    <>
                      <span aria-hidden="true" className={cn('size-2 rounded-full', colorOf(agent).dot)} />
                      {agent}
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
                    <span className="min-w-0 truncate font-mono">{exec.command ?? ''}</span>
                    <span className="ml-auto shrink-0 tabular-nums">{duration(now - exec.start)}</span>
                  </>
                ) : w.mount?.last ? (
                  <>
                    <span className="shrink-0">idle · last</span>
                    <span className="min-w-0 truncate font-mono text-faint">{w.mount.last.command ?? 'exec'}</span>
                    <span className={cn('ml-auto shrink-0', w.mount.last.kind && w.mount.last.kind !== 'exit:0' && 'text-warning')}>
                      {w.mount.last.kind ?? ''}
                    </span>
                  </>
                ) : (
                  <span className="text-faint">idle · mounted {w.mount ? ago(w.mount.since, now) : ''}</span>
                )}
                {w.mount && w.mount.commits > 0 && (
                  <span className="shrink-0 text-faint">
                    · {w.mount.commits} commit{w.mount.commits === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}

// ---------- recent calls ----------

function Activity({
  run,
  now,
  colorOf,
  onOpenAgent,
}: {
  run: RunDetail
  now: number
  colorOf: (name: string) => AgentColor
  onOpenAgent: (name: string) => void
}) {
  const recent = useMemo(() => {
    const calls: TraceCall[] = []
    for (let i = run.steps.length - 1; i >= 0 && calls.length < FEED * 3; i--) calls.push(...run.steps[i].calls)
    return calls.sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, FEED)
  }, [run.steps])
  const running = run.live.running
  if (recent.length === 0 && running.length === 0) return null
  return (
    <section aria-label="Recent calls" className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-semibold">Recent LayerFS calls</h2>
      <ol className="divide-y overflow-hidden rounded-xl border bg-card text-xs">
        {running.map((c) => (
          <CallRow key={`r-${c.id}`} agent={c.agent} method={c.method} target={callTarget(c)} color={colorOf(c.agent)} onOpenAgent={onOpenAgent}>
            <Spinner className="size-3" />
            <span className="w-16 text-right tabular-nums">{duration(now - c.start)}</span>
          </CallRow>
        ))}
        {recent.map((c) => (
          <CallRow
            key={c.id}
            agent={c.agent}
            method={c.method}
            target={callTarget({ branch: c.branch, sandbox: c.sandbox, path: c.path })}
            color={colorOf(c.agent)}
            onOpenAgent={onOpenAgent}
          >
            {c.ok === false ? <span className="text-destructive">{c.code ?? 'failed'}</span> : <span className="text-faint">{c.kind ?? 'ok'}</span>}
            <span className="w-16 text-right text-muted-foreground tabular-nums">{duration(c.ms)}</span>
          </CallRow>
        ))}
      </ol>
    </section>
  )
}

function CallRow({
  agent,
  method,
  target,
  color,
  onOpenAgent,
  children,
}: {
  agent: string
  method: string
  target: string | null
  color: AgentColor
  onOpenAgent: (name: string) => void
  children: React.ReactNode
}) {
  const kind = KIND[methodKind(method)]
  return (
    <li className="flex items-center gap-3 px-4 py-1.5">
      <button
        type="button"
        onClick={() => onOpenAgent(agent)}
        className="flex w-28 shrink-0 items-center gap-1.5 truncate rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', color.dot)} />
        <span className="truncate">{agent}</span>
      </button>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', kind.dot)} />
      <span className="w-40 shrink-0 truncate font-mono">{method}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-faint">{target ?? ''}</span>
      <span className="flex shrink-0 items-center gap-3">{children}</span>
    </li>
  )
}
