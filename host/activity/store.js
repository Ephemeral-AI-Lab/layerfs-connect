import { appendFile, chmod, mkdir, readdir, readFile, stat, unlink, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { activityGeneration, activityLease, exclusiveActivity } from './gate.js'

const DAY = 86400000
const pattern = /^activity-\d{4}-\d{2}-\d{2}-[\w-]+\.ndjson$/

export class ActivityStore {
  constructor(state, { maxBytes = 100 * 1000 * 1000, fileBytes = 5 * 1000 * 1000, maxAge = 7 * DAY, now = Date.now } = {}) {
    this.state = state
    this.dir = join(state, 'logs', 'cli')
    this.maxBytes = maxBytes; this.fileBytes = fileBytes; this.maxAge = maxAge; this.now = now
    this.writer = `${process.pid}-${randomUUID()}`
    this.sequence = 0; this.size = 0; this.date = ''; this.pending = Promise.resolve(); this.error = null
  }

  append(event, generation = activityGeneration(this.state)) {
    let release
    try { release = activityLease(this.state) } catch (e) {
      if (e.code !== 'ConnectBusy') this.error = 'CLI activity could not be saved. Check the state directory permissions and free disk space.'
      return Promise.resolve()
    }
    this.pending = this.pending.then(async () => {
      if (generation !== activityGeneration(this.state)) return
      if (this.generation !== generation) { this.generation = generation; this.path = null; this.size = 0 }
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      await chmod(this.dir, 0o700)
      const line = `${JSON.stringify({ ...event, generation })}\n`, date = new Date(this.now()).toISOString().slice(0, 10)
      if (!this.path || date !== this.date || this.size + Buffer.byteLength(line) > this.fileBytes) {
        this.date = date; this.size = 0
        this.path = join(this.dir, `activity-${date}-${this.writer}-${++this.sequence}.ndjson`)
      }
      await appendFile(this.path, line, { mode: 0o600 })
      this.size += Buffer.byteLength(line)
      await this.prune()
      this.error = null
    }).catch(() => { this.error = 'CLI activity could not be saved. Check the state directory permissions and free disk space.' }).finally(release)
    return this.pending
  }

  async clear() {
    await this.pending
    const release = exclusiveActivity(this.state)
    let published = false
    try {
      const generation = randomUUID(), control = join(this.state, 'logs', 'cli-control')
      const path = join(control, 'generation.json'), temporary = `${path}.${process.pid}.tmp`
      // Publish the fence first. A crash during deletion cannot make old records readable.
      await writeFile(temporary, JSON.stringify({ generation, clearedAt: Date.now() }), { mode: 0o600 })
      await rename(temporary, path)
      published = true
      for (const file of await this.files()) await unlink(file.path).catch(e => { if (e.code !== 'ENOENT') throw e })
      this.path = null; this.size = 0; this.error = null
      return generation
    } catch (error) {
      error.activityCleared = published
      throw error
    } finally { release() }
  }

  async files() {
    let names
    try { names = await readdir(this.dir) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    return (await Promise.all(names.filter(name => pattern.test(name)).map(async name => {
      const path = join(this.dir, name)
      try { const info = await stat(path); return { path, size: info.size, at: info.mtimeMs } } catch (e) { if (e.code !== 'ENOENT') throw e; return null }
    }))).filter(Boolean).sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
  }

  async prune() {
    const files = await this.files()
    let size = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files) {
      if (file.at >= this.now() - this.maxAge && size <= this.maxBytes) continue
      await unlink(file.path).catch(e => { if (e.code !== 'ENOENT') throw e })
      size -= file.size
      if (file.path === this.path) { this.path = null; this.size = 0 }
    }
  }

  async read({ before = Infinity, limit = 100, actionId, origin = 'all', status = 'all', search = '' } = {}) {
    await this.pending
    let generation
    try { generation = activityGeneration(this.state) } catch (e) {
      if (this.error) return { items: [], next: null, warning: this.error }
      throw e
    }
    const actions = new Map()
    const invocationEvents = new Map()
    let files
    try { files = await this.files() } catch (error) {
      if (this.error) return { items: [], next: null, warning: this.error }
      throw error
    }
    // A bounded archive (100 MB by default); parse one rotated file at a time.
    for (const file of files) {
      if (file.at < this.now() - this.maxAge) continue
      let text
      try { text = await readFile(file.path, 'utf8') } catch (e) { if (e.code === 'ENOENT') continue; throw e }
      for (const line of text.split('\n')) {
        let event
        try { event = JSON.parse(line) } catch { continue } // Includes an interrupted last line.
        if (event.v !== 1 || !event.action?.id || (event.generation ?? 'initial') !== generation) continue
        if (event.invocationId && event.type !== 'cli.shared') {
          if (!invocationEvents.has(event.invocationId)) invocationEvents.set(event.invocationId, [])
          invocationEvents.get(event.invocationId).push(event)
        }
        if (actionId && actionId !== event.action.id) continue
        let action = actions.get(event.action.id)
        if (!action) actions.set(event.action.id, action = { ...event.action, at: event.at, invocations: [], events: [] })
        action.at = Math.min(action.at, event.at)
        action.events.push(event)
      }
    }
    for (const action of actions.values()) {
      const shared = action.events.filter(event => event.type === 'cli.shared')
      for (const event of shared) action.events.push(...(invocationEvents.get(event.invocationId) ?? []))
      action.events.sort((a, b) => a.at - b.at || a.seq - b.seq)
      const calls = new Map()
      for (const event of action.events) {
        if (event.type === 'action.finished') action.request = event.data
        if (!event.invocationId) continue
        let call = calls.get(event.invocationId)
        if (!call) calls.set(event.invocationId, call = { id: event.invocationId, at: event.at, status: 'queued' })
        Object.assign(call, event.data)
        if (event.type === 'cli.shared') call.shared = true
        if (event.type === 'cli.started') call.status = 'running'
        if (event.type === 'cli.finished') call.status = event.data.status
      }
      action.invocations = [...calls.values()]
      for (const call of action.invocations) if (['queued', 'running'].includes(call.status) && call.ownerPid) {
        try { process.kill(call.ownerPid, 0) } catch (e) { if (e.code === 'ESRCH') { call.status = 'interrupted'; call.message = 'The recorder process ended without a final result. Inspect state before another action.' } }
      }
      const statuses = action.invocations.map(call => call.status)
      action.status = statuses.some(s => ['queued', 'running'].includes(s)) ? 'running' : action.request?.error || statuses.some(s => s !== 'success') ? 'failed' : action.invocations.length ? 'success' : 'no-cli'
      // Events are only needed for the action detail endpoint.
      if (!actionId) delete action.events
    }
    const [cursorAt, cursorId] = String(before).split(':')
    const filtered = [...actions.values()].filter(action => (action.at < Number(cursorAt) || action.at === Number(cursorAt) && cursorId && action.id < cursorId) && (origin === 'all' || action.origin === origin) && (status === 'all' || action.status === status) && (!search || JSON.stringify(action).toLowerCase().includes(search.toLowerCase()))).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    const items = filtered.slice(0, Math.min(200, Math.max(1, limit)))
    // A concurrent clear invalidates this snapshot too.
    if (generation !== activityGeneration(this.state)) return this.read({ before, limit, actionId, origin, status, search })
    const control = generation === 'initial' ? null : JSON.parse(await readFile(join(this.state, 'logs', 'cli-control', 'generation.json'), 'utf8'))
    return { items, next: filtered.length > items.length ? `${items.at(-1).at}:${items.at(-1).id}` : null, warning: this.error, cleared: generation !== 'initial', clearedAt: control?.clearedAt ?? null }
  }
}
