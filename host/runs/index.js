// The scenario engine (host/README.md, "The engine"):
//   const runs = new RunManager({ spec, scenarios: '<connect>/scenarios' })
//   runs.demos() · runs.demo(id) · await runs.start(id) · runs.runs(demo?)
//   runs.run(id) · runs.stop(id) · await runs.remove(id) · runs.on('event', …) · await runs.close()
// Scenarios load with tools/lib/scenario.mjs (dsh-layerfs's checks, renamed)
// and reload when their scenario.json changes; one that does not load is left
// out and reported by loadErrors(). A scenario plays on a project that is
// there (a session's), in a folder /<scenario>_<n>/ of its own on its own
// trunk Branch (run.js, folder.js, scope.js), so any scenarios, and any runs
// of one, play on one project at once, beside live sessions; startAll plays
// every scenario there together. Runs live in <spec.runs>/<runId>/; their
// run.json records survive a host restart, and a run still playing at a
// restart reads as failed (interrupted). At most MAX_PLAYING launches play
// at once, and of those at most HEAVY_AT_ONCE heavy ones (isHeavy: they
// install and build, or replay 100 steps or more); a heavy launch past that
// waits its turn, still starting, and plays when one ends, so startAll does
// not overload Docker. A scenario of several sessions starts a run per session as one
// launch (run.js, Launch): they share one folder and play in it at once.
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScenario } from '../../tools/lib/scenario.mjs'
import { keyOf, missing, notePostgresql, openRuntime, storeOf } from '../config.js'
import { LiveRun } from './live-run.js'
import { LiveState } from './live.js'
import { closeRunSandboxes, Launch, Run } from './run.js'
import { scopedScenario } from './scope.js'
import { piLog, trajectory, writeNotes } from './trajectory.js'
import { demoViews } from './views.js'

export { LIMIT_MS } from './run.js'
/** Every scenario at once (startAll) and a little room. */
export const MAX_PLAYING = 16
/**
 * Heavy launches that play at once; the next waits for one to end. Two kept
 * an 8 GiB Docker VM answering in time; eleven at once (crew's and depot's
 * builds among them) timed most of them out.
 */
export const HEAVY_AT_ONCE = 2
/** Replaying this many steps or more makes a scenario heavy. */
const HEAVY_STEPS = 100
/** What a heavy launch waiting its turn says it is doing. */
export const WAITING_PHASE = `Waiting its turn: ${HEAVY_AT_ONCE} heavy scenarios play at once`

