// Live: the project's working sessions as one diagram. Agents on the left, as
// a tree per run (subagents under their parent); the LayerFS project in the
// middle, with its Store and its open Branches by run; the Sandboxes on the
// right, with the Workspaces mounted in them. Every LayerFS call is drawn
// (live-flow.ts): a dot leaves the agent in its colour along a dashed lane,
// reaches the Branch row it touched (and the Workspace or Sandbox, for
// workspace and sandbox calls), and comes back green, or red when it failed.
//
// Sessions are scenario runs, several of which can play on one project at
// once, each in its own folder: Live shows the playing ones and those that
// ended in the last five minutes. Their calls come from their trace lines
// (live-data.ts keeps them current from the host's events); the project's
// state is reread every two seconds while one plays.
//
// Folding: playing runs start open (the newest two), the others folded to one
// card; subagents from the third level start folded under their parent. What
// the user folds or opens is kept per project. A folded card stands in for
// what it hides: their calls start from it.
//
// Density: past DENSE_SESSIONS sessions a folded one is a single line; past
// DENSE_SANDBOXES Sandboxes, one not running a command is a single line too
// (a click opens its card), with no mount lanes drawn to it, and past
// SANDBOX_ROWS lines the rest wait behind "+N more". Calls still fly to a
// line: it carries its Workspaces' anchors.
import './live.css'

import type { ProjectState, RunSummary } from '@shared/host-api'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { type StoreFacts, storeFacts, useStorageView } from '@/components/projects/store-facts'
import { useProjectSandboxes } from '@/components/projects/use-sandboxes'
import { bindings } from '@/components/live/live-bindings'
import { activeRun, runName, useLiveProject, useLiveSessions } from '@/components/live/live-data'
import { FAIL_CLASS, FlowEngine, type FlowScene, OK_CLASS } from '@/components/live/live-flow'
import {
  type Folds,
  type Group,
  type GroupLayout,
  type SandboxView,
  activeAgent,
  agentKey,
  hubRows,
  layoutGroup,
  routeOf,
  sandboxViews,
} from '@/components/live/live-model'
import { HubNode, IdleAgents, IdleSandboxes, SandboxLine, SandboxNode, SessionGroup, ZoneLabel, count } from '@/components/live/live-nodes'
import { agentColors, ago, isLive } from '@/components/live/run-format'
import { useNow } from '@/lib/use-now'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** A finished call older than this is history, not drawn. */
const FRESH_MS = 5000
/** Sessions drawn at most; the newest playing ones first. */
const MAX_SESSIONS = 12
/** More sessions than this: the folded ones are one line each. */
const DENSE_SESSIONS = 3
/** More Sandboxes than this: the quiet ones are one line each. */
const DENSE_SANDBOXES = 4
/** One-line Sandboxes shown before "+N more". */
const SANDBOX_ROWS = 10

export interface LiveTabProps {
  /** The project key (`store/name` in a shared Store). */
  project: string
  /** This project's runs, newest first. */
  runs: RunSummary[] | undefined
  onOpenRun: (runId: string, agent?: string) => void
}

// ---------- folds, kept per project ----------

const foldStore = (project: string) => `connect.live.folds:${project}`
const MAX_FOLDS = 200

function readFolds(project: string): Folds {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(foldStore(project)) ?? '{}')
    return v && typeof v === 'object' ? (v as Folds) : {}
  } catch {
    return {}
  }
}

