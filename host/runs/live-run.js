// A live session: the user talks with a pi agent (pi-agent.js) on one LayerFS
// project, turn by turn. It is a Run (run.js) with no script: root is a
// PiAgent with bash and subagent tools, the project is used as it is (never
// reset or Inited here), and there are no limits, stuck checks or final
// checks. The session's state is 'running' while a turn works and 'idle'
// between turns; Stop ends the current turn, not the session. Its record
// (run.json, kind 'live') and pi's own session files under <runDir>/pi let a
// later host carry on the conversation where it stopped.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { keyOf, notePostgresql, openRuntime } from '../config.js'
import { PiAgent } from './pi-agent.js'
import { closeRunSandboxes, Run } from './run.js'

const SCRIPTLESS = { agents: {}, parents: [], root: 'root' }
const NAME = /[^a-z0-9-]+/g

export class LiveRun extends Run {
  /**
   * @param {object} o
   * @param {object} o.spec
   * @param {object} o.record run.json so far: id, project, state, started, model, thinkingLevel, … (kind 'live')
   * @param {(event: object) => void} o.emit
   * @param {{ agentModel: (choice?: object) => Promise<object> }} o.models models.js's Models (or a stand-in)
   */
  constructor({ spec, record, emit, models }) {
    super({ spec, demo: { id: null, folder: null, scenario: SCRIPTLESS }, record: { ...record, kind: 'live' }, emit, loadSeed: async () => null, loadChecks: async () => null })
    this.models = models
    /** Views of agents from before a host restart: listed still, though they never run again. */
    this.earlier = (record.agents ?? []).filter((a) => a.name !== this.root)
    this.taken = new Set([this.root, ...this.earlier.map((a) => a.name)])
  }

  summary() {
    const own = super.summary()
    const now = new Set(own.agents.map((a) => a.name))
    return { ...own, demo: null, title: this.title ?? null, model: this.model ?? null, thinkingLevel: this.thinkingLevel ?? null, agents: [...own.agents, ...this.earlier.filter((a) => !now.has(a.name))] }
  }

  /** Opens the session on its project: a new one with `text` as its first message, or one a host restart left (`resume`). */
  async open({ text = null, resume = false } = {}) {
    const found = await this.projectRecord()
    this.volume = found.volume ?? null
    this.image = found.image ?? this.spec.image ?? null
    const resolved = await this.models.agentModel(this.model ? { ...splitModel(this.model), thinking: this.thinkingLevel } : {})
    this.model = `${resolved.model.provider}/${resolved.model.id}`
    this.thinkingLevel = resolved.thinkingLevel
    this.prepare()
    const steps = this.steps.filter((s) => s.agent === this.root).length
    const root = new PiAgent(this, this.root, { prompt: null, ...resolved, subagents: true, resume: resume && existsSync(join(this.dir, 'pi', this.root)), steps })
    this.agents.set(this.root, root)
    this.follow(root, resume)
    this.traces.start()
    this.state = 'idle'
    root.state = 'idle'
    this.changed(true)
    if (text) await this.say(text)
  }

  /** The runtime's record of the session's project; 404 when it is not there or not Inited. */
  async projectRecord() {
    const runtime = await openRuntime(this.spec)
    // `this.project` is the project key: `store/name` in a shared Store (layerfs#506)
    const found = (await runtime.project.list()).find((p) => keyOf(p) === this.project && p.initialized)
    if (!found) throw Object.assign(new Error(`no initialized LayerFS project named ${this.project}`), { code: 'NoSuchProject', status: 404 })
    // a PostgreSQL Store's project (layerfs#506 d): its connection's URL is noted for the session's calls and Sandboxes
    if (found.kind === 'postgresql' && !(await notePostgresql(this.spec, { name: found.name, store: found.store, shared: true }))) {
      throw Object.assign(new Error(`${found.name} is in the PostgreSQL Store ${found.store}, whose connection this host does not hold`), { code: 'Unsupported', status: 409 })
    }
    return found
  }

  /** A name no agent of the session has: the model's own, made safe, numbered when taken. */
  agentName(asked) {
    const base = String(asked ?? '').toLowerCase().replace(NAME, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'helper'
    let name = base
    for (let n = 2; this.taken.has(name); n++) name = `${base}-${n}`
    this.taken.add(name)
    return name
  }

  addAgent(agent) {
    this.agents.set(agent.name, agent)
    this.follow(agent)
  }

  /** Reads an agent's trace file; after a restart, only what it writes from now on. */
  follow(agent, fromEnd = false) {
    const file = join(this.traceDir, `${agent.name}.jsonl`)
    this.traces.follow(agent.name, file)
    const tail = this.traces.files.get(agent.name)
    if (fromEnd && tail && existsSync(file)) tail.offset = statSync(file).size
  }

  /** The user's message: root works on it as the next turn, on the model `choice` names when given. */
  async say(text, choice = null) {
    const body = String(text ?? '').trim()
    if (!body) throw Object.assign(new Error('the message is empty'), { code: 'InvalidInput', status: 400 })
    if (this.state !== 'idle') throw Object.assign(new Error(`${this.root} is still working; stop it or wait for its reply`), { code: 'Busy', status: 409 })
    const root = this.agents.get(this.root)
    if (choice?.provider && choice?.model) {
      const resolved = await this.models.agentModel(choice)
      await root.useModel(resolved)
      this.model = `${resolved.model.provider}/${resolved.model.id}`
      this.thinkingLevel = resolved.thinkingLevel
    }
    this.title ??= body.split('\n')[0].slice(0, 80)
    this.error = null
    this.state = 'running'
    this.changed(true)
    this.message('user', this.root, body)
    root.receive('user', body)
  }

  /** Root's turn ended (pi-agent.js): back to idle; a failure shows as the session's error until the next message. */
  turnEnded(failure) {
    const at = Date.now()
    for (const step of this.steps) if (step.state === 'running') Object.assign(step, { state: 'stopped', ended: at })
    this.live.stopped()
    this.liveChanged(true)
    this.state = 'idle'
    this.error = failure && failure !== 'stopped' ? failure : null
    this.changed(true)
    this.resolveTurn?.()
  }

  /** Stops the current turn: every working agent's request and its running commands. */
  stop() {
    if (this.state !== 'running') return
    const ended = new Promise((resolve) => (this.resolveTurn = resolve))
    for (const agent of this.agents.values()) agent.abort?.()
    this.stopWork('killed: stopped')
    return ended
  }

  fail(reason) {
    if (this.state !== 'running') return
    this.error = reason
    void this.stop()
  }

  checkStuck() {}

  /**
   * The host is closing: a turn still working is stopped, its Sandboxes
   * closed (nothing will finish with them), and the record says so. The
   * session stays idle: a later host carries on the conversation.
   */
  async close() {
    const working = this.state === 'running'
    if (working) {
      const stopped = this.stop()
      await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5000))])
      this.state = 'idle'
      this.error = 'interrupted: the host closed during this turn'
    }
    this.traces.stop()
    clearInterval(this.traces.timer)
    if (working) await closeRunSandboxes(this.spec, { id: this.id, project: this.project, volume: this.volume, image: this.image }).catch((e) => console.error(`[runs] ${this.id}: closing Sandboxes: ${e.message}`))
    this.save(true)
  }
}

/** "provider/model-id" -> { provider, model } (a model id may hold slashes). */
export function splitModel(value) {
  const at = String(value).indexOf('/')
  return at < 0 ? { provider: null, model: value } : { provider: value.slice(0, at), model: value.slice(at + 1) }
}
