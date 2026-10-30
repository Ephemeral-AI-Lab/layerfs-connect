// One run of a scenario on the real LayerFS, on a project that is there (a
// session's): the run gets a folder /<scenario>_<n>/ of its own on a trunk
// Branch that stands for main (folder.js), and every LayerFS call of its
// scripts is kept in that folder, its own Branches and its own Sandboxes
// (scope.js), so any number of runs play on one project at once. The agents
// (agent.js, tools.js) play in <runDir>/work with the SDK tracing each agent's
// calls to <runDir>/traces/<agent>.jsonl. The run passes when root's last
// step is done, the final checks (host/checks) pass on its folder and
// Branches, and its last trunk landed on main; the first failed step, a stop
// or the 15-minute limit ends it. The record (run.json) is written whole,
// through a temporary file, as the run changes.
//
// A scenario of several sessions plays as one launch: a run per session, its
// root agent named after the session. The launch's first run sets up the
// folder; the others wait for it and play in the same folder and scope. They
// end together: once one fails or stops, the others stop, and the scope's
// Sandboxes are closed once, after the last has ended; the folder lands once,
// after every session passed.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { API, layerfsEnv, notePostgresql, openRuntime, projectRef, withProjectEnv } from '../config.js'
import { Agent } from './agent.js'
import { Job } from './jobs.js'
import { callCodes, inOrder } from '../../tools/lib/expect.mjs'
import { Tools } from './tools.js'
import { LiveState } from './live.js'
import { traceCall, Traces } from './traces.js'
import { landOnMain, projectRecord, setupFolder } from './folder.js'
import { Scope, SCOPE_ENV } from './scope.js'

export const LIMIT_MS = 15 * 60 * 1000
// Each step waits a random third to all of a per-step bound first: 3 s, or
// less when the run's steps would otherwise pause longer than 5 minutes in
// all (crew's 967 steps get about 0.3 s), well inside LIMIT_MS.
const THINK_MAX_MS = 3000
const THINK_BUDGET_MS = 5 * 60 * 1000
const SAVE_MS = 300
const LIVE_MS = 120
const RESOLVE = fileURLToPath(new URL('../resolve-layerfs.js', import.meta.url))
const CLI = join(API, 'cli', 'src', 'layerfs.js')
const ACTIVE = new Set(['starting', 'running'])
const q = (s) => `'${String(s).replaceAll("'", "'\\''")}'`

/** A background process's states while it still runs. */
const RUNNING = new Set(['running', 'starting', 'Running', 'Starting'])

