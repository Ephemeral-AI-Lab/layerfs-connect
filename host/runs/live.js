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
  const ws = str(line.ws ?? args.ws)
  const at = ws?.indexOf(':') ?? -1
  return {
    ws,
    sandbox: str(line.sandbox ?? args.sandbox) ?? (at > 0 ? ws.slice(0, at) : null),
    path: str(line.path ?? args.path) ?? (at > 0 ? ws.slice(at + 1) : null),
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

  mount(place) {
    return this.mounts.get(place.ws ?? `${place.sandbox}:${place.path}`)
      ?? [...this.mounts.values()].find(m => m.sandbox === place.sandbox && m.path === place.path)
  }

  used(mount, agent) {
    if (mount && !mount.users.includes(agent)) mount.users.push(agent)
  }

  started(line, agent) {
    const place = where(line), mount = this.mount(place)
    const { sandbox, path, ws } = place
    const branch = place.branch ?? mount?.branch
    this.used(mount, agent)
    this.running.set(`${agent}:${line.id}`, {
      id: String(line.id),
      agent,
      method: line.method,
      sandbox,
      path,
      ws,
      branch,
      command: clip(line.args?.command),
      start: Date.parse(line.start) || Date.now(),
    })
  }

  ended(line, agent) {
    this.running.delete(`${agent}:${line.id}`)
    const at = (Date.parse(line.start) || Date.now()) + (typeof line.ms === 'number' ? Math.round(line.ms) : 0)
    const place = where(line), mount = this.mount(place)
    const { sandbox, path, ws } = place, branch = place.branch ?? mount?.branch
    if (!this.last.has(agent) || this.last.get(agent).at <= at) this.last.set(agent, { method: line.method, ok: line.ok !== false, code: line.code ?? null, at, sandbox, path, ws, branch })
    if (line.ok === false) return
    // Another file may deliver an older completion after a fresh named mount.
    if (mount && mount.since > at) return
    switch (line.method) {
      case 'sandbox.create':
        if (sandbox) this.sandboxes.set(sandbox, { id: sandbox, agent, at })
        break
      case 'sandbox.close':
        for (const [key, m] of this.mounts) if (m.sandbox === sandbox) this.mounts.delete(key)
        this.sandboxes.delete(sandbox)
        break
      case 'workspace.mount':
        if (sandbox && path) this.mounts.set(ws ?? `${sandbox}:${path}`, { sandbox, path, ws, branch, agent, users: [agent], since: at, commits: 0, last: null })
        break
      case 'workspace.unmount':
        for (const [key, value] of this.mounts) if (value === mount) this.mounts.delete(key)
        break
      case 'workspace.exec': {
        const m = mount
        this.used(m, agent)
        if (m) m.last = { command: clip(line.args?.command), kind: line.kind ?? null, at }
        break
      }
      case 'workspace.commit': {
        const m = mount
        this.used(m, agent)
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
      mounts: [...this.mounts.values()].map((m) => ({ ...m, users: [...m.users], last: m.last && { ...m.last } })),
      sandboxes: [...this.sandboxes.values()],
      last: Object.fromEntries(this.last),
    }
  }

  static from(saved) {
    const live = new LiveState()
    for (const m of saved?.mounts ?? []) live.mounts.set(m.ws ?? `${m.sandbox}:${m.path}`, { ...m, users: m.users ? [...m.users] : [m.agent] })
    for (const s of saved?.sandboxes ?? []) live.sandboxes.set(s.id, { ...s })
    return live
  }
}
