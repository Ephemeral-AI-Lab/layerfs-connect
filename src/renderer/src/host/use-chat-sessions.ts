import { useEffect, useState } from 'react'
import type { AgentSessionSummary } from '@shared/agent-api'

import { agentHost } from '@/host/agent-client'
import { onHostEvent } from '@/host/client'

/** A chat is working: a turn runs, or its child agents do. */
export const chatLive = (c: AgentSessionSummary) => c.state === 'running' || c.execution?.phase === 'children'

/** The project a chat is on (a scenario chat is on its scenario's project); null for a local folder. */
export const chatProject = (c: AgentSessionSummary) => c.project ?? c.scenario?.project ?? null

/**
 * The agent harness's conversations, archived ones too, kept current from the
 * host's `chat` events; read again when `tick` moves. Undefined until the first read.
 */
export function useChatSessions(tick?: unknown) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>()
  const [error, setError] = useState<Error>()
  useEffect(() => {
    let live = true
    agentHost.sessions().then(
      (all) => { if (live) { setSessions(all); setError(undefined) } },
      (e: Error) => { if (live) { setSessions((s) => s ?? []); setError(e) } },
    )
    return () => { live = false }
  }, [tick])
  useEffect(() => onHostEvent((event) => {
    if (event.type !== 'chat') return
    const { messages: _m, queued: _q, tools: _t, children: _c, approvals: _a, ...summary } = event.session
    setSessions((all) => {
      if (!all) return all
      const i = all.findIndex((s) => s.id === summary.id)
      if (i >= 0 && all[i].updated > summary.updated) return all
      return i < 0 ? [summary, ...all] : all.map((s, j) => (j === i ? summary : s))
    })
  }), [])
  return { sessions, error }
}
