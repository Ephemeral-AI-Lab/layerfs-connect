// One run of a demo on the real LayerFS: Init a fresh project from the
// demo's fixture (a seed demo's seed written out first), then play the
// agents (agent.js, tools.js) in <runDir>/work with the SDK tracing each
// agent's calls to <runDir>/traces/<agent>.jsonl. The run passes when root's
// last step is done and the final checks (host/checks) pass; the first failed
// step, a stop or the 15-minute limit ends it. The record (run.json) is
// written whole, through a temporary file, as the run changes.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { API, layerfsEnv, openRuntime, withProjectEnv } from '../config.js'
import { Agent } from './agent.js'
import { Job } from './jobs.js'
import { callCodes, inOrder } from '../../tools/lib/expect.mjs'
import { Tools } from './tools.js'
import { traceCall, Traces } from './traces.js'

export const LIMIT_MS = 15 * 60 * 1000
const WATCH_MS = 250
const SAVE_MS = 300
const RESOLVE = fileURLToPath(new URL('../resolve-layerfs.js', import.meta.url))
const CLI = join(API, 'agent', 'cli', 'src', 'layerfs.js')
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
   */
  constructor({ spec, demo, record, emit, loadSeed, loadChecks }) {
    this.spec = spec
    this.source = demo
    this.scenario = demo.scenario
    this.emit = emit
    this.loadSeed = loadSeed
    this.loadChecks = loadChecks
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
    this.traces = new Traces((line, agent) => this.call(line, agent))
    this.agents = new Map()
    for (const [name, steps] of Object.entries(this.scenario.agents)) this.agents.set(name, new Agent(this, name, steps))
    for (const [child, parent] of this.scenario.parents) this.agents.get(child).parent = this.agents.get(parent)
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve))
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
      demo: this.source.id,
      project: this.project,
      state: this.state,
      started: this.started,
      ended: this.ended,
      error: this.error,
      done: agents.reduce((n, a) => n + a.index, 0),
      of: agents.reduce((n, a) => n + a.steps.length, 0),
      phase: this.phase,
    }
  }

  detail() {
    return {
      ...this.summary(),
      agents: [...this.agents.values()].map((a) => a.view()),
      steps: this.steps,
      messages: this.messages,
      captured: this.captured,
      checks: this.checks,
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
    const value = { ...this.detail(), volume: this.volume ?? null, image: this.image ?? null, dir: this.dir, scenarioDir: this.source.folder, host: process.pid }
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(value))
    renameSync(`${file}.tmp`, file)
  }

  changed(now = false) {
    this.emit({ type: 'run', run: this.summary() })
    this.save(now)
  }

  agentChanged(agent) {
    this.emit({ type: 'agent', run: this.id, agent: agent.view() })
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
  }

  // ---------- processes ----------

  /** The environment of an agent's bash call labelled `label`. */
  env(agent, label) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LAYERFS_')))
    return {
      ...env,
      ...layerfsEnv(this.spec, { name: this.project, volume: this.volume, image: this.image }),
      PATH: `${this.bin}:${process.env.PATH ?? ''}`,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${RESOLVE}`].filter(Boolean).join(' '),
      LAYERFS_TRACE: join(this.traceDir, `${agent.name}.jsonl`),
      LAYERFS_TRACE_STEP: label,
      LAYERFS_TRACE_START: '1',
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

  /** Inits the project, then plays the agents until the run ends. */
  async play() {
    this.limit = setTimeout(() => this.fail(`over the ${LIMIT_MS / 60000}-minute limit`), LIMIT_MS - (Date.now() - this.started))
    this.limit.unref()
    try {
      for (const dir of [this.work, this.bin, this.traceDir]) mkdirSync(dir, { recursive: true })
      const shim = join(this.bin, 'layerfs')
      writeFileSync(shim, `#!/bin/sh\nexec node --import ${q(RESOLVE)} ${q(CLI)} "$@"\n`)
      chmodSync(shim, 0o755)
      await this.init()
      if (this.over) return
      this.state = 'running'
      this.changed(true)
      for (const agent of this.agents.values()) this.traces.follow(agent.name, join(this.traceDir, `${agent.name}.jsonl`))
      this.traces.start()
      this.agents.get('root').turn()
    } catch (error) {
      this.fail(`${error.code ? `${error.code}: ` : ''}${error.message}`)
    }
    await this.finished
  }

  async init() {
    const { scenario } = this
    let folder = scenario.fixture
    if (scenario.seed) {
      const { writeSeed } = await this.loadSeed()
      folder = writeSeed(scenario.seed, join(this.dir, 'seed'))
    }
    if (!folder) throw Object.assign(new Error('the demo names no fixture'), { code: 'InvalidInput' })
    const runtime = await openRuntime(this.spec)
    let job = await runtime.project.start_init(this.project, folder, scenario.image ? { image: scenario.image } : {})
    while (!job.ended) {
      await pause(WATCH_MS)
      job = (await runtime.project.get_init(job.id)) ?? { ...job, step: 'failed', ended: Date.now(), error: { code: 'Unknown', message: "the runtime no longer has this Init's job" } }
    }
    if (job.step !== 'done') throw Object.assign(new Error(`Init failed: ${job.error?.message ?? 'unknown'}`), { code: job.error?.code ?? 'Failed' })
    this.volume = job.project?.volume ?? null
    this.image = job.project?.image ?? scenario.image ?? null
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
    const project = { name: this.project, volume: this.volume, image: this.image }
    const client = await withProjectEnv(this.spec, project, () => LayerFS.open(this.project))
    try {
      return await mod.finalChecks({ scenario: this.scenario, scenarioDir: this.source.folder, project: this.project, client })
    } finally {
      await client.close()
    }
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

  end(state, error) {
    if (!ACTIVE.has(this.state)) return
    this.state = state
    this.error = error
    this.ended = Date.now()
    clearTimeout(this.limit)
    this.stopWork(state === 'passed' ? 'killed: the run ended' : `killed: the run ${state}`)
    this.traces.stop()
    for (const step of this.steps) if (step.state === 'running') Object.assign(step, { state: 'stopped', ended: this.ended })
    for (const agent of this.agents.values()) if (!['done', 'failed'].includes(agent.state)) agent.setState(state === 'passed' ? agent.state : 'stopped')
    this.changed(true)
    // a run cut short leaves its scripts' Workspaces mounted, so their Sandboxes never go idle
    const cleanup = state === 'passed' ? Promise.resolve() : this.closeSandboxes().catch((e) => console.error(`[runs] ${this.id}: closing Sandboxes: ${e.message}`))
    this.cleanup = cleanup
    cleanup.finally(() => this.resolveFinished())
  }

  /**
   * Unmounts (discarding) every Workspace still mounted in the run's project
   * and closes its Sandboxes: what an agent ends with, done for the agents a
   * failed or stopped run cut off. Each call once; a refusal is logged.
   */
  async closeSandboxes() {
    if (!this.volume) return
    await openRuntime(this.spec)
    const { LayerFS } = await import('@layerfs/agent')
    const project = { name: this.project, volume: this.volume, image: this.image }
    const lf = await withProjectEnv(this.spec, project, () => LayerFS.open(this.project))
    try {
      // background processes keep their Workspace Busy: cancel each once, then wait (bounded) until none runs
      const { LayerFSBackend } = await import('@layerfs/backend')
      const be = LayerFSBackend.of(lf)
      const running = async () => (await be.daemon.process.list(1000, 0)).items.filter((p) => RUNNING.has(p.state ?? p.status))
      for (const p of await running().catch(() => [])) {
        await be.daemon.process.cancel(p.process ?? p.id).catch((e) => console.error(`[runs] ${this.id}: cancel ${p.process ?? p.id}: ${e.message}`))
      }
      for (const until = Date.now() + 10_000; Date.now() < until && (await running().catch(() => [])).length; ) await pause(250)
      const { items } = await lf.project.list_sandboxes(1000, 0)
      for (const { sandbox } of items) {
        try {
          const mounted = await lf.sandbox.list_workspaces(sandbox, 1000, 0)
          for (const w of mounted.items) await lf.workspace.unmount({ sandbox, path: w.path }, true)
          await lf.sandbox.close(sandbox)
        } catch (e) {
          console.error(`[runs] ${this.id}: Sandbox ${sandbox}: ${e.code ?? ''} ${e.message}`)
        }
      }
    } finally {
      await lf.close()
    }
  }
}