/** A scenario that installs and builds (tagged node or rust) or replays HEAVY_STEPS steps or more. */
export function isHeavy(demo) {
  const tags = demo.raw?.tags ?? []
  return tags.includes('node') || tags.includes('rust') || (demo.scenario.counts?.steps ?? 0) >= HEAVY_STEPS
}
const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const ACTIVE = new Set(['starting', 'running'])
const SUMMARY = ['id', 'kind', 'demo', 'project', 'folder', 'state', 'queued', 'started', 'ended', 'error', 'done', 'of', 'phase', 'agents', 'replay', 'session', 'launch', 'title', 'model', 'thinkingLevel']

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
   * @param {object} [o.models] models.js's Models: what live sessions run on (absent: no live sessions)
   */
  constructor({ spec, scenarios = SCENARIOS, models = null }) {
    super()
    this.models = models
    this.spec = spec
    this.dir = scenarios
    /** scenario id -> { mtime, demo?, views?, error? } */
    this.cache = new Map()
    /** run id -> Run (this process) or its run.json record (earlier ones) */
    this.live = new Map()
    this.records = new Map()
    this.starting = 0
    /** Heavy launches waiting their turn (play, playNext). */
    this.queue = []
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
      if (ACTIVE.has(record.state) && record.kind === 'live') {
        // a live session carries on with its next message; the turn the host cut off is over
        const at = Date.now()
        Object.assign(record, { state: 'idle', error: 'interrupted: the host stopped during this turn' })
        for (const step of record.steps ?? []) if (step.state === 'running') Object.assign(step, { state: 'stopped', ended: at })
        for (const agent of record.agents ?? []) if (agent.state === 'running') agent.state = agent.parent ? 'stopped' : 'idle'
        writeFileSync(`${file}.tmp`, JSON.stringify(record))
        renameSync(`${file}.tmp`, file)
      } else if (ACTIVE.has(record.state)) {
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
      if (record.kind === 'live' || record.state === 'passed' || ACTIVE.has(record.state) || record.swept !== false || hostAlive(record.host)) continue
      // a PostgreSQL Store's project has no volume (layerfs#506 d)
      if (!record.volume && !(await notePostgresql(this.spec, record.project).catch(() => false))) continue
      // an older record (before scopes): its project was reset by a newer replay, so nothing of it is left to close
      if (!record.scopeDir && this.newestOf(record.project)?.id !== record.id) continue
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

  /** Launches playing: the sessions of one launch count once; live sessions do not count. */
  playing() {
    return new Set([...this.live.values()].filter((r) => ACTIVE.has(r.state) && r.kind !== 'live').map((r) => r.launch ?? r.id)).size + this.starting
  }

  /** The newest run recorded on LayerFS project `name`. */
  newestOf(name) {
    let newest = null
    for (const r of this.allRuns()) if (r.project === name && (!newest || r.started > newest.started)) newest = r
    return newest
  }

  /**
   * Starts scenario `id` on LayerFS project `project`, which must be there:
   * the run sets up /<scenario>_<n>/ on a trunk Branch of its own and plays
   * there (run.js), whatever else plays on the project.
   */
  async start(id, { project = null } = {}) {
    const c = this.load().find((x) => x.demo.id === id)
    if (!c) throw refuse('NotFound', 404, `no scenario named ${id}`)
    if (project === null) throw refuse('InvalidInput', 400, 'name the project to play the scenario on')
    checkProject(project)
    const gaps = missing(this.spec)
    if (gaps.length) throw refuse('NotConfigured', 409, `LayerFS is not configured: set ${gaps.join(' and ')} in Settings`)
    if (this.playing() >= MAX_PLAYING) throw refuse('Busy', 409, `${MAX_PLAYING} scenarios are playing; stop one or wait for one to end`)
    this.starting++
    let runs
    try {
      if (c.demo.scenario.seed && !(await optional('../seed.js'))) throw refuse('NotReady', 409, `${id} is a seed demo, and host/seed.js is not there yet`)
      // the startup sweep may still be closing an interrupted run's Sandboxes
      await this.sweeping
      const runtime = await openRuntime(this.spec)
      await playable(this.spec, await runtime.project.list(), project)
      runs = this.makeRuns(c.demo, project)
      for (const run of runs) this.live.set(run.id, run)
    } finally {
      this.starting--
    }
    this.play(runs, isHeavy(c.demo))
    return runs[0].summary()
  }

  /** Every scenario on `project` at once, each in its own folder: their first runs' summaries. */
  async startAll({ project = null } = {}) {
    if (project === null) throw refuse('InvalidInput', 400, 'name the project to play the scenarios on')
    checkProject(project)
    const gaps = missing(this.spec)
    if (gaps.length) throw refuse('NotConfigured', 409, `LayerFS is not configured: set ${gaps.join(' and ')} in Settings`)
    const all = this.load()
    if (this.playing() + all.length > MAX_PLAYING) throw refuse('Busy', 409, `${this.playing()} scenarios are playing; all ${all.length} more would pass ${MAX_PLAYING}`)
    this.starting += all.length
    const launched = []
    try {
      if (all.some((c) => c.demo.scenario.seed) && !(await optional('../seed.js'))) throw refuse('NotReady', 409, 'host/seed.js is not there yet')
      await this.sweeping
      const runtime = await openRuntime(this.spec)
      await playable(this.spec, await runtime.project.list(), project)
      for (const c of all) {
        const runs = this.makeRuns(c.demo, project)
        for (const run of runs) this.live.set(run.id, run)
        launched.push({ runs, heavy: isHeavy(c.demo) })
      }
    } finally {
      this.starting -= all.length
    }
    for (const { runs, heavy } of launched) this.play(runs, heavy)
    return launched.map(({ runs }) => runs[0].summary())
  }

  /** The runs of one launch of `demo` on `project`: one, or one per session. */
  makeRuns(demo, project) {
    const id = demo.id
    const started = Date.now()
    const base = Math.max(0, ...this.allRuns().filter((r) => r.demo === id).map((r) => r.replay ?? 0))
    const common = {
      spec: this.spec,
      emit: (event) => this.emit('event', event),
      loadSeed: () => optional('../seed.js'),
      loadChecks: () => optional('../checks/index.js'),
    }
    const scenario = scopedScenario(demo.scenario)
    // a time stamp and a counter: several launches start in the same millisecond under startAll
    const stamp = `${started.toString(36)}${(this.made = ((this.made ?? 0) + 1) % 1296).toString(36).padStart(2, '0')}`
    if (!scenario.sessions) {
      const record = { id: `${runName(project)}-${id}-${stamp}`, kind: 'replay', demo: id, project, replay: base + 1, state: 'starting', started }
      return [new Run({ ...common, demo: { ...demo, scenario }, record })]
    }
    // one run per session, started together (the same `started`, so none reads as an older session of the others)
    const launch = new Launch(`${runName(project)}-${id}-${stamp}`)
    const runs = []
    scenario.sessions.forEach((s, i) => {
      const record = { id: `${launch.id}-${s.name}`, kind: 'replay', demo: id, project, replay: base + 1 + i, session: s.name, launch: launch.id, state: 'starting', started }
      runs.push(new Run({ ...common, demo: { ...demo, scenario: s.scenario }, record, launch, after: runs[0] ?? null }))
    })
    return runs
  }

  /** Plays a launch's runs, or, a heavy one past HEAVY_AT_ONCE, queues it (still starting) until one ends. */
  play(runs, heavy = false) {
    // decided before these runs count as heavy, so a launch does not count itself
    const wait = heavy && this.heavyPlaying() >= HEAVY_AT_ONCE
    for (const run of runs) run.heavy = heavy
    if (wait) {
      for (const run of runs) {
        run.queued = true
        run.phase = WAITING_PHASE
        run.changed(true)
      }
      this.queue.push(runs)
      return
    }
    for (const run of runs) {
      run.queued = false
      run.changed(true)
    }
    // each run's play ends once it has ended and cleaned up: then the next in the queue may play
    Promise.all(runs.map((run) => run.play().catch((error) => run.fail(error.message)))).finally(() => this.playNext())
  }

  /** Heavy launches playing now: not waiting their turn, not ended. */
  heavyPlaying() {
    return new Set([...this.live.values()].filter((r) => r.heavy && !r.queued && ACTIVE.has(r.state)).map((r) => r.launch ?? r.id)).size
  }

  /** Starts queued heavy launches while there is room; one stopped while it waited is dropped. */
  playNext() {
    while (this.queue.length && this.heavyPlaying() < HEAVY_AT_ONCE) {
      const runs = this.queue.shift()
      if (!runs.every((run) => ACTIVE.has(run.state))) continue
      // its clock (LIMIT_MS, the time shown) starts now, not when it was queued
      const now = Date.now()
      for (const run of runs) Object.assign(run, { started: now, phase: null })
      this.play(runs, true)
    }
  }

  // ---------- live sessions ----------

  /** Starts a live session on LayerFS project `project`, as it is; `text`, when given, is its first message. */
  async startLive({ project, text = null, provider = null, model = null, thinking = null } = {}) {
    if (!this.models) throw refuse('NotConfigured', 409, 'live sessions are not available in this host')
    checkProject(project)
    const gaps = missing(this.spec)
    if (gaps.length) throw refuse('NotConfigured', 409, `LayerFS is not configured: set ${gaps.join(' and ')} in Settings`)
    if (text != null && typeof text !== 'string') throw refuse('InvalidInput', 400, 'text is a string')
    const started = Date.now()
    // a run's id names its folder: a shared Store's `store/name` becomes `store.name`
    const record = { id: `${runName(project)}-live-${started.toString(36)}`, project, state: 'starting', started }
    if (provider && model) {
      const resolved = await this.models.agentModel({ provider, model, thinking: thinking ?? undefined })
      Object.assign(record, { model: `${resolved.model.provider}/${resolved.model.id}`, thinkingLevel: resolved.thinkingLevel })
    }
    const run = new LiveRun({ spec: this.spec, record, emit: (event) => this.emit('event', event), models: this.models })
    await run.open({ text: text?.trim() || null })
    this.live.set(run.id, run)
    return run.summary()
  }

  /** The user's next message to live session `id`, on the model `body` names when it names one. */
  async say(id, body = {}) {
    const run = await this.liveSession(id)
    const choice = body.provider && body.model ? { provider: body.provider, model: body.model, thinking: body.thinking ?? undefined } : null
    await run.say(body.text, choice)
    return run.summary()
  }

  /** Live session `id`: this host's, or one an earlier host left, opened again where it stopped. */
  async liveSession(id) {
    const live = this.live.get(id)
    if (live instanceof LiveRun) return live
    if (live) throw refuse('InvalidInput', 400, `${id} is a scenario replay, not a live session`)
    const record = this.records.get(id)
    if (!record) throw refuse('NotFound', 404, `no session named ${id}`)
    if (record.kind !== 'live') throw refuse('InvalidInput', 400, `${id} is a scenario replay, not a live session`)
    if (hostAlive(record.host)) throw refuse('Busy', 409, `${id} is open in another Connect window`)
    if (!this.models) throw refuse('NotConfigured', 409, 'live sessions are not available in this host')
    this.reviving ??= new Map()
    if (!this.reviving.has(id)) {
      const run = new LiveRun({ spec: this.spec, record, emit: (event) => this.emit('event', event), models: this.models })
      for (const step of run.steps) run.byLabel.set(`${step.agent}:${step.index}`, step)
      run.live = LiveState.from(record.live)
      const opening = run.open({ resume: true }).then(() => {
        this.records.delete(id)
        this.live.set(id, run)
        return run
      })
      this.reviving.set(id, opening)
      opening.finally(() => this.reviving.delete(id)).catch(() => {})
    }
    return this.reviving.get(id)
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
    const notes = writeNotes(join(this.spec.runs, id))
    if (run.kind === 'live') {
      const pi = piLog(join(this.spec.runs, id), name)
      return { ...trajectory({ run, agent: name, pi, notes, before, limit }), agents }
    }
    const views = this.load().find((c) => c.demo.id === run.demo)?.views
    const script = views?.script[name] ?? []
    const session = run.session ? views?.summary.sessions?.find((s) => s.name === run.session) : null
    const prompt = name === root ? (session?.prompt ?? views?.summary.agents.find((a) => a.name === name)?.prompt ?? views?.summary.prompt ?? null) : null
    return { ...trajectory({ run, agent: name, scriptView: (i) => script[i], prompt, title: views?.summary.title ?? null, notes, before, limit }), agents }
  }

  async stop(id) {
    const live = this.live.get(id)
    if (live) {
      await live.stop()
      return live.summary()
    }
    const r = this.records.get(id)
    if (!r) throw refuse('NotFound', 404, `no run named ${id}`)
    return pick(r)
  }

  /** Removes a finished run's saved history, leaving its LayerFS project intact. */
  async remove(id) {
    const live = this.live.get(id)
    const record = live ?? this.records.get(id)
    if (!record) throw refuse('NotFound', 404, `no run named ${id}`)
    if (id === '.' || id === '..' || basename(id) !== id) throw refuse('InvalidInput', 400, 'a run id must be one directory name')
    if (ACTIVE.has(record.state)) throw refuse('Busy', 409, `run ${id} is still playing; stop it before deleting it`)
    // Cleanup and the startup sweep both write run.json after the run ends.
    await Promise.all([this.sweeping, live?.finished])
    if (!this.live.has(id) && !this.records.has(id)) throw refuse('NotFound', 404, `no run named ${id}`)
    rmSync(join(this.spec.runs, id), { recursive: true, force: true })
    live?.forget()
    this.live.delete(id)
    this.records.delete(id)
    this.emit('event', { type: 'run-removed', id, demo: record.demo })
    return { id }
  }

  /** Ends the runs still playing (failed: interrupted) and writes their records. */
  async close() {
    const sessions = [...this.live.values()].filter((r) => r instanceof LiveRun)
    const playing = [...this.live.values()].filter((r) => ACTIVE.has(r.state) && !(r instanceof LiveRun))
    for (const run of playing) run.end('failed', 'interrupted: the host closed')
    await Promise.all([...playing.map((r) => r.finished), ...sessions.map((r) => r.close()), this.sweeping])
    for (const run of this.live.values()) run.save(true)
  }
}

const EMPTY_LIVE = { running: [], mounts: [], sandboxes: [], last: {} }
const pick = (r) => ({ ...Object.fromEntries(SUMMARY.map((k) => [k, r[k] ?? null])), kind: r.kind ?? 'replay', agents: (r.agents ?? []).filter(started) })

/**
 * True for an agent that started. Records list only those; older records
 * listed every agent, and marked the never-started ones of a cut-short run
 * stopped with no step done.
 */
const started = (a) => a.state !== 'waiting' && !(a.parent && a.state === 'stopped' && !a.done)

/** A LayerFS project name, as the runtime takes it. */
/** A run's id names its folder: a shared Store's project key `store/name` becomes `store.name`. */
const runName = (key) => key.replace('/', '.')

/**
 * The project `key` names, when scenarios can play on it: refused when it
 * is not there. A project of a PostgreSQL Store plays too (layerfs#506 d):
 * its connection's URL is noted for its runs' calls and Sandboxes.
 */
async function playable(spec, list, key) {
  const found = list.find((p) => keyOf(p) === key)
  if (!found) throw refuse('NotFound', 404, `no LayerFS project named ${key}`)
  if (found.kind === 'postgresql' && !(await notePostgresql(spec, { name: found.name, store: storeOf(found), shared: true }))) {
    throw refuse('Unsupported', 409, `${found.name} is in the PostgreSQL Store ${storeOf(found)}, whose connection this host does not hold`)
  }
  return found
}

/** A project key: a LayerFS project name, or `store/name` for a project of a shared Store (layerfs#506). */
function checkProject(key) {
  const NAME = /^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/
  if (typeof key !== 'string' || !key.split('/').every((part) => NAME.test(part)) || key.split('/').length > 2) {
    throw refuse('InvalidInput', 400, 'the project is a LayerFS project name (lowercase letters, digits, dots, dashes and underscores), or store/name')
  }
}

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
