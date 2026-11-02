// Scenario chats: a chat on a LayerFS project whose model is a scenario's
// script (scenario-model.js). Its bash runs on the host, as a scenario run's
// did (host/runs/run.js): in a folder /<scenario>_<n>/ of its own on the
// project, on a trunk Branch that stands for main, with every LayerFS call of
// its scripts kept to that folder, its Branches and its Sandboxes (scope.js).
// Each call's trace lines go to the chat's traces/root.jsonl, labelled
// root:<toolCallId> (child-extension.js), for the script's `expect` checks.
// The script's last reply runs the final checks and lands the folder on main;
// a chat stopped or failed before that has its Sandboxes closed.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { layerfsEnv, projectRef } from '../config.js'
import { layerfs } from '../layerfs.js'
import { compileScenario } from '../../tools/lib/scenario.mjs'
import { chatReady } from './scenario-plan.js'

const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const refuse = (status, message) => Object.assign(new Error(message), { status })

export class AgentScenarios {
  /** @param {{ spec: object, dir?: string, machines?: () => Promise<object> }} o config.js's spec, the scenarios folder, and machine.list (a parameter for tests) */
  constructor({ spec, dir = SCENARIOS, machines = null }) {
    this.spec = spec
    this.dir = dir
    this.machines = machines ?? (() => layerfs(this.spec).machine.list())
    /** id -> { mtime, entry } */
    this.cache = new Map()
    /** chat id -> its final verdict, once asked */
    this.finishing = new Map()
  }

  /** Every scenario that loads: { id, title, blurb, prompt, folder, scenario (scoped), chat: null | why it does not play in a chat }. */
  all() {
    if (!existsSync(this.dir)) return []
    const out = []
    for (const id of readdirSync(this.dir).sort()) {
      const file = join(this.dir, id, 'scenario.json')
      if (!existsSync(file)) continue
      const mtime = statSync(file).mtimeMs
      let cached = this.cache.get(id)
      if (cached?.mtime !== mtime) {
        try {
          const folder = join(this.dir, id)
          const raw = JSON.parse(readFileSync(file, 'utf8'))
          const compiled = compileScenario(raw, { name: id, folder, where: file })
          cached = { mtime, entry: { id, folder, compiled, title: raw.title ?? id, blurb: raw.blurb ?? '', prompt: raw.prompt ?? null, order: raw.order ?? 0, notInChat: compiled.blocked ? `It comes with a later LayerFS: it ${compiled.blocked}.` : chatReady(compiled) } }
        } catch (error) {
          cached = { mtime, entry: null }
          process.stderr.write(`connect: scenario ${id} does not load: ${error.message}\n`)
        }
        this.cache.set(id, cached)
      }
      if (cached.entry) out.push(cached.entry)
    }
    return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  /** The scenarios a chat plays, with their script scoped to a folder of their own. */
  playable() {
    return this.all().filter((s) => !s.notInChat).map((s) => ({ ...s, scenario: this.scoped(s) }))
  }

  scoped(entry) {
    entry.scopedScenario ??= this.scopedOf(entry.compiled)
    return entry.scopedScenario
  }

  get(id) {
    return this.playable().find((s) => s.id === id) ?? null
  }

  /**
   * `machine` checked before a chat starts, so a wrong one is refused at
   * once: a machine of this home (machine.list). Null: the project's Store's
   * machine. Sandboxes follow the Store, so a chat on another machine moves
   * the project's Store there first (setup).
   */
  async checkMachine(machine = null) {
    if (machine === null || machine === undefined) return null
    const listed = (await this.machines()).machines ?? []
    if (!listed.some((m) => m.name === machine)) throw refuse(400, `No machine named ${machine}. Machines: ${listed.map((m) => m.name).join(', ')}.`)
    return machine
  }

  /** The chat's scenario state as the record keeps it, before its folder is set up. */
  initial(entry, project, dir, machine = null) {
    return { id: entry.id, title: entry.title, project, machine, dir, folder: null, scopeDir: null, state: 'preparing', phase: 'Setting up its folder', checks: [], error: null, swept: false }
  }

  /** Sets up the chat's folder on the project (folder.js), and the `layerfs` command its bash finds. */
  async setup(record, onPhase = () => {}) {
    const s = record.scenario
    const entry = this.get(s.id)
    if (!entry) throw new Error(`No scenario named ${s.id} plays in a chat.`)
    const [{ placeRun, setupFolder }, { writeSeed }, { writeShims }] = await Promise.all([import('../runs/folder.js'), import('../seed.js'), import('../runs/shim.js')])
    mkdirSync(join(s.dir, 'work'), { recursive: true })
    writeShims(this.spec, s.dir)
    let fixture = entry.compiled.fixture
    if (entry.compiled.seed) fixture = writeSeed(entry.compiled.seed, join(s.dir, 'seed'))
    if (!fixture) throw new Error(`${entry.title} names no fixture.`)
    if (s.machine) await placeRun(this.spec, s.project, s.machine, onPhase)
    s.scopeDir = join(s.dir, 'scope')
    const { run } = await setupFolder(this.spec, { scenarioId: s.id, fixture, project: s.project, scopeDir: s.scopeDir, phase: onPhase, machine: s.machine ?? null })
    s.folder = run
  }

  /** The bash environment overrides of the chat's calls: the home, its project key, its scope, and the `layerfs` shim. */
  async env(record) {
    const s = record.scenario
    if (!s.scopeDir) throw Object.assign(new Error('The scenario is still setting up its folder.'), { status: 409 })
    return {
      ...layerfsEnv(this.spec),
      LAYERFS_CONNECT_PROJECT: projectRef(s.project).key,
      PATH: `${join(s.dir, 'bin')}:${process.env.PATH ?? ''}`,
      [this.scopeEnv]: s.scopeDir,
      LAYERFS_CONNECT_MACHINE: (await import('../runs/scope.js')).Scope.open(s.scopeDir).machine ?? '',
    }
  }

  /** The finished trace lines of one bash call of the chat (`traceDir`/root.jsonl). */
  traceOf(traceDir, callId) {
    const file = join(traceDir, 'root.jsonl')
    if (!existsSync(file)) return []
    const label = `root:${callId}`
    const lines = []
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      if (!raw.includes(label)) continue
      try {
        const line = JSON.parse(raw)
        if (line?.layerfs_trace === 1 && line.phase !== 'start' && line.step === label) lines.push(line)
      } catch {
        // a line being written
      }
    }
    return lines
  }

