// Live's data, from chats: a project's chats that work in LayerFS (scenario
// chats, and project chats with a mount of their own) as the runs the diagram
// draws. Each shown chat's LayerFS calls and what it holds in LayerFS now
// (GET /api/agent/sessions/:id/live, from its trace lines) are read once, and
// again every second while it works. The project's state (Branches, Layers,
// open Sandboxes) is reread while one works.
import type { AgentSessionSummary } from '@shared/agent-api'
import type { AgentRun, ProjectState, RunLive, RunningCall, RunState, RunSummary, TraceCall } from '@shared/host-api'
import { useEffect, useMemo, useState } from 'react'

import { isProject } from '@/components/projects/store-facts'
import { isLive } from '@/components/live/run-format'
import { agentHost } from '@/host/agent-client'
import { host } from '@/host/client'
import { chatLive, chatProject } from '@/host/use-chat-sessions'
import { useHostQuery } from '@/host/use-host'

/** How often the project is reread while a chat works. */
const POLL_MS = 2000
/** How often a working chat's calls are reread. */
const CALLS_MS = 1000
/** How long an ended chat stays in Live. */
export const ACTIVE_AFTER_MS = 5 * 60 * 1000

export interface LiveSession {
  run: RunSummary
  /** Its LayerFS calls, oldest first. */
  calls: TraceCall[]
  live: RunLive
}

const EMPTY_LIVE: RunLive = { running: [], mounts: [], sandboxes: [], last: {} }

/** A session Live shows: working, or ended a moment ago. */
export const activeRun = (run: RunSummary, now: number) => isLive(run.state) || now - (run.ended ?? run.started) < ACTIVE_AFTER_MS

/** A run's name: a scenario chat's folder (`shop_2`), else the chat's title. */
export const runName = (run: Pick<RunSummary, 'folder' | 'demo' | 'replay'>) => run.folder ?? (run.replay ? `${run.demo} #${run.replay}` : run.demo)

/** The run a Branch belongs to (`<folder>.<name>`), and its name inside the run. */
export function branchRun(branch: string, folders: readonly string[]): { folder: string; name: string } | null {
  for (const folder of folders) if (branch.startsWith(`${folder}.`)) return { folder, name: branch.slice(folder.length + 1) }
  return null
}

/** `<folder>.main`, `<folder>.main.1`, …: a run's trunk, which stands for main. */
export const isTrunk = (name: string) => /^main(\.\d+)?$/.test(name)

/** Whether a chat works in LayerFS: a scenario chat, or a project chat with a mount. */
export const worksInLayerfs = (chat: AgentSessionSummary) => !!chat.scenario || (!!chat.project && !!chat.workspace)

const SCENARIO_STATE: Record<NonNullable<AgentSessionSummary['scenario']>['state'], RunState> = {
  preparing: 'starting',
  playing: 'running',
  passed: 'passed',
  failed: 'failed',
  stopped: 'stopped',
}

/** A chat as the run Live draws (its agents come from its calls: useLiveSessions). */
export function chatRun(chat: AgentSessionSummary): RunSummary {
  const s = chat.scenario ?? null
  const working = chatLive(chat)
  const state: RunState = s
    ? (working && s.state !== 'preparing' ? 'running' : SCENARIO_STATE[s.state])
    : working ? 'running' : chat.state === 'error' ? 'failed' : 'passed'
  return {
    id: chat.id,
    kind: 'live',
    demo: s ? s.id : chat.title,
    project: chatProject(chat) ?? '',
    folder: s?.folder ?? null,
    replay: null,
    state,
    started: chat.created,
    ended: isLive(state) ? null : chat.updated,
    error: s?.error ?? chat.error ?? null,
    done: s?.done ?? 0,
    of: s?.of ?? 0,
    phase: s?.phase ?? null,
    agents: [{ name: 'root', parent: null, state: isLive(state) ? 'running' : state === 'failed' ? 'failed' : 'done', done: s?.done ?? 0, of: s?.of ?? 0 }],
  }
}

/** The project's chats that work in LayerFS, as Live's runs, newest first. */
export function projectRuns(chats: readonly AgentSessionSummary[] | undefined, project: string): RunSummary[] | undefined {
  return chats
    ?.filter((chat) => !chat.archived && chatProject(chat) === project && worksInLayerfs(chat))
    .map(chatRun)
    .sort((a, b) => b.started - a.started)
}

/** Its agents: root, then each agent named by completed or in-flight calls. */
export function withAgents(run: RunSummary, calls: readonly TraceCall[], running: readonly RunningCall[]): RunSummary {
  const root = run.agents[0]
  const names = [...new Set([...calls, ...running].map((call) => call.agent))].filter((name) => name !== root.name)
  if (!names.length) return run
  const child: AgentRun['state'] = isLive(run.state) ? 'running' : 'done'
  return { ...run, agents: [root, ...names.map((name) => ({ name, parent: root.name, state: child, done: 0, of: 0 }))] }
}

/** The runs `runs` (Live's shown ones), each with its calls and what it holds in LayerFS, kept current. */
export function useLiveSessions(runs: readonly RunSummary[]): LiveSession[] {
  const [read, setRead] = useState<ReadonlyMap<string, { calls: TraceCall[]; live: RunLive }>>(() => new Map())
  const idsKey = runs.map((run) => `${run.id}:${isLive(run.state) ? 1 : 0}`).join(',')

  useEffect(() => {
    let alive = true
    // A new run state needs its own final read, even while the previous effect's read finishes.
    const reading = new Set<string>()
    const wanted = idsKey ? idsKey.split(',').map((item) => item.split(':')) : []
    setRead((m) => {
      const keep = new Map([...m].filter(([id]) => wanted.some(([w]) => w === id)))
      return keep.size === m.size ? m : keep
    })
    const load = (id: string) => {
      if (reading.has(id)) return
      reading.add(id)
      agentHost.live(id).then(
        (answer) => { if (alive) setRead((m) => new Map(m).set(id, answer)) },
        () => {}, // unreadable now: the next tick asks again
      ).finally(() => reading.delete(id))
    }
    for (const [id] of wanted) load(id)
    const working = wanted.filter(([, on]) => on === '1').map(([id]) => id)
    // a hidden window skips its rereads; the next visible tick catches up
    const timer = working.length ? setInterval(() => { if (!document.hidden) working.forEach(load) }, CALLS_MS) : undefined
    return () => { alive = false; if (timer) clearInterval(timer) }
  }, [idsKey])

  return useMemo(() => runs.map((run) => {
    const got = read.get(run.id)
    const calls = got?.calls ?? []
    const live = got?.live ?? EMPTY_LIVE
    return { run: withAgents(run, calls, live.running), calls, live }
  }), [runs, read])
}

/** The project's state, reread every POLL_MS while `live`, and once more when `changed` moves. */
export function useLiveProject(project: string, live: boolean, changed: string): ProjectState | undefined {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    // a hidden window skips its rereads; the next visible tick catches up
    const timer = setInterval(() => document.hidden || setTick((n) => n + 1), POLL_MS)
    return () => clearInterval(timer)
  }, [live])
  const q = useHostQuery(() => host.project(project), [project, tick, changed], `project:${project}`)
  return q.data && isProject(q.data.project, project) ? q.data : undefined
}