export class Run {
  /**
   * @param {object} o
   * @param {object} o.spec Connect's deployment (config.js)
   * @param {{ id, folder, scenario }} o.demo the loaded scenario and its folder
   * @param {object} o.record what run.json holds so far (id, demo, project, …)
   * @param {(event: object) => void} o.emit
   * @param {Run} [o.after] the launch's run that resets the project: this one waits for its Init
   * @param {Launch} [o.launch] the launch this run's session belongs to
   */
  constructor({ spec, demo, record, emit, loadSeed, loadChecks, after = null, launch = null }) {
    this.spec = spec
    this.source = demo
    this.scenario = demo.scenario
    this.emit = emit
    this.loadSeed = loadSeed
    this.loadChecks = loadChecks
    this.after = after
    this.group = launch
    Object.assign(this, { steps: [], messages: [], captured: {}, checks: [], phase: null, error: null, ended: null }, record)
    this.dir = join(spec.runs, this.id)
    this.work = join(this.dir, 'work')
    this.bin = join(this.dir, 'bin')
    this.traceDir = join(this.dir, 'traces')
    this.seq = 0
    this.procs = new Set()
    this.jobs = new Map()
    this.jobEnds = new Map()
    this.byLabel = new Map()
    this.closing = false
    this.tools = new Tools(this)
    this.live = new LiveState()
    this.liveTimer = null
    this.traces = new Traces(
      (line, agent) => this.call(line, agent),
      (line, agent) => this.callStarted(line, agent),
    )
    this.agents = new Map()
    for (const [name, steps] of Object.entries(this.scenario.agents)) this.agents.set(name, new Agent(this, name, steps))
    for (const [child, parent] of this.scenario.parents) this.agents.get(child).parent = this.agents.get(parent)
    this.root = this.scenario.root ?? 'root'
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve))
    // settles once the project is Inited (or the run ended first): the launch's other sessions wait for it
    this.ready = new Promise((resolve, reject) => Object.assign(this, { resolveReady: resolve, rejectReady: reject }))
    this.ready.catch(() => {})
    launch?.runs.push(this)
  }

  get over() {
    return this.closing || !ACTIVE.has(this.state)
  }

  next() {
    return ++this.seq
  }

  // ---------- views and the record ----------

  summary() {
    const agents = [...this.agents.values()]
    return {
      id: this.id,
      kind: this.kind ?? 'replay',
      demo: this.source.id,
      project: this.project,
      folder: this.folder ?? null,
      replay: this.replay ?? null,
      session: this.session ?? null,
      launch: this.launch ?? null,
      state: this.state,
      queued: this.queued ?? false,
      started: this.started,
      ended: this.ended,
      error: this.error,
      done: agents.reduce((n, a) => n + a.index, 0),
      of: agents.reduce((n, a) => n + a.steps.length, 0),
      phase: this.phase,
      // only agents that have started: a subagent appears when its parent starts it
      agents: agents.filter((a) => a.state !== 'waiting').map((a) => a.view()),
    }
  }

  detail() {
    return {
      ...this.summary(),
      steps: this.steps,
      messages: this.messages,
      captured: this.captured,
      checks: this.checks,
      live: this.live.view(),
    }
  }

  /** run.json: the detail, and where the project and folders are. */
  save(now = false) {
    if (!now) {
      this.saveTimer ??= setTimeout(() => this.save(true), SAVE_MS)
      return
    }
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    const file = join(this.dir, 'run.json')
    const value = { ...this.detail(), volume: this.volume ?? null, image: this.image ?? null, scopeDir: this.scopeDir ?? null, dir: this.dir, scenarioDir: this.source.folder, host: process.pid, swept: this.swept ?? false }
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(value))
    renameSync(`${file}.tmp`, file)
  }

  changed(now = false) {
    this.emit({ type: 'run', run: this.summary() })
    this.save(now)
  }

  agentChanged(agent) {
    if (agent.state !== 'waiting') this.emit({ type: 'agent', run: this.id, agent: agent.view() })
    this.save()
    if (agent.state === 'idle' || agent.state === 'done') setImmediate(() => this.checkStuck())
  }

  /** Fails a run no agent can move on: nobody works, and root is not done. */
  checkStuck() {
    if (this.over) return
    const agents = [...this.agents.values()]
    if (agents.some((a) => a.state === 'running' || a.turning)) return
    const waits = agents
      .filter((a) => a.state === 'idle')
      .map((a) => {
        const previous = a.steps[a.index - 1]
        return previous?.until?.length ? `${a.name} waits for ${a.unsettled(previous.until).join(' and ')}` : `${a.name} waits for a message`
      })
    this.fail(`stuck: no agent can go on (${waits.join('; ')})`)
  }

  /** How long an agent pauses before its next step: random, bounded per step and over the run; none when spec.think is false (tests). */
  thinkMs() {
    if (this.spec.think === false) return 0
    this.thinkHi ??= Math.min(THINK_MAX_MS, THINK_BUDGET_MS / Math.max(1, [...this.agents.values()].reduce((n, a) => n + a.steps.length, 0)))
    return this.thinkHi * (1 / 3 + (2 / 3) * Math.random())
  }

  progress(agent) {
    if (!agent.parent) {
      let phase = null
      for (let i = Math.min(agent.index, agent.steps.length - 1); i >= 0 && !phase; i--) phase = agent.steps[i].phase ?? null
      this.phase = phase
    }
    this.emit({ type: 'agent', run: this.id, agent: agent.view() })
    this.changed()
  }

  message(from, to, text) {
    const message = { at: Date.now(), from, to, text }
    this.messages.push(message)
    this.emit({ type: 'message', run: this.id, message })
    this.save()
  }

  remember(key, value) {
    this.captured[key] = value
  }

  // ---------- steps ----------

  stepStarted(agent, index) {
    const result = { agent: agent.name, index, state: 'running', started: Date.now(), ended: null, calls: [], checks: [] }
    this.steps.push(result)
    this.byLabel.set(`${agent.name}:${index}`, result)
    this.emit({ type: 'step', run: this.id, step: result })
    this.save()
    return result
  }

  stepEnded(result, fields) {
    Object.assign(result, fields, { ended: Date.now() })
    this.emit({ type: 'step', run: this.id, step: result })
    this.save()
  }

  stepFailed(agent, index, step, reason, result = null, fields = {}) {
    result ??= this.stepStarted(agent, index)
    this.stepEnded(result, { state: 'failed', ...fields })
    const what = step.call?.args?.description ? ` (${step.call.args.description})` : ''
    this.fail(`${agent.name}[${index}]${what}: ${reason}`, agent)
    return false
  }

  stepReplied(agent, index, step, text) {
    this.stepEnded(this.stepStarted(agent, index), { state: 'ok', output: text })
  }

  stepSkipped(agent, index, step) {
    const result = this.stepStarted(agent, index)
    this.stepEnded(result, { state: 'ok', output: step.text, checks: [{ name: 'wait', ok: true, detail: `not said: ${step.until.join(' and ')} had replied already` }] })
  }

  /** One finished trace line. */
  call(line, agent) {
    const call = traceCall(line, agent)
    this.byLabel.get(call.step)?.calls.push(call)
    this.emit({ type: 'call', run: this.id, call })
    this.live.ended(line, agent)
    this.liveChanged()
  }

  /** A call's start line: it shows as running until its end line. */
  callStarted(line, agent) {
    this.live.started(line, agent)
    this.liveChanged()
  }

  /** Sends the live state at most every LIVE_MS. */
  liveChanged(now = false) {
    if (!now) {
      this.liveTimer ??= setTimeout(() => this.liveChanged(true), LIVE_MS)
      return
    }
    clearTimeout(this.liveTimer)
    this.liveTimer = null
    this.emit({ type: 'live', run: this.id, live: this.live.view() })
  }

  // ---------- processes ----------

  /** The run's project as LayerFS calls name it: `this.project` is its key (`store/name` in a shared Store, layerfs#506). */
  layerfsProject() {
    return { ...projectRef(this.project), volume: this.volume, image: this.image }
  }

  /** The environment of an agent's bash call labelled `label`. */
  env(agent, label) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LAYERFS_')))
    return {
      ...env,
      ...layerfsEnv(this.spec, this.layerfsProject()),
      PATH: `${this.bin}:${process.env.PATH ?? ''}`,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${RESOLVE}`].filter(Boolean).join(' '),
      LAYERFS_TRACE: join(this.traceDir, `${agent.name}.jsonl`),
      LAYERFS_TRACE_STEP: label,
      LAYERFS_TRACE_START: '1',
      ...(this.scopeDir ? { [SCOPE_ENV]: this.scopeDir } : {}),
    }
  }

  track(proc) {
    this.procs.add(proc)
    return () => this.procs.delete(proc)
  }

  startJob(agent, step, index, { label, command, cwd, env }) {
    const id = `job-${this.jobs.size + 1}`
    const job = new Job({ id, name: step.call.job ?? null, label, command, cwd, env, onOutput: (chunk) => agent.seen.look(chunk.toString('utf8')) })
    job.agent = agent
    this.jobs.set(id, job)
    const result = this.byLabel.get(`${agent.name}:${index}`)
    this.jobEnds.set(id, job.done.then(() => this.jobEnded(job, agent, step, index, result)))
    return job
  }

  job(id) {
    return this.jobs.get(id)
  }

  jobsOf(agent) {
    return [...this.jobs.values()].filter((j) => j.agent === agent)
  }

  /** Waits until a finished job's step is checked. */
  jobSettled(job) {
    return job.state === 'running' ? Promise.resolve() : this.jobEnds.get(job.id)
  }

  /** A background job ended: its step gets the job's output and its `expect` is checked. */
  jobEnded(job, agent, step, index, result) {
    this.traces.read(agent.name)
    const fields = { exitCode: job.exitCode, stdout: job.stdout.text(), stderr: job.stderr.text(), truncated: job.stdout.truncated || job.stderr.truncated }
    const checks = [{ name: 'job', ok: true, detail: `${job.id} ${job.status()}` }]
    if (job.state === 'killed' && this.over) {
      // the run ended first: nothing to check
      return this.stepEnded(result, { ...fields, checks })
    }
    if (step.expect) {
      const codes = callCodes(this.traces.lines(`${agent.name}:${index}`))
      const ok = inOrder(codes, step.expect)
      checks.push({ name: 'expect', ok, detail: `expected ${step.expect.join(', ')}; its LayerFS calls show ${codes.length ? codes.join(', ') : 'nothing'}` })
      if (!ok) {
        this.stepEnded(result, { ...fields, checks, state: 'failed' })
        return this.fail(`${agent.name}[${index}] (${step.call.args.description}): background ${checks.at(-1).detail}`, agent)
      }
    }
    this.stepEnded(result, { ...fields, checks })
  }

  // ---------- the run ----------

  /** The run's folders, and the `layerfs` command its agents' bash calls find on PATH. */
  prepare() {
    for (const dir of [this.work, this.bin, this.traceDir]) mkdirSync(dir, { recursive: true })
    const shim = join(this.bin, 'layerfs')
    writeFileSync(shim, `#!/bin/sh\nexec node --import ${q(RESOLVE)} ${q(CLI)} "$@"\n`)
    chmodSync(shim, 0o755)
  }

  /** Inits the project, then plays the agents until the run ends. */
  async play() {
    this.limit = setTimeout(() => this.fail(`over the ${LIMIT_MS / 60000}-minute limit`), LIMIT_MS - (Date.now() - this.started))
    this.limit.unref()
    try {
      this.prepare()
      if (this.after) await this.joinInit()
      else await this.init()
      this.resolveReady()
      if (this.over) return
      this.state = 'running'
      this.changed(true)
      for (const agent of this.agents.values()) this.traces.follow(agent.name, join(this.traceDir, `${agent.name}.jsonl`))
      this.traces.start()
      this.agents.get(this.root).turn()
    } catch (error) {
      this.rejectReady(error)
      this.fail(`${error.code ? `${error.code}: ` : ''}${error.message}`)
    }
    await this.finished
  }

  /** Sets up the run's folder on its trunk in the project (folder.js). */
  async init() {
    const { scenario } = this
    let folder = scenario.fixture
    if (scenario.seed) {
      const { writeSeed } = await this.loadSeed()
      folder = writeSeed(scenario.seed, join(this.dir, 'seed'))
    }
    if (!folder) throw Object.assign(new Error('the scenario names no fixture'), { code: 'InvalidInput' })
    this.phase = 'Setting up its folder'
    this.changed(true)
    const project = await projectRecord(this.spec, this.project)
    this.volume = project.volume ?? null
    this.image = project.image ?? null
    this.scopeDir = join(this.dir, 'scope')
    const { run } = await setupFolder(this.spec, {
      scenarioId: this.source.id,
      fixture: folder,
      project,
      scopeDir: this.scopeDir,
      phase: (phase) => {
        this.phase = phase
        this.changed(true)
      },
    })
    this.folder = run
    this.phase = null
    this.save(true)
  }

  /** Another session of the launch sets up the folder: wait for it, then play in it. */
  async joinInit() {
    this.phase = 'Setting up its folder'
    this.changed(true)
    try {
      await this.after.ready
    } catch (error) {
      throw Object.assign(new Error(`session ${this.after.session ?? this.after.id} did not set up the folder: ${error.message}`), { code: error.code })
    }
    this.volume = this.after.volume
    this.image = this.after.image
    this.scopeDir = this.after.scopeDir
    this.folder = this.after.folder
    this.phase = null
    this.save(true)
  }

  /** Root did its last step: leftover work stops, then the final checks decide. */
  async rootDone() {
    if (this.over) return
    this.closing = true
    this.stopWork('killed: the run ended')
    await Promise.all([...this.jobEnds.values()])
    this.traces.stop()
    let checks = []
    try {
      checks = await this.finalChecks()
    } catch (error) {
      checks = [{ name: 'final', ok: false, detail: `${error.code ? `${error.code}: ` : ''}${error.message}` }]
    }
    // the run's folder joins main once its checks passed (a launch's, once every session's did)
    if (this.state === 'running' && this.scopeDir && checks.every((c) => c.ok)) {
      this.phase = 'Landing on main'
      this.changed(true)
      checks = [...checks, await this.land()]
      this.phase = null
    }
    this.checks = checks
    this.emit({ type: 'checks', run: this.id, checks })
    if (this.state !== 'running') return
    const failed = checks.filter((c) => !c.ok)
    this.end(failed.length ? 'failed' : 'passed', failed.length ? `final checks failed: ${failed.map((c) => c.name).join(', ')}` : null)
  }

  async finalChecks() {
    const mod = await this.loadChecks()
    if (!mod?.finalChecks) return []
    await openRuntime(this.spec)
    const { LayerFS } = await import('@layerfs/agent')
    const project = this.layerfsProject()
    const client = await withProjectEnv(this.spec, project, () => LayerFS.open(project.name))
    try {
      const scope = this.scopeDir ? Scope.open(this.scopeDir) : null
      return await mod.finalChecks({ scenario: this.scenario, scenarioDir: this.source.folder, project: project.name, client, scope })
    } finally {
      await client.close()
    }
  }

  /** The check that the run's last trunk landed on main (folder.js); a launch lands once, after its last session. */
  async land() {
    const landing = this.group ? this.group.land(this) : this.landNow()
    try {
      const { ok, detail } = await landing
      return { name: 'main.landed', ok, detail }
    } catch (error) {
      return { name: 'main.landed', ok: false, detail: `${error.code ? `${error.code}: ` : ''}${error.message}` }
    }
  }

  landNow() {
    return landOnMain(this.spec, { project: this.layerfsProject(), scope: Scope.open(this.scopeDir) })
  }

  /** Kills every running bash process and job of the run. */
  stopWork(reason) {
    for (const proc of this.procs) proc.kill()
    for (const job of this.jobs.values()) job.kill(reason)
  }

  fail(reason, agent = null) {
    if (!ACTIVE.has(this.state)) return
    if (agent) agent.setState('failed')
    this.end('failed', reason)
  }

  stop() {
    if (!ACTIVE.has(this.state)) return
    this.end('stopped', 'stopped')
  }

  /** Ends the run; `cause` is set when another session of the launch ended it (so it ends no others). */
  end(state, error, cause = null) {
    if (!ACTIVE.has(this.state)) return
    this.state = state
    this.error = error
    this.ended = Date.now()
    clearTimeout(this.limit)
    this.stopWork(state === 'passed' ? 'killed: the run ended' : `killed: the run ${state}`)
    this.traces.stop()
    this.live.stopped()
    this.liveChanged(true)
    for (const step of this.steps) if (step.state === 'running') Object.assign(step, { state: 'stopped', ended: this.ended })
    // an agent never started stays waiting, so it stays unlisted
    for (const agent of this.agents.values()) if (!['done', 'failed', 'waiting'].includes(agent.state)) agent.setState(state === 'passed' ? agent.state : 'stopped')
    this.changed(true)
    this.rejectReady(new Error(error ?? state))
    // the launch's sessions share the project: one cut short stops the others (a host closing interrupts them all alike)
    if (state !== 'passed' && this.group) this.group.cutShort(error ?? state)
    if (state !== 'passed' && this.group && !cause) {
      const interrupted = state === 'failed' && String(error).startsWith('interrupted')
      const why = interrupted ? error : `stopped: session ${this.session ?? this.id} ${state === 'stopped' ? 'was stopped' : 'failed'}`
      for (const other of this.group.runs) if (other !== this) other.end(interrupted ? 'failed' : 'stopped', why, this)
    }
    // a run cut short leaves its scripts' Workspaces mounted, so their Sandboxes never go idle
    const cleanup = state === 'passed' ? Promise.resolve() : this.closeSandboxes().catch((e) => console.error(`[runs] ${this.id}: closing Sandboxes: ${e.message}`))
    this.cleanup = cleanup
    cleanup.finally(() => this.resolveFinished())
  }

  /** Closes the run's Sandboxes once; `swept` in run.json says it was tried. */
  async closeSandboxes() {
    try {
      if (this.group) await this.group.closeSandboxes(this.spec)
      else await closeRunSandboxes(this.spec, { id: this.id, project: this.project, volume: this.volume, image: this.image, scopeDir: this.scopeDir })
    } finally {
      this.swept = true
      this.save(true)
    }
  }
}

