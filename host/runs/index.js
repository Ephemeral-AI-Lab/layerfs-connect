// The scenario engine (host/README.md, "The engine"):
//   const runs = new RunManager({ spec, scenarios: '<connect>/scenarios' })
//   runs.demos() · runs.demo(id) · await runs.start(id) · runs.runs(demo?)
//   runs.run(id) · runs.stop(id) · runs.on('event', …) · await runs.close()
// Scenarios load with tools/lib/scenario.mjs (dsh-layerfs's checks, renamed)
// and reload when their scenario.json changes; one that does not load is left
// out and reported by loadErrors(). A demo has one LayerFS project, named
// after it; each run is a replay that resets it (run.js), so one run of a
// demo plays at a time and only its newest run's project state is there.
// Runs live in <spec.runs>/<runId>/; their
// run.json records survive a host restart, and a run still playing at a
// restart reads as failed (interrupted). At most two launches play at once.
// A scenario of several sessions starts a run per session as one launch
// (run.js, Launch): the first resets the project, and all play on it at once.
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScenario } from '../../tools/lib/scenario.mjs'
import { missing, openRuntime } from '../config.js'
import { closeRunSandboxes, Launch, Run } from './run.js'
import { piLog, trajectory } from './trajectory.js'
import { demoViews } from './views.js'

