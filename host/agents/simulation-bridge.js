import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { idleExecution } from './runtime.js'

/** Project-bound saved chats; Pi owns the transcripts, the simulation owns execution. */
export function simulationChatAdapter(manager) {
  const projections = new Map()
  return {
    async createConversation({ title, project, runId, conversationId }) {
      const cwd = join(manager.state, 'simulations', runId, 'conversations', conversationId)
      mkdirSync(cwd, { recursive: true, mode: 0o700 })
      const chat = await manager.create({ title, project, cwd, runs: 'folder', provider: 'simulation', modelId: 'scripted', thinkingLevel: 'off', limits: { maxRetries: 0 } })
      const record = manager.record(chat.id)
      record.simulation = { id: runId, conversationId }
      // Planned objectives have no active Pi work until the runtime publishes it.
      record.state = 'idle'
      record.execution = idleExecution()
      manager.changed(chat.id, true, { summaryOnly: true })
      return { id: chat.id, cwd }
    },
    /** The bash tool's explicit CLI calls, recorded as `cli` operations of the conversation (sessions/). */
    recorder(chatId, context) {
      if (!manager.record(chatId).simulation) throw new Error('Simulation cannot record into an unrelated conversation.')
      return manager.sessions?.recorder(chatId, context, 'cli') ?? null
    },
    async publishSession({ chatId, sessionFile, sessionManager, children, state = 'running', error = null }) {
      const record = manager.record(chatId)
      if (!record.simulation) throw new Error('Simulation cannot publish into an unrelated conversation.')
      record.sessionFile = sessionFile ?? record.sessionFile
      record.children = children ?? record.children
      record.state = error ? 'error' : state
      record.error = error
      record.needsStop = false
      record.execution.phase = error ? 'error' : state === 'running' ? 'thinking' : 'idle'
      record.execution.reason = error
      if (record.sessionFile && existsSync(record.sessionFile)) {
        const stat = statSync(record.sessionFile)
        const stamp = `${record.sessionFile}:${stat.size}:${stat.mtimeMs}:${record.state}`
        if (projections.get(chatId) !== stamp) {
          manager.projectHistory(record, sessionManager ?? SessionManager.open(record.sessionFile), { running: record.state === 'running' })
          // Scripted histories are evidence, not mutable model checkpoints.
          for (const message of record.messages) message.canRestore = false
          projections.set(chatId, stamp)
        }
      }
      manager.changed(chatId, true, { summaryOnly: true })
      // once the run stops executing, read the kinds of its merges' sources (not during the run: its CLI capacity is the run's)
      if (record.state !== 'running') manager.sessions?.schedule(record, 0)
    },
  }
}

/** A restart preserves interrupted evidence and never reopens a model session. */
export function reconcileSimulationChats(manager, simulations) {
  for (const record of manager.records.values()) {
    if (!record.simulation) continue
    let run
    try { run = simulations.get(record.simulation.id) } catch { /* Partial packages remain inspectable. */ }
    record.needsStop = false
    record.state = ['interrupted', 'failed'].includes(run?.state) || !run ? 'error' : 'idle'
    record.error = run?.error ?? (!run ? 'The simulation package is unavailable. Its conversation history is retained.' : null)
    record.execution.phase = record.error ? 'error' : 'idle'
    for (const child of record.children) if (['running', 'pending', 'queued', 'paused'].includes(child.state)) child.state = 'stopped'
    for (const message of record.messages) message.canRestore = false
    manager.changed(record.id, true, { summaryOnly: true })
    manager.sessions?.schedule(record)
  }
}

export function simulationChatRoute(manager, method, parts) {
  const [group, id, action] = parts
  if (group !== 'sessions' || !id || method === 'GET' || !manager.records.get(id)?.simulation) return null
  const record = manager.record(id)
  const runId = record.simulation.id
  if (action === 'stop' || action === 'children' && parts[4] === 'stop') {
    return { handled: true, value: Promise.resolve(manager.simulations.stop(runId)).then(() => manager.detail(id)) }
  }
  if (action === 'update') return null
  if (method === 'DELETE') {
    const run = manager.simulations.get(runId)
    if (['completed', 'failed', 'stopped', 'interrupted'].includes(run.state)) return null
  }
  throw Object.assign(new Error('This conversation is managed by its simulation. Use Stop simulation or start a new /simulation run.'), { status: 409, code: 'ConnectBusy' })
}
