import { MixedSandboxPool, mixedSandboxName, MIXED_RECIPE_VERSION } from './mixed-recipe.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { configureActivity } from '../../host/activity/recorder.js'
import { withActivity } from '../../host/activity/context.js'
import { stringify } from '../../host/cli/json.js'
import { CONTENT_VERSION, presetOf, sourceFiles } from './presets.mjs'
import { verifyProject } from './project-verification.mjs'
import { runBounded } from './scheduler.mjs'
import { DEFAULT_HISTORY_LIMITS, runHistoryDAG } from './history-scheduler.mjs'
import { StepJournal } from './step-journal.mjs'
import { projectHistorySteps, projectHistoryPlan, assertProjectStep, resolveHistoryStep, machineCreateArgs } from './recipe.mjs'
import { CliInventory } from '../../host/cli/inventory.js'
import { assertHostIdle } from '../../host/demo-presets/admission.js'

const missing = error => ['NotFound', 'NoSuchProject', 'NoSuchStore', 'NoSuchBranch', 'NoSuchSandbox'].includes(error.code)
const rows = (value, field = 'items') => Array.isArray(value) ? value : value?.[field] ?? []
const fail = message => { throw new Error(message) }
const uncertain = error => error.code === 'Unknown' || error.transport === 'transport-unknown' || error.detail?.attempted === true