/**
 * The runs of one launch of a scenario of several sessions: they share the
 * folder and scope, so its Sandboxes are closed once, when every one has
 * ended, and it lands on main once, when every one passed its checks.
 */
export class Launch {
  constructor(id) {
    this.id = id
    /** @type {Run[]} */
    this.runs = []
    this.closing = null
    this.passed = new Set()
    this.landing = new Promise((resolve, reject) => Object.assign(this, { resolveLanding: resolve, rejectLanding: reject }))
    this.landing.catch(() => {})
  }

  /** A session passed its checks: the last one lands the folder; each waits for that. */
  land(run) {
    this.passed.add(run)
    if (this.passed.size === this.runs.length) run.landNow().then(this.resolveLanding, this.rejectLanding)
    return this.landing
  }

  /** A session ended without passing: nothing lands. */
  cutShort(reason) {
    this.rejectLanding(Object.assign(new Error(`not landed: ${reason}`), { code: 'Stopped' }))
  }

  closeSandboxes(spec) {
    // a run that ends cut short ends the others first (Run.end), so none still plays here
    const first = this.runs[0]
    this.closing ??= closeRunSandboxes(spec, { id: this.id, project: first.project, volume: first.volume, image: first.image, scopeDir: first.scopeDir })
    return this.closing
  }
}