  /** The final checks and the landing on main, once per chat: the verdict line the last reply ends with. */
  finish(record, onChange = () => {}) {
    if (!this.finishing.has(record.id)) {
      this.finishing.set(record.id, this.verdict(record, onChange).finally(() => onChange()))
    }
    return this.finishing.get(record.id)
  }

  async verdict(record, onChange) {
    const s = record.scenario
    const entry = this.get(s.id)
    s.phase = 'Final checks'
    onChange()
    let checks
    try {
      checks = await this.finalChecks(s, entry)
    } catch (error) {
      checks = [{ name: 'final', ok: false, detail: `${error.code ? `${error.code}: ` : ''}${error.message}` }]
    }
    if (checks.every((c) => c.ok)) {
      s.phase = 'Landing on main'
      onChange()
      try {
        const { landOnMain } = await import('../runs/folder.js')
        const { Scope } = await import('../runs/scope.js')
        const { ok, detail } = await landOnMain(this.spec, { project: s.project, scope: Scope.open(s.scopeDir) })
        checks.push({ name: 'main.landed', ok, detail })
      } catch (error) {
        checks.push({ name: 'main.landed', ok: false, detail: `${error.code ? `${error.code}: ` : ''}${error.message}` })
      }
    }
    const failed = checks.filter((c) => !c.ok)
    Object.assign(s, { checks, phase: null, ...(failed.length ? {} : { done: s.of ?? s.done }), state: failed.length ? 'failed' : 'passed', error: failed.length ? `final checks failed: ${failed.map((c) => c.name).join(', ')}` : null })
    if (failed.length) await this.release(record)
    return failed.length
      ? `**Final checks failed.**\n${failed.map((c) => `- ${c.name}: ${c.detail}`).join('\n')}`
      : `**Final checks passed.** ${checks.find((c) => c.name === 'main.landed')?.detail ?? `/${s.folder} is on main`}.`
  }

  async finalChecks(s, entry) {
    let mod
    try { mod = await import('../checks/index.js') } catch { return [] }
    if (!mod?.finalChecks) return []
    const [{ Scope }, { projectHandle }] = await Promise.all([import('../runs/scope.js'), import('../runs/folder.js')])
    const scope = Scope.open(s.scopeDir)
    const client = await projectHandle(this.spec, s.project, scope.machine)
    return mod.finalChecks({ scenario: entry.scenario, scenarioDir: entry.folder, project: client.project, client, scope })
  }

  /** A chat stopped or failed before its scenario passed: its scripts' Sandboxes are closed, once. */
  async release(record, state = null) {
    const s = record.scenario
    if (!s) return
    if (state && ['preparing', 'playing'].includes(s.state)) s.state = state
    if (s.state === 'passed' || s.swept || !s.scopeDir) return
    s.swept = true
    const { closeRunSandboxes } = await import('../runs/run.js')
    await closeRunSandboxes(this.spec, { id: record.id, project: s.project, scopeDir: s.scopeDir })
      .catch((error) => console.error(`[scenarios] ${record.id}: closing Sandboxes: ${error.message}`))
  }

  /** Loads scope.js (it is part of the scenario engine) before scripts are scoped. */
  async ready() {
    const { scopedScenario, SCOPE_ENV } = await import('../runs/scope.js')
    this.scopedOf = scopedScenario
    this.scopeEnv = SCOPE_ENV
    return this
  }
}