export class DemoRunner extends CliInventory {
  constructor({ state, preset = 'studio', driver, sandboxes, report = console.log, progress = () => {}, historyDensity = 'dense', historyCycles, executionMode = 'filesystem', historySchedule = 'parallel', historyConcurrency = DEFAULT_HISTORY_LIMITS.concurrency, historyStoreConcurrency = DEFAULT_HISTORY_LIMITS.perStore, historyProjectConcurrency = DEFAULT_HISTORY_LIMITS.perProject }) {
    super(driver)
    this.state = resolve(state)
    this.home = join(this.state, 'home-2')
    this.file = join(this.state, 'demo-fixtures.json')
    this.journalFile = join(this.state, 'demo-steps.ndjson')
    this.lock = join(this.state, 'demo-fixtures.lock')
    this.presetName = preset; this.preset = presetOf(preset); this.driver = driver
    if (!['filesystem', 'mixed'].includes(executionMode)) throw new Error(`Unknown execution mode ${executionMode}`)
    this.executionMode = executionMode
    this.mixedPools = new Map()
    this.historyOptions = { density: historyDensity, cycles: historyCycles, executionMode }
    if (!['parallel', 'serial'].includes(historySchedule)) throw new Error(`Unknown history schedule ${historySchedule}`)
    this.historySchedule = historySchedule
    this.historyLimits = { concurrency: historyConcurrency, perStore: historyStoreConcurrency, perProject: historyProjectConcurrency }
    for (const [name, value] of Object.entries(this.historyLimits)) if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid history ${name}: ${value}`)
    if (historyConcurrency > 16) throw new Error('History concurrency cannot exceed 16 CLI processes.')
    this.sandboxesExplicit = sandboxes !== undefined
    this.sandboxes = this.preset.sandboxes === false ? false : sandboxes ?? true; this.report = report; this.progress = (value, force = false) => {
      const now = Date.now()
      if (!force && value.stage === this.lastProgressStage && value.completed !== value.total && now - (this.lastProgressAt ?? 0) < 250) return
      this.lastProgressAt = now; this.lastProgressStage = value.stage
      if (value.stage === 'verifying' && this.historyTasks && !value.tasks) value = { ...value, tasks: this.historyTasks }
      progress(value)
      if (this.manifest?.presetOperation?.state === 'running') { this.manifest.presetOperation.progress = value; this.save() }
    }
  }
  plan() {
    return { preset: this.presetName, description: this.preset.description, executionMode: this.executionMode, sandboxLimit: 3, workspaceLimit: 16, state: this.state, home: this.home, machines: this.preset.machines, stores: this.preset.stores, projects: this.preset.stores.reduce((n, s) => n + s.projects.length, 0), sandboxes: this.executionMode === 'mixed' ? this.preset.stores.reduce((n, store) => n + store.projects.length, 0) : this.sandboxes ? this.preset.stores.length : 0, workspaces: this.executionMode === 'mixed' ? this.preset.stores.reduce((n, store) => n + store.projects.length * 2, 0) : this.sandboxes ? this.preset.stores.length * 2 : 0, logs: join(this.state, 'logs', 'cli'), reset: 'Clear previous CLI Activity; recreate fixture stores and projects; retain owned VMs. Log reset as a fresh action.', teardown: 'Close owned sandboxes, delete owned stores and VMs, restore borrowed worker power; retain logs and manifest.' }
  }
  save() {
    const temporary = `${this.file}.${process.pid}.tmp`
    const { steps, ...snapshot } = this.manifest
    writeFileSync(temporary, stringify({ ...snapshot, steps: {}, ...(this.journal ? { stepJournal: this.journal.metadata() } : {}) }), { mode: 0o600 })
    renameSync(temporary, this.file)
  }
  acquire() {
    mkdirSync(this.state, { recursive: true, mode: 0o700 })
    if (lstatSync(this.state).isSymbolicLink()) fail('The demo state must be a real directory, not a symlink.')
    let fd
    try { fd = openSync(this.lock, 'wx', 0o600) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const previous = readFileSync(this.lock, 'utf8')
      let owner
      try { owner = JSON.parse(previous) } catch { fail('The demo lock is malformed; inspect it before continuing.') }
      try { process.kill(owner.pid, 0); fail(`Another demo operation is running (PID ${owner.pid}).`) } catch (e) { if (e.code !== 'ESRCH') throw e }
      if (readFileSync(this.lock, 'utf8') !== previous) fail('The demo lock changed; try the command again.')
      unlinkSync(this.lock)
      fd = openSync(this.lock, 'wx', 0o600)
    }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })); closeSync(fd)
    this.locked = true
  }
  release() { if (this.locked) { unlinkSync(this.lock); this.locked = false } }
  load(create = false) {
    if (existsSync(this.home) && lstatSync(this.home).isSymbolicLink()) fail('The demo home must not be a symlink.')
    if (existsSync(this.file)) {
      this.manifest = JSON.parse(readFileSync(this.file, 'utf8'))
      if (this.manifest.tool !== 'layerfs-connect-demo' || this.manifest.version !== 1 || this.manifest.preset !== this.presetName || this.manifest.state !== realpathSync(this.state)) fail('The demo ownership manifest does not match this state and preset. Use a separate state directory for each preset.')
      if (this.preset.sandboxes !== false && !this.sandboxesExplicit && typeof this.manifest.sandboxes === 'boolean') this.sandboxes = this.manifest.sandboxes
      if (this.sandboxesExplicit && this.manifest.sandboxes !== undefined && this.preset.sandboxes !== false && this.manifest.sandboxes !== this.sandboxes && this.command !== 'reset') fail('Changing sandbox configuration requires reset; setup does not silently remove existing sandboxes.')
    } else {
      if (!create) fail('No demo ownership manifest. Run setup or preview first; an existing LayerFS home will not be adopted.')
      if (existsSync(this.home) && readdirSync(this.home).length) fail('Refusing to adopt a nonempty LayerFS home without a demo ownership manifest. Choose a fresh --state directory.')
      this.manifest = { tool: 'layerfs-connect-demo', version: 1, id: randomUUID(), preset: this.presetName, contentVersion: CONTENT_VERSION, executionMode: this.executionMode, ...(this.executionMode === 'mixed' ? { mixedRecipeVersion: MIXED_RECIPE_VERSION } : {}), sandboxes: this.sandboxes, state: realpathSync(this.state), homeId: null, created: Date.now(), resources: { machine: {}, store: {}, sandbox: {} }, projects: {}, borrowed: {}, steps: {} }
      this.save()
    }
    if (this.manifest.stepJournal && !existsSync(this.journalFile)) fail('The preset step journal is missing. Inspect the state directory; mutations will not be replayed.')
    this.journal = new StepJournal(this.journalFile)
    this.manifest.steps = this.journal.load(this.manifest.steps)
    const homeFile = join(this.home, 'layerfs.json')
    if (existsSync(homeFile)) {
      const homeId = JSON.parse(readFileSync(homeFile, 'utf8')).id
      if (this.manifest.homeId && this.manifest.homeId !== homeId) fail('The LayerFS home identity changed. The ownership manifest cannot authorize cleanup of this home.')
      if (!homeId) fail('The demo home has no valid LayerFS identity.')
      this.manifest.homeId = homeId
    } else if (this.manifest.homeId) fail('The owned LayerFS home is missing. Preserve its manifest and inspect the state directory.')
  }
  async query(argv) { return this.driver.invoke(argv, { read: true }) }
  async cleanupPlan(keepMachines) {
    const resources = {}, owned = {}, preserved = {}
    for (const family of ['machine', 'store', 'sandbox']) {
      resources[family] = await this.inventory(family)
      owned[family] = []; preserved[family] = []
      for (const row of resources[family]) {
        const entry = this.manifest.resources[family][row.name]
        if (entry && !entry.owned) fail(`${family} ${row.name} exists after an unconfirmed create. Inspect it; cleanup will not assume ownership.`)
        if (entry?.owned) {
          if (!row.name.startsWith('demo-')) fail('Cleanup refuses a resource outside the demo namespace.')
          if (entry.created != null && row.created != null && entry.created !== row.created) fail(`${family} ${row.name} was replaced; cleanup stopped.`)
          if (row.op) fail(`${family} ${row.name} has an unresolved or active operation. Inspect it before cleanup.`)
          owned[family].push(row)
        } else if (!(family === 'machine' && ['native', 'docker'].includes(row.name))) preserved[family].push(row.name)
      }
    }
    const workspaces = []
    for (const row of owned.sandbox) workspaces.push(...(await this.sandboxDetails(row.name)).workspaces.map(ws => ws.ws))
    const remove = { stores: owned.store.map(r => r.name).sort(), sandboxes: owned.sandbox.map(r => r.name).sort(), machines: keepMachines ? [] : owned.machine.map(r => r.name).sort(), workspaces: workspaces.sort() }
    const retainMachines = keepMachines ? owned.machine.map(r => r.name).sort() : []
    for (const names of Object.values(preserved)) names.sort()
    const plan = { remove, retainMachines, preserved, projects: owned.store.reduce((n, row) => n + (row.projects?.length ?? 0), 0) }
    // Include all data/project/workspace membership in confirmation, not volatile machine state.
    const signature = createHash('sha256').update(JSON.stringify({ ...plan, identities: Object.fromEntries(Object.entries(owned).map(([family, rows]) => [family, rows.map(row => ({ name: row.name, created: row.created, id: row.id, projects: [...(row.projects ?? [])].sort() })).sort((a, b) => a.name.localeCompare(b.name))])) })).digest('hex')
    return { ...plan, signature }
  }
  async maybe(argv) {
    const [family, call, name] = argv
    // Inventory first: an expected absence is not a failed CLI invocation.
    if (call === 'get' && ['machine', 'store', 'sandbox', 'project'].includes(family)) {
      let page = 0, found = false
      do {
        const list = await this.query([family, 'list', ...(family === 'project' ? [name.split('/')[0]] : []), ...(['sandbox', 'project'].includes(family) ? ['--page-size', '1000', '--page-pos', String(page)] : [])])
        found = rows(list, family === 'machine' ? 'machines' : 'items').some(row => family === 'project' ? (row.project ?? row.key ?? `${row.store}/${row.name}`) === name : row.name === name)
        if (found) break
        page = list.next_page_pos ?? null
      } while (page !== null)
      if (!found) return null
    }
    try { return await this.query(argv) } catch (error) { if (missing(error)) return null; throw error }
  }
  recordStep(key, step) {
    this.journal ??= new StepJournal(this.journalFile)
    try { this.journal.append(key, step) } catch (error) { error.presetJournalFailure = true; throw error }
    this.manifest.steps[key] = step
  }
  async once(key, argv, options) {
    const previous = this.manifest.steps[key]
    if (previous?.status === 'done') {
      if (stringify(previous.argv) !== stringify(argv)) fail(`Step ${key} no longer matches its recorded command. Reset before changing the recipe.`)
      return previous.result
    }
    if (previous && ['running', 'uncertain'].includes(previous.status)) fail(`Step ${key} has no certain final result. Run status and inspect LayerFS; reset/teardown perform cleanup rather than replaying this step.`)
    this.recordStep(key, { status: 'running', argv, ...(options?.dependencies ? { dependencies: options.dependencies } : {}), at: Date.now(), actionId: this.action?.id })
    try {
      const result = await this.driver.invoke(argv, { ...options, onInvocation: identity => {
        this.recordStep(key, { ...this.manifest.steps[key], invocationId: identity.id, actionId: identity.actionId })
      } })
      this.recordStep(key, { ...this.manifest.steps[key], status: 'done', ended: Date.now(), result })
      return result
    } catch (error) {
      this.recordStep(key, { ...this.manifest.steps[key], status: uncertain(error) || error.presetJournalFailure || argv[0] === 'project' && argv[1] === 'init' && error.code === 'Failed' ? 'uncertain' : 'failed', code: error.code ?? 'Failed', ended: Date.now() })
      throw error
    }
  }
  assertSetupSettled() {
    const pending = Object.entries(this.manifest.steps).find(([, s]) => ['running', 'uncertain'].includes(s.status))
    if (pending) fail(`Setup cannot replay ${pending[0]} after an interrupted/uncertain outcome. Run status, inspect the named resource, then use reset or teardown for owned cleanup.`)
  }
  async ensureResource(family, name, argv) {
    const current = await this.maybe([family, 'get', name])
    const owned = this.manifest.resources[family][name]
    if (current) {
      if (!owned?.owned) fail(`${family} ${name} already exists but is not confirmed as created by this fixture. It will not be adopted or removed.`)
      if (owned.created != null && current.created != null && owned.created !== current.created) fail(`${family} ${name} was replaced outside the fixture. Cleanup authority is no longer certain.`)
      if (current.op?.uncertain || ['unresolved', 'creating', 'removing', 'closing'].includes(current.state)) fail(`${family} ${name} needs inspection (${current.state}); no operation will be replayed.`)
      return current
    }
    if (owned?.owned) fail(`Owned ${family} ${name} is missing. Run reset to rebuild the fixture.`)
    this.manifest.resources[family][name] = { owned: false, status: 'creating' }; this.save()
    try { await this.once(`${family}.create:${name}`, argv) } catch (error) {
      if (family === 'machine' && error.detail?.vm_exists === true && !uncertain(error)) {
        this.manifest.resources[family][name] = { owned: true, created: null, status: 'failed' }; this.save()
      }
      throw error
    }
    this.manifest.resources[family][name] = { owned: true, created: null, status: 'ready' }; this.save()
    const made = await this.query([family, 'get', name])
    this.manifest.resources[family][name] = { owned: true, created: made.created ?? null, status: 'ready' }; this.save()
    return made
  }
  async initialize() {
    mkdirSync(this.home, { recursive: true, mode: 0o700 }); chmodSync(this.home, 0o700)
    if (!existsSync(join(this.home, 'layerfs.json'))) await this.driver.invoke(['machine', 'list'])
    this.load(); this.save()
  }
  async preflight() {
    const supported = rows(await this.query(['machine', 'platforms']), 'platforms')
    for (const machine of this.preset.machines) {
      const name = typeof machine === 'string' ? machine : machine.name
      if (!this.preset.stores.some(store => store.machine === name)) continue
      const platform = typeof machine === 'string' ? machine : machine.platform
      const row = supported.find(row => row.platform === platform)
      if (!row?.ready || !row.sqlite) fail(`${platform} is not ready for this preset: ${(row?.missing ?? ['unsupported on this host']).join(', ')}. Fix the prerequisite or select a smaller preset; nothing will be fabricated.`)
    }
    if ((this.sandboxes || this.executionMode === 'mixed') && this.preset.stores.some(store => store.machine === 'native') && !this.driver.spec.daemon) fail('Native sandboxes need a matching LAYERFS_CONNECT_DAEMON (or --daemon). Use --no-sandboxes for data/history only.')
  }
  async startMachine(name) {
    const current = await this.query(['machine', 'get', name])
    if (current.op || current.state === 'unresolved') fail(`Machine ${name} has an operation in flight or unresolved. Inspect it first.`)
    if (['running', 'ready'].includes(current.state)) return
    if (name === 'docker' && !this.manifest.borrowed.docker) { this.manifest.borrowed.docker = { initially: current.state, started: true }; this.save() }
    await this.once(`machine.start:${name}:${this.commandId}`, ['machine', 'start', name])
  }
  source(store, name) {
    const root = join(this.state, 'demo-sources'), storeRoot = join(root, store), folder = join(storeRoot, name)
    for (const path of [root, storeRoot, folder]) {
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail('Demo source paths must not be symlinks.')
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    for (const [path, content] of Object.entries(sourceFiles(name))) {
      const file = join(folder, path)
      if (existsSync(dirname(file)) && lstatSync(dirname(file)).isSymbolicLink() || existsSync(file) && lstatSync(file).isSymbolicLink()) fail('Demo source files must not be symlinks.')
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content)
    }
    return folder
  }
  async ensureProject(store, name) {
    const key = `${store}/${name}`
    const current = await this.maybe(['project', 'get', key])
    if (!current) {
      if (this.manifest.projects[key]) fail(`Owned project ${key} is missing. Run reset to rebuild it.`)
      await this.once(`project.init:${key}`, ['project', 'init', key, this.source(store, name), '--progress'])
      this.manifest.projects[key] = { seeded: false }; this.save()
    } else if (!this.manifest.projects[key]) fail(`Project ${key} was not created by this fixture; it will not be overwritten.`)
  }
  historyArgv(step, project) {
    if (!step.commitFrom) return step.argv
    const dependency = this.manifest.steps[`${step.commitFrom}:${project}`]
    if (dependency?.status !== 'done' || typeof dependency.result?.head !== 'string' || !dependency.result.head) fail(`Missing immutable Commit receipt for ${step.key}; no publication was attempted.`)
    return resolveHistoryStep(step, { [step.commitFrom]: dependency.result })
  }
  async executeHistoryStep(project, step) {
    for (const key of step.dependsOn ?? []) if (this.manifest.steps[`${key}:${project}`]?.status !== 'done') fail(`Unconfirmed dependency ${key} for ${step.key}; no mutation was attempted.`)
    const key = `${step.key}:${project}`
    if (step.resource?.family === 'sandbox') {
      const made = await this.ensureResource('sandbox', step.resource.name, step.argv)
      if (!this.manifest.steps[key]) this.recordStep(key, { status: 'done', argv: step.argv, result: made, resourceReceipt: `sandbox.create:${step.resource.name}`, at: Date.now() })
      return made
    }
    let pool, sandbox, workspace
    if (step.argv[0] === 'workspace' && step.argv[1] === 'mount') {
      pool = this.mixedPools.get(project)
      if (!pool) { pool = new MixedSandboxPool(project); this.mixedPools.set(project, pool) }
      workspace = step.argv[step.argv.indexOf('--name') + 1]
      sandbox = pool.acquire(workspace)
      if (sandbox !== step.argv[2]) fail('Mixed workspace allocation does not match its recorded script.')
    }
    await this.once(key, this.historyArgv(step, project), { ...(step.input === undefined ? {} : { input: step.input }), dependencies: step.dependsOn })
    const result = this.manifest.steps[key]?.result
    assertProjectStep(step, result)
    if (step.argv[0] === 'workspace' && step.argv[1] === 'unmount') {
      const [box, ws] = step.argv[2].split(':'); this.mixedPools.get(project)?.release(box, ws)
    }
    return result
  }
  async seedProjectHistory(store, name, onStep = () => {}, shouldStop = () => false) {
    const key = `${store}/${name}`
    if (!this.manifest.projects[key]) fail(`Project ${key} has not been imported.`)
    const steps = projectHistorySteps(store, name, this.historyOptions)
    if (this.manifest.projects[key].seeded) {
      for (const [index, step] of steps.entries()) onStep(index + 1, step, this.manifest.steps[`${step.key}:${key}`]?.result)
      return
    }
    for (const [index, step] of steps.entries()) {
      if (shouldStop()) throw Object.assign(new Error('Stopped before the next CLI step because another project failed. Inspect CLI Activity before rebuilding.'), { code: 'PresetStopped' })
      const result = await this.executeHistoryStep(key, step)
      onStep(index + 1, step, result)
    }
    this.manifest.projects[key].seeded = true; this.save()
  }
  async seedProject(store, name) {
    await this.ensureProject(store, name)
    await this.seedProjectHistory(store, name)
  }
  async setupConcurrentProjects({ advance, reportProgress }) {
    // Import serially within each Store. No history operation starts until all
    // Stores are placed, so the generated history exercises the target machines.
    await runBounded(this.preset.stores, 2, async (store, { shouldStop }) => {
      const stopIfFailed = () => { if (shouldStop()) throw Object.assign(new Error('Preparation stopped because another store failed.'), { code: 'PresetStopped' }) }
      reportProgress(`Preparing store ${store.name} for ${store.machine}`)
      await this.ensureResource('store', store.name, ['store', 'create', store.name])
      for (const name of store.projects) {
        stopIfFailed()
        reportProgress(`Importing project ${store.name}/${name}`)
        await this.ensureProject(store.name, name)
      }
      stopIfFailed()
      const placed = await this.query(['store', 'get', store.name])
      stopIfFailed()
      if (placed.op || placed.state === 'unresolved') fail(`Store ${store.name} has an operation that needs inspection.`)
      if (placed.machine !== store.machine) {
        if (placed.machine !== 'native') fail(`Store ${store.name} moved outside the fixture plan. Inspect it or reset.`)
        reportProgress(`Moving ${store.name} to ${store.machine}`)
        await this.once(`store.push:${store.name}`, ['store', 'push', store.name, store.machine, '--progress'])
      }
      advance(`Store ${store.name} is placed on ${store.machine}`)
    })
    const tasks = this.preset.stores.flatMap(store => store.projects.map(name => {
      const plan = projectHistoryPlan(name, this.historyOptions)
      return { id: `${store.name}/${name}`, project: `${store.name}/${name}`, machine: store.machine, store: store.name, name, tier: plan.tier, state: 'waiting', completed: 0, total: projectHistorySteps(store.name, name, this.historyOptions).length, commits: 0, branches: 1, layers: 1, targetCommits: plan.commits, targetBranches: plan.branches.length + 1, targetLayers: plan.layers }
    }))
    const workspaceRequired = tasks.reduce((n, task) => n + projectHistoryPlan(task.name, this.historyOptions).workspaceRevisions, 0)
    const authoredTotal = tasks.reduce((n, task) => n + projectHistoryPlan(task.name, this.historyOptions).authoredRevisions, 0)
    let workspaceCompleted = 0
    let lastTaskProgress = 0
    const preparation = this.preset.machines.length + this.preset.stores.length
    const total = preparation + tasks.reduce((sum, task) => sum + task.total, 0)
    const publish = (label, immediate = false) => {
      const now = Date.now()
      if (!immediate && now - lastTaskProgress < 250) return
      lastTaskProgress = now
      this.historyTasks = tasks.map(({ store, name, ...task }) => ({ ...task }))
      const historyCompleted = tasks.reduce((sum, task) => sum + task.completed, 0)
      this.progress({ stage: 'building', completed: preparation + historyCompleted, total, historyCompleted, historyTotal: total - preparation, workspaceCoverage: { completed: workspaceCompleted, required: workspaceRequired, total: authoredTotal }, label, tasks: this.historyTasks }, true)
    }
    publish(`All stores are placed. Preparing ${tasks.length} project histories concurrently`)
    const previousConcurrency = this.driver.concurrency
    this.driver.concurrency = this.historyLimits.concurrency
    try {
      if (this.historySchedule === 'parallel') {
        const scheduled = tasks.map(task => ({ ...task, seeded: this.manifest.projects[task.project]?.seeded === true, steps: projectHistorySteps(task.store, task.name, this.historyOptions), commitIds: new Set() }))
        try {
          await runHistoryDAG(scheduled, async (item, step) => {
            const task = tasks.find(task => task.id === item.id)
            if (!task.started) { task.started = Date.now(); task.state = 'running'; publish(`Building ${task.project} on ${task.machine}`, true) }
            try {
              let result
              if (item.seeded) {
                // Completed version-3 histories used moving-head publish argv.
                // Retain their exact original custody instead of replaying/rekeying.
                const receipt = this.manifest.steps[`${step.key}:${task.project}`]
                if (receipt?.status !== 'done') fail(`Seeded project ${task.project} has no confirmed receipt for ${step.key}; inspect its journal before reset.`)
                result = receipt.result; assertProjectStep(step, result)
              } else result = await this.executeHistoryStep(task.project, step)
              task.completed++
              if (step.workspaceRevision && result?.kind === 'Committed') workspaceCompleted++
              if (['Committed', 'Merged'].includes(result?.kind) && result.head) item.commitIds.add(result.head)
              task.commits = item.commitIds.size
              if (['Forked', 'Merged'].includes(result?.kind)) task.branches++
              if (result?.kind === 'Added') task.layers++
              if (task.completed === task.total) {
                this.manifest.projects[task.project].seeded = true; this.save()
                task.ended = Date.now(); task.state = 'completed'
              }
              publish(`Building ${task.project} on ${task.machine}`, task.completed === task.total)
            } catch (error) {
              task.ended = Date.now(); task.state = 'failed'; task.error = error.message; task.errorCode = error.code ?? 'Failed'
              publish(`${task.project} history stopped`, true)
              throw error
            }
          }, this.historyLimits)
        } catch (error) {
          for (const task of tasks) if (!['failed', 'completed'].includes(task.state)) { task.state = 'stopped'; task.ended = Date.now() }
          publish('History scheduling stopped; all dispatched commands have settled', true)
          throw error
        }
        return
      }
      await runBounded(tasks, 8, async (task, { shouldStop }) => {
        task.started = Date.now(); task.state = 'running'; publish(`Building ${task.project} on ${task.machine}`, true)
        const commitIds = new Set()
        try {
          await this.seedProjectHistory(task.store, task.name, (completed, step, result) => {
            task.completed = completed
            if (step?.workspaceRevision && result?.kind === 'Committed') workspaceCompleted++
            if (step && result) {
              if (['Committed', 'Merged'].includes(result.kind) && result.head) commitIds.add(result.head)
              task.commits = commitIds.size
              if (['Forked', 'Merged'].includes(result.kind)) task.branches++
              if (result.kind === 'Added') task.layers++
            }
            publish(`Building ${task.project} on ${task.machine}`)
          }, shouldStop)
          task.ended = Date.now(); task.state = 'completed'; publish(`${task.project} history is ready`, true)
        } catch (error) {
          task.ended = Date.now(); task.state = error.code === 'PresetStopped' ? 'stopped' : 'failed'; task.error = error.message; task.errorCode = error.code ?? 'Failed'; publish(`${task.project} history stopped`, true)
          throw error
        }
      })
    } finally {
      // runBounded drains all in-flight calls before restoring admission or
      // allowing run() to release the environment operation lock.
      this.driver.concurrency = previousConcurrency
    }
  }
  async setup() {
    this.assertSetupSettled()
    if (Object.keys(this.manifest.projects).length && (this.manifest.executionMode ?? 'filesystem') !== this.executionMode) fail('Changing execution mode requires Build projects to reset the existing library first.')
    if (Object.keys(this.manifest.projects).length && this.executionMode === 'mixed' && this.manifest.mixedRecipeVersion !== MIXED_RECIPE_VERSION) fail('Mixed workspace sessions have changed. Use Build projects to reset and build the current two-revision workspace sessions.')
    this.manifest.executionMode = this.executionMode
    if (this.executionMode === 'mixed') this.manifest.mixedRecipeVersion = MIXED_RECIPE_VERSION
    if (Object.keys(this.manifest.projects).length && this.manifest.contentVersion !== CONTENT_VERSION) fail('Preset content has changed. Use Build preset to reset and prepare the new project library; existing data has been preserved.')
    await this.preflight()
    let completed = 0
    const total = this.preset.machines.length + this.preset.stores.length + this.preset.stores.reduce((n, store) => n + (this.presetName === 'studio' ? store.projects.reduce((sum, name) => sum + projectHistorySteps(store.name, name, this.historyOptions).length, 0) : store.projects.length), 0)
    const reportProgress = (label, tasks) => this.progress({ stage: 'building', completed, total, label, ...(tasks ? { tasks } : {}) })
    const advance = (label, tasks) => { completed++; reportProgress(label, tasks) }
    this.progress({ stage: 'building', completed, total, label: 'Preparing preset resources' })
    for (const machine of this.preset.machines) {
      const name = typeof machine === 'string' ? machine : machine.name
      if (typeof machine !== 'string') await this.ensureResource('machine', name, machineCreateArgs(machine))
      // Empty preset lists built-ins but does not start Docker.
      if (this.preset.stores.some(store => store.machine === name)) await this.startMachine(name)
      advance(`Machine ${name} ready`)
    }
    if ((this.sandboxes || this.executionMode === 'mixed') && this.preset.stores.some(store => store.machine === 'native')) {
      const native = await this.query(['machine', 'get', 'native'])
      if (native.daemon !== this.driver.spec.daemon) await this.once(`native.daemon:${this.driver.spec.daemon}`, ['machine', 'update', 'native', '--daemon', this.driver.spec.daemon])
    }
    if (this.presetName === 'studio') {
      await this.setupConcurrentProjects({ advance, reportProgress })
      return
    }
    await runBounded(this.preset.stores, 2, async store => {
      await this.ensureResource('store', store.name, ['store', 'create', store.name])
      for (const project of store.projects) {
        this.progress({ stage: 'building', completed, total, label: `Building project ${store.name}/${project}` })
        await this.seedProject(store.name, project); advance(`Project ${store.name}/${project} ready`)
      }
      const placed = await this.query(['store', 'get', store.name])
      if (placed.op || placed.state === 'unresolved') fail(`Store ${store.name} has an operation that needs inspection.`)
      if (placed.machine !== store.machine) {
        if (placed.machine !== 'native') fail(`Store ${store.name} moved outside the fixture plan. Inspect it or reset.`)
        await this.once(`store.push:${store.name}`, ['store', 'push', store.name, store.machine, '--progress'])
      }
      if (!this.sandboxes) { advance(`Store ${store.name} ready`); return }
      const sandbox = `demo-${store.projects[0]}`, project = `${store.name}/${store.projects[0]}`
      await this.ensureResource('sandbox', sandbox, ['sandbox', 'create', project, sandbox, store.machine])
      const detail = await this.query(['sandbox', 'get', sandbox])
      if (detail.down_reason) fail(`Sandbox ${sandbox} cannot be reached: ${detail.down_reason}`)
      for (const [name, branch] of [['feature', projectHistoryPlan(store.projects[0], this.historyOptions).definition.features[0].name], ['fix', projectHistoryPlan(store.projects[0], this.historyOptions).definition.features[1].name]]) {
        if (!detail.workspaces?.some(ws => ws.name === name)) await this.once(`workspace.mount:${sandbox}:${name}`, ['workspace', 'mount', sandbox, branch, '--name', name])
      }
      advance(`Store ${store.name} and workspaces ready`)
    })
  }
  async cleanup(keepMachines, plan) {
    this.report('Removing preset resources')
    this.manifest.cleanupReceipt = { ...plan, verified: false, at: Date.now() }; this.save()
    // Unconfirmed creates are intentionally preserved: a failed claim is not ownership.
    for (const family of ['sandbox', 'store', 'machine']) for (const [name, entry] of Object.entries(this.manifest.resources[family])) {
      if (!entry.owned && await this.maybe([family, 'get', name])) fail(`${family} ${name} exists after an unconfirmed create. Inspect it; cleanup will not assume ownership.`)
      if (!name.startsWith('demo-')) fail('Cleanup refuses a resource outside the demo namespace.')
    }
    for (const [name, entry] of Object.entries(this.manifest.resources.store)) {
      if (!entry.owned) continue
      const store = await this.maybe(['store', 'get', name])
      if (store && store.machine !== 'native') await this.startMachine(store.machine)
    }
    for (const [name, entry] of Object.entries(this.manifest.resources.sandbox)) {
      if (!entry.owned) continue
      const sandbox = await this.maybe(['sandbox', 'get', name])
      if (sandbox) {
        if (entry.created != null && sandbox.created != null && entry.created !== sandbox.created) fail(`Sandbox ${name} was replaced; cleanup stopped.`)
        if (sandbox.down_reason) fail(`Sandbox ${name} cannot be inspected: ${sandbox.down_reason}`)
        for (const ws of (await this.sandboxDetails(name)).workspaces) await this.once(`cleanup.unmount:${this.commandId}:${ws.ws}`, ['workspace', 'unmount', ws.ws, '--discard'])
        await this.once(`cleanup.sandbox:${this.commandId}:${name}`, ['sandbox', 'close', name])
      }
    }
    for (const [name, entry] of Object.entries(this.manifest.resources.store)) {
      const store = await this.maybe(['store', 'get', name])
      if (store && entry.owned) {
        if (entry.created != null && store.created != null && entry.created !== store.created) fail(`Store ${name} was replaced; cleanup stopped.`)
        await this.once(`cleanup.store:${this.commandId}:${name}`, ['store', 'remove', name])
      }
    }
    if (!keepMachines) {
      for (const [name, entry] of Object.entries(this.manifest.resources.machine)) {
        const machine = await this.maybe(['machine', 'get', name])
        if (machine && entry.owned) {
          if (entry.created != null && machine.created != null && entry.created !== machine.created) fail(`Machine ${name} was replaced; cleanup stopped.`)
          await this.once(`cleanup.machine:${this.commandId}:${name}`, ['machine', 'remove', name])
        }
      }
      if (this.manifest.borrowed.docker?.started) {
        const docker = await this.query(['machine', 'get', 'docker'])
        const stores = rows(await this.query(['store', 'list']))
        const sandboxes = await this.inventory('sandbox')
        if (stores.some(store => store.machine === 'docker') || sandboxes.some(box => box.machine === 'docker')) this.report('Retaining the borrowed Docker worker because remaining resources use it.')
        else {
          if (!['stopped', 'ready'].includes(docker.state)) await this.once(`cleanup.docker:${this.commandId}`, ['machine', 'stop', 'docker'])
          delete this.manifest.borrowed.docker
        }
      }
    }
    this.report('Verifying cleanup against LayerFS inventory')
    const remaining = [], unexpected = []
    for (const [family, plural] of [['store', 'stores'], ['sandbox', 'sandboxes'], ['machine', 'machines']]) {
      const inventory = await this.inventory(family), names = inventory.map(row => row.name)
      remaining.push(...plan.remove[plural].filter(name => names.includes(name)).map(name => `${family} ${name}`))
      const allowed = new Set([...plan.preserved[family], ...(family === 'machine' ? ['native', 'docker', ...plan.retainMachines] : [])])
      unexpected.push(...names.filter(name => !allowed.has(name)).map(name => `${family} ${name}`))
      if (family === 'machine') remaining.push(...plan.retainMachines.filter(name => !names.includes(name)).map(name => `missing retained machine ${name}`))
    }
    Object.assign(this.manifest.cleanupReceipt, { remaining, unexpected, verified: !remaining.length && !unexpected.length }); this.save()
    if (remaining.length || unexpected.length) fail(`Cleanup verification failed. Remaining: ${remaining.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}. Rebuild has not started; inspect CLI Activity and resources.`)
    this.manifest.resources.sandbox = {}; this.manifest.resources.store = {}
    if (!keepMachines) this.manifest.resources.machine = {}
    this.journal.clear()
    delete this.manifest.activityCapture
    delete this.historyTasks
    this.manifest.projects = {}; this.manifest.steps = {}; this.manifest.contentVersion = CONTENT_VERSION; this.manifest.executionMode = this.executionMode; if (this.executionMode === 'mixed') this.manifest.mixedRecipeVersion = MIXED_RECIPE_VERSION; else delete this.manifest.mixedRecipeVersion; this.mixedPools.clear(); this.save()
  }
  async status() {
    const resources = {}
    for (const family of ['machine', 'store', 'sandbox']) resources[family] = await this.query([family, 'list'])
    const page = await this.activity.summaries({ actionId: this.action.id })
    return { ...this.plan(), homeId: this.manifest.homeId, ownership: this.manifest.resources, pending: Object.entries(this.manifest.steps).filter(([, step]) => step.status !== 'done'), resources, actionId: this.action.id, activityCaptured: !!page.items.length }
  }
  async verify({ activity = true } = {}) {
    if (this.executionMode === 'mixed' && this.manifest.mixedRecipeVersion !== MIXED_RECIPE_VERSION) fail('This environment uses older Mixed workspace sessions. Build the current two-revision workspace recipe before verifying it.')
    if (this.manifest.contentVersion !== CONTENT_VERSION) fail('This environment has older preset content. Build the current project library before verifying it.')
    let projects = 0
    const projectTotal = this.preset.stores.reduce((sum, store) => sum + store.projects.length, 0)
    this.progress({ stage: 'verifying', completed: 0, total: projectTotal, label: 'Verifying saved project files and histories' }, true)
    for (const machine of this.preset.machines) await this.query(['machine', 'get', typeof machine === 'string' ? machine : machine.name])
    // Four independent read pipelines; projects and pagination remain ordered
    // inside a Store. A failed pipeline stops every sibling before its next read.
    await runBounded(this.preset.stores, 4, async (store, { shouldStop }) => {
      const query = argv => {
        if (shouldStop()) throw Object.assign(new Error('Verification stopped because another Store failed; all dispatched reads have settled.'), { code: 'PresetStopped' })
        return this.query(argv)
      }
      const current = await query(['store', 'get', store.name])
      if (current.machine !== store.machine || current.op) fail(`Store ${store.name} does not match its intended placement or has an operation in flight.`)
      for (const name of store.projects) {
        const key = `${store.name}/${name}`
        await query(['project', 'get', key])
        const receipt = { steps: Object.fromEntries(projectHistorySteps(store.name, name, this.historyOptions).map(step => [step.key, this.manifest.steps[`${step.key}:${key}`]?.result])) }
        const verified = await verifyProject(query, store.name, name, receipt, this.historyOptions)
        if (this.executionMode === 'mixed') {
          const box = await query(['sandbox', 'get', mixedSandboxName(name), '--page-size', '16', '--page-pos', '0'])
          if (box.project !== key || box.machine !== store.machine || box.state !== 'running' || box.op || box.down_reason || !Array.isArray(box.workspaces) || box.workspaces.length || box.next_page_pos != null) fail(`Mixed sandbox for ${key} is unreachable, misplaced or still mounted.`)
          const plan = projectHistoryPlan(name, this.historyOptions)
          const completed = projectHistorySteps(store.name, name, this.historyOptions).filter(step => step.workspaceRevision && this.manifest.steps[`${step.key}:${key}`]?.result?.kind === 'Committed').length
          if (completed !== plan.workspaceRevisions || completed / plan.authoredRevisions < 0.3) fail(`Mixed workspace coverage is incomplete for ${key}.`)
          verified.workspaceRevisions = completed; verified.authoredRevisions = plan.authoredRevisions
        }
        this.manifest.projects[key].verification = verified; this.save()
        projects++
        this.progress({ stage: 'verifying', completed: projects, total: projectTotal, label: `Verified ${projects} of ${projectTotal} projects: ${key}` }, true)
      }
      if (this.sandboxes) {
        const inspector = new CliInventory({ invoke: query })
        const box = await inspector.sandboxDetails(`demo-${store.projects[0]}`)
        if (box.down_reason || !['feature', 'fix'].every(name => box.workspaces?.some(ws => ws.name === name))) fail(`Sandbox ${box.name} is missing its workspaces or is unreachable.`)
      }
    })
    const capture = await this.verifyActivityCapture()
    this.manifest.activityCapture = capture; this.save()
    if (!activity) return { presetVerified: true, projects, activityCapture: capture }
    const setupAction = this.manifest.lastSetupActionId
    if (!setupAction) fail('No completed setup/reset receipt exists to verify. Run setup first.')
    return { verified: true, projects, setupActionId: setupAction, cliInvocations: capture.cliInvocations, cliInputOutputCaptured: capture.complete, activityCapture: capture }
  }
  async verifyActivityCapture() {
    // Test stand-ins have no executable. An executable fixture must retain an
    // exact identity for every history mutation, including on desktop builds.
    if (!this.driver.spec?.cli) return { complete: false, testStandIn: true, cliInvocations: 0 }
    const groups = new Map()
    for (const step of Object.values(this.manifest.steps)) {
      if (step.status !== 'done') continue
      const history = ['file', 'branch', 'workspace'].includes(step.argv?.[0]) && ['write', 'fork', 'merge', 'publish', 'exec', 'commit', 'mount', 'unmount'].includes(step.argv?.[1])
      if (history && (!step.invocationId || !step.actionId)) fail('Preset CLI Activity has no invocation identity for a completed history mutation. Inspect the step journal; input/output capture could not be verified.')
      if (!step.invocationId || !step.actionId) continue
      if (!groups.has(step.actionId)) groups.set(step.actionId, { ids: [], inputIds: [] })
      groups.get(step.actionId).ids.push(step.invocationId)
      if (step.argv?.[0] === 'file' && step.argv?.[1] === 'write') groups.get(step.actionId).inputIds.push(step.invocationId)
    }
    await this.activity.flush()
    const actions = []
    for (const [actionId, { ids: expectedIds, inputIds: expectedInputIds }] of groups) {
      const proof = await this.activity.capture(actionId, { expectedIds, expectedInputIds })
      if (!proof.complete || proof.failedCount || proof.expectedTruncated || proof.expectedInputMissingCount) fail('Preset CLI Activity is incomplete, failed, truncated or expired; exact mutation input/output capture could not be verified.')
      actions.push({ actionId, ...proof })
    }
    // Include read/discovery failures even when the expected IDs are only the
    // journaled mutations. Additional verification calls are valid observations.
    if (this.action?.id && !groups.has(this.action.id)) {
      const proof = await this.activity.capture(this.action.id)
      if (!proof.complete || proof.failedCount) fail('Preset verification CLI Activity is incomplete or contains a failed call. Inspect CLI Activity before rebuilding.')
      actions.push({ actionId: this.action.id, ...proof })
    }
    if (this.preset.stores.some(store => store.projects.length) && !groups.size) fail('Preset CLI Activity has no retained mutation identities. Inspect the step journal before rebuilding.')
    return { complete: true, verifiedAt: Date.now(), expectedMutations: [...groups.values()].reduce((sum, group) => sum + group.ids.length, 0), cliInvocations: actions.reduce((sum, proof) => sum + proof.count, 0), actions }
  }

  async run(command, { actionId, onReady, beforeReset, expectedCleanup, inheritedLock } = {}) {
    this.command = command
    if (inheritedLock) {
      const lease = JSON.parse(readFileSync(this.lock, 'utf8'))
      if (lease.pid !== process.pid || lease.actionId !== inheritedLock) fail('The inherited build lock does not belong to this operation.')
    } else this.acquire()
    try {
      let clearError
      this.load(command === 'setup' || command === 'preview')
      this.activity = configureActivity(this.state)
      let cleanupPlan
      if (['reset', 'teardown'].includes(command)) {
        // Read-only prerequisites and ownership checks precede the irreversible clear.
        await this.driver.discover()
        if (this.driver.connect) await this.driver.connect()
        if (command === 'reset') await this.preflight()
        await assertHostIdle(this.state)
        await beforeReset?.()
        cleanupPlan = await this.cleanupPlan(command === 'reset')
        if (expectedCleanup && expectedCleanup !== cleanupPlan.signature) fail('The cleanup inventory changed since confirmation. Refresh the cleanup plan and confirm again.')
      }
      if (command === 'reset') {
        try { await this.activity.clear() } catch (error) {
          if (!error.activityCleared) throw error
          clearError = error
        }
        this.report('Previous CLI Activity in this demo environment was cleared.')
      }
      this.commandId = actionId ?? randomUUID()
      this.action = { id: this.commandId, name: `demo.${command}`, label: `${command.charAt(0).toUpperCase() + command.slice(1)} ${this.presetName} demo (${this.driver.connect ? 'desktop + CLI' : 'CLI'})`, target: this.presetName, page: '/activity', origin: 'user' }
      this.action.page = '/presets'
      writeFileSync(this.lock, JSON.stringify({ pid: process.pid, at: Date.now(), actionId: this.action.id }), { mode: 0o600 })
      return await withActivity({ state: this.state, action: this.action }, async () => {
        this.activity.record(this.action, 'action.received')
        try {
          if (['setup', 'reset', 'teardown'].includes(command)) {
            this.manifest.presetOperation = { id: this.action.id, actionId: this.action.id, command, preset: this.presetName, pid: process.pid, created: Date.now(), state: 'running', phase: `${command === 'reset' ? 'Resetting' : 'Running'} preset through the CLI`, historyCleared: command === 'reset' }
            this.save()
          }
          await onReady?.(this.action)
          if (clearError) throw new Error(`Previous CLI Activity was cleared, but old files could not all be removed: ${clearError.message}. Resource cleanup has not started. Inspect the log directory before resetting again.`)
          await this.driver.discover()
          await this.initialize()
          if (this.driver.connect) await this.driver.connect()
          let verification
          if (command === 'setup') await this.setup()
          else if (command === 'reset') { await this.cleanup(true, cleanupPlan); this.report('Rebuilding preset'); await this.setup() }
          else if (command === 'teardown') await this.cleanup(false, cleanupPlan)
          else if (command === 'verify') verification = await this.verify()
          else if (!['status', 'preview'].includes(command)) fail(`Unknown demo command ${command}`)
          if (command === 'setup' || command === 'reset') {
            const verificationLabel = this.sandboxes ? 'Verifying preset files, history and workspaces' : 'Verifying project files, branches and main Layers'
            this.progress({ stage: 'verifying', completed: 0, total: this.preset.stores.reduce((sum, store) => sum + store.projects.length, 0), label: verificationLabel }, true)
            this.report(verificationLabel)
            verification = await this.verify({ activity: false })
            this.progress({ stage: 'verifying', completed: verification.projects, total: verification.projects, label: 'Preset verified' }, true)
            this.manifest.lastSetupActionId = this.action.id; this.manifest.sandboxes = this.sandboxes
          }
          this.manifest.last = { command, at: Date.now(), actionId: this.action.id }; this.save()
          if (['setup', 'reset', 'teardown'].includes(command)) { Object.assign(this.manifest.presetOperation, { state: 'completed', ended: Date.now(), cleanup: cleanupPlan ? this.manifest.cleanupReceipt : undefined, presetVerified: verification?.presetVerified, phase: command === 'teardown' ? 'Preset resources removed. Cleanup verified.' : command === 'reset' ? 'Reset completed. Cleanup and rebuilt preset verified. Previous CLI Activity was cleared.' : 'Preset is ready and verified' }); this.save() }
          this.activity.record(this.action, 'action.finished', { status: 200, ...(cleanupPlan ? { cleanup: this.manifest.cleanupReceipt } : {}), ...verification })
          return { preset: this.presetName, state: this.state, home: this.home, actionId: this.action.id, cleanup: cleanupPlan ? this.manifest.cleanupReceipt : undefined, activityUrl: `http://127.0.0.1:1025/#/activity?action=${this.action.id}`, ...verification, ...(command === 'status' ? await this.status() : {}) }
        } catch (error) {
          if (['setup', 'reset', 'teardown'].includes(command) && this.manifest.presetOperation) { Object.assign(this.manifest.presetOperation, { state: 'failed', ended: Date.now(), cleanup: cleanupPlan ? this.manifest.cleanupReceipt : undefined, phase: error.message, error: { code: error.code ?? 'Failed', message: error.message } }); this.save() }
          this.activity.record(this.action, 'action.finished', { status: 500, error: true, code: error.code ?? 'Failed' })
          throw error
        } finally { await this.activity.flush() }
      })
    } finally { this.release() }
  }
}
