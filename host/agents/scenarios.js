// Scenario chats: a chat on a LayerFS project whose model is a scenario's
// script (scenario-model.js). Its bash runs on the host, as a scenario run's
// did (host/runs/run.js): in a folder /<scenario>_<n>/ of its own on the
// project, on a trunk Branch that stands for main, with every LayerFS call of
// its scripts kept to that folder, its Branches and its Sandboxes (scope.js).
// Each call's trace lines go to the chat's traces/root.jsonl, labelled
// root:<toolCallId> (child-extension.js), for the script's `expect` checks.
// The script's last reply runs the final checks and lands the folder on main;
// a chat stopped or failed before that has its Sandboxes closed.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API, layerfsEnv, notePostgresql, openRuntime, projectRef, storeOf, withProjectEnv } from '../config.js'
import { compileScenario } from '../../tools/lib/scenario.mjs'
import { chatReady } from './scenario-plan.js'

const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const RESOLVE = fileURLToPath(new URL('../resolve-layerfs.js', import.meta.url))
const CLI = join(API, 'cli', 'src', 'layerfs.js')
const q = (s) => `'${String(s).replaceAll("'", "'\\''")}'`

export class AgentScenarios {
  /** @param {{ spec: object, dir?: string }} o config.js's spec, and the scenarios folder */
  constructor({ spec, dir = SCENARIOS }) {
    this.spec = spec
    this.dir = dir
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
          cached = { mtime, entry: { id, folder, compiled, title: raw.title ?? id, blurb: raw.blurb ?? '', prompt: raw.prompt ?? null, order: raw.order ?? 0, notInChat: chatReady(compiled) } }
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

  /** The chat's scenario state as the record keeps it, before its folder is set up. */
  initial(entry, project, dir) {
    return { id: entry.id, title: entry.title, project, dir, folder: null, scopeDir: null, volume: null, image: null, state: 'preparing', phase: 'Setting up its folder', checks: [], error: null, swept: false }
  }

  /** Sets up the chat's folder on the project (folder.js), and the `layerfs` command its bash finds. */
  async setup(record, onPhase = () => {}) {
    const s = record.scenario
    const entry = this.get(s.id)
    if (!entry) throw new Error(`No scenario named ${s.id} plays in a chat.`)
    const [{ projectRecord, setupFolder }, { writeSeed }] = await Promise.all([import('../runs/folder.js'), import('../seed.js')])
    const bin = join(s.dir, 'bin')
    for (const dir of [join(s.dir, 'work'), bin]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(bin, 'layerfs'), `#!/bin/sh\nexec node --import ${q(RESOLVE)} ${q(CLI)} "$@"\n`)
    chmodSync(join(bin, 'layerfs'), 0o755)
    let fixture = entry.compiled.fixture
    if (entry.compiled.seed) fixture = writeSeed(entry.compiled.seed, join(s.dir, 'seed'))
    if (!fixture) throw new Error(`${entry.title} names no fixture.`)
    const project = await projectRecord(this.spec, s.project)
    // a PostgreSQL Store's project has no volume: its calls need the connection's URL (layerfs#506 d)
    if (project.kind === 'postgresql' && !(await notePostgresql(this.spec, { name: project.name, store: storeOf(project), shared: true }))) {
      throw new Error(`${project.name} is in the PostgreSQL Store ${storeOf(project)}, whose connection this host does not hold`)
    }
    s.volume = project.volume ?? null
    s.image = project.image ?? null
    s.scopeDir = join(s.dir, 'scope')
    const { run } = await setupFolder(this.spec, { scenarioId: s.id, fixture, project, scopeDir: s.scopeDir, phase: onPhase })
    s.folder = run
  }

  /**
   * A project of a PostgreSQL Store has no volume: its connection's URL is
   * noted in this process (config.js notePostgresql) before its calls, also
   * after the host restarts.
   */
  async noteStore(s) {
    if (!s.volume) await notePostgresql(this.spec, s.project)
  }

  /** The bash environment overrides of the chat's calls: its project, its scope, and the `layerfs` shim. */
  async env(record) {
    const s = record.scenario
    if (!s.scopeDir) throw Object.assign(new Error('The scenario is still setting up its folder.'), { status: 409 })
    await this.noteStore(s)
    return {
      ...layerfsEnv(this.spec, { ...projectRef(s.project), volume: s.volume, image: s.image }),
      PATH: `${join(s.dir, 'bin')}:${process.env.PATH ?? ''}`,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${RESOLVE}`].filter(Boolean).join(' '),
      [this.scopeEnv]: s.scopeDir,
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
        await this.noteStore(s)
        const { ok, detail } = await landOnMain(this.spec, { project: { ...projectRef(s.project), volume: s.volume, image: s.image }, scope: Scope.open(s.scopeDir) })
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
    await openRuntime(this.spec)
    const { LayerFS } = await import('@layerfs/agent')
    const { Scope } = await import('../runs/scope.js')
    const project = { ...projectRef(s.project), volume: s.volume, image: s.image }
    await this.noteStore(s)
    const client = await withProjectEnv(this.spec, project, () => LayerFS.open(project.name))
    try {
      return await mod.finalChecks({ scenario: entry.scenario, scenarioDir: entry.folder, project: project.name, client, scope: Scope.open(s.scopeDir) })
    } finally {
      await client.close()
    }
  }

  /** A chat stopped or failed before its scenario passed: its scripts' Sandboxes are closed, once. */
  async release(record, state = null) {
    const s = record.scenario
    if (!s) return
    if (state && ['preparing', 'playing'].includes(s.state)) s.state = state
    if (s.state === 'passed' || s.swept || !s.scopeDir) return
    s.swept = true
    const { closeRunSandboxes } = await import('../runs/run.js')
    await closeRunSandboxes(this.spec, { id: record.id, project: s.project, volume: s.volume, image: s.image, scopeDir: s.scopeDir })
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
