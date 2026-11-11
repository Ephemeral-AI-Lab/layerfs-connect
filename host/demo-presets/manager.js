import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { request as httpRequest } from 'node:http'
import { EventEmitter } from 'node:events'
import { CONTENT_VERSION, presets, presetOf } from '../../tools/demo/presets.mjs'
import { DemoRunner } from '../../tools/demo/runner.mjs'
import { projectDefinition } from '../../tools/demo/projects.mjs'
import { projectHistoryPlan } from '../../tools/demo/recipe.mjs'
import { MIXED_RECIPE_VERSION } from '../../tools/demo/mixed-recipe.mjs'
import { prepareBuild, buildPreset, presetScript } from '../../tools/demo/build.mjs'
import { EnvironmentReset } from '../environment-reset.js'
import { scriptPage } from '../../tools/demo/script-page.mjs'
import { StepJournal } from '../../tools/demo/step-journal.mjs'
import { CliDriver } from '../../tools/demo/drivers.mjs'
import { activityRecorder } from '../activity/recorder.js'
import { activityRoute } from '../activity/routes.js'
import { exclusiveActivity } from '../activity/gate.js'
import { activityGeneration } from '../activity/gate.js'
import { liveReceipt } from './admission.js'

const error = (status, code, message) => Object.assign(new Error(message), { status, code })
const busy = message => error(409, 'ConnectBusy', message)
const knownPreset = name => { try { presetOf(name); return true } catch { return false } }
const modeOf = value => { const mode = value ?? 'filesystem'; if (!['filesystem', 'mixed'].includes(mode)) throw error(400, 'InvalidInput', 'Choose Filesystem or Mixed execution mode.'); return mode }
const pending = job => job && ['queued', 'running'].includes(job.state)
const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const save = (file, value) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, file) }
const revisionOf = manifest => manifest ? `${manifest.id}:${createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}` : null

