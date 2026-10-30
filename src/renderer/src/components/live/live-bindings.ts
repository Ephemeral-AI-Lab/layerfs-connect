// Where each agent of Live's sessions works (live-data.ts): the Branch it
// writes to and the Workspace it holds, if any. Live keeps a lane drawn from
// every agent to that Branch (live-tab.tsx).
import type { LiveSession } from '@/components/live/live-data'

export interface Binding {
  session: string
  agent: string
  /** Its Workspace's Branch, else the Branch its last call named. */
  branch: string | null
  sandbox: string | null
  path: string | null
}

/** Every session's bindings: one per Workspace an agent holds, and one per agent that holds none. */
export function bindings(sessions: readonly LiveSession[]): Binding[] {
  const out: Binding[] = []
  for (const { run, calls, live } of sessions) {
    // a Workspace an agent holds is where it works
    for (const m of live.mounts) out.push({ session: run.id, agent: m.agent, branch: m.branch, sandbox: m.sandbox, path: m.path })
    // an agent with no Workspace works on the Branch its last call named
    const held = new Set(live.mounts.map((m) => m.agent))
    const agents = new Set([...calls.map((c) => c.agent), ...live.running.map((r) => r.agent)])
    for (const agent of agents) {
      if (held.has(agent)) continue
      const named = calls.findLast((c) => c.agent === agent && c.branch)
      out.push({ session: run.id, agent, branch: named?.branch ?? null, sandbox: null, path: null })
    }
  }
  return out
}
