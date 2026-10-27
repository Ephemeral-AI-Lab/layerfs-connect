// What a run's agents hold in LayerFS right now, from their trace lines: the
// calls still running, the Sandboxes they made and the Workspaces they have
// mounted (with the last command run in each). The live view draws agents to
// the project and to these Workspaces. Nothing here asks LayerFS: a
// Workspace an agent mounted belongs to it until its unmount (or its
// Sandbox's close) shows in the trace.

const COMMAND = 240
const clip = (s) => (typeof s === 'string' ? (s.length > COMMAND ? `${s.slice(0, COMMAND - 1)}…` : s) : null)
const str = (v) => (v === undefined || v === null ? null : String(v))

/** One trace line's Sandbox, path and Branch, from its answer or its arguments. */
function where(line) {
  const args = line.args ?? {}
  return {
    sandbox: str(line.sandbox ?? args.sandbox),
    path: str(line.path ?? args.path),
    branch: str(typeof line.branch === 'string' ? line.branch : (args.branch ?? null)),
  }
}

export class LiveState {
  constructor() {
    /** call id -> RunningCall */
    this.running = new Map()
    /** "<sandbox>:<path>" -> LiveMount */
    this.mounts = new Map()
    /** sandbox id -> { id, agent, at } */
    this.sandboxes = new Map()
    /** agent -> its last finished call */
    this.last = new Map()
  }

  started(line, agent) {
    const { sandbox, path, branch } = where(line)
    this.running.set(String(line.id), {
      id: String(line.id),
      agent,
      method: line.method,
      sandbox,
      path,
      branch,
      command: clip(line.args?.command),
      start: Date.parse(line.start) || Date.now(),
    })
  }

  ended(line, agent) {
    this.running.delete(String(line.id))
    const at = (Date.parse(line.start) || Date.now()) + (typeof line.ms === 'number' ? Math.round(line.ms) : 0)
    const { sandbox, path, branch } = where(line)
    this.last.set(agent, { method: line.method, ok: line.ok !== false, code: line.code ?? null, at })
    if (line.ok === false) return
    switch (line.method) {
      case 'sandbox.create':
        if (sandbox) this.sandboxes.set(sandbox, { id: sandbox, agent, at })
        break
      case 'sandbox.close':
        for (const [key, m] of this.mounts) if (m.sandbox === sandbox) this.mounts.delete(key)
        this.sandboxes.delete(sandbox)
        break
      case 'workspace.mount':
        if (sandbox && path) this.mounts.set(`${sandbox}:${path}`, { sandbox, path, branch, agent, since: at, commits: 0, last: null })
        break
      case 'workspace.unmount':
        this.mounts.delete(`${sandbox}:${path}`)
        break
      case 'workspace.exec': {
        const m = this.mounts.get(`${sandbox}:${path}`)
        if (m) m.last = { command: clip(line.args?.command), kind: line.kind ?? null, at }
        break
      }
      case 'workspace.commit': {
        const m = this.mounts.get(`${sandbox}:${path}`)
        if (m) m.commits++
        break
      }
    }
  }

  /** The run ended: whatever was running was stopped with it. */
  stopped() {
    this.running.clear()
  }

  view() {
    return {
      running: [...this.running.values()],
      mounts: [...this.mounts.values()].map((m) => ({ ...m, last: m.last && { ...m.last } })),
      sandboxes: [...this.sandboxes.values()],
      last: Object.fromEntries(this.last),
    }
  }

  static from(saved) {
    const live = new LiveState()
    for (const m of saved?.mounts ?? []) live.mounts.set(`${m.sandbox}:${m.path}`, { ...m })
    for (const s of saved?.sandboxes ?? []) live.sandboxes.set(s.id, { ...s })
    return live
  }
}