function useFolds(project: string) {
  const [over, setOver] = useState(() => readFolds(project))
  useEffect(() => setOver(readFolds(project)), [project])
  const set = useCallback(
    (key: string, folded: boolean) =>
      setOver((o) => {
        const { [key]: _, ...rest } = o
        const next = Object.fromEntries(Object.entries({ ...rest, [key]: folded }).slice(-MAX_FOLDS))
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

// ---------- the tab ----------

export function LiveTab({ project, runs, onOpenRun }: LiveTabProps) {
  const { t } = useI18n()
  const anyLive = runs?.some((r) => isLive(r.state)) ?? false
  // ticks slowly once nothing plays, so ended sessions leave on time
  const now = useNow(true, anyLive ? 1000 : 10_000)
  const shown = useMemo(
    () =>
      (runs ?? [])
        .filter((r) => activeRun(r, now))
        .sort((a, b) => Number(isLive(b.state)) - Number(isLive(a.state)) || b.started - a.started)
        .slice(0, MAX_SESSIONS),
    [runs, now],
  )
  const sessions = useLiveSessions(shown)
  const state = useLiveProject(project, anyLive, sessions.map((s) => `${s.run.id}:${s.run.state}`).join(','))
  const storage = useStorageView()
  const store = useMemo(() => (state ? storeFacts(state.project, storage) : undefined), [state, storage])

  const groups = useMemo<Group[]>(
    () => sessions.map((session) => ({ session, name: runName(session.run), colorOf: agentColors(session.run.agents.map((a) => a.name)) })),
    [sessions],
  )
  // the Sandboxes' Workspaces come from their own read, which never holds the project read
  const sandboxRead = useProjectSandboxes(project, anyLive ? 4000 : null)
  const withWorkspaces = useMemo(() => (state && sandboxRead.data ? { ...state, sandboxes: sandboxRead.data } : state), [state, sandboxRead.data])
  const sandboxes = useMemo(() => sandboxViews(withWorkspaces, groups), [withWorkspaces, groups])
  const folds = useFolds(project)

  const inFlight = groups.reduce((n, g) => n + g.session.live.running.length, 0)
  const playing = groups.filter((g) => isLive(g.session.run.state)).length
  const lastEnded = runs?.find((r) => !isLive(r.state))
  const idleNote = runs
    ? lastEnded
      ? t('The last chat, {name}, ended {time}', { name: runName(lastEnded), time: ago(lastEnded.ended ?? lastEnded.started, now) })
      : t('No chat has worked in LayerFS on this project yet')
    : t('Reading the chats…')

  return (
    <section aria-label={t('Live')} className="glass-liquid live-panel flex min-w-0 flex-col overflow-hidden rounded-2xl shadow-xs">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-foreground/[0.06] px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', playing ? 'pulse-ring bg-primary text-primary' : 'bg-idle')} />
          {t('Live')}
        </h2>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {[
            playing ? count(t, playing, '{n} chat working', '{n} chats working') : t('No chat working'),
            groups.length > playing ? t('{n} ended recently', { n: groups.length - playing }) : null,
            count(t, inFlight, '{n} call in flight', '{n} calls in flight'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <FlowGraph
        project={project}
        state={state}
        store={store}
        groups={groups}
        sandboxes={sandboxes}
        folds={folds}
        now={now}
        live={anyLive}
        busy={inFlight > 0}
        idleNote={idleNote}
        onOpen={onOpenRun}
      />

    </section>
  )
}

// ---------- the graph ----------

interface GraphProps {
  project: string
  state: ProjectState | undefined
  store: StoreFacts | undefined
  groups: Group[]
  sandboxes: SandboxView[]
  folds: ReturnType<typeof useFolds>
  now: number
  /** A run of the project plays. */
  live: boolean
  /** A call is in flight. */
  busy: boolean
  /** When the last run ended, for the idle placeholder. */
  idleNote: string
  onOpen: (runId: string, agent?: string) => void
}

function FlowGraph({ project, state, store, groups, sandboxes, folds, now, live, busy, idleNote, onOpen }: GraphProps) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const engine = useRef<FlowEngine | null>(null)
  const many = groups.length > 1
  const dense = groups.length > DENSE_SESSIONS
  const layouts = useMemo<GroupLayout[]>(() => groups.map((g, i) => layoutGroup(g, folds.over, i, many)), [groups, folds.over, many])
  const rows = useMemo(() => hubRows(state, groups), [state, groups])
  const folders = useMemo(() => groups.map((g) => g.name), [groups])
  const workspaces = useMemo(() => new Set(sandboxes.flatMap((s) => s.workspaces.map((w) => w.key))), [sandboxes])
  // where each agent works: its Workspace's Branch, else the Branch its last call named
  const bound = useMemo(() => bindings(groups.map((g) => g.session)).filter((b) => !!b.branch && rows.names.has(b.branch)), [groups, rows])
  // a Branch an agent works on is outlined in that agent's colour (the first, if several)
  const owners = useMemo(() => {
    const map = new Map<string, string>()
    for (const b of bound) {
      const g = groups.find((x) => x.session.run.id === b.session)
      if (g && b.branch && !map.has(b.branch)) map.set(b.branch, g.colorOf(b.agent).text)
    }
    return map
  }, [bound, groups])
  const noAgents = layouts.length === 0
  const noSandboxes = sandboxes.length === 0

  // many Sandboxes: the ones running a command (or opened by a click) keep their cards, the rest are lines
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const [allRows, setAllRows] = useState(false)
  const denseSandboxes = sandboxes.length > DENSE_SANDBOXES
  const compact = useMemo(() => {
    if (!denseSandboxes) return new Set<string>()
    // a mount waiting under load does not count, or every new Sandbox would keep its card
    const working = new Set(
      groups.flatMap((g) =>
        g.session.live.running.filter((c) => c.command !== null || c.method.startsWith('process.')).flatMap((c) => (c.sandbox ? [c.sandbox] : [])),
      ),
    )
    return new Set(sandboxes.filter((s) => !working.has(s.id) && !opened.has(s.id)).map((s) => s.id))
  }, [denseSandboxes, groups, sandboxes, opened])
  const cards = sandboxes.filter((s) => !compact.has(s.id))
  const lines = sandboxes.filter((s) => compact.has(s.id))
  const shownLines = allRows ? lines : lines.slice(0, SANDBOX_ROWS)

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
    const byRun = new Map(layouts.map((l) => [l.group.session.run.id, l]))
    const split = (key: string) => {
      const i = key.indexOf('/')
      return { l: byRun.get(key.slice(0, i)), name: key.slice(i + 1) }
    }
    const mounts: FlowScene['mounts'] = []
    for (const s of sandboxes)
      for (const w of s.workspaces)
        // a Sandbox shown as a line draws no mount lane: its calls still fly to it
        if (w.mount && !compact.has(s.id))
          mounts.push({
            key: w.key,
            route: { agent: agentKey(w.mount.run, w.mount.agent), via: w.branch && rows.names.has(w.branch) ? `branch-${w.branch}` : null, to: `ws-${w.key}` },
          })
    // every agent stays joined to the Branch it works on, mount or not
    for (const b of bound) {
      const agent = agentKey(b.session, b.agent)
      const via = `branch-${b.branch}`
      if (mounts.some((m) => m.route.agent === agent && m.route.via === via)) continue
      mounts.push({ key: `bind-${agent}`, route: { agent, via, to: null } })
    }
    const tree: FlowScene['tree'] = []
    for (const l of layouts)
      for (const n of l.nodes) if (n.visible && n.parent) tree.push([`agent-${n.key}`, `agent-${agentKey(l.group.session.run.id, n.parent)}`])
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
  }, [layouts, sandboxes, rows, bound, noAgents, noSandboxes, compact])
  useLayoutEffect(() => engine.current?.setScene(scene))

  useTraffic(engine, groups, rows.names, workspaces)

  const agentCount = groups.reduce((n, g) => n + g.session.run.agents.filter(activeAgent).length, 0)
  const quiet =
    'self-start rounded-lg px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="overflow-x-auto">
      <div
        ref={box}
        className="live-field relative grid min-h-[26rem] min-w-[760px] grid-cols-[minmax(14rem,19rem)_minmax(2.5rem,1fr)_minmax(13rem,16rem)_minmax(2.5rem,1fr)_minmax(16rem,25rem)] items-center px-5 py-8"
      >
        {/* over the cards, so a lane reaches into the project card to its Branch row; lanes only cross the gaps */}
        <svg ref={svg} aria-hidden="true" className="live-overlay pointer-events-none absolute inset-0 z-20 size-full overflow-visible" />

        <div className="relative z-10 flex min-w-0 flex-col gap-3">
          <ZoneLabel label={t('Agents')} count={noAgents ? undefined : agentCount} />
          {noAgents && <IdleAgents note={idleNote} />}
          {layouts.map((l) => (
            <SessionGroup
              key={l.group.session.run.id}
              layout={l}
              dense={dense}
              now={now}
              onOpen={(agent) => onOpen(l.group.session.run.id, agent)}
              onFold={folds.set}
            />
          ))}
        </div>
        <span />
        <div className="relative z-10">
          <HubNode project={project} state={state} store={store} rows={rows} owners={owners} live={live} busy={busy} />
        </div>
        <span />
        <div className="relative z-10 flex min-w-0 flex-col gap-3">
          <ZoneLabel label={t('Sandboxes')} count={noSandboxes ? undefined : sandboxes.length} />
          {noSandboxes ? (
            <IdleSandboxes />
          ) : (
            <>
              {cards.map((s, i) => (
                <SandboxNode key={s.id} index={i} sandbox={s} groups={groups} folders={folders} now={now} />
              ))}
              {shownLines.length > 0 && (
                <div className="flex flex-col gap-1">
                  {shownLines.map((s, i) => (
                    <SandboxLine key={s.id} index={i} sandbox={s} groups={groups} onOpen={() => setOpened((o) => new Set(o).add(s.id))} />
                  ))}
                  {lines.length > SANDBOX_ROWS && (
                    <button type="button" onClick={() => setAllRows((v) => !v)} className={quiet}>
                      {allRows ? t('Show fewer') : t('+{n} more', { n: lines.length - SANDBOX_ROWS })}
                    </button>
                  )}
                </div>
              )}
              {opened.size > 0 && denseSandboxes && (
                <button type="button" onClick={() => setOpened(new Set())} className={quiet}>
                  {t('Fold the Sandboxes I opened')}
                </button>
              )}
            </>
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
      const rid = g.session.run.id
      let done = seen.current.get(rid)
      const first = !done
      if (!done) seen.current.set(rid, (done = new Set()))
      for (const c of g.session.live.running) {
        const key = `${rid}/${c.agent}:${c.id}`
        if (out.current.has(key)) continue
        const route = first ? null : routeOf(g, c, rows, workspaces)
        out.current.set(key, route ? e.send(route) : Promise.resolve())
      }
      for (const c of g.session.calls) {
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