/** How long one cleanup call may take: a Sandbox whose daemon stopped answering must not hold cleanup up. */
const CLEANUP_CALL_MS = 30_000

/** `promise`, or a Timeout refusal after `ms`. */
function bounded(promise, ms, what) {
  let timer
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${what}: no answer in ${ms / 1000} s`), { code: 'Timeout' })), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** The container of Sandbox `sandbox` of `project` ({ name, store, shared }), as LayerFS names it. */
export const sandboxContainer = (prefix, project, sandbox) => `${prefix}${project.shared ? `${project.store}.` : ''}${project.name}-${sandbox}`

/**
 * Unmounts (discarding) every Workspace still mounted in a run's Sandboxes
 * and closes them: what an agent ends with, done for the agents a failed,
 * stopped or interrupted run cut off. A run with a scope touches only its own
 * Sandboxes and their processes (others may be playing in the project); an
 * older record without one, every Sandbox of its project. Each call is
 * bounded (CLEANUP_CALL_MS). A run's own Sandbox whose daemon does not answer
 * is stopped as a container, as LayerFS's project removal stops Sandboxes,
 * and removed as a stopped leftover. Each run once; a refusal is logged.
 */
export async function closeRunSandboxes(spec, { id, project: key, volume, image, scopeDir = null }) {
  // a PostgreSQL Store's project has no volume (layerfs#506 d)
  if (!volume && !(await notePostgresql(spec, key))) return
  let mine = null
  if (scopeDir) {
    try {
      mine = new Set(Scope.open(scopeDir).sandboxes().values())
    } catch {
      return
    }
    if (!mine.size) return
  }
  const ours = (sandbox) => !mine || mine.has(String(sandbox))
  const runtime = await openRuntime(spec)
  const { LayerFS } = await import('@layerfs/agent')
  // `key` is the run's project key: `store/name` in a shared Store (layerfs#506)
  const project = { ...projectRef(key), volume, image }
  const lf = await withProjectEnv(spec, project, () => LayerFS.open(project.name))
  const stuck = []
  try {
    // background processes keep their Workspace Busy: cancel each once, then wait (bounded) until none runs
    const { LayerFSBackend } = await import('@layerfs/backend')
    const be = LayerFSBackend.of(lf)
    const running = async () => (await bounded(be.daemon.process.list(1000, 0), CLEANUP_CALL_MS, 'process.list')).items.filter((p) => RUNNING.has(p.state ?? p.status) && ours(p.sandbox))
    for (const p of await running().catch(() => [])) {
      await bounded(be.daemon.process.cancel(p.process ?? p.id), CLEANUP_CALL_MS, 'process.cancel').catch((e) => console.error(`[runs] ${id}: cancel ${p.process ?? p.id}: ${e.message}`))
    }
    for (const until = Date.now() + 10_000; Date.now() < until && (await running().catch(() => [])).length; ) await pause(250)
    // a scoped run knows its Sandboxes; an older record lists the project's
    const sandboxes = mine ? [...mine] : (await bounded(lf.project.list_sandboxes(1000, 0), CLEANUP_CALL_MS, 'list_sandboxes')).items.map((s) => s.sandbox)
    for (const sandbox of sandboxes) {
      if (!ours(sandbox)) continue
      try {
        const mounted = await bounded(lf.sandbox.list_workspaces(sandbox, 1000, 0), CLEANUP_CALL_MS, `Sandbox ${sandbox}`)
        for (const w of mounted.items) await bounded(lf.workspace.unmount({ sandbox, path: w.path }, true), CLEANUP_CALL_MS, `unmount ${w.path}`)
        await bounded(lf.sandbox.close(sandbox), CLEANUP_CALL_MS, `close ${sandbox}`)
      } catch (e) {
        // closed already: nothing to do; its daemon not answering: stopped below
        if (e.code === 'NoSuchSandbox') continue
        console.error(`[runs] ${id}: Sandbox ${sandbox}: ${e.code ?? ''} ${e.message}`)
        if (e.code === 'Timeout' && mine) stuck.push(sandbox)
      }
    }
  } finally {
    await lf.close().catch(() => {})
  }
  if (stuck.length) {
    // LayerFS names a Sandbox's container <prefix>[<store>.]<project>-<n>
    const containers = stuck.map((sandbox) => sandboxContainer(spec.prefix, project, sandbox))
    try {
      await runtime.platform.docker(runtime.settings, ['stop', '-t', '10', ...containers], { timeout: 60_000 })
      await runtime.sandbox.clean_leftovers(containers)
      console.error(`[runs] ${id}: stopped ${containers.join(', ')}: their daemons did not answer`)
    } catch (e) {
      console.error(`[runs] ${id}: stopping ${containers.join(', ')}: ${e.message}`)
    }
  }
}
