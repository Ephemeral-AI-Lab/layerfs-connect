// The scenario engine (host/README.md, "The engine"):
//   const runs = new RunManager({ spec, scenarios: '<connect>/scenarios' })
//   runs.demos() · runs.demo(id) · await runs.start(id) · runs.runs(demo?)
//   runs.run(id) · runs.stop(id) · runs.on('event', …) · await runs.close()
// Scenarios load with tools/lib/scenario.mjs (dsh-layerfs's checks, renamed)
// and reload when their scenario.json changes; one that does not load is left
// out and reported by loadErrors(). Runs live in <spec.runs>/<runId>/; their
// run.json records survive a host restart, and a run still playing at a
// restart reads as failed (interrupted). At most two runs play at once.
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScenario } from '../../tools/lib/scenario.mjs'
import { missing, openRuntime } from '../config.js'
import { Run } from './run.js'
import { demoViews } from './views.js'

export { LIMIT_MS } from './run.js'
export const MAX_PLAYING = 2
const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const ACTIVE = new Set(['starting', 'running'])
const SUMMARY = ['id', 'demo', 'project', 'state', 'started', 'ended', 'error', 'done', 'of', 'phase']

const refuse = (code, status, message) => Object.assign(new Error(message), { code, status })

/** A module of another builder's, or null while it is not there. */
async function optional(path) {
  try {
    return await import(path)
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes(path.replace(/^\.\.?\//, ''))) return null
    throw error
  }
}

export class RunManager extends EventEmitter {
  constructor({ spec, scenarios = SCENARIOS }) {
    super()
    this.spec = spec
    this.dir = scenarios
    /** scenario id -> { mtime, demo?, views?, error? } */
    this.cache = new Map()
    /** run id -> Run (this process) or its run.json record (earlier ones) */
    this.live = new Map()
    this.records = new Map()
    this.starting = 0
    this.loadRecords()
  }

  // ---------- demos ----------

  load() {
    const found = new Set()
    if (existsSync(this.dir)) {
      for (const id of readdirSync(this.dir).sort()) {
        const file = join(this.dir, id, 'scenario.json')
        if (!existsSync(file)) continue
        found.add(id)
        const mtime = statSync(file).mtimeMs
        if (this.cache.get(id)?.mtime === mtime) continue
        const folder = join(this.dir, id)
        try {
          const raw = JSON.parse(readFileSync(file, 'utf8'))
          const scenario = compileScenario(raw, { name: id, folder, where: file })
          const demo = { id, folder, scenario, raw }
          this.cache.set(id, { mtime, demo, views: demoViews(demo) })
        } catch (error) {
          this.cache.set(id, { mtime, error: error.message })
          process.stderr.write(`connect: scenario ${id} does not load: ${error.message}\n`)
        }
      }
    }
    for (const id of this.cache.keys()) if (!found.has(id)) this.cache.delete(id)
    return [...this.cache.values()].filter((c) => c.demo).sort((a, b) => a.views.summary.order - b.views.summary.order || a.demo.id.localeCompare(b.demo.id))
  }

  loadErrors() {
    this.load()
    return Object.fromEntries([...this.cache].filter(([, c]) => c.error).map(([id, c]) => [id, c.error]))
  }

  withRuns(summary) {
    const runs = this.runs(summary.id)
    return { ...summary, latest: runs[0] ?? null, runs: runs.length }
  }

  demos() {
    return this.load().map((c) => this.withRuns(c.views.summary))
  }

  demo(id) {
    const c = this.load().find((x) => x.demo.id === id)
    return c ? { ...this.withRuns(c.views.summary), script: c.views.script } : null
  }

  // ---------- runs ----------

  loadRecords() {
    if (!existsSync(this.spec.runs)) return
    for (const id of readdirSync(this.spec.runs)) {
      const file = join(this.spec.runs, id, 'run.json')
      if (!existsSync(file)) continue
      let record
      try {
        record = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        continue
      }
      // another host on the same state (a second app window) still plays it: leave it alone
      if (ACTIVE.has(record.state) && hostAlive(record.host)) {
        this.records.set(record.id ?? id, record)
        continue
      }
      if (ACTIVE.has(record.state)) {
        const ended = record.ended ?? Date.now()
        Object.assign(record, { state: 'failed', error: 'interrupted: the host stopped while it played', ended })
        for (const step of record.steps ?? []) if (step.state === 'running') Object.assign(step, { state: 'stopped', ended })
        for (const agent of record.agents ?? []) if (['running', 'idle', 'waiting'].includes(agent.state)) agent.state = 'stopped'
        writeFileSync(`${file}.tmp`, JSON.stringify(record))
        renameSync(`${file}.tmp`, file)
      }
      this.records.set(record.id ?? id, record)
    }
  }

  playing() {
    return [...this.live.values()].filter((r) => ACTIVE.has(r.state)).length + this.starting
  }

  /** Starts a run of demo `id`: Inits a fresh project `<id>-<n>` from its fixture, then plays it. */
  async start(id) {
    const c = this.load().find((x) => x.demo.id === id)
    if (!c) throw refuse('NotFound', 404, `no demo named ${id}`)
    const gaps = missing(this.spec)
    if (gaps.length) throw refuse('NotConfigured', 409, `LayerFS is not configured: set ${gaps.join(' and ')} in Settings`)
    if (this.playing() >= MAX_PLAYING) throw refuse('Busy', 409, `${MAX_PLAYING} runs are playing; stop one or wait for one to end`)
    this.starting++
    let run
    try {
      if (c.demo.scenario.seed && !(await optional('../seed.js'))) throw refuse('NotReady', 409, `${id} is a seed demo, and host/seed.js is not there yet`)
      const runtime = await openRuntime(this.spec)
      const taken = new Set((await runtime.project.list()).map((p) => p.name))
      for (const r of this.allRuns()) taken.add(r.project)
      let n = 1
      while (taken.has(`${id}-${n}`)) n++
      const started = Date.now()
      const record = { id: `${id}-${started.toString(36)}`, demo: id, project: `${id}-${n}`, state: 'starting', started }
      run = new Run({
        spec: this.spec,
        demo: c.demo,
        record,
        emit: (event) => this.emit('event', event),
        loadSeed: () => optional('../seed.js'),
        loadChecks: () => optional('../checks/index.js'),
      })
      this.live.set(run.id, run)
    } finally {
      this.starting--
    }
    run.changed(true)
    run.play().catch((error) => run.fail(error.message))
    return run.summary()
  }

  allRuns() {
    const out = new Map()
    for (const [id, r] of this.records) out.set(id, pick(r))
    for (const [id, r] of this.live) out.set(id, r.summary())
    return [...out.values()]
  }

  runs(demo) {
    return this.allRuns()
      .filter((r) => !demo || r.demo === demo)
      .sort((a, b) => b.started - a.started)
  }

  run(id) {
    const live = this.live.get(id)
    if (live) return live.detail()
    const r = this.records.get(id)
    return r ? { ...pick(r), agents: r.agents ?? [], steps: r.steps ?? [], messages: r.messages ?? [], captured: r.captured ?? {}, checks: r.checks ?? [] } : null
  }

  stop(id) {
    const live = this.live.get(id)
    if (live) {
      live.stop()
      return live.summary()
    }
    const r = this.records.get(id)
    if (!r) throw refuse('NotFound', 404, `no run named ${id}`)
    return pick(r)
  }

  /** Ends the runs still playing (failed: interrupted) and writes their records. */
  async close() {
    const playing = [...this.live.values()].filter((r) => ACTIVE.has(r.state))
    for (const run of playing) run.end('failed', 'interrupted: the host closed')
    await Promise.all(playing.map((r) => r.finished))
    for (const run of this.live.values()) run.save(true)
  }
}

const pick = (r) => Object.fromEntries(SUMMARY.map((k) => [k, r[k] ?? null]))

/** True when `pid` is another live process (the host that wrote a run's record). */
function hostAlive(pid) {
  if (!Number.isInteger(pid) || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
