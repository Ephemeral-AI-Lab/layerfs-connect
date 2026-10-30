// Live's data: the project's working sessions (scenario runs), each loaded
// once with host.run(id) and kept current from the host's events, and the
// project's state (Branches, Layers, open Sandboxes), reread while a session
// plays. A session keeps only what Live draws: its summary and agents, its
// calls (from the steps' calls and `call` events) and what it holds in
// LayerFS now (`live`).
import type { ProjectState, RunEvent, RunLive, RunSummary, TraceCall } from '@shared/host-api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isProject } from '@/components/projects/store-facts'
import { isLive } from '@/components/runs/run-format'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'

/** How often the project is reread while a session plays. */
const POLL_MS = 2000
/** Calls kept per session: Live draws only fresh ones. */
const MAX_CALLS = 400
/** How long an ended session stays in Live. */
export const ACTIVE_AFTER_MS = 5 * 60 * 1000

export interface LiveSession {
  run: RunSummary
  /** Its LayerFS calls, oldest first: finished ones (and ones the trace has seen start). */
  calls: TraceCall[]
  live: RunLive
}

/** A session Live shows: playing, waiting its turn, or ended a moment ago. */
export const activeRun = (run: RunSummary, now: number) => isLive(run.state) || now - (run.ended ?? run.started) < ACTIVE_AFTER_MS

/** A run's name: its folder (`crew_2`), else its scenario and replay number. */
export const runName = (run: Pick<RunSummary, 'folder' | 'demo' | 'replay'>) => run.folder ?? (run.replay ? `${run.demo} #${run.replay}` : run.demo)

/** The run a Branch belongs to (`<folder>.<name>`), and its name inside the run. */
export function branchRun(branch: string, folders: readonly string[]): { folder: string; name: string } | null {
  for (const folder of folders) if (branch.startsWith(`${folder}.`)) return { folder, name: branch.slice(folder.length + 1) }
  return null
}

/** `<folder>.main`, `<folder>.main.1`, …: a run's trunk, which stands for main. */
export const isTrunk = (name: string) => /^main(\.\d+)?$/.test(name)

const callKey = (c: TraceCall) => `${c.agent}:${c.id}`

function addCalls(calls: TraceCall[], more: TraceCall[]): TraceCall[] {
  if (more.length === 0) return calls
  const seen = new Set(calls.map(callKey))
  const fresh = more.filter((c) => !seen.has(callKey(c)))
  if (fresh.length === 0) return calls
  const next = [...calls, ...fresh]
  return next.length > MAX_CALLS ? next.slice(-MAX_CALLS) : next
}

function apply(s: LiveSession, events: RunEvent[]): LiveSession {
  let { run, calls, live } = s
  for (const e of events) {
    switch (e.type) {
      case 'run':
        run = { ...run, ...e.run }
        break
      case 'agent': {
        const i = run.agents.findIndex((a) => a.name === e.agent.name)
        run = { ...run, agents: i < 0 ? [...run.agents, e.agent] : run.agents.map((a, j) => (j === i ? e.agent : a)) }
        break
      }
      case 'step':
        calls = addCalls(calls, e.step.calls)
        break
      case 'call':
        calls = addCalls(calls, [e.call])
        break
      case 'live':
        live = e.live
        break
    }
  }
  return run === s.run && calls === s.calls && live === s.live ? s : { run, calls, live }
}

const eventRun = (e: RunEvent) => (e.type === 'run' ? e.run.id : e.type === 'run-removed' ? e.id : e.run)

/** The sessions `ids`, loaded and kept current; events are applied once per frame. */
export function useLiveSessions(ids: readonly string[]): LiveSession[] {
  const idsKey = ids.join(',')
  const wanted = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey])
  const wantedSet = useMemo(() => new Set(wanted), [wanted])
  const [sessions, setSessions] = useState<ReadonlyMap<string, LiveSession>>(() => new Map())
  const queue = useRef<RunEvent[]>([])
  const frame = useRef(0)
  /** Sessions loaded or loading: each is read once, then kept current by events. */
  const asked = useRef(new Set<string>())

  useEffect(() => {
    setSessions((m) => {
      const next = new Map([...m].filter(([id]) => wanted.includes(id)))
      return next.size === m.size ? m : next
    })
    for (const id of asked.current) if (!wanted.includes(id)) asked.current.delete(id)
    for (const id of wanted) {
      if (asked.current.has(id)) continue
      asked.current.add(id)
      host.run(id).then(
        (d) => {
          if (!asked.current.has(id)) return
          const loaded: LiveSession = { run: d, calls: addCalls([], d.steps.flatMap((step) => step.calls)), live: d.live }
          setSessions((m) => (m.has(id) ? m : new Map(m).set(id, loaded)))
        },
        // unreadable now: the next change of `wanted` asks again
        () => asked.current.delete(id),
      )
    }
  }, [wanted])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const flush = useCallback(() => {
    frame.current = 0
    const events = queue.current
    queue.current = []
    const byRun = new Map<string, RunEvent[]>()
    for (const e of events) {
      const id = eventRun(e)
      const list = byRun.get(id)
      if (list) list.push(e)
      else byRun.set(id, [e])
    }
    setSessions((m) => {
      let next: Map<string, LiveSession> | null = null
      for (const [id, mine] of byRun) {
        const s = m.get(id)
        if (!s) continue
        const after = apply(s, mine)
        if (after !== s) (next ??= new Map(m)).set(id, after)
      }
      return next ?? m
    })
  }, [])

  useHostEvents((e) => {
    if (e.type === 'run-removed' || !wantedSet.has(eventRun(e))) return
    queue.current.push(e)
    if (!frame.current) frame.current = requestAnimationFrame(flush)
  })

  return useMemo(() => wanted.flatMap((id) => sessions.get(id) ?? []), [wanted, sessions])
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
