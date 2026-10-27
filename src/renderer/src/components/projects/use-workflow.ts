import { useEffect, useState } from 'react'

import { COMMANDS, type FlowCompute, type Live, OPENING } from '@/data/flow'
import type { Project } from '@/data/sample'

/** How often the sample loop advances, in milliseconds. */
const TICK = 200

export interface FlowState {
  /** Simulated time, which stands still while paused. */
  t: number
  /** The head Commit number. */
  head: number
  /** Commits made locally and not pushed (local SQLite only). */
  toPush: number
  sessions: Record<string, Live>
  /** The latest Commit, for the project node's flash. */
  lastCommit?: { id: number; session: string; at: number }
}

const between = (lo: number, hi: number) => lo + Math.round(Math.random() * (hi - lo))
const workspaceId = () => `ws-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')}`
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

function opening(project: Project, computes: FlowCompute[], toPush: number): FlowState {
  const head = Number(project.lastCommit.id.replace(/\D/g, '')) || 0
  const scripted = OPENING[project.key] ?? {}
  const sessions: Record<string, Live> = {}
  project.sessions.forEach((s, i) => {
    const preset = scripted[s.id]
    const compute = computes[i % computes.length]
    sessions[s.id] = preset
      ? { ...preset, next: i + 1 }
      : s.busy
        ? {
            phase: 'exec',
            until: between(1500, 4000),
            compute: compute.id,
            workspace: workspaceId(),
            from: head,
            command: COMMANDS[s.agent][0],
            next: i + 1,
          }
        : { phase: 'idle', until: between(2500, 9000), next: i }
  })
  return { t: 0, head, toPush, sessions }
}

function step(state: FlowState, project: Project, computes: FlowCompute[], local: boolean): FlowState {
  const t = state.t + TICK
  let { head, toPush, lastCommit } = state
  const sessions = { ...state.sessions }
  for (const s of project.sessions) {
    const live = sessions[s.id]
    if (!live || t < live.until) continue
    switch (live.phase) {
      case 'idle': {
        const compute = computes[live.next % computes.length]
        sessions[s.id] = {
          phase: 'mounting',
          until: t + 1400,
          compute: compute.id,
          workspace: workspaceId(),
          from: head,
          next: live.next + 1,
        }
        break
      }
      case 'mounting':
        sessions[s.id] = { ...live, phase: 'exec', until: t + between(2600, 5200), command: pick(COMMANDS[s.agent]) }
        break
      case 'exec':
        sessions[s.id] = { ...live, phase: 'commit', until: t + 1300 }
        break
      case 'commit':
        head += 1
        if (local) toPush += 1
        lastCommit = { id: head, session: s.id, at: t }
        // Per-call granularity: the Workspace unmounts once the call is done.
        sessions[s.id] = { phase: 'idle', until: t + between(3500, 8000), next: live.next }
        break
    }
  }
  return { t, head, toPush, sessions, lastCommit }
}

/** The sample loop for one project: idle, mount, exec, commit, unmount, again. */
export function useWorkflow(project: Project, computes: FlowCompute[], local: boolean, startToPush: number, running: boolean) {
  const [state, setState] = useState(() => opening(project, computes, startToPush))

  // A different project starts its own loop.
  const [key, setKey] = useState(project.key)
  if (key !== project.key) {
    setKey(project.key)
    setState(opening(project, computes, startToPush))
  }

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setState((s) => step(s, project, computes, local)), TICK)
    return () => clearInterval(timer)
  }, [running, project, computes, local])

  return state
}