/** Hosts stay private; only the original authenticated gateway is exposed to the renderer. */
export class PresetManager extends EventEmitter {
  constructor({ spec, entry, originalBusy = () => [], root = process.env.LAYERFS_CONNECT_DEMO_ROOT || join(homedir(), '.layerfs-connect-demo'), driverFactory = (spec, report) => new CliDriver(spec, report) }) {
    super()
    this.spec = spec; this.entry = entry; this.originalBusy = originalBusy; this.root = resolve(root); this.driverFactory = driverFactory
    this.contexts = new Map(); this.active = 'original'; this.switching = false; this.mutations = 0; this.streams = new Set(); this.transitionReaders = new Set()
    this.file = join(spec.state, 'demo-preset-jobs.json')
    this.jobs = new Map((read(this.file) ?? []).map(job => [job.id, pending(job) ? { ...job, state: 'interrupted', ended: Date.now(), phase: 'Interrupted. Inspect CLI Activity before another operation.' } : job]))
    this.persist()
  }
  persist() { save(this.file, [...this.jobs.values()]) }
  publish(job) { this.persist(); this.emit('event', { type: 'demo-preset', jobId: job.id, preset: job.preset }) }
  reporter(job) {
    let last = 0
    return text => {
      job.phase = text.slice(0, 240)
      const cleared = text.startsWith('Previous CLI Activity')
      if (cleared) job.historyCleared = true
      if (cleared || Date.now() - last >= 250) { last = Date.now(); this.publish(job) }
    }
  }
  context(name) {
    presetOf(name)
    if (!this.contexts.has(name)) {
      const state = join(this.root, name)
      this.contexts.set(name, { id: name, state, spec: { ...this.spec, state, home: join(state, 'home-2'), runs: join(state, 'runs') }, local: resolve(state) === resolve(this.spec.state), endpoint: null, child: null })
    }
    return this.contexts.get(name)
  }
  latest(name) { return [...this.jobs.values()].reverse().find(job => job.preset === name) ?? null }
  definition(name, requestedMode) {
    const preset = presetOf(name), context = this.context(name), manifest = read(join(context.state, 'demo-fixtures.json'))
    let job = this.latest(name)
    const operation = manifest?.presetOperation
    if (operation && operation.actionId !== job?.actionId && !(job?.command === 'environment-reset' && (pending(job) || operation.actionId === job.rebuildActionId)) && (!job || operation.created >= job.created)) {
      job = { ...operation, requestId: `terminal-${operation.actionId}` }
      if (pending(job)) { try { process.kill(job.pid, 0) } catch (e) { if (e.code === 'ESRCH') Object.assign(job, { state: 'interrupted', phase: 'The CLI process ended without a final result. Inspect CLI Activity before continuing.' }); else throw e } }
    }
    const executionMode = modeOf(requestedMode ?? manifest?.executionMode)
    const stores = preset.stores.length
    const projectDefinitions = preset.stores.flatMap(store => store.projects.map(name => {
      const definition = projectDefinition(name), plan = projectHistoryPlan(name, { executionMode })
      return { store: store.name, name, title: definition.title, description: definition.description, branches: plan.branches, history: plan.history, tier: plan.tier, cycles: plan.cycles, layers: plan.layers, commands: plan.commands, workspaceRevisions: plan.workspaceRevisions, authoredRevisions: plan.authoredRevisions, sandboxLimit: plan.sandboxLimit, workspaceLimit: plan.workspaceLimit }
    }))
    const contentReady = (manifest?.executionMode ?? 'filesystem') === executionMode && manifest?.contentVersion === CONTENT_VERSION && (executionMode !== 'mixed' || manifest?.mixedRecipeVersion === MIXED_RECIPE_VERSION) && job?.state === 'completed' && !!job?.presetVerified
    return { id: name, executionMode, contentVersion: CONTENT_VERSION, contentReady, projectDefinitions, machineDefinitions: preset.machines.map(machine => typeof machine === 'string' ? { name: machine, platform: machine } : machine), projectGroups: preset.stores.map(store => ({ store: store.name, machine: store.machine, projects: store.projects })), description: preset.description, machines: preset.machines.map(m => typeof m === 'string' ? m : m.name), stores, projects: preset.stores.reduce((n, s) => n + s.projects.length, 0), sandboxes: executionMode === 'mixed' ? preset.stores.reduce((n, store) => n + store.projects.length, 0) : preset.sandboxes === false ? 0 : stores, workspaces: executionMode === 'mixed' ? 0 : preset.sandboxes === false ? 0 : stores * 2, requirements: [
      ...(preset.stores.some(s => s.machine === 'docker') ? ['Docker and a matching Linux bundle'] : []),
      ...(preset.machines.some(m => typeof m !== 'string') ? ['Lima and a matching Linux bundle'] : []),
      ...((executionMode === 'mixed' || stores && preset.sandboxes !== false) ? ['Matching native daemon for sandbox workspaces'] : []),
    ], coverage: executionMode === 'mixed' ? 'CLI-backed histories with at least 30% of authored revisions committed through reused sandbox workspaces. Current content verification is recorded per build.' : name === 'native' ? 'Verified through the real CLI without sandboxes. Sandbox creation is unverified.' : name === 'empty' ? 'Initialization and reset verified through the real CLI. No fixture resources or workers are started.' : 'CLI-backed files and history only. Current content verification is recorded per build.', state: context.state, home: context.spec.home, initialized: !!manifest?.homeId, settings: manifest ? { sandboxes: manifest.sandboxes, executionMode: manifest.executionMode ?? 'filesystem' } : null, revision: revisionOf(manifest), job }
  }
  list() { const items = Object.keys(presets).map(name => this.definition(name)); return { items, active: this.active, original: { home: this.spec.home, job: this.latest('original') }, busy: this.switching || [...this.jobs.values()].some(pending) || items.some(p => pending(p.job)) || [...this.contexts.values()].some(c => !!liveReceipt(join(c.state, 'demo-fixtures.lock'))) || !!liveReceipt(join(this.spec.state, 'demo-fixtures.lock')) } }
  async script(name, sandboxes = true, query = new URLSearchParams()) {
    const executionMode = modeOf(query.get('executionMode') ?? undefined)
    const paged = query.has('offset')
    this.scriptSnapshots ??= new Map()
    const snapshotId = query.get('snapshot')
    let cached = snapshotId ? this.scriptSnapshots.get(snapshotId) : undefined
    if (snapshotId && (!cached || cached.name !== name || cached.sandboxes !== sandboxes || cached.executionMode !== executionMode)) throw error(409, 'Conflict', 'This script preview expired. Close and reopen it to load the current plan.')
    if (cached) return { ...scriptPage(cached.script, Object.fromEntries(query)), snapshot: snapshotId }
    const spec = this.context(name).spec
    let resetPlan, resetNote = 'Build initializes this private home, discovers its resources and generates recursive cleanup commands at runtime.'
    if (existsSync(join(spec.home, 'layerfs.json'))) {
      try {
        const driver = this.driverFactory(spec)
        await driver.discover()
        resetPlan = await new EnvironmentReset({ spec, driver }).plan()
        resetNote = 'Cleanup commands below reflect the current inventory. Build checks inventory again before executing.'
      } catch { resetNote = 'Current inventory could not be fully inspected. Build will discover cleanup targets before execution; this preview does not claim the environment is empty.' }
    }
    const script = presetScript({ preset: name, spec, sandboxes, executionMode, resetPlan, resetNote })
    if (!paged) return script
    const id = randomUUID()
    this.scriptSnapshots.set(id, { name, sandboxes, executionMode, script })
    while (this.scriptSnapshots.size > 2) this.scriptSnapshots.delete(this.scriptSnapshots.keys().next().value)
    return { ...scriptPage(script, Object.fromEntries(query)), snapshot: id }
  }
  async buildPlan(name, sandboxes = true, executionMode = 'filesystem') {
    executionMode = modeOf(executionMode)
    if (this.list().busy) throw busy('Wait for active operations to finish before building.')
    const spec = this.context(name).spec
    return { ...await prepareBuild({ spec, preset: name, sandboxes, executionMode, driver: this.driverFactory(spec) }), environment: name }
  }
  async environmentPlan(name) {
    if (this.list().busy) throw busy('Wait for active operations to finish before planning reset.')
    const spec = name === 'original' ? this.spec : this.context(name).spec
    const reset = new EnvironmentReset({ spec, driver: this.driverFactory(spec) })
    await reset.driver.discover()
    return { ...await reset.plan(), environment: name }
  }
  async resetEnvironment(name, body) {
    if (!body || !/^[\w-]{1,80}$/.test(body.requestId ?? '') || typeof body.expectedPlan !== 'string' || body.confirm !== true || typeof body.rebuild !== 'boolean' || typeof body.sandboxes !== 'boolean') throw error(400, 'InvalidInput', 'Review and confirm the environment reset plan.')
    if (name === 'original' && body.rebuild) throw error(400, 'InvalidInput', 'Choose a preset before rebuilding.')
    const executionMode = modeOf(body.executionMode)
    const fingerprint = JSON.stringify([name, 'environment-reset', body.expectedPlan, body.rebuild, body.sandboxes, executionMode])
    const duplicate = [...this.jobs.values()].find(j => j.requestId === body.requestId)
    if (duplicate) { if (duplicate.fingerprint !== fingerprint) throw error(409, 'Conflict', 'This request ID was already used with different settings.'); return duplicate }
    if (this.list().busy) throw busy('Another environment operation is in progress.')
    this.switching = true
    try {
      const context = name === 'original' ? null : this.context(name), spec = context?.spec ?? this.spec
      await this.idle(this.active === 'original' ? null : this.context(this.active)); await this.idle(context)
      if (context?.child || context?.lost) await this.closeContext(context)
      const job = { id: randomUUID(), requestId: body.requestId, fingerprint, preset: name, command: 'environment-reset', executionMode, rebuild: body.rebuild, actionId: null, state: 'queued', phase: 'Checking environment', created: Date.now(), historyCleared: false, actionIds: [], progress: { stage: 'checking', completed: 0, total: null, label: 'Checking environment' } }
      this.jobs.set(job.id, job); this.publish(job)
      const report = this.reporter(job)
      const progress = value => { job.progress = value; this.publish(job) }
      const driver = this.driverFactory(spec, report)
      const reset = new EnvironmentReset({ spec, driver, report, progress })
      let admitted, rejected
      const ready = new Promise((yes, no) => { admitted = yes; rejected = no })
      const onReady = async action => { Object.assign(job, { actionId: action.id, actionIds: [action.id], state: 'running', started: Date.now() }); this.active = name; this.endStreams(); this.publish(job); admitted(job) }
      const options = { expectedPlan: body.expectedPlan, assertIdle: () => this.idle(context), onReady }
      const operation = body.rebuild
        ? buildPreset({ spec, preset: name, driver, sandboxes: body.sandboxes, executionMode, ...options, report, progress,
          onCleanup: receipt => { job.cleanup = receipt; this.publish(job) },
          onBuildReady: action => { job.rebuildActionId = action.id; job.actionIds.push(action.id); this.publish(job) } })
        : reset.run(options)
      const task = operation.then(async result => {
        const receipt = body.rebuild ? result.cleanup : result
        job.cleanup = receipt
        if (body.rebuild) job.presetVerified = result.presetVerified
        else {
          const file = join(spec.state, 'demo-fixtures.json'), manifest = read(file)
          if (manifest?.tool === 'layerfs-connect-demo' && manifest.homeId === receipt.homeId && receipt.verified) {
            const journal = new StepJournal(join(spec.state, 'demo-steps.ndjson')); journal.clear(); manifest.stepJournal = journal.metadata(); delete manifest.activityCapture
            Object.assign(manifest, { resources: { machine: {}, store: {}, sandbox: {} }, projects: {}, steps: {}, borrowed: {}, lastSetupActionId: null, sandboxes: body.sandboxes }); save(file, manifest)
          }
        }
        Object.assign(job, { state: 'completed', phase: body.rebuild ? 'Environment reset verified. Selected preset rebuilt and verified.' : 'Environment is empty. Reset verified.', ended: Date.now() })
      }).catch(e => {
        const receipt = read(join(spec.state, 'environment-reset.json'))
        Object.assign(job, { state: 'failed', cleanup: receipt?.actionId === job.actionId ? receipt : job.cleanup, error: { code: e.code ?? 'Failed', message: e.message }, phase: e.message, ended: Date.now() }); rejected(e)
      }).finally(async () => {
        this.switching = true
        try { if (context?.monitor) await this.closeContext(context) }
        catch (e) { Object.assign(job, { state: 'failed', phase: e.message, error: { code: e.code ?? 'Failed', message: e.message } }) }
        this.publish(job); this.endStreams(); this.releaseReaders(); this.tasks.delete(task)
      })
      this.tasks ??= new Set(); this.tasks.add(task)
      return await ready
    } finally { this.releaseReaders() }
  }
  async cleanupPlan(name, command) {
    if (this.list().busy) throw busy('Wait for the preset operation to finish before planning cleanup.')
    const context = this.context(name), runner = new DemoRunner({ state: context.state, preset: name, driver: this.driverFactory(context.spec) })
    runner.acquire()
    try {
      runner.load(); await runner.driver.discover()
      const revision = this.definition(name).revision
      const plan = await runner.cleanupPlan(command === 'reset')
      if (revision !== this.definition(name).revision) throw busy('The preset changed while planning cleanup. Refresh the plan.')
      return { ...plan, revision, home: context.spec.home, command }
    } finally { runner.release() }
  }
  async endpoint(context, { monitor = false } = {}) {
    if (context.local) return null
    if (context.endpoint) return context.endpoint
    const receipt = read(join(context.state, 'host.json'))
    if (receipt) {
      let live = false
      try { process.kill(receipt.pid, 0); live = true } catch (e) { if (e.code !== 'ESRCH') throw e }
      if (live) throw busy('Another host owns this demo environment. Stop that preview or choose another preset; it will not be taken over.')
    }
    context.endpoint = new Promise((resolveReady, reject) => {
      context.monitor = monitor
      const child = spawn(process.execPath, [this.entry, '--state', context.state], { env: { ...process.env, LAYERFS_CONNECT_PRESET_CHILD: '1', LAYERFS_CONNECT_PRESET_MONITOR: monitor ? '1' : '0', LAYERFS_CONNECT_CLI: this.spec.cli, ...(this.spec.daemon ? { LAYERFS_CONNECT_DAEMON: this.spec.daemon } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
      context.child = child
      const timer = setTimeout(() => { reject(error(503, 'Unavailable', 'The demo host did not start within 30 seconds. Inspect its state before continuing.')); child.stdin.end() }, 30000)
      child.stderr.resume() // Never forward authentication receipts or raw child output to the renderer.
      createInterface({ input: child.stdout }).once('line', line => {
        try { const result = JSON.parse(line); if (!result.ready) throw new Error(result.error); clearTimeout(timer); resolveReady({ url: result.url, token: result.token }) }
        catch { clearTimeout(timer); child.stdin.end(); reject(error(503, 'Unavailable', 'The demo host could not start. Check the configured CLI and daemon.')) }
      })
      child.once('error', () => { clearTimeout(timer); reject(error(503, 'Unavailable', 'The demo host could not launch. Check the Node runtime.')) })
      child.once('close', () => { clearTimeout(timer); reject(error(503, 'Unavailable', 'The demo host ended. Inspect state before continuing.')); context.lost = true })
    })
    return context.endpoint
  }
  releaseReaders() { this.switching = false; for (const resolve of this.transitionReaders) resolve(); this.transitionReaders.clear() }
  async closeContext(context) {
    if (context.child && !context.lost) {
      this.endStreams()
      // Let already admitted page reads finish before retiring their observer.
      if (context.readers) await new Promise(resolve => { (context.readDone ??= new Set()).add(resolve) })
      const child = context.child
      const closed = new Promise((done, reject) => { const timer = setTimeout(() => reject(busy('The demo host is still closing. Wait before retrying.')), 30000); child.once('close', () => { clearTimeout(timer); done() }) })
      child.stdin.end(); await closed
    }
    context.endpoint = null; context.child = null; context.lost = false; context.monitor = false
  }
  async idle(context) {
    if (this.mutations) throw busy('A desktop mutation is in progress. Wait for it to finish before changing environments.')
    const fixture = liveReceipt(join(context?.state ?? this.spec.state, 'demo-fixtures.lock'))
    if (fixture && fixture.pid !== process.pid) throw busy('A terminal preset operation is in progress. Wait for it to finish before switching or resetting.')
    let reasons = []
    if (!context || context.local) reasons = this.originalBusy()
    else if (context.endpoint && !context.lost) {
      const endpoint = await this.endpoint(context)
      const res = await fetch(`${endpoint.url}/api/demo-runtime`, { headers: { authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw busy('The demo host could not confirm that it is idle. Inspect its active work before resetting or switching.')
      reasons = (await res.json()).busy
    }
    if (reasons.length) throw busy(`Wait for active work to finish: ${reasons.join(', ')}.`)
    // Includes direct adapter calls from terminal processes and queued calls.
    const release = exclusiveActivity(context?.state ?? this.spec.state); release()
  }
  async activate(name) {
    if (this.switching || [...this.jobs.values()].some(pending)) throw busy('A preset operation is in progress. Wait for it to finish.')
    this.switching = true
    try {
      await this.idle(this.active === 'original' ? null : this.context(this.active))
      if (name !== 'original') {
        const context = this.context(name)
        const manifest = read(join(context.state, 'demo-fixtures.json'))
        if (!manifest?.homeId) throw error(409, 'InvalidInput', 'Run this preset before opening its environment.')
        // Validate ownership and home identity without creating or seeding resources.
        new DemoRunner({ state: context.state, preset: name, driver: this.driverFactory(context.spec) }).load()
        await this.idle(context)
        await this.endpoint(context)
      }
      this.active = name; this.endStreams()
      return { active: name }
    } finally { this.releaseReaders() }
  }
  async start(name, command, body) {
    this.context(name)
    if (!body || !/^[\w-]{1,80}$/.test(body.requestId ?? '')) throw error(400, 'InvalidInput', 'A valid operation request ID is required.')
    const executionMode = modeOf(body.executionMode)
    const fingerprint = JSON.stringify([name, command, executionMode, body.sandboxes, body.expectedRevision, body.clearActivity, body.expectedCleanup])
    const duplicate = [...this.jobs.values()].find(job => job.requestId === body.requestId)
    if (duplicate) {
      if (duplicate.fingerprint !== fingerprint) throw error(409, 'Conflict', 'This request ID was already used with different settings.')
      if (duplicate.admissionError) throw error(duplicate.admissionError.status, duplicate.admissionError.code, duplicate.admissionError.message)
      return duplicate
    }
    if (typeof body.sandboxes !== 'boolean') throw error(400, 'InvalidInput', 'Choose whether to create sandboxes and workspaces.')
    if (command === 'reset' && body.clearActivity !== true) throw error(400, 'InvalidInput', 'Confirm that reset clears previous CLI Activity in this demo environment.')
    if (command === 'teardown' && !body.expectedCleanup) throw error(400, 'InvalidInput', 'Review the cleanup plan before removing preset resources.')
    if (this.switching || [...this.jobs.values()].some(pending)) throw busy('Another preset operation is in progress.')
    this.switching = true
    let runner, job
    try {
      await this.idle(this.active === 'original' ? null : this.context(this.active))
      const context = this.context(name)
      await this.idle(context)
      if (['reset', 'teardown'].includes(command) && this.definition(name).revision !== body.expectedRevision) throw error(409, 'Conflict', 'The preset changed since confirmation. Refresh and confirm cleanup again.')
      // Shut down only our idle child before resource changes, dropping its caches and pollers.
      if (context.child || context.lost) await this.closeContext(context)
      let admitted, rejected
      const ready = new Promise((yes, no) => { admitted = yes; rejected = no })
      job = { id: randomUUID(), requestId: body.requestId, fingerprint, preset: name, command, executionMode, environment: name, actionId: null, state: 'queued', phase: 'Checking prerequisites', created: Date.now(), historyCleared: false }
      this.jobs.set(job.id, job); this.publish(job)
      const report = this.reporter(job)
      runner = new DemoRunner({ state: context.state, preset: name, executionMode, sandboxes: name === 'empty' ? false : body.sandboxes, driver: this.driverFactory(context.spec, report), report })
      // run() acquires the shared terminal/UI fixture lock and validates the manifest.
      const running = runner.run(command, { onReady: async action => {
        // Publish the new environment only after real home initialization. Page
        // reads may then attach a monitor without racing a fresh CLI home.
        if (!existsSync(join(context.spec.home, 'layerfs.json'))) { await runner.driver.discover(); await runner.initialize() }
        Object.assign(job, { actionId: action.id, state: 'running', phase: command === 'reset' ? 'Rebuilding preset' : 'Creating missing resources', started: Date.now() })
        this.active = name; this.endStreams(); this.publish(job); admitted(job)
      }, beforeReset: () => this.idle(context), expectedCleanup: body.expectedCleanup })
      this.tasks ??= new Set(); this.tasks.add(running)
      const finish = async (failure) => {
        // Replace the observer with a normal host before enabling mutations.
        this.switching = true
        try {
          if (context.monitor) await this.closeContext(context)
          if (failure) throw failure
          const receipt = read(join(context.state, 'demo-fixtures.json'))?.presetOperation
          Object.assign(job, { state: 'completed', phase: receipt?.phase ?? 'Preset operation completed', cleanup: receipt?.cleanup, presetVerified: receipt?.presetVerified, ended: Date.now() }); this.publish(job); this.endStreams()
        } catch (e) {
          const receipt = read(join(context.state, 'demo-fixtures.json'))?.presetOperation
          Object.assign(job, { state: 'failed', cleanup: receipt?.actionId === job.actionId ? receipt.cleanup : undefined, phase: e.message.slice(0, 400), error: { code: e.code ?? 'Failed', message: e.message }, ended: Date.now() })
          if (!job.actionId) job.admissionError = { status: e.status ?? 409, code: e.code ?? 'Failed', message: e.message }
          this.publish(job); this.endStreams(); rejected(e)
        } finally { this.releaseReaders() }
      }
      const completion = running.then(() => finish(), e => finish(e)).finally(() => this.tasks.delete(completion))
      this.tasks.delete(running); this.tasks.add(completion)
      return await ready
    } finally { this.releaseReaders() }
  }
  async route(method, parts, body, query = new URLSearchParams()) {
    if (parts.length > 2) throw error(404, 'NotFound', 'Unknown preset route.')
    const [id, operation] = parts
    if (method === 'GET' && !id) return this.list()
    if (method === 'GET' && id === 'requests' && operation) {
      const job = [...this.jobs.values()].find(job => job.requestId === operation)
      if (!job) throw error(404, 'NotFound', 'This request has not been admitted. Dismiss this message and choose Run or Reset explicitly.')
      return job
    }
    if (method === 'GET' && id === 'jobs' && operation) {
      const job = this.jobs.get(operation)
      if (!job) throw error(404, 'NotFound', 'This preset operation is no longer available.')
      return job
    }
    if ((id === 'original' || knownPreset(id)) && operation === 'environment-plan' && method === 'GET') return this.environmentPlan(id)
    if ((id === 'original' || knownPreset(id)) && operation === 'environment-reset' && method === 'POST') return this.resetEnvironment(id, body)
    if (id === 'original' && operation === 'activate' && method === 'POST') return this.activate('original')
    if (!knownPreset(id)) throw error(404, 'NotFound', 'Unknown demo preset.')
    if (method === 'GET' && !operation) return this.definition(id, query.get('executionMode') ?? undefined)
    if (method === 'GET' && ['build-plan', 'build-plan-no-sandboxes'].includes(operation)) return this.buildPlan(id, operation === 'build-plan', query.get('executionMode') ?? undefined)
    if (method === 'GET' && ['script', 'script-no-sandboxes'].includes(operation)) return this.script(id, operation === 'script', query)
    if (method === 'GET' && ['reset-plan', 'teardown-plan'].includes(operation)) return this.cleanupPlan(id, operation === 'reset-plan' ? 'reset' : 'teardown')
    if (method === 'POST' && operation === 'activate') return this.activate(id)
    if (method === 'POST' && ['run', 'reset', 'teardown'].includes(operation)) return this.start(id, operation === 'run' ? 'setup' : operation, body)
    throw error(404, 'NotFound', 'Unknown preset operation.')
  }
  endStreams() { for (const end of this.streams) end(); this.streams.clear(); this.emit('environment') }
  async forward(req, res, url, send) {
    if (url.pathname.startsWith('/api/demo-presets')) return false
    if (url.pathname.startsWith('/api/cli-activity')) {
      const context = this.active === 'original' ? null : this.context(this.active)
      const state = context?.state ?? this.spec.state, home = context?.spec.home ?? this.spec.home
      const recorder = activityRecorder(state)
      const isState = url.pathname === '/api/cli-activity/state', isClear = url.pathname === '/api/cli-activity/clear'
      if (isState && req.method === 'GET') {
        let blocked = this.list().busy
        if (!blocked) { try { await this.idle(context) } catch { blocked = true } }
        send(res, 200, { environment: this.active, home, busy: blocked, generation: activityGeneration(state), clearedAt: read(join(state, 'logs', 'cli-control', 'generation.json'))?.clearedAt ?? null }); return true
      }
      if (isClear && req.method === 'POST') {
        if (this.list().busy) throw busy('Wait for the preset operation to finish before clearing history.')
        this.switching = true
        try {
          let input = ''; for await (const chunk of req) { input += chunk; if (input.length > 4096) throw error(400, 'InvalidInput', 'Clear history request is too large.') }
          let body; try { body = JSON.parse(input) } catch { throw error(400, 'InvalidInput', 'Invalid clear history request.') }
          if (body.confirm !== true || body.home !== home || body.generation !== activityGeneration(state)) throw error(409, 'Conflict', 'The environment or history changed. Review Clear history again.')
          await this.idle(context)
          await recorder.clear()
          send(res, 200, { cleared: true, clearedAt: read(join(state, 'logs', 'cli-control', 'generation.json'))?.clearedAt }); return true
        } finally { this.releaseReaders() }
      }
      const answer = await activityRoute(recorder, req.method, url.pathname.split('/').filter(Boolean).slice(2), url.searchParams)
      send(res, answer === undefined ? 404 : 200, answer ?? null); return true
    }
    if (this.switching && !url.pathname.startsWith('/api/cli-activity')) {
      if (req.method !== 'GET') throw busy('A preset environment is changing. Changes are available after admission finishes.')
      await new Promise(resolve => this.transitionReaders.add(resolve))
    }
    if (this.active === 'original') {
      if (this.latest('original') && pending(this.latest('original')) && req.method !== 'GET') throw busy('The environment is resetting. You can keep browsing its pages.')
      return false
    }
    const context = this.context(this.active)
    const running = [...this.jobs.values()].some(job => job.preset === this.active && pending(job))
    if (running && req.method !== 'GET') throw busy('The preset is running. Changes are available when it finishes; you can keep browsing its pages.')
    if (running && url.pathname === '/api/events') {
      res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' }); res.write(': preset running\n\n')
      let closed = false
      const emit = event => { if (!closed && !res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`) }
      const recorder = activityRecorder(context.state)
      const end = () => { cleanup(); res.end() }
      recorder.on('event', emit); this.on('event', emit); this.streams.add(end)
      const beat = setInterval(() => { if (!closed && !res.writableEnded && !res.destroyed) res.write(': heartbeat\n\n') }, 15000)
      const cleanup = () => { if (closed) return; closed = true; clearInterval(beat); recorder.off('event', emit); this.off('event', emit); this.streams.delete(end) }
      res.on('close', cleanup); res.on('error', cleanup)
      return true
    }
    if (context.local) return false
    context.readers = (context.readers ?? 0) + 1
    try {
      const endpoint = await this.endpoint(context, { monitor: running })
      if (context.lost) throw error(503, 'Unavailable', 'The demo host ended. Return to Presets and inspect the environment before continuing.')
      const target = new URL(url.pathname + url.search, endpoint.url)
      if (url.pathname === '/api/events') target.searchParams.set('token', endpoint.token)
      await new Promise((done, reject) => {
        let response
        const upstream = httpRequest(target, { method: req.method, headers: { authorization: `Bearer ${endpoint.token}`, ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}), ...(req.headers['x-lfs-action'] ? { 'x-lfs-action': req.headers['x-lfs-action'] } : {}) } }, reply => {
          response = reply
          res.writeHead(reply.statusCode, { ...reply.headers, 'access-control-allow-origin': '*' }); reply.pipe(res)
          reply.on('end', done)
        })
        const end = () => { response?.unpipe(res); response?.destroy(); upstream.destroy(); res.end(); done() }
        if (url.pathname === '/api/events') this.streams.add(end)
        res.on('close', () => { this.streams.delete(end); upstream.destroy(); done() })
        res.on('error', end)
        upstream.on('error', () => { if (!res.headersSent) reject(error(503, 'Unavailable', 'The demo host connection ended. Inspect the preset before another operation.')); else res.end(); done() })
        req.pipe(upstream)
      })
      return true
    } finally {
      if (--context.readers === 0) { for (const resolve of context.readDone ?? []) resolve(); context.readDone?.clear() }
    }
  }
  async close() { this.endStreams(); await Promise.allSettled([...(this.tasks ?? [])]); for (const context of this.contexts.values()) context.child?.stdin.end() }
}
