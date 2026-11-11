import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { execute } from '../cli/spawn.js'
import { discover } from '../cli/capabilities.js'
import { stringify } from '../cli/json.js'
import { validateReport } from './report.js'
import { activityContext, withActivity } from '../activity/context.js'

const targets = new Set(['host', 'machine', 'sandbox', 'store.integrity', 'store.connection', 'backup.connection'])
const invalid = (message) => Object.assign(new Error(message), { status: 400, code: 'InvalidInput' })
/** Dedicated bounded Doctor queue; navigation and reconnect never launch work. */
export class DoctorManager extends EventEmitter {
  constructor({ spec, run = execute, capabilities = discover, maxActive = 2, maxReports = 40, maxBytes = 8 * 1024 * 1024 }) {
    super()
    Object.assign(this, { spec, run, capabilities, maxActive, maxReports, maxBytes })
    this.file = join(spec.state, 'doctor-jobs.json')
    this.jobs = new Map()
    this.active = 0
    this.activityContexts = new WeakMap()
    if (existsSync(this.file)) for (const job of JSON.parse(readFileSync(this.file, 'utf8'))) {
      if (['queued', 'running'].includes(job.state)) Object.assign(job, { state: 'interrupted', error: 'Interrupted — final result unavailable after host restart.', ended: Date.now() })
      this.jobs.set(job.id, job)
    }
    this.persist()
  }
  persist() {
    const completed = () => [...this.jobs.values()].filter(j => !['queued', 'running'].includes(j.state))
    while ((this.jobs.size > this.maxReports || Buffer.byteLength(stringify([...this.jobs.values()])) > this.maxBytes) && completed().length > 1) this.jobs.delete(completed()[0].id)
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, stringify([...this.jobs.values()]), { mode: 0o600 })
    renameSync(temporary, this.file)
  }
  changed(job) {
    this.persist()
    this.emit('event', { type: 'doctor', id: job.id, state: job.state })
  }
  list() { return [...this.jobs.values()].map(({ report, ...job }) => ({ ...job, hasReport: !!report })).reverse() }
  get(id) { const job = this.jobs.get(id); if (!job) throw Object.assign(new Error('Doctor report unavailable or expired.'), { status: 404 }); return job }
  async launch(input) {
    const { target, name, timeout, quick, write_test, key } = input
    if (!targets.has(target) || typeof key !== 'string' || !key || key.length > 128) throw invalid('Choose a supported Doctor target and launch key.')
    if (Object.keys(input).some(k => !['target', 'name', 'timeout', 'quick', 'write_test', 'key'].includes(k))) throw invalid('Unknown Doctor option.')
    if (target !== 'host' && (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(name))) throw invalid('Choose a saved resource name.')
    if (target === 'host' && name !== undefined) throw invalid('Host diagnosis has no resource name.')
    if (quick !== undefined && (target !== 'store.integrity' || typeof quick !== 'boolean')) throw invalid('Quick applies only to Store integrity.')
    if (write_test !== undefined && (target !== 'backup.connection' || typeof write_test !== 'boolean')) throw invalid('Write test applies only to Backup connection.')
    if (timeout !== undefined && !/^[1-9]\d*(ms|s|m|h)$/.test(timeout)) throw invalid('Time budget must be a positive ms/s/m/h duration.')
    const capability = await this.capabilities(this.spec)
    const command = `doctor ${target.replaceAll('.', ' ')}`
    if (!capability.commands.some(c => (typeof c === 'string' ? c : c.name) === command)) throw Object.assign(new Error('Diagnostics unavailable for this CLI/runtime.'), { code: 'Unsupported', status: 409 })
    const previous = [...this.jobs.values()].find(j => j.key === key)
    if (previous) {
      if (JSON.stringify(previous.request) !== JSON.stringify({ target, name, timeout, quick, write_test })) throw invalid('Launch key already belongs to another diagnosis.')
      return previous
    }
    if (target === 'store.integrity' && [...this.jobs.values()].some(j => ['queued', 'running'].includes(j.state) && j.request.target === target && j.request.name === name)) throw Object.assign(new Error('An integrity audit is already queued or running for this Store.'), { status: 409 })
    if ([...this.jobs.values()].filter(j => ['queued', 'running'].includes(j.state)).length >= this.maxReports) throw Object.assign(new Error('Doctor queue is full; wait for an active diagnosis to finish.'), { status: 409 })
    const job = { id: randomUUID(), key, request: { target, name, timeout, quick, write_test }, state: 'queued', created: Date.now(), simulated: false, identity: capability.identity }
    this.jobs.set(job.id, job)
    this.activityContexts.set(job, activityContext())
    this.changed(job)
    void this.drain()
    return job
  }
  async drain() {
    if (this.active >= this.maxActive) return
    const job = [...this.jobs.values()].find(j => j.state === 'queued')
    if (!job) return
    this.active++
    Object.assign(job, { state: 'running', started: Date.now() })
    this.changed(job)
    const request = job.request
    const argv = ['doctor', ...request.target.split('.'), ...(request.name ? [request.name] : []), ...(request.quick ? ['--quick'] : []), ...(request.write_test ? ['--write-test'] : []), ...(request.timeout ? ['--timeout', request.timeout] : [])]
    try {
      job.report = validateReport(await withActivity(this.activityContexts.get(job), () => this.run(this.spec, argv, { read: true, onSpawn: child => { job.pid = child.pid; this.changed(job) } })), request)
      job.state = 'completed'
      if (Buffer.byteLength(stringify(job)) > this.maxBytes / 2) { delete job.report; job.error = 'Report exceeded the retention budget; final report unavailable.' }
    } catch (error) {
      job.state = error.code === 'Unsupported' || error.code === 'CliIncompatible' ? 'unavailable' : error.code === 'InvalidReport' || error.transport === 'transport-unknown' ? 'interrupted' : 'failed'
      job.error = error.message
      job.code = error.code
    } finally {
      job.ended = Date.now()
      this.active--
      this.changed(job)
      void this.drain()
    }
  }
}
