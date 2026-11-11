// One persistent scripted Pi request per saved agent. Many compiled tasks and
// genuine shell calls execute inside that request without manufacturing turns.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Type } from 'typebox'
import { ModelRuntime, createAgentSession, SessionManager, SettingsManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { renderSimulationCommand } from '../../tools/simulation/compiler.mjs'
import { executeSimulationBash } from './bash.js'
import { traceSimulationStep } from './trace.js'

const PROVIDER = 'simulation', API = 'layerfs-simulation'
const usage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
const toolResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value })
const stopped = () => new Error('Simulation stopped.')

export class SimulationAgents {
  // `recorder(chatId, context)` records a bash tool's CLI calls in the conversation's journal (sessions/)
  constructor({ state, publishSession = async () => {}, recorder = null }) {
    Object.assign(this, { state, publishSession, recorder }); this.sessions = new Map(); this.byId = new Map(); this.children = new Map(); this.opening = new Map(); this.states = new Map(); this.publications = new Map()
  }
  initialize() { return this.initializing ??= this.initializeRuntime() }
  async initializeRuntime() {
    this.runtime = await ModelRuntime.create({ authPath: join(this.state, 'simulation-auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })
    this.runtime.registerProvider(PROVIDER, { name: 'Scripted simulation', apiKey: 'scripted', baseUrl: 'http://simulation.invalid', api: API,
      models: [{ id: 'scripted', name: 'Simulation', api: API, reasoning: false, input: ['text'], contextWindow: 1_000_000, maxTokens: 100_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      streamSimple: (_model, _context, options = {}) => {
        const stream = createAssistantMessageEventStream()
        setImmediate(async () => {
          const message = { role: 'assistant', content: [], provider: PROVIDER, model: 'scripted', api: API, usage: usage(), timestamp: Date.now(), stopReason: 'stop' }
          try {
            const entry = this.byId.get(options.sessionId)
            if (!entry) throw new Error('No saved simulation agent owns this request.')
            const assignment = await this.nextAssignment(entry, options.signal)
            stream.push({ type: 'start', partial: message })
            if (!assignment) {
              const completed = entry.turnResults ?? []
              const commands = completed.reduce((sum, item) => sum + (item.value?.commands ?? item.value?.result?.commands ?? 0), 0)
              const final = [...completed].reverse().map(item => item.value?.final ?? item.value?.result?.final).find(Boolean)
              const text = `Completed ${completed.map(item => item.title).join('; ')}. Confirmed ${commands} CLI steps.${final?.head ? ` Final saved head: ${final.head}.` : ''}${final?.layer ? ` Publication: ${typeof final.layer === 'string' ? final.layer : JSON.stringify(final.layer)}.` : ''}`
              message.content.push({ type: 'text', text }); stream.push({ type: 'text_start', contentIndex: 0, partial: message }); stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message }); stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message })
            } else {
              const step = assignment.steps?.[assignment.cursor]
              const name = assignment.collect ? 'simulation_collect' : assignment.delegate ? 'simulation_delegate' : 'bash'
              const args = step ? { command: renderSimulationCommand(step, assignment.resolveStep(step)), scriptPath: assignment.task.scriptPath ?? '' } : { task: assignment.task.id, agentId: assignment.task.agentId, scriptPath: assignment.task.scriptPath ?? '' }
              const toolCall = { type: 'toolCall', id: `simulation_${assignment.task.id}_${step?.key ?? name}`, name, arguments: args }
              assignment.offered = args
              message.content.push(toolCall); message.stopReason = 'toolUse'
              stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message }); stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message })
            }
            stream.push({ type: 'done', reason: message.stopReason, message })
          } catch (error) {
            message.stopReason = options.signal?.aborted ? 'aborted' : 'error'; message.errorMessage = error.message
            stream.push({ type: 'error', reason: message.stopReason, error: message })
          }
        }); return stream
      },
    })
  }
  async nextAssignment(entry, signal) {
    // Pi asks again only after persisting the preceding tool result.
    if (entry.current?.done) {
      const completed = entry.current; entry.current = null
      if (completed.error) { completed.reject(completed.error); throw completed.error }
      entry.turnResults.push({ title: completed.collect ? `received ${completed.task.title} from ${completed.task.agentId}` : completed.delegate ? `delegated ${completed.task.title}` : completed.task.title, value: completed.value })
      completed.resolve(completed.value)
    }
    while (!entry.current) {
      signal?.throwIfAborted()
      if (entry.error) throw entry.error
      if (entry.queue.length) { entry.current = entry.queue.shift(); break }
      if (entry.ending) return null
      await new Promise((resolve, reject) => {
        const abort = () => { entry.wake = null; reject(signal.reason ?? stopped()) }
        entry.wake = () => { signal?.removeEventListener('abort', abort); entry.wake = null; resolve() }
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
    return entry.current
  }
  async session(chatId, agentId = null, parentSession) {
    const key = `${chatId}/${agentId ?? 'main'}`
    if (this.sessions.has(key)) return this.sessions.get(key)
    if (!this.opening.has(key)) this.opening.set(key, this.createSession(chatId, agentId, parentSession).finally(() => this.opening.delete(key)))
    return this.opening.get(key)
  }
  async createSession(chatId, agentId, parentSession) {
    await this.initialize()
    const dir = join(this.state, 'chats', chatId, agentId ? `simulation-${agentId}` : 'simulation-main'); mkdirSync(dir, { recursive: true })
    const sessionManager = SessionManager.create(dir, dir, parentSession ? { parentSession } : undefined)
    const entry = { sessionManager, chatId, agentId, dir, queue: [], current: null, wake: null, ending: false, turnResults: [], turnCount: 0 }
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } })
    const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, noContextFiles: true, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true }); await resourceLoader.reload()
    const coordination = ['simulation_delegate', 'simulation_collect'].map(name => ({ name, label: name === 'simulation_collect' ? 'Collect worker result' : 'Delegate simulation task', description: 'Coordinate a compiled assignment and confirmed worker results.', parameters: Type.Object({ task: Type.String(), agentId: Type.Optional(Type.String()), scriptPath: Type.Optional(Type.String()) }), execute: async (_id, args) => {
      const assignment = entry.current
      if (!assignment || assignment.task.id !== args.task || assignment.done || assignment.invoked) throw new Error('No matching pending simulation assignment.')
      assignment.invoked = true
      try { assignment.value = await assignment.execute(); assignment.done = true; return toolResult(assignment.value) }
      catch (error) { assignment.error = error; assignment.done = true; throw error }
    } }))
    const bash = { name: 'bash', label: 'Bash', description: 'Run the explicit compiled LayerFS CLI command in a real shell.', parameters: Type.Object({ command: Type.String(), scriptPath: Type.Optional(Type.String()) }), execute: async (_id, args, signal) => {
      const assignment = entry.current, step = assignment?.steps?.[assignment.cursor]
      if (!step || assignment.done || args.command !== assignment.offered.command) throw new Error('No matching compiled shell command.')
      try {
        const result = await executeSimulationBash({ command: args.command, argv: assignment.resolveStep(step), input: step.input, stepKey: step.key, scriptPath: assignment.task.scriptPath, taskId: assignment.task.id, cwd: assignment.runDir ?? dir, signal: assignment.signal ?? signal, execute: () => traceSimulationStep({ state: this.state, chatId, agentId, sessionId: sessionManager.getSessionId(), sessionManager, toolCallId: _id, argv: assignment.resolveStep(step), input: step.input, recorder: this.recorder && (context => this.recorder(chatId, context)), mount: assignment.mountFacts && (value => assignment.mountFacts(step, value)), execution: { project: assignment.project ?? null } }, () => assignment.executeStep(step)) })
        assignment.cursor++; assignment.final = result.details.receipt
        if (assignment.cursor === assignment.steps.length) { assignment.done = true; assignment.value = { taskId: assignment.task.id, commands: assignment.cursor, final: assignment.final } }
        return result
      } catch (error) { assignment.error = error; assignment.done = true; throw error }
    } }
    const customTools = [bash, ...coordination]
    const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: this.runtime, model: this.runtime.getModel(PROVIDER, 'scripted'), sessionManager, settingsManager, resourceLoader, tools: customTools.map(tool => tool.name), customTools })
    entry.session = session; this.sessions.set(`${chatId}/${agentId ?? 'main'}`, entry); this.byId.set(sessionManager.getSessionId(), entry)
    session.subscribe(() => this.schedulePublish(chatId))
    return entry
  }
  failEntry(entry, error) {
    entry.error = error
    entry.current?.reject(error); entry.current = null
    for (const queued of entry.queue.splice(0)) queued.reject(error)
    entry.wake?.()
  }
  enqueue(entry, assignment) {
    const result = new Promise((resolve, reject) => Object.assign(assignment, { resolve, reject }))
    result.catch(() => {}); assignment.cursor = 0
    const turn = assignment.turn ?? { id: 'objective', request: 'Complete the related project objectives. Execute the visible CLI steps, preserve dependencies, and hand back confirmed results.' }
    entry.submissions = (entry.submissions ?? Promise.resolve()).then(async () => {
      if (entry.error) throw entry.error
      if (entry.loop && entry.turnId !== turn.id) await this.endTurn(entry)
      if (entry.error) throw entry.error
      entry.queue.push(assignment); entry.wake?.()
      if (!entry.loop) {
        if (++entry.turnCount > 10) throw new Error('Simulation agent exceeded its ten-turn limit.')
        entry.turnId = turn.id; entry.ending = false; entry.turnResults = []
        const signal = assignment.signal
        entry.abort = () => { this.failEntry(entry, signal.reason ?? stopped()); void entry.session.abort() }
        signal?.addEventListener('abort', entry.abort, { once: true })
        entry.loop = entry.session.prompt(turn.request).catch(error => this.failEntry(entry, error)).finally(() => {
          signal?.removeEventListener('abort', entry.abort)
          if (!entry.ending && !entry.error) this.failEntry(entry, new Error('The scripted agent stopped before its assignments finished.'))
        })
      }
    }).catch(error => { assignment.reject(error); this.failEntry(entry, error) })
    return result
  }
  async endTurn(entry) {
    if (!entry.loop) return
    entry.ending = true; entry.wake?.()
    await entry.loop; entry.loop = null; entry.turnId = null; entry.ending = false
  }
  async finishTurn(chatId, agentId, turnId) {
    const entry = this.sessions.get(`${chatId}/${agentId ?? 'main'}`)
    if (!entry) return
    await entry.submissions
    if (!turnId || entry.turnId === turnId) await this.endTurn(entry)
    await this.publish(chatId)
  }
  schedulePublish(chatId) {
    if (this.closing || this.publications.has(chatId)) return
    const timer = setTimeout(() => { this.publications.delete(chatId); void this.publish(chatId).catch(() => {}) }, 500)
    timer.unref?.(); this.publications.set(chatId, timer)
  }
  async publish(chatId, state, error = null) {
    clearTimeout(this.publications.get(chatId)); this.publications.delete(chatId)
    if (state) this.states.set(chatId, { state, error })
    const status = this.states.get(chatId) ?? { state: 'running', error: null }, main = this.sessions.get(`${chatId}/main`)
    if (main) await this.publishSession({ chatId, sessionFile: main.session.sessionFile, sessionManager: main.sessionManager, children: [...(this.children.get(chatId)?.values() ?? [])], ...status })
  }
  async executeTask({ chatId, agentId, task, steps, resolveStep, executeStep, signal, runDir, mainTurn, agentTurn, project, mountFacts }) {
    if (!steps?.length || typeof resolveStep !== 'function' || typeof executeStep !== 'function') throw new Error('Simulation agents require explicit compiled shell steps.')
    const main = await this.session(chatId), assignment = { task, steps, resolveStep, executeStep, signal, runDir, project, mountFacts, turn: agentId ? agentTurn : mainTurn }
    if (!agentId) { const value = await this.enqueue(main, assignment); await this.publish(chatId); return value }
    const child = await this.session(chatId, agentId, main.session.sessionFile)
    let work
    try {
      await this.enqueue(main, { task, signal, turn: mainTurn, delegate: true, execute: async () => {
        const children = this.children.get(chatId) ?? new Map(); this.children.set(chatId, children)
        const record = { id: agentId, runId: agentId, agent: agentId, task: task.title, state: 'running', sessionFile: child.session.sessionFile, startedAt: Date.now() }; children.set(agentId, record)
        work = this.enqueue(child, assignment).then(value => { record.state = 'completed'; return value }, error => { record.state = signal?.aborted ? 'stopped' : 'failed'; record.text = error.message; throw error }).finally(async () => { record.endedAt = Date.now(); await this.publish(chatId) }); work.catch(() => {})
        return { agentId, taskId: task.id, sessionFile: child.session.sessionFile }
      } })
    } catch (error) { if (work) await work.catch(() => {}); throw error }
    const value = await work
    await this.enqueue(main, { task, signal, turn: mainTurn, collect: true, execute: async () => ({ agentId, taskId: task.id, sessionFile: child.session.sessionFile, result: value }) })
    await this.publish(chatId); return value
  }
  async finishChat(chatId) {
    const entries = [...this.sessions.values()].filter(entry => entry.chatId === chatId)
    await Promise.all(entries.map(async entry => { await entry.submissions; await this.endTurn(entry) }))
    await this.publish(chatId)
  }
  async close() {
    this.closing = true; for (const timer of this.publications.values()) clearTimeout(timer); this.publications.clear()
    for (const entry of this.sessions.values()) { entry.ending = true; this.failEntry(entry, stopped()); await entry.session.abort(); entry.session.dispose() }
    this.sessions.clear(); this.byId.clear()
  }
}
