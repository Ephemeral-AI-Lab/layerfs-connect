import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileSimulation, writeSimulationPackage, resolveSimulationStep, claimSimulationExecution, validateSimulationPackage } from '../../tools/simulation/compiler.mjs'
import { assertProjectStep } from '../../tools/demo/recipe.mjs'
import { verifyProject } from '../../tools/demo/project-verification.mjs'
import { execute as executeCli } from '../cli/spawn.js'
import { stringify } from '../cli/json.js'
import { withActivity } from '../activity/context.js'
import { invocationIdentity } from '../activity/recorder.js'
import { SimulationAgents } from './agents.js'
import { WorkspaceLifecycleGate } from './gate.js'

const persist = (file, value) => { writeFileSync(`${file}.tmp`, stringify(value) + '\n', { mode: 0o600 }); renameSync(`${file}.tmp`, file) }
const stopped = () => Object.assign(new Error('Simulation stopped.'), { code: 'SimulationStopped' })

/** Owns independent run packages, dependency scheduling and real CLI receipts. */
export class SimulationManager extends EventEmitter {
  constructor({ state, spec, agents, onChange = () => {}, execute = executeCli, verify = verifyProject, agentRuntime = null }) {
    super(); Object.assign(this, { state, spec, agents, onChange, execute, verify }); this.runs = new Map(); this.cliActive = 0; this.cliWaiting = []; this.cliLimit = 12; this.workspaceGate = new WorkspaceLifecycleGate()
    this.agentRuntime = agentRuntime ?? new SimulationAgents({ state, recorder: agents.recorder ? (chatId, context) => agents.recorder(chatId, context) : null, publishSession: async (value) => {
      await agents.publishSession(value)
      for (const run of this.runs.values()) if (Object.values(run.sessions.conversations).some(chat => chat.id === value.chatId)) {
        const conversationId = Object.entries(run.sessions.conversations).find(([, chat]) => chat.id === value.chatId)[0]
        Object.assign(run.sessions.conversations[conversationId], { sessionFile: value.sessionFile })
        for (const child of value.children) run.sessions.subagents[`${conversationId}/${child.id}`] = { ...child, chatId: value.chatId }
        persist(join(run.dir, 'sessions.json'), run.sessions)
      }
    } })
    mkdirSync(join(state, 'simulations'), { recursive: true })
    // Interrupted writes are evidence. Never resume or retry an uncertain mutation.
    for (const id of readdirSync(join(state, 'simulations'))) {
      const dir = join(state, 'simulations', id), file = join(dir, 'manifest.json')
      if (!existsSync(file)) continue
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8'))
        if (['preparing', 'running', 'verifying', 'stopping', 'prepared'].includes(manifest.status)) { manifest.status = 'interrupted'; manifest.error = 'The host stopped during this simulation. Inspect receipts before starting a new run.'; persist(file, manifest) }
        this.runs.set(id, { manifest, dir, controller: null, sessions: JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8')), resources: JSON.parse(readFileSync(join(dir, 'resources.json'), 'utf8')) })
      } catch { /* A partial package is retained and cannot be executed. */ }
    }
  }
  snapshot(run) { return { ...run.manifest, id: run.manifest.runId, state: run.manifest.status, template: run.manifest.project, project: run.manifest.projectRef, sessionId: Object.values(run.sessions.conversations)[0]?.id ?? null, directory: run.dir, resources: run.resources, sessions: run.sessions } }
  list() { return [...this.runs.values()].map(run => this.snapshot(run)) }
  get(id) { const run = this.runs.get(id); if (!run) throw Object.assign(new Error('Simulation not found.'), { status: 404 }); return this.snapshot(run) }
  changed(run, force = true) {
    if (!force && Date.now() - (run.lastChanged ?? 0) < 250) return
    run.lastChanged = Date.now(); persist(join(run.dir, 'manifest.json'), run.manifest)
    const snapshot = this.snapshot(run)
    this.onChange(snapshot); this.emit('change', snapshot)
    const { id, state, project, template, sessionId, progress, error } = snapshot
    this.emit('event', { type: 'simulation', run: { id, state, project, template, sessionId, progress, error } })
  }
  flush(run, force = false) {
    if (!force && Date.now() - (run.lastFlush ?? 0) < 1000) return
    run.lastFlush = Date.now(); persist(join(run.dir, 'receipts.json'), run.receipts); persist(join(run.dir, 'resources.json'), run.resources)
  }
  journal(run, event) { appendFileSync(join(run.dir, 'journal.jsonl'), stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 }) }
  launch(input) { return this.start(input) }
  busy() { return [...this.runs.values()].some(run => ['preparing', 'running', 'verifying', 'stopping'].includes(run.manifest.status)) }
  async start(input) {
    let compiled
    try { compiled = compileSimulation(input) }
    catch (error) { throw Object.assign(error, { status: 400, code: 'InvalidInput' }) }
    const dir = await writeSimulationPackage(this.state, compiled)
    await claimSimulationExecution(dir, 'host')
    // Generated text is already on disk; retain only the executable plan/state.
    delete compiled.files
    const run = { ...compiled, dir, receipts: {}, controller: new AbortController(), pending: new Set(), completed: new Set(), started: new Set(), running: new Map() }
    this.runs.set(compiled.manifest.runId, run)
    run.manifest.status = 'preparing'; run.manifest.progress = { completed: 0, total: compiled.plan.counts.commands }; this.changed(run)
    run.promise = this.run(run).catch(error => {
      run.manifest.status = run.manifest.cancellationUnconfirmed ? 'interrupted' : run.controller.signal.aborted && !run.failure ? 'stopped' : 'failed'; run.manifest.error = run.manifest.cancellationUnconfirmed ? 'Simulation stopped, but the remote execution cancellation could not be confirmed. Inspect the owned workspace before continuing.' : (run.failure ?? error).message
      this.journal(run, { type: 'run.finished', status: run.manifest.status, error: run.manifest.error }); this.changed(run)
    }).finally(async () => {
      this.flush(run, true)
      for (const chat of Object.values(run.sessions.conversations)) await this.agentRuntime.publish?.(chat.id, 'idle', run.manifest.error ?? null)
    })
    return this.snapshot(run)
  }
  async settled(id) { const run = this.runs.get(id); if (!run) return this.get(id); await run.promise; return this.snapshot(run) }
  async stop(id) {
    const run = this.runs.get(id); if (!run) return this.get(id)
    if (!['preparing', 'running', 'verifying', 'stopping'].includes(run.manifest.status)) return this.snapshot(run)
    run.manifest.status = 'stopping'; this.changed(run); run.controller.abort(stopped())
    await run.promise; return this.snapshot(run)
  }
  async command(run, step) {
    const argv = resolveSimulationStep(step, run.receipts, run.dir)
    if (argv[0] === 'workspace' && !['exec-cancel', 'exec-kill'].includes(argv[1])) {
      const sandbox = argv[1] === 'mount' ? argv[2] : argv[2].split(':', 1)[0]
      const key = `${this.spec.home ?? ''}\0${sandbox}`
      return this.workspaceGate.run(key, ['mount', 'unmount'].includes(argv[1]), run.controller.signal, () => this.admittedCommand(run, step))
    }
    return this.admittedCommand(run, step)
  }
  async admittedCommand(run, step) {
    const signal = run.controller.signal
    signal.throwIfAborted()
    if (this.cliActive >= this.cliLimit) await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal.removeEventListener('abort', abort); resolve() } }
      const abort = () => { this.cliWaiting = this.cliWaiting.filter(item => item !== entry); reject(signal.reason ?? stopped()) }
      signal.addEventListener('abort', abort, { once: true }); this.cliWaiting.push(entry)
    })
    else this.cliActive++
    try { return await this.commandInside(run, step) }
    finally { const next = this.cliWaiting.shift(); if (next) next.resolve(); else this.cliActive-- }
  }
  async commandInside(run, step) {
    const { signal } = run.controller
    signal.throwIfAborted()
    const argv = resolveSimulationStep(step, run.receipts, run.dir)
    for (const dependency of step.dependsOn ?? []) if (!run.completed.has(dependency)) throw new Error(`Step ${step.key} started before ${dependency}.`)
    if (run.started.has(step.key)) throw new Error(`Step ${step.key} was already attempted; uncertain mutations cannot be replayed.`)
    run.started.add(step.key)
    this.journal(run, { type: 'step.started', step: step.key, argv, conversationId: step.conversationId, agentId: step.agentId })
    let child, cancel, cancellation
    try {
      const pending = withActivity({ state: this.state, action: { id: run.manifest.runId, name: 'simulation.run', label: `Simulation ${run.manifest.project}`, target: run.manifest.projectRef, conversationId: step.conversationId, sessionId: run.sessions.conversations[step.conversationId]?.id, agentId: step.agentId, origin: 'user' } }, () => this.execute(this.spec, argv, {
        input: step.input, events: argv.includes('--events'), beforeSpawn: () => signal.throwIfAborted(), onSpawn: value => {
          child = value; cancel = () => {
            if (argv[0] === 'workspace' && argv[1] === 'exec') {
              const execId = argv[argv.indexOf('--exec-id') + 1]
              cancellation = withActivity({ state: this.state, action: { id: run.manifest.runId, name: 'simulation.stop', label: 'Stop simulation execution', target: run.manifest.projectRef, origin: 'user' } }, () => this.execute(this.spec, ['workspace', 'exec-cancel', argv[2], execId], {})).then(result => {
                if (!['cancelled', 'ended'].includes(result?.outcome) || result.outcome === 'cancelled' && !['SIGTERM', 'SIGKILL'].includes(result.signal)) throw new Error(`Execution cancellation was not confirmed: ${result?.outcome ?? 'missing outcome'}`)
                this.journal(run, { type: 'execution.cancelled', step: step.key, result })
              }).catch(error => {
                this.journal(run, { type: 'execution.cancel-failed', step: step.key, error: error.message, replayAllowed: false })
                run.manifest.cancellationUnconfirmed = true
              })
            }
            child.kill('SIGTERM')
          }; signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
        },
      }))
      const activity = invocationIdentity(pending)
      const result = await pending
      if (step.key === 'setup.machine' && (result.supports?.sqlite === false || !['ready', 'running'].includes(result.state))) {
        throw Object.assign(new Error(`Machine ${run.manifest.machine} is not ready for a SQLite simulation. Start a supported machine and launch a new simulation.`), { code: 'Unavailable' })
      }
      assertProjectStep(step, result)
      run.receipts[step.key] = result; run.completed.add(step.key)
      this.resource(run, step, result)
      this.journal(run, { type: 'step.completed', step: step.key, result, activity })
      if (!step.key.startsWith('verification.')) run.manifest.progress.completed++
      this.flush(run); this.changed(run, false)
      return result
    } catch (error) {
      this.journal(run, { type: 'step.failed', step: step.key, error: error.message, code: error.code, transport: error.transport, replayAllowed: false })
      throw error
    } finally { if (cancel) signal.removeEventListener('abort', cancel); await cancellation }
  }
  /** Confirmed facts of a workspace call's mount, from this run's own mount receipts (never a later mount with the same name). */
  mountFacts(run, step, value) {
    const argv = resolveSimulationStep(step, run.receipts, run.dir), project = run.manifest.projectRef
    if (argv[1] === 'mount') return value?.ws ? { project, branch: value.branch ?? argv[3], base_layer: value.base_layer ?? null } : null
    // a handle can be mounted again after its unmount; the call belongs to the latest confirmed mount
    const mount = run.plan.steps.findLast(s => s.argv[0] === 'workspace' && s.argv[1] === 'mount' && run.receipts[s.key]?.ws === argv[2])
    return mount ? { project, branch: run.receipts[mount.key].branch ?? mount.argv[3], base_layer: run.receipts[mount.key].base_layer ?? null } : null
  }
  resource(run, step, result) {
    const [family, call] = step.argv
    if (family === 'store' && call === 'create') run.resources.store.status = 'created'
    if (family === 'store' && call === 'push') run.resources.store.status = 'placed'
    if (family === 'sandbox' && call === 'create') run.resources.sandboxes.push({ name: step.argv[3], status: 'running', receipt: result })
    if (family === 'workspace' && call === 'mount') run.resources.workspaces.push({ ws: result.ws, status: 'mounted' })
    if (family === 'workspace' && call === 'unmount') { const ws = resolveSimulationStep(step, run.receipts, run.dir)[2]; const lease = run.resources.workspaces.find(item => item.ws === ws && item.status === 'mounted'); if (lease) lease.status = 'unmounted' }
    if (family === 'project' && call === 'init') run.resources.branches.push({ name: 'main', owned: true, status: 'retained', receipt: result })
    if (family === 'branch' && ['fork', 'merge'].includes(call)) {
      const existing = run.resources.branches.find(branch => branch.name === step.argv[3])
      if (existing) Object.assign(existing, { receipt: result })
      else run.resources.branches.push({ name: step.argv[3], owned: true, status: 'retained', receipt: result })
    }
  }
  async run(run) {
    await validateSimulationPackage(run.dir)
    for (const step of run.plan.steps.filter(step => step.phase === 'setup')) await this.command(run, step)
    for (const conversation of run.plan.conversations) {
      run.controller.signal.throwIfAborted()
      const chat = await this.agents.createConversation({ title: conversation.title, project: run.manifest.projectRef, runId: run.manifest.runId, conversationId: conversation.id })
      if (!chat?.id) throw new Error('Simulation chat adapter returned no saved conversation ID.')
      run.sessions.conversations[conversation.id] = { id: chat.id, project: run.manifest.projectRef }; persist(join(run.dir, 'sessions.json'), run.sessions)
    }
    run.manifest.status = 'running'; this.changed(run)
    const tasks = new Map(run.plan.tasks.map(task => [task.id, task])), done = new Set(), active = new Map(), busyAgents = new Set(), counts = new Map()
    const byKey = new Map(run.plan.steps.map(step => [step.key, step])), turns = run.plan.turns ?? [], closedTurns = new Set()
    try {
    while (done.size < tasks.size) {
      run.controller.signal.throwIfAborted()
      for (const task of tasks.values()) {
        const key = `${task.conversationId}/${task.agentId ?? 'main'}`
        if (done.has(task.id) || active.has(task.id) || busyAgents.has(key) || active.size >= run.plan.limits.concurrency || (counts.get(task.conversationId) ?? 0) >= run.plan.limits.perConversation || task.dependsOn.some(id => !done.has(id))) continue
        busyAgents.add(key); counts.set(task.conversationId, (counts.get(task.conversationId) ?? 0) + 1)
        const work = this.agentRuntime.executeTask({ chatId: run.sessions.conversations[task.conversationId].id, agentId: task.agentId, task, mainTurn: turns.find(turn => turn.conversationId === task.conversationId && !turn.agentId && turn.taskIds.includes(task.id)), agentTurn: turns.find(turn => turn.conversationId === task.conversationId && turn.agentId === task.agentId && turn.taskIds.includes(task.id)), steps: task.stepKeys.map(key => byKey.get(key)), resolveStep: step => resolveSimulationStep(step, run.receipts, run.dir), executeStep: step => this.command(run, step), runDir: run.dir, project: run.manifest.projectRef, mountFacts: (step, value) => this.mountFacts(run, step, value), signal: run.controller.signal, execute: async () => {
          const results = []
          for (const key of task.stepKeys) results.push(await this.command(run, byKey.get(key)))
          return { taskId: task.id, commands: results.length, final: results.at(-1) }
        } }).then(async () => {
          done.add(task.id); this.journal(run, { type: 'task.completed', task: task.id })
          for (const turn of turns.filter(turn => turn.conversationId === task.conversationId && turn.taskIds.includes(task.id) && turn.taskIds.every(id => done.has(id)))) {
            const turnKey = `${turn.conversationId}/${turn.agentId ?? 'main'}/${turn.id}`
            if (!closedTurns.has(turnKey)) { closedTurns.add(turnKey); await this.agentRuntime.finishTurn?.(run.sessions.conversations[turn.conversationId].id, turn.agentId, turn.id) }
          }
        }).catch(error => { if (!run.controller.signal.aborted) { run.failure ??= error; run.controller.abort(error) } throw error }).finally(() => { active.delete(task.id); busyAgents.delete(key); counts.set(task.conversationId, counts.get(task.conversationId) - 1) })
        active.set(task.id, work); work.catch(() => {})
      }
      if (!active.size) throw new Error('Simulation dependency graph cannot make progress.')
      await Promise.race(active.values())
    }
    } finally { await Promise.allSettled(active.values()) }
    for (const chat of Object.values(run.sessions.conversations)) await this.agentRuntime.finishChat?.(chat.id)
    run.manifest.status = 'verifying'; this.changed(run)
    let verificationIndex = 0
    const verdict = await this.verify(async argv => this.command(run, { key: `verification.${++verificationIndex}`, argv: argv.map(word => word === `${run.manifest.store}/${run.manifest.project}` ? run.manifest.projectRef : word), dependsOn: [] }), run.manifest.store, run.manifest.project, run.receipts, { cycles: run.manifest.cycles, executionMode: run.manifest.mixed ? 'mixed' : 'filesystem' })
    if (verdict?.project) verdict.project = run.manifest.projectRef
    if (run.resources.workspaces.some(workspace => workspace.status !== 'unmounted')) throw new Error('Simulation left an owned workspace mounted.')
    for (const sandbox of run.resources.sandboxes) {
      const status = await this.command(run, { key: `verification.${++verificationIndex}`, argv: ['sandbox', 'get', sandbox.name], dependsOn: [] })
      if (status.state !== 'running' || status.down_reason || !Array.isArray(status.workspaces) || status.workspaces.length || status.next_page_pos != null) throw new Error(`Sandbox ${sandbox.name}: clean workspace state could not be confirmed.`)
    }
    this.flush(run, true)
    persist(join(run.dir, 'verification', 'result.json'), verdict)
    run.manifest.status = 'completed'; run.manifest.verification = verdict; this.journal(run, { type: 'run.finished', status: 'completed' }); this.changed(run)
  }
  async close() { await Promise.all([...this.runs.values()].filter(run => run.controller).map(run => this.stop(run.manifest.runId))); await this.agentRuntime.close?.() }
}
