import { appendFile, chmod, mkdir, readdir, readFile, stat, unlink, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { activityGeneration, activityLease, exclusiveActivity } from './gate.js'
import { ActivityIndex } from './index.js'
import { readdirSync, statSync } from 'node:fs'
import { protectedActivity } from './context.js'

const DAY = 86400000
const pattern = /^activity-\d{4}-\d{2}-\d{2}-[\w-]+\.ndjson$/

export class ActivityStore {
  constructor(state, { maxBytes = 100 * 1000 * 1000, protectedBytes = 1000 * 1000 * 1000, maxPendingBytes = 8 * 1000 * 1000, fileBytes = 5 * 1000 * 1000, maxAge = 7 * DAY, now = Date.now } = {}) {
    this.state = state
    this.dir = join(state, 'logs', 'cli')
    this.maxBytes = maxBytes; this.fileBytes = fileBytes; this.maxAge = maxAge; this.now = now
    this.writer = `${process.pid}-${randomUUID()}`
    this.sequence = 0; this.size = 0; this.date = ''; this.pending = Promise.resolve(); this.error = null
    this.protectedBytes = protectedBytes; this.maxPendingBytes = maxPendingBytes; this.pendingBytes = 0; this.protectedWritten = 0
    this.index = new ActivityIndex(this)
    this.reservations = new Map(); this.reservedBytes = 0; this.budgetLoaded = false
    this.memoryReservedBytes = 0; this.terminalBytes = 512 * 1024; this.waiters = []; this.queue = []; this.batchBytes = 256 * 1024; this.writeBatches = 0
    this.metrics = { peakPendingBytes: 0, peakBufferedBytes: 0, peakReservedBytes: 0, recordsWritten: 0, writableWaits: 0, terminalDrops: 0, skippedProgress: 0 }
  }
  measure() {
    this.metrics.peakPendingBytes = Math.max(this.metrics.peakPendingBytes, this.pendingBytes)
    this.metrics.peakReservedBytes = Math.max(this.metrics.peakReservedBytes, this.memoryReservedBytes)
    this.metrics.peakBufferedBytes = Math.max(this.metrics.peakBufferedBytes, this.pendingBytes + this.memoryReservedBytes)
  }
  diagnostics() { return { ...this.metrics, batches: this.writeBatches, capacityBytes: this.maxPendingBytes, pendingBytes: this.pendingBytes, reservedBytes: this.memoryReservedBytes, reservations: this.reservations.size, waiting: this.waiters.length } }

  loadBudget() {
    if (this.budgetLoaded) return
    try { this.protectedWritten = readdirSync(this.dir).filter(name => /-protected-\d+\.ndjson$/.test(name)).reduce((sum, name) => sum + statSync(join(this.dir, name)).size, 0); this.budgetLoaded = true }
    catch (error) { if (error.code === 'ENOENT') this.budgetLoaded = true }
  }
  reserveInvocation(id, { protectedAction = false, control = false } = {}) {
    if (this.reservations.has(id)) return Promise.resolve()
    if (this.terminalBytes + (control ? 0 : this.terminalBytes) > this.maxPendingBytes) return Promise.reject(Object.assign(new Error('CLI activity queue is too small for a bounded terminal record and cancellation headroom.'), { code: 'ActivityCapacity' }))
    this.loadBudget()
    if (this.waiters.length >= 128) return Promise.reject(Object.assign(new Error('CLI activity admission is busy. Wait for active commands to finish.'), { code: 'ActivityBackpressure' }))
    return new Promise((resolve, reject) => {
      const waiter = { id, protectedAction, control, resolve, reject }
      if (control) this.waiters.unshift(waiter); else this.waiters.push(waiter)
      this.wakeAdmissions()
      if (this.waiters.includes(waiter)) this.metrics.writableWaits++
    })
  }
  wakeAdmissions() {
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index]
      if (this.error) {
        this.waiters.splice(index, 1)
        if (waiter.protectedAction) waiter.reject(Object.assign(new Error(this.error), { code: 'ActivityUnavailable' })); else waiter.resolve()
        continue
      }
      const memoryLimit = waiter.control ? this.maxPendingBytes : this.maxPendingBytes - this.terminalBytes
      const memory = this.pendingBytes + this.memoryReservedBytes + this.terminalBytes <= memoryLimit
      const disk = !waiter.protectedAction || this.protectedWritten + this.pendingBytes + this.reservedBytes + this.terminalBytes <= this.protectedBytes
      if (!disk && !this.reservations.size && !this.pendingBytes) {
        this.waiters.splice(index, 1)
        this.error = 'CLI activity protected archive capacity reached. Export and reset activity before continuing; existing output is preserved.'
        waiter.reject(Object.assign(new Error(this.error), { code: 'ActivityCapacity' }))
        continue
      }
      if (!memory || !disk) { index++; continue }
      this.waiters.splice(index, 1)
      this.reservations.set(waiter.id, { memory: this.terminalBytes, disk: waiter.protectedAction ? this.terminalBytes : 0 })
      this.memoryReservedBytes += this.terminalBytes
      this.measure()
      if (waiter.protectedAction) this.reservedBytes += this.terminalBytes
      waiter.resolve()
    }
  }
  releaseReservation(id) {
    const reservation = this.reservations.get(id)
    if (!reservation) return
    this.memoryReservedBytes -= reservation.memory; this.reservedBytes -= reservation.disk
    this.reservations.delete(id)
  }
  append(event, generation = activityGeneration(this.state)) {
    if (generation !== activityGeneration(this.state)) return Promise.resolve()
    if (this.generation !== generation) {
      this.generation = generation; this.path = null; this.size = 0; this.budgetLoaded = false; this.protectedWritten = 0; this.directoryReady = false
    }
    const line = `${JSON.stringify({ ...event, generation })}\n`, bytes = Buffer.byteLength(line)
    const protectedAction = protectedActivity(event.action?.name)
    this.loadBudget()
    const reservation = this.reservations.get(event.invocationId)
    const terminal = ['cli.started', 'cli.finished'].includes(event.type) && reservation
    const creditedMemory = terminal ? Math.min(bytes, reservation.memory) : 0
    const creditedDisk = terminal ? Math.min(bytes, reservation.disk) : 0
    if (this.pendingBytes + this.memoryReservedBytes + bytes - creditedMemory > this.maxPendingBytes) {
      // Never spend an admitted invocation's terminal room on new work or progress.
      if (event.type === 'cli.progress') { this.metrics.skippedProgress++; return Promise.resolve() }
      if (terminal) this.metrics.terminalDrops++
      const error = Object.assign(new Error('CLI activity is applying backpressure. Wait for queued records to be saved.'), { code: 'ActivityBackpressure' })
      if (event.type === 'cli.queued' && protectedAction) throw error
      this.error = error.message
      return Promise.resolve()
    }
    if (protectedAction && this.protectedWritten + this.pendingBytes + this.reservedBytes + bytes - creditedDisk > this.protectedBytes) {
      this.error = 'CLI activity protected archive capacity reached. Export and reset activity before continuing; existing output is preserved.'
      if (event.type === 'cli.queued') throw Object.assign(new Error(this.error), { code: 'ActivityCapacity' })
      return Promise.resolve()
    }
    if (!this.writerLease) {
      try { this.writerLease = activityLease(this.state) } catch (error) {
        if (error.code !== 'ConnectBusy') this.error = 'CLI activity could not be saved. Check the state directory permissions and free disk space.'
        return Promise.resolve()
      }
    }
    if (terminal) {
      reservation.memory -= creditedMemory; this.memoryReservedBytes -= creditedMemory
      reservation.disk -= creditedDisk; this.reservedBytes -= creditedDisk
    }
    this.pendingBytes += bytes
    this.measure()
    const persisted = new Promise(resolve => this.queue.push({ line, bytes, event, generation, protectedAction, resolve }))
    if (!this.draining) {
      this.draining = true
      this.pending = new Promise(resolve => { this.resolveDrain = resolve })
      setImmediate(() => void this.drain())
    }
    return persisted
  }
  async drain() {
    let writing = []
    try {
      while (this.queue.length) {
        const first = this.queue[0], date = new Date(this.now()).toISOString().slice(0, 10)
        if (!this.directoryReady) {
          await mkdir(this.dir, { recursive: true, mode: 0o700 }); await chmod(this.dir, 0o700); this.directoryReady = true
        }
        let rotated = false
        if (!this.path || date !== this.date || this.size + first.bytes > this.fileBytes || this.protectedFile !== first.protectedAction) {
          rotated = true
          this.protectedWritten = (await this.files()).filter(file => file.protected).reduce((sum, file) => sum + file.size, 0)
          this.date = date; this.size = 0; this.protectedFile = first.protectedAction
          this.path = join(this.dir, `activity-${date}-${this.writer}-${first.protectedAction ? 'protected-' : ''}${++this.sequence}.ndjson`)
        }
        const batch = []; let bytes = 0
        while (this.queue.length) {
          const next = this.queue[0]
          if (next.protectedAction !== first.protectedAction || next.generation !== first.generation || batch.length && (bytes + next.bytes > this.batchBytes || this.size + bytes + next.bytes > this.fileBytes)) break
          batch.push(this.queue.shift()); bytes += next.bytes
          if (bytes >= this.batchBytes) break
        }
        writing = batch
        if (first.generation === activityGeneration(this.state)) {
          await appendFile(this.path, batch.map(item => item.line).join(''), { mode: 0o600 })
          this.writeBatches++
          this.metrics.recordsWritten += batch.length
          this.size += bytes
          if (first.protectedAction) this.protectedWritten += bytes
          if (rotated) await this.prune()
        }
        for (const item of batch) {
          this.pendingBytes -= item.bytes
          if (item.event.type === 'cli.finished') this.releaseReservation(item.event.invocationId)
          item.resolve()
        }
        writing = []
        this.wakeAdmissions()
      }
    } catch {
      this.error = 'CLI activity could not be saved. Check the state directory permissions and free disk space.'
      for (const item of [...writing, ...this.queue.splice(0)]) { this.pendingBytes -= item.bytes; if (item.event.type === 'cli.finished') this.releaseReservation(item.event.invocationId); item.resolve() }
      this.wakeAdmissions()
    } finally {
      this.draining = false
      this.writerLease?.(); this.writerLease = null
      this.resolveDrain?.(); this.resolveDrain = null
    }
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
      this.path = null; this.size = 0; this.error = null; this.protectedWritten = 0; this.reservations.clear(); this.reservedBytes = 0; this.memoryReservedBytes = 0; this.budgetLoaded = false; this.directoryReady = false; this.index.reset()
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
      try { const info = await stat(path); return { path, size: info.size, at: info.mtimeMs, protected: /-protected-\d+\.ndjson$/.test(name) } } catch (e) { if (e.code !== 'ENOENT') throw e; return null }
    }))).filter(Boolean).sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
  }

  async prune() {
    const files = await this.files()
    let size = files.filter(file => !file.protected).reduce((sum, file) => sum + file.size, 0)
    for (const file of files) {
      if (file.protected) continue
      if (file.at >= this.now() - this.maxAge && size <= this.maxBytes) continue
      await unlink(file.path).catch(e => { if (e.code !== 'ENOENT') throw e })
      size -= file.size
      if (file.path === this.path) { this.path = null; this.size = 0 }
    }
  }

  async syncIndex() { await this.pending; await this.index.refresh() }
  async summaries({ before = Infinity, limit = 100, actionId, origin = 'all', status = 'all', search = '' } = {}) {
    try { await this.syncIndex() } catch (error) { this.error ??= error.message; return { items: [], next: null, warning: this.error } }
    const [at, id] = String(before).split(':')
    const actions = [...this.index.actions.values()].filter(action => !actionId || action.id === actionId).map(action => this.index.summary(action))
      .filter(action => (action.at < Number(at) || action.at === Number(at) && id && action.id < id) && (origin === 'all' || action.origin === origin) && (status === 'all' || action.status === status) && (!search || `${action.label} ${action.target ?? ''} ${action.projects.join(' ')}`.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
    const items = actions.slice(0, Math.min(100, Math.max(1, limit)))
    return { items, next: actions.length > items.length ? `${items.at(-1).at}:${items.at(-1).id}` : null, warning: this.error, cleared: this.index.generation !== 'initial', ...await this.clearedState() }
  }
  async clearedState() {
    try { return { clearedAt: JSON.parse(await readFile(join(this.state, 'logs', 'cli-control', 'generation.json'), 'utf8')).clearedAt ?? null } }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { clearedAt: null } }
  }
  async invocationPage(actionId, { after, limit = 100, project } = {}) {
    await this.syncIndex()
    const action = this.index.actions.get(actionId)
    const calls = action ? [...action.ids].map(id => this.index.calls.get(id)).filter(call => call && (!project || call.project === project)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)) : []
    const offset = after ? Math.max(0, calls.findIndex(call => `${call.at}:${call.id}` === after) + 1) : 0
    const items = calls.slice(offset, offset + Math.min(100, Math.max(1, Number(limit) || 100))).map(call => this.index.metadata(call, action))
    return { items, total: calls.length, next: offset + items.length < calls.length && items.length ? `${items.at(-1).at}:${items.at(-1).id}` : null, warning: this.error }
  }
  async invocation(actionId, id) { await this.syncIndex(); return this.index.detail(actionId, id) }
  async capture(actionId, { expectedIds, expectedInputIds = [] } = {}) {
    await this.syncIndex()
    const action = this.index.actions.get(actionId), ids = action ? [...action.ids] : [], expected = expectedIds ?? ids
    const wanted = new Set(expected), missingIds = [], unexpectedIds = ids.filter(id => !wanted.has(id))
    let queued = 0, started = 0, finished = 0, outputCaptured = 0, incomplete = 0, failedCount = 0, truncatedCount = 0, expectedTruncated = 0
    const expectedInputMissing = expectedInputIds.filter(id => !action?.ids.has(id) || !this.index.calls.get(id)?.inputCaptured)
    for (const id of ids) { const call = this.index.calls.get(id); if (!call) continue; if (call.status !== 'success') failedCount++; if (call.inputTruncated || call.outputTruncated) truncatedCount++ }
    for (const id of wanted) {
      const call = this.index.calls.get(id)
      if (!action?.ids.has(id) || !call) { missingIds.push(id); continue }
      if (call.stages['cli.queued']) queued++
      if (call.stages['cli.started']) started++
      if (call.stages['cli.finished']) finished++
      if (call.stdoutCaptured && call.stderrCaptured) outputCaptured++
      if (call.inputTruncated || call.outputTruncated) expectedTruncated++
      if (!call.stages['cli.queued'] || !call.stages['cli.started'] || !call.stages['cli.finished'] || !call.stdoutCaptured || !call.stderrCaptured) incomplete++
    }
    return { complete: !this.error && !!wanted.size && expected.length === wanted.size && !missingIds.length && !incomplete && !expectedInputMissing.length, expected: expected.length, count: ids.length, queued, started, finished, outputCaptured, failedCount, truncatedCount, expectedTruncated, expectedInputMissing: expectedInputMissing.slice(0, 100), expectedInputMissingCount: expectedInputMissing.length, missingIds: missingIds.slice(0, 100), missingCount: missingIds.length, unexpectedIds: unexpectedIds.slice(0, 100), unexpectedCount: unexpectedIds.length, incomplete, warning: this.error }
  }

  async read({ before = Infinity, limit = 100, actionId, origin = 'all', status = 'all', search = '' } = {}) {
    await this.pending
    // Native machine-stage observers use this legacy detail API. Locate their
    // small action first instead of retaining every large preset stream in RAM.
    if (actionId && origin === 'all' && status === 'all' && !search && before === Infinity) {
      try {
        await this.syncIndex()
        const action = this.index.actions.get(actionId)
        if (!action || action.ids.size <= 1000) {
          const items = []
          if (action) {
            const value = this.index.summary(action), files = new Set(action.files), events = []
            for (const id of action.ids) for (const ref of Object.values(this.index.calls.get(id)?.refs ?? {})) files.add(ref.path)
            for (const path of files) {
              let content
              try { content = await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') continue; throw error }
              for (const line of content.split('\n')) {
                try { const event = JSON.parse(line); if ((event.generation ?? 'initial') === this.index.generation && (event.action?.id === actionId || action.ids.has(event.invocationId) && event.type !== 'cli.shared')) events.push(event) } catch { /* Interrupted final line. */ }
              }
            }
            value.events = events.sort((a, b) => a.at - b.at || a.seq - b.seq)
            value.invocations = []
            for (const id of action.ids) value.invocations.push(await this.index.detail(actionId, id))
            items.push(value)
          }
          return { items, next: null, warning: this.error, cleared: this.index.generation !== 'initial', ...await this.clearedState() }
        }
      } catch { /* Preserve the established diagnostic/error behavior below. */ }
    }
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
      if (!file.protected && file.at < this.now() - this.maxAge) continue
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
