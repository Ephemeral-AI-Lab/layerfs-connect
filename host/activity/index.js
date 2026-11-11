import { open } from 'node:fs/promises'
import { activityGeneration } from './gate.js'

// Keep small command metadata and disk locations, never stdin/stdout/stderr.
// Each refresh reads only new complete lines, including independent writers.
export class ActivityIndex {
  constructor(store) { this.store = store; this.reset(); this.pending = Promise.resolve() }
  reset() { this.files = new Map(); this.actions = new Map(); this.calls = new Map(); this.generation = null; this.parsed = 0; this.sandboxProjects = new Map(); this.unassigned = new Set() }
  refresh() {
    const work = this.pending.then(() => this.update())
    this.pending = work.catch(() => {})
    return work
  }
  async update() {
    const generation = activityGeneration(this.store.state)
    const files = await this.store.files(), current = new Map(files.map(file => [file.path, file]))
    if (this.generation !== generation || [...this.files].some(([path, offset]) => !current.has(path) || current.get(path).size < offset)) { this.reset(); this.generation = generation }
    for (const file of files) {
      if (!file.protected && file.at < this.store.now() - this.store.maxAge) continue
      let offset = this.files.get(file.path) ?? 0
      if (offset >= file.size) continue
      let handle
      try {
        handle = await open(file.path, 'r')
        let pending = Buffer.alloc(0), position = offset
        const buffer = Buffer.alloc(128 * 1024)
        while (position < file.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, file.size - position), position)
          if (!bytesRead) break
          position += bytesRead; pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)])
          let end
          while ((end = pending.indexOf(10)) >= 0) {
            const length = end + 1, location = { path: file.path, offset, length }
            try {
              const event = JSON.parse(pending.subarray(0, end).toString('utf8'))
              if (event.v === 1 && event.action?.id && (event.generation ?? 'initial') === generation) { this.apply(event, location); this.parsed++ }
            } catch (error) { if (error.code === 'ActivityIndexLimit') throw error }
            offset += length; pending = pending.subarray(length)
          }
          if (pending.length > 2 * 1024 * 1024) throw new Error('CLI activity contains an oversized event. Inspect its archive before continuing.')
        }
        this.files.set(file.path, offset)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      finally { await handle?.close() }
    }
    // Other writer shards can contain workspace records before the successful
    // sandbox-create record. Resolve from metadata only after every shard.
    for (const id of this.unassigned) {
      const call = this.calls.get(id), project = this.sandboxProjects.get(call.actionId)?.get(call.sandbox)
      if (project) { call.project = project; this.unassigned.delete(id) }
    }
    if (activityGeneration(this.store.state) !== generation) return this.update()
  }
  apply(event, location) {
    let action = this.actions.get(event.action.id)
    if (!action) {
      if (this.actions.size >= 100000) throw Object.assign(new Error('CLI activity action index reached its limit. Export and clear history before continuing.'), { code: 'ActivityIndexLimit' })
      this.actions.set(event.action.id, action = { ...event.action, at: event.at, ids: new Set(), files: new Set() })
    }
    action.files.add(location.path)
    action.at = Math.min(action.at, event.at)
    if (event.type === 'action.finished') action.request = event.data
    if (!event.invocationId) return
    action.ids.add(event.invocationId)
    let call = this.calls.get(event.invocationId)
    if (!call) {
      if (this.calls.size >= 250000) throw Object.assign(new Error('CLI activity command index reached its limit. Export and clear history before continuing.'), { code: 'ActivityIndexLimit' })
      this.calls.set(event.invocationId, call = { id: event.invocationId, actionId: event.action.id, at: event.at, status: 'queued', refs: {}, stages: {} })
    }
    if (event.type === 'cli.shared') { action.shared ??= new Set(); action.shared.add(call.id); return }
    call.refs[event.type] = location
    const { stdin, stdout, stderr, ...metadata } = event.data ?? {}
    Object.assign(call, metadata)
    call.at = Math.min(call.at, event.at)
    call.stages[event.type] = true
    if (stdin !== undefined) call.inputCaptured = stdin !== null
    if (stdin) call.inputTruncated = !!stdin.truncated
    if (stdout !== undefined) call.stdoutCaptured = !!stdout
    if (stderr !== undefined) call.stderrCaptured = !!stderr
    if (stdout || stderr) call.outputTruncated = !!stdout?.truncated || !!stderr?.truncated
    if (event.type === 'cli.started') call.status = 'running'
    if (event.type === 'cli.finished') call.status = event.data.status
    const [family, operation, target, name] = call.argv ?? []
    const directProject = ['project', 'branch', 'commit', 'file'].includes(family) || family === 'sandbox' && operation === 'create'
    if (directProject && typeof target === 'string' && /^[^/\s]+\/[^/\s]+$/.test(target) && !target.startsWith('--')) call.project = target
    if (family === 'sandbox' && operation === 'create' && call.status === 'success' && call.project && name) {
      let projects = this.sandboxProjects.get(call.actionId)
      if (!projects) this.sandboxProjects.set(call.actionId, projects = new Map())
      projects.set(name, call.project)
    } else if (family === 'workspace' || family === 'sandbox' && operation !== 'create') {
      call.sandbox = target?.split(':')[0]
      if (call.sandbox) {
        const project = this.sandboxProjects.get(call.actionId)?.get(call.sandbox)
        if (project) call.project = project
        else this.unassigned.add(call.id)
      }
    }
  }
  metadata(call, action) {
    const { refs, stages, actionId, ...value } = call
    if (action?.shared?.has(call.id)) value.shared = true
    if (['queued', 'running'].includes(value.status) && value.ownerPid) {
      try { process.kill(value.ownerPid, 0) } catch (error) { if (error.code === 'ESRCH') { value.status = 'interrupted'; value.message = 'The recorder process ended without a final result. Inspect state before another action.' } }
    }
    return value
  }
  summary(action) {
    const { ids, shared, files, ...value } = action, statuses = new Set(), projects = new Set()
    for (const id of ids) { const call = this.calls.get(id); if (!call) continue; const meta = this.metadata(call, action); statuses.add(meta.status); if (meta.project) projects.add(meta.project) }
    value.status = ['queued', 'running'].some(status => statuses.has(status)) ? 'running' : action.request?.error || [...statuses].some(status => status !== 'success') ? 'failed' : ids.size ? 'success' : 'no-cli'
    return { ...value, invocationCount: ids.size, projects: [...projects].sort(), invocations: [] }
  }
  async detail(actionId, id) {
    const action = this.actions.get(actionId), call = this.calls.get(id)
    if (!action?.ids.has(id) || !call) return null
    const value = this.metadata(call, action)
    for (const type of ['cli.queued', 'cli.started', 'cli.progress', 'cli.finished']) {
      const ref = call.refs[type]
      if (!ref) continue
      const handle = await open(ref.path, 'r')
      try { const buffer = Buffer.alloc(ref.length); await handle.read(buffer, 0, buffer.length, ref.offset); Object.assign(value, JSON.parse(buffer.toString('utf8')).data) }
      finally { await handle.close() }
    }
    // Process ownership checks must win over an old queued/started status.
    const status = this.metadata(call, action); value.status = status.status
    if (status.message) value.message = status.message
    return value
  }
}