export { LIMIT_MS } from './run.js'
export const MAX_PLAYING = 2
const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const ACTIVE = new Set(['starting', 'running'])
const SUMMARY = ['id', 'demo', 'project', 'state', 'started', 'ended', 'error', 'done', 'of', 'phase', 'agents', 'replay', 'session', 'launch']

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
  /**
   * @param {object} o
   * @param {(project: string) => Promise<void>} [o.beforeRemove] called before a replay removes its demo's project (to close clients of it)
   */
  constructor({ spec, scenarios = SCENARIOS, beforeRemove = async () => {} }) {
    super()
    this.beforeRemove = beforeRemove
    this.spec = spec
    this.dir = scenarios
    /** scenario id -> { mtime, demo?, views?, error? } */
    this.cache = new Map()
    /** run id -> Run (this process) or its run.json record (earlier ones) */
    this.live = new Map()
    this.records = new Map()
    this.starting = 0
    this.loadRecords()
    this.sweeping = this.sweep()
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
        for (const agent of record.agents ?? []) if (['running', 'idle'].includes(agent.state)) agent.state = 'stopped'
        writeFileSync(`${file}.tmp`, JSON.stringify(record))
        renameSync(`${file}.tmp`, file)
      }
      this.records.set(record.id ?? id, record)
    }
  }

  /**
   * Closes the Sandboxes of each run a host left without closing them (it
   * stopped or was killed before its cleanup finished). Once per run: the
   * record's `swept` is set whatever the outcome.
   */
  async sweep() {
    for (const record of this.records.values()) {
      if (record.state === 'passed' || ACTIVE.has(record.state) || record.swept !== false || !record.volume || hostAlive(record.host)) continue
      // an earlier replay's project was removed by a newer one: nothing of it is left to close
      if (this.newestOf(record.project)?.id !== record.id) continue
      try {
        await closeRunSandboxes(this.spec, record)
      } catch (e) {
        console.error(`[runs] ${record.id}: closing Sandboxes: ${e.message}`)
      }
      record.swept = true
      const file = join(this.spec.runs, record.id, 'run.json')
      writeFileSync(`${file}.tmp`, JSON.stringify(record))
      renameSync(`${file}.tmp`, file)
    }
  }

  /** Launches playing: the sessions of one launch count once. */
  playing() {
    return new Set([...this.live.values()].filter((r) => ACTIVE.has(r.state)).map((r) => r.launch ?? r.id)).size + this.starting
  }

  /** The newest run recorded on LayerFS project `name`. */
  newestOf(name) {
    let newest = null
    for (const r of this.allRuns()) if (r.project === name && (!newest || r.started > newest.started)) newest = r
    return newest
  }

  /** Starts a replay of demo `id` on its project `id`: reset (removed, then Inited from the fixture), then played. */
  async start(id) {
    const c = this.load().find((x) => x.demo.id === id)
    if (!c) throw refuse('NotFound', 404, `no demo named ${id}`)
    const gaps = missing(this.spec)
    if (gaps.length) throw refuse('NotConfigured', 409, `LayerFS is not configured: set ${gaps.join(' and ')} in Settings`)
    if (this.playing() >= MAX_PLAYING) throw refuse('Busy', 409, `${MAX_PLAYING} runs are playing; stop one or wait for one to end`)
    this.starting++
    let runs
    try {
      if (c.demo.scenario.seed && !(await optional('../seed.js'))) throw refuse('NotReady', 409, `${id} is a seed demo, and host/seed.js is not there yet`)
      if (this.allRuns().some((r) => r.project === id && ACTIVE.has(r.state))) throw refuse('Busy', 409, `${id} is replaying now; stop it before replaying again`)
      // the startup sweep may still be closing an interrupted replay's Sandboxes on this project
      await this.sweeping
      await openRuntime(this.spec)
      const started = Date.now()
      const base = Math.max(0, ...this.allRuns().filter((r) => r.demo === id).map((r) => r.replay ?? 0))
      const common = {
        spec: this.spec,
        emit: (event) => this.emit('event', event),
        loadSeed: () => optional('../seed.js'),
        loadChecks: () => optional('../checks/index.js'),
        beforeRemove: this.beforeRemove,
      }
      const sessions = c.demo.scenario.sessions
      if (!sessions) {
        const record = { id: `${id}-${started.toString(36)}`, demo: id, project: id, replay: base + 1, state: 'starting', started }
        runs = [new Run({ ...common, demo: c.demo, record })]
      } else {
        // one run per session, started together (the same `started`, so none reads as an older session of the others)
        const launch = new Launch(`${id}-${started.toString(36)}`)
        runs = []
        sessions.forEach((s, i) => {
          const record = { id: `${launch.id}-${s.name}`, demo: id, project: id, replay: base + 1 + i, session: s.name, launch: launch.id, state: 'starting', started }
          runs.push(new Run({ ...common, demo: { ...c.demo, scenario: s.scenario }, record, launch, after: runs[0] ?? null }))
        })
      }
      for (const run of runs) this.live.set(run.id, run)
    } finally {
      this.starting--
    }
    for (const run of runs) {
      run.changed(true)
      run.play().catch((error) => run.fail(error.message))
    }
    return runs[0].summary()
  }

  /** The runs of `id`'s launch (itself alone for a run of one session), first first. */
  launchOf(id) {
    const run = this.live.get(id) ?? this.records.get(id)
    if (!run?.launch) return run ? [run] : []
    return [...this.live.values(), ...this.records.values()].filter((r, i, all) => r.launch === run.launch && all.findIndex((x) => x.id === r.id) === i).sort((a, b) => (a.replay ?? 0) - (b.replay ?? 0))
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
    return r ? { ...pick(r), steps: r.steps ?? [], messages: r.messages ?? [], captured: r.captured ?? {}, checks: r.checks ?? [], live: r.live ?? EMPTY_LIVE } : null
  }

  /**
   * One agent's Trace rows (trajectory.js): pi's log for a live session, the
   * scenario's script for a replay. `before`/`limit` page from the newest.
   */
  trace(id, { agent = null, before = null, limit = undefined } = {}) {
    const run = this.run(id)
    if (!run) throw refuse('NotFound', 404, `no run named ${id}`)
    const root = run.agents.find((a) => a.parent === null)?.name ?? 'root'
    const name = agent || root
    if (!run.agents.some((a) => a.name === name)) throw refuse('NotFound', 404, `run ${id} has no agent named ${name}`)
    const agents = run.agents.map((a) => ({ name: a.name, parent: a.parent, state: a.state }))
    if (run.kind === 'live') {
      const pi = piLog(join(this.spec.runs, id), name)
      return { ...trajectory({ run, agent: name, pi, before, limit }), agents }
    }
    const views = this.load().find((c) => c.demo.id === run.demo)?.views
    const script = views?.script[name] ?? []
    const session = run.session ? views?.summary.sessions?.find((s) => s.name === run.session) : null
    const prompt = name === root ? (session?.prompt ?? views?.summary.agents.find((a) => a.name === name)?.prompt ?? views?.summary.prompt ?? null) : null
    return { ...trajectory({ run, agent: name, scriptView: (i) => script[i], prompt, title: views?.summary.title ?? null, before, limit }), agents }
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
    await Promise.all([...playing.map((r) => r.finished), this.sweeping])
    for (const run of this.live.values()) run.save(true)
  }
}

const EMPTY_LIVE = { running: [], mounts: [], sandboxes: [], last: {} }
const pick = (r) => ({ ...Object.fromEntries(SUMMARY.map((k) => [k, r[k] ?? null])), agents: (r.agents ?? []).filter(started) })

/**
 * True for an agent that started. Records list only those; older records
 * listed every agent, and marked the never-started ones of a cut-short run
 * stopped with no step done.
 */
const started = (a) => a.state !== 'waiting' && !(a.parent && a.state === 'stopped' && !a.done)

/** True when `pid` is another live process (the host that wrote a run's record). */
function hostAlive(pid) {
  if (!Number.isInteger(pid) || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but this one may not signal it (another user, a sandbox)
    return error?.code === 'EPERM'
  }
}
