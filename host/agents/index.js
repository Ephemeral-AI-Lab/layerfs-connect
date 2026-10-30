import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { AgentModels } from './models.js'
import { asyncSnapshotChildren, asyncSubagentChildren, createConnectExtensions } from './extensions.js'
import { connectPrompt } from './prompt.js'
import { childrenFrom, sessionTranscript } from './transcript.js'
import { ApprovalService, permissionMode } from './permissions.js'
import { CHECKPOINT_TYPE, checkpointFor, cloneSession } from './history.js'
import { DEFAULT_LIMITS, idleExecution, runLimits, sessionUsage } from './runtime.js'
import { updateSession } from './session-metadata.js'
import { readProjectInstructions } from './context.js'
import { readToolOutput } from './tool-output.js'
import { normalizePrompt, promptDetails } from './attachments.js'
import { assertNativeControl, bindNativeInput, cancelNativeControls, currentNativeControl, nativeCommand, pendingNativeInput, runNativeControl, staleNativeControl } from './native-input.js'
import { commandContextActions, commandForkTarget } from './command-context.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
const needsRecovery = (record) => record.needsStop || record.workspace?.process || record.children.some((child) => ['running', 'pending', 'queued', 'paused'].includes(child.state))
const workspaceSummary = (workspace) => workspace ? Object.fromEntries(
  ['branch', 'state', 'sandbox', 'path', 'head', 'commitCount', 'lastSaved', 'error'].map((key) => [key, workspace[key] ?? null]),
) : null

// Pi exposes a priority peek and whole-queue clearing, but no per-item removal.
// Snapshot both queues synchronously in "all" mode, then restore their modes.
// Keep the actual message objects so equal text and extension messages stay distinct.
function takeQueues(agent) {
  const { steeringMode, followUpMode } = agent
  agent.steeringMode = agent.followUpMode = 'all'
  const first = agent.peekQueuedMessages()
  agent.clearSteeringQueue()
  const followUp = agent.peekQueuedMessages()
  agent.clearFollowUpQueue()
  agent.steeringMode = steeringMode
  agent.followUpMode = followUpMode
  return { steer: first[0] === followUp[0] ? [] : first, followUp }
}

function editQueue(active, id, mode) {
  const queues = takeQueues(active.session.agent)
  if (active.suspendedQueues) for (const kind of ['steer', 'followUp']) queues[kind].unshift(...active.suspendedQueues[kind])
  const pending = new Set([...queues.steer, ...queues.followUp])
  for (const entry of active.preparingQueued?.values() ?? []) pending.add(entry.message)
  active.queued = active.queued.filter((entry) => pending.has(entry.message))
  const entry = active.queued.find((entry) => entry.id === id)
  if (entry) {
    queues[entry.mode] = queues[entry.mode].filter((message) => message !== entry.message)
    if (mode) {
      entry.mode = mode
      queues[mode].push(entry.message)
    } else active.queued = active.queued.filter((item) => item !== entry)
  }
  if (active.suspendedQueues) active.suspendedQueues = queues
  else for (const kind of ['steer', 'followUp']) for (const message of queues[kind]) active.session.agent[kind](message)
  return entry
}

const preparedMessage = (message) => ({
  action: 'transform',
  text: message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'),
  images: message.content.filter((part) => part.type === 'image'),
})

function enqueueMessage(active, entry) {
  if (active.suspendedQueues) active.suspendedQueues[entry.mode].push(entry.message)
  else active.session.agent[entry.mode](entry.message)
}

export class AgentManager extends EventEmitter {
  static async create({ state, defaultCwd = process.cwd(), projectEnvironment = async () => ({}), projectWorkspaces = null }) {
    const agentDir = join(state, 'pi')
    mkdirSync(agentDir, { recursive: true, mode: 0o700 })
    process.env.PI_CODING_AGENT_DIR = agentDir
    const models = await AgentModels.create(agentDir)
    const manager = new AgentManager({ state, agentDir, defaultCwd, models, projectEnvironment, projectWorkspaces })
    manager.permissions = await new ApprovalService(manager).start()
    return manager
  }

  constructor(options) {
    super()
    Object.assign(this, options)
    this.dir = join(this.state, 'chats')
    mkdirSync(this.dir, { recursive: true })
    this.records = new Map()
    this.live = new Map()
    this.stopping = new Map()
    this.workspaceExecutions = new Map()
    this.workspacePreparations = new Map()
    this.creatingProjects = new Map()
    this.deletingProjects = new Set()
    this.historyOperations = new Map()
    this.controlMutations = new Map()
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(this.dir, entry.name, 'chat.json')
      if (!existsSync(file)) continue
      const record = JSON.parse(readFileSync(file, 'utf8'))
      record.permissionMode = 'full'
      record.approvals ??= []
      record.archived ??= false
      record.archivedAt ??= null
      record.limits = { ...DEFAULT_LIMITS, ...record.limits }
      record.execution ??= idleExecution()
      record.usage ??= sessionUsage()
      record.workspace ??= record.project && this.projectWorkspaces ? this.projectWorkspaces.initial(record.id) : null
      for (const approval of record.approvals) {
        if (['pending', 'reviewing'].includes(approval.status)) {
          Object.assign(approval, { status: 'cancelled', decidedAt: Date.now(), reason: 'The app closed before this command was approved.' })
        }
      }
      if (record.state === 'running') {
        record.needsStop = true
        record.state = 'idle'
        record.error = 'The app closed during this turn. Send a message to continue.'
        record.execution.phase = 'interrupted'
        record.execution.reason = record.error
      } else if (needsRecovery(record)) {
        record.needsStop = true
        record.execution.phase = 'interrupted'
        record.execution.reason = 'The app closed with unfinished agent work. Continue to recover it, or stop it explicitly.'
      }
      this.records.set(record.id, record)
      if (record.sessionFile && existsSync(record.sessionFile)) this.projectHistory(record, SessionManager.open(record.sessionFile))
      this.save(record.id)
    }
  }

  modelsSnapshot() { return { ...this.models.snapshot(), defaultCwd: this.defaultCwd } }

  execution(id) {
    const record = this.record(id)
    const execution = { ...record.execution }
    if (record.needsStop && record.state !== 'running' && execution.phase !== 'stopping') execution.phase = 'interrupted'
    else if (record.state === 'error') execution.phase = 'error'
    else if (record.state === 'running' && record.approvals.some((approval) => ['pending', 'reviewing'].includes(approval.status))) execution.phase = 'approval'
    else if (record.state === 'running' && record.children.some((child) => ['running', 'pending', 'queued', 'paused'].includes(child.state)) && !this.live.get(id)?.streaming && !this.live.get(id)?.runningTools?.size && !['retrying', 'compacting', 'preparing'].includes(execution.phase)) execution.phase = 'children'
    return execution
  }

  beginExecution(id) {
    const record = this.record(id)
    record.execution = { ...idleExecution(), phase: 'preparing', startedAt: Date.now() }
  }

  armDeadline(id, active) {
    clearTimeout(active.runTimer)
    const record = this.record(id)
    if (!record.limits.maxRuntimeSeconds) return
    const remaining = record.limits.maxRuntimeSeconds * 1000 - (Date.now() - record.execution.startedAt)
    active.runTimer = setTimeout(() => this.stopForLimit(id, `Reached the ${record.limits.maxRuntimeSeconds}-second run limit.`), Math.max(0, remaining))
    active.runTimer.unref()
  }

  stopForLimit(id, reason) {
    const active = this.live.get(id)
    if (!active || active.limitReason) return
    active.limitReason = reason
    this.record(id).execution.reason = reason
    // Stop waits for the current task, so never await it inside an awaited Pi hook.
    queueMicrotask(() => { void this.stop(id, { reason }).catch(() => {}) })
  }

  finishExecution(id, active) {
    const record = this.record(id)
    const children = active.children ? [...active.children.values()] : record.children
    if (children.some((child) => ['running', 'pending', 'queued', 'paused'].includes(child.state))) {
      if (!this.stopping.get(id)?.pending && !record.error) record.execution.phase = 'children'
      return
    }
    if (pendingNativeInput(active)) {
      if (!this.stopping.get(id)?.pending && !record.error) record.execution.phase = 'preparing'
      return
    }
    clearTimeout(active.runTimer)
    if (!this.stopping.get(id)?.pending) record.execution.phase = active.limitReason ? 'interrupted' : record.error ? 'error' : 'idle'
    if (active.limitReason) record.execution.reason = active.limitReason
  }

  trackTask(id, active, task, control = null) {
    active.task = task.catch((error) => { if (error.code !== 'stopping') this.record(id).error = active.checkpointError ?? active.startError ?? error.message }).finally(() => {
      if (control) control.dispatchSettled = true
      const record = this.record(id)
      if (record.error) { active.session.clearQueue(); active.queued = []; active.suspendedQueues = null }
      active.streaming = null
      record.state = record.error ? 'error' : active.queued.length ? 'running' : 'idle'
      this.finishExecution(id, active)
      if (active.pendingPromptAck && (active.startError || active.checkpointError || control?.signal.aborted)) {
        const manager = active.session.sessionManager
        for (const entry of manager.getEntries().slice(active.pendingPromptEntryCount)) {
          if (entry.type === 'message' && (entry.message === active.startingUserMessage || (entry.message.role === 'assistant' && ['aborted', 'error'].includes(entry.message.stopReason)))) manager.appendContextEdit(entry.id, null)
        }
        active.session.agent.state.messages = manager.buildSessionProjection().messages
      }
      this.changed(id, true)
      if (active.pendingPromptAck) {
        active.pendingPromptAck.reject(control?.signal.aborted ? control.signal.reason : new Error(active.checkpointError ?? active.startError ?? record.error ?? 'The run stopped before this message was saved.'))
        active.pendingPromptAck = null
        active.pendingPromptDetails = null
        active.pendingPromptControl = null
      }
    })
  }

  update(id, input) { return updateSession(this, id, input) }

  currentControl(id) { return currentNativeControl(this.live.get(id)) }

  withCommandControl(id, active, work) {
    const owned = currentNativeControl(active)
    if (owned) { assertNativeControl(active); return work(owned) }
    const record = this.record(id)
    const busy = record.state === 'running' || !active.session.isIdle
    if (!busy) { record.state = 'running'; this.beginExecution(id); this.armDeadline(id, active); this.changed(id, true) }
    return runNativeControl(active, 'command', work).task.finally(() => {
      if (!busy && this.live.get(id) === active && !this.stopping.get(id)?.pending && active.session.isIdle) {
        record.state = record.error ? 'error' : 'idle'
        this.finishExecution(id, active)
        this.changed(id, true)
      }
    })
  }

  async withControlIdle(id, work) {
    const active = this.live.get(id)
    const control = currentNativeControl(active)
    if (!control || control.kind !== 'command') throw fail(409, 'This operation requires the current plugin command.')
    assertNativeControl(active)
    const record = this.record(id)
    if (!active.session.isIdle || record.children.some((child) => ['running', 'pending', 'queued', 'paused'].includes(child.state)) || this.workspaceExecutions.has(id)) throw fail(409, 'Wait for the agent and its subagents to finish before changing sessions.')
    if (this.controlMutations.has(id)) throw fail(409, 'A plugin is already changing this conversation.')
    this.controlMutations.set(id, control)
    try { return await work(control) }
    finally {
      if (this.controlMutations.get(id) === control) this.controlMutations.delete(id)
    }
  }

  async context(id) {
    const record = this.record(id)
    if (this.permissions.stopped.has(id)) throw fail(409, 'The session was stopped.')
    this.checkHistoryAvailable(id, this.live.get(id)?.startingWithHistory === true)
    return { instructions: record.project ? await this.projectWorkspaces.context(record, () => this.changed(id, true)) : await readProjectInstructions(record.cwd) }
  }

  output(id, artifactId, offset = 0) {
    this.record(id)
    return readToolOutput(join(this.dir, id), artifactId, offset)
  }

  record(id) {
    const record = this.records.get(id)
    if (!record) throw fail(404, `No agent session ${id}`)
    return record
  }

  summary(record) {
    const { messages, children, sessionFile, tools, approvals, needsStop, execution, usage, ...summary } = record
    return { ...summary, execution: this.execution(record.id), workspace: workspaceSummary(record.workspace) }
  }

  list() { return [...this.records.values()].sort((a, b) => b.updated - a.updated).map((record) => this.summary(record)) }

  detail(id) {
    const record = this.record(id)
    const active = this.live.get(id)
    if (active?.session) {
      const messages = [...active.session.messages]
      if (active.streaming && !messages.includes(active.streaming)) messages.push(active.streaming)
      this.projectHistory(record, active.session.sessionManager, { messages, updates: active.updates, running: record.state === 'running', streaming: active.streaming })
      const children = new Map(active.children)
      for (const child of childrenFrom(record.messages)) {
        const previous = children.get(child.id)
        if (previous && ['completed', 'failed', 'stopped'].includes(previous.state) && ['queued', 'pending', 'running', 'paused'].includes(child.state)) continue
        children.set(child.id, Object.fromEntries(Object.entries({
          ...previous, ...child,
          text: child.text || previous?.text,
          task: child.task || previous?.task,
          sessionFile: child.sessionFile || previous?.sessionFile,
        }).filter(([, value]) => value !== undefined)))
      }
      record.children = [...children.values()]
      record.tools = active.session.getActiveToolNames()
    }
    const { sessionFile, needsStop, ...detail } = record
    // Query Pi's current projection, not cumulative message usage. Keep this
    // ephemeral: a restored record has no trustworthy estimate until opened.
    return {
      ...detail,
      workspace: workspaceSummary(record.workspace),
      queued: (active?.queued ?? []).map(({ id, text, mode, message }) => ({ id, text, mode, attachments: message.details?.connectAttachments ?? [] })),
      contextUsage: active?.session?.getContextUsage() ?? null,
      execution: this.execution(id),
      recovery: { required: Boolean(needsStop || (record.state !== 'running' && needsRecovery(record))), canContinue: !record.archived && record.state !== 'running' && record.execution.phase !== 'stopping' && (!active?.session || active.session.isIdle) && record.messages.length > 0 },
    }
  }

  save(id) {
    this.detail(id)
    const file = join(this.dir, id, 'chat.json')
    writeFileSync(`${file}.tmp`, JSON.stringify(this.record(id)), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }

  changed(id, persist = false) {
    const record = this.record(id)
    record.updated = Math.max(Date.now(), record.updated + 1)
    if (persist) this.save(id)
    const session = this.detail(id)
    const metadata = (attachments) => attachments?.map(({ data, ...attachment }) => attachment)
    this.emit('event', { type: 'chat', session: {
      ...session,
      messages: session.messages.map((message) => message.attachments ? { ...message, attachments: metadata(message.attachments) } : message),
      queued: session.queued.map((message) => message.attachments ? { ...message, attachments: metadata(message.attachments) } : message),
    } })
  }

  async create(input = {}) {
    const id = randomUUID()
    this.checkProjectAvailable(input.project)
    if (input.project) this.creatingProjects.set(id, input.project)
    try { return await this.createRecord(id, input) }
    finally { this.creatingProjects.delete(id) }
  }

  async createRecord(id, input, { publish = true } = {}) {
    const cwd = resolve(input.cwd || this.defaultCwd)
    if (!statSync(cwd).isDirectory()) throw fail(400, 'Choose a working directory.')
    if (input.project) await this.projectEnvironment(input.project)
    if (input.project && !this.projectWorkspaces) throw fail(503, 'LayerFS workspaces are not available in this host.')
    const selected = { ...this.models.snapshot().selected, ...input }
    const record = {
      id, title: input.title || 'New session', cwd, project: input.project || null,
      workspace: input.project ? this.projectWorkspaces.initial(id) : null,
      created: Date.now(), updated: Date.now(), state: 'idle', error: null,
      archived: false, archivedAt: null, limits: runLimits(input.limits), execution: idleExecution(), usage: sessionUsage(),
      permissionMode: permissionMode(input.permissionMode), approvals: [],
      provider: selected.provider || null, modelId: selected.modelId || null,
      thinkingLevel: selected.thinkingLevel || 'off', messages: [], children: [], tools: ['bash', 'subagent'], sessionFile: null,
    }
    mkdirSync(join(this.dir, id), { recursive: true })
    this.records.set(id, record)
    if (publish) this.changed(id, true)
    else this.save(id)
    return this.detail(id)
  }

  async open(id, { history = false, setup, sessionStartEvent, parentSession } = {}) {
    const record = this.record(id)
    this.checkHistoryAvailable(id, history)
    this.checkProjectAvailable(record.project)
    if (this.live.has(id)) return this.live.get(id).opening
    const active = { id, session: null, streaming: null, updates: new Map(), queued: [], preparingQueued: new Map(), children: new Map((record.children ?? []).map((child) => [child.id, child])), controls: new Set(), inputGeneration: 0, task: null, recoveryRequired: !this.canSkipSessionRecovery(record) }
    this.live.set(id, active)
    active.opening = (async () => {
      const runDir = join(this.dir, id)
      if (record.project) await this.prepareWorkspace(id, { history })
      const controlCwd = record.project ? runDir : record.cwd
      const mergeChildren = (children) => {
        for (const child of children) {
          const previous = active.children.get(child.id)
          if (previous && ['completed', 'failed', 'stopped'].includes(previous.state) && ['queued', 'running'].includes(child.state)) continue
          active.children.set(child.id, { ...previous, ...Object.fromEntries(Object.entries(child).filter(([, value]) => value !== undefined)) })
        }
      }
      active.refreshChildren = () => {
        active.childrenDirty = true
        if (active.childRefresh) return active.childRefresh
        active.childRefresh = Promise.resolve().then(async () => {
          while (active.childrenDirty) {
            active.childrenDirty = false
            mergeChildren(asyncSnapshotChildren(await active.extensions.status()))
          }
          if (record.state !== 'running' && active.session?.isIdle) this.finishExecution(id, active)
          if (this.live.get(id) === active) this.changed(id, true)
        }).catch((error) => {
          if (this.live.get(id) !== active) return
          record.error = `Could not refresh subagents: ${error.message}`
          this.changed(id, true)
        }).finally(() => { active.childRefresh = null })
        return active.childRefresh
      }
      const extensions = await createConnectExtensions({
        cwd: controlCwd, agentDir: this.agentDir, runDir, workspace: !!record.project, allowNestedSubagents: true,
        instructions: record.limits.instructions,
        defaultBashTimeoutSeconds: record.limits.bashTimeoutSeconds,
        onTurnStart: (_event, ctx) => {
          try { assertNativeControl(active) } catch (error) { ctx.abort(); throw error }
          const execution = record.execution
          const max = record.limits.maxTurns
          if (max && execution.turns >= max) {
            ctx.abort()
            this.stopForLimit(id, `Reached the ${max}-turn limit.`)
            return
          }
          if (record.limits.maxRuntimeSeconds && Date.now() - execution.startedAt >= record.limits.maxRuntimeSeconds * 1000) {
            ctx.abort()
            this.stopForLimit(id, `Reached the ${record.limits.maxRuntimeSeconds}-second run limit.`)
            return
          }
          execution.turns++
          execution.phase = 'thinking'
          this.changed(id, true)
        },
        approvalFile: this.permissions.connection(id, runDir),
        onUserMessage: async (message) => {
          try {
            if (active.pendingPromptAck) active.startingUserMessage = message
            assertNativeControl(active)
            if (active.startError) throw new Error(active.startError)
            if (active.pendingPromptDetails && !Object.hasOwn(message.details ?? {}, 'connectText')) {
              message.details = { ...message.details, ...active.pendingPromptDetails }
              active.pendingPromptDetails = null
            }
            const checkpoint = record.project ? await this.projectWorkspaces.checkpoint(record, () => this.changed(id, true)) : null
            active.session.sessionManager.appendCustomEntry(CHECKPOINT_TYPE, { checkpoint })
          } catch (error) { if (error.code !== 'stopping') active.checkpointError = error.message; throw error }
        },
        onSubagentEvent: (event) => {
          mergeChildren(asyncSubagentChildren(event))
          if (active.session) this.changed(id, true)
          if (active.extensions) void active.refreshChildren()
        },
      })
      active.extensions = extensions
      const settingsManager = SettingsManager.inMemory({ retry: { enabled: record.limits.maxRetries > 0, maxRetries: record.limits.maxRetries, baseDelayMs: 500, maxAgentDelayMs: 5000 }, compaction: { enabled: true } })
      const resourceLoader = new DefaultResourceLoader({
        cwd: controlCwd, agentDir: this.agentDir, settingsManager,
        noContextFiles: true,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        extensionFactories: [...extensions.extensionFactories, (pi) => pi.on('before_agent_start', (_event, ctx) => {
          try { assertNativeControl(active) } catch (error) { ctx.abort(); throw error }
        })],
        appendSystemPrompt: [connectPrompt(record)],
      })
      await resourceLoader.reload()
      const errors = resourceLoader.getExtensions().errors
      if (errors.length) throw new Error(errors.map((error) => error.error).join('\n'))
      const sessionManager = record.sessionFile && existsSync(record.sessionFile)
        ? SessionManager.open(record.sessionFile)
        : SessionManager.create(controlCwd, runDir, parentSession ? { parentSession } : undefined)
      const model = this.models.resolve(record.provider && record.modelId ? record : undefined)
      const { session } = await createAgentSession({
        cwd: controlCwd, agentDir: this.agentDir, modelRuntime: this.models.runtime, model,
        thinkingLevel: record.thinkingLevel, settingsManager, sessionManager, resourceLoader, tools: extensions.tools, sessionStartEvent,
      })
      active.session = session
      bindNativeInput(active)
      if (setup) { await setup(session.sessionManager); session.refreshContext() }
      record.sessionFile = session.sessionFile
      record.provider = model.provider
      record.modelId = model.id
      session.subscribe((event) => this.onEvent(id, event))
      await session.bindExtensions({ mode: 'json', commandContextActions: commandContextActions(this, id, active), onError: (error) => {
        if (this.live.get(id) !== active || staleNativeControl(active)) return
        const control = currentNativeControl(active)
        if (control && ['command', 'queue'].includes(control.kind)) { control.error = error.error ?? String(error); return }
        record.error = error.error ?? String(error)
        if (active.pendingPromptAck || error.event === 'before_agent_start') active.startError = record.error
        this.changed(id, true)
      } })
      await active.refreshChildren()
      this.save(id)
      return active
    })().catch((error) => {
      active.session?.dispose()
      this.live.delete(id)
      throw error
    })
    return active.opening
  }

  onEvent(id, event) {
    const active = this.live.get(id)
    const record = this.record(id)
    if (event.type === 'agent_start') {
      if (record.state !== 'running' && record.execution.phase !== 'children') { this.beginExecution(id); this.armDeadline(id, active) }
      record.state = 'running'
      if (record.execution.phase !== 'retrying') record.execution.phase = 'thinking'
    }
    if (event.type === 'message_update') active.streaming = event.message
    if (event.type === 'message_start') active.queued = active.queued.filter((entry) => entry.message !== event.message)
    if (event.type === 'message_end') {
      active.streaming = null
      if (event.message.role === 'assistant') {
        if (event.message.stopReason === 'error' && active.session.autoRetryEnabled) {
          const queues = takeQueues(active.session.agent)
          active.suspendedQueues ??= { steer: [], followUp: [] }
          for (const kind of ['steer', 'followUp']) active.suspendedQueues[kind].push(...queues[kind])
        } else if (['error', 'aborted'].includes(event.message.stopReason)) {
          active.session.clearQueue()
          active.queued = []
          active.suspendedQueues = null
        } else if (active.suspendedQueues) {
          const queues = active.suspendedQueues
          active.suspendedQueues = null
          for (const kind of ['steer', 'followUp']) for (const message of queues[kind]) active.session.agent[kind](message)
        }
      }
      if (event.message.errorMessage) record.error = active.checkpointError ?? active.startError ?? event.message.errorMessage
      if (event.message.role === 'user' && active.pendingPromptAck && !staleNativeControl(active)) {
        const ack = active.pendingPromptAck
        // Pi appends this message immediately after notifying public listeners.
        queueMicrotask(() => { if (active.pendingPromptAck === ack && !active.checkpointError && !active.startError && !staleNativeControl(active)) { active.pendingPromptAck = null; active.pendingPromptControl = null; ack.resolve() } })
      }
    }
    if (event.type === 'tool_execution_start') {
      active.runningTools ??= new Set()
      active.runningTools.add(event.toolCallId)
      record.execution.toolCalls++
      record.execution.phase = event.toolName === 'bg_wait' ? 'children' : 'tool'
    }
    if (event.type === 'tool_execution_update') active.updates.set(event.toolCallId, event.partialResult)
    if (event.type === 'tool_execution_end') {
      active.updates.set(event.toolCallId, { ...event.result, isError: event.isError, finished: true })
      active.runningTools?.delete(event.toolCallId)
      if (!active.runningTools?.size) record.execution.phase = 'thinking'
    }
    if (event.type === 'auto_retry_start' || event.type === 'summarization_retry_scheduled') {
      record.error = null
      Object.assign(record.execution, { phase: 'retrying', retryAttempt: event.attempt, reason: event.errorMessage })
    }
    if (event.type === 'auto_retry_end') {
      if (event.success) { record.error = null; delete record.execution.reason }
      record.execution.phase = 'thinking'
    }
    if (event.type === 'compaction_start' || event.type === 'summarization_retry_attempt_start') record.execution.phase = 'compacting'
    if (event.type === 'compaction_end') {
      record.execution.phase = record.state === 'running' ? 'thinking' : 'idle'
      if (event.errorMessage) record.execution.reason = event.errorMessage
    }
    if (event.type === 'agent_settled') {
      if (record.error) { active.session.clearQueue(); active.queued = []; active.suspendedQueues = null }
      if (!active.queued.length) { record.state = record.error ? 'error' : 'idle'; this.finishExecution(id, active) }
      else if (!active.queueResume) {
        // A message can arrive after Pi's final queue check, including in a
        // subagent completion wake that was not started by manager.message().
        active.queueResume = (async () => {
          const task = active.task
          // Let Pi finish settled callbacks and start any deferred run first.
          await new Promise(setImmediate)
          await task
          if (this.live.get(id) !== active || !active.session.isIdle || record.error || this.stopping.get(id)?.pending) return
          const ready = active.queued.filter((entry) => !active.preparingQueued.has(entry.id))
          const next = ready.find((entry) => entry.mode === 'steer') ?? ready[0]
          if (!next || !editQueue(active, next.id)) return
          record.state = 'idle'
          await this.message(id, next.input ?? { text: next.text }, { nativeInput: preparedMessage(next.message) })
        })().catch((error) => {
          if (error.code === 'stopping' || this.live.get(id) !== active) return
          record.error = error.message
          record.state = 'error'
          active.queued = []
          active.session.clearQueue()
          this.changed(id, true)
        }).finally(() => { active.queueResume = null })
      }
    }
    if (event.type === 'message_update' || event.type === 'tool_execution_update') {
      active.emitTimer ??= setTimeout(() => {
        active.emitTimer = null
        this.changed(id)
      }, 40)
    } else {
      clearTimeout(active.emitTimer)
      active.emitTimer = null
      this.changed(id, event.type === 'message_end' || event.type === 'agent_settled')
    }
  }

  async pluginCommand(id, active, prepared, busy) {
    const record = this.record(id)
    if (!busy) {
      record.state = 'running'
      record.error = null
      this.beginExecution(id)
      this.armDeadline(id, active)
      this.changed(id, true)
    }
    const control = runNativeControl(active, 'command', async (lease) => {
      await active.session.prompt(prepared.text, { images: prepared.images, preflightResult: (disposition) => { lease.disposition = disposition } })
      if (lease.signal.aborted) throw lease.signal.reason
      if (lease.error) throw fail(400, lease.error)
    })
    try {
      await control.task
    } finally {
      if (!busy && this.live.get(id) === active && !this.stopping.get(id)?.pending) {
        record.state = record.error ? 'error' : 'idle'
        this.finishExecution(id, active)
        this.changed(id, true)
      }
    }
    return this.detail(active.replacedBy ?? id)
  }

  async message(id, input, { history = false, nativeInput } = {}) {
    this.checkHistoryAvailable(id, history)
    const text = input.text?.trim() ?? ''
    if (!text && !input.attachments?.length) throw fail(400, 'A message is required.')
    const record = this.record(id)
    if (record.archived) throw fail(409, 'Restore this conversation before sending a message.')
    this.checkProjectAvailable(record.project)
    const previousStop = this.stopping.get(id)
    const checkStopping = () => {
      if (!this.records.has(id) || previousStop?.pending || previousStop?.removing || this.stopping.get(id) !== previousStop) {
        throw Object.assign(fail(409, 'The session is stopping. Send the message again after it stops.'), { code: 'stopping' })
      }
    }
    checkStopping()
    if (record.state === 'running') {
      const active = await this.open(id, { history })
      checkStopping()
      if (record.state !== 'running') return this.message(id, input, { history, nativeInput })
      if (active.session.isIdle) {
        if (pendingNativeInput(active)) throw fail(409, 'Wait for the plugin operation to finish, or stop it.')
        const owned = currentNativeControl(active)
        await Promise.allSettled([...active.controls].filter((control) => control !== owned).map((control) => control.task))
        checkStopping()
        if (record.state !== 'running') return this.message(id, input, { history, nativeInput })
      }
      const prepared = normalizePrompt(input, active.session.model)
      if (!nativeInput && nativeCommand(active, prepared.text)) return this.pluginCommand(id, active, prepared, true)
      const mode = input.mode === 'steer' ? 'steer' : 'followUp'
      const control = runNativeControl(active, 'queue', async (lease) => {
        const processed = nativeInput ?? await active.session.extensionRunner.emitInput(prepared.text, prepared.images, 'interactive', mode)
        assertNativeControl(active)
        checkStopping()
        if (lease.error) throw fail(400, lease.error)
        if (processed.action === 'handled') return { session: this.detail(id) }
        const next = processed.action === 'transform' ? { text: processed.text, images: processed.images ?? prepared.images } : prepared
        // A model can settle while an input handler or dialog is awaited. Keep its
        // prepared result, so starting a fresh run does not invoke the handler twice.
        if (record.state !== 'running') return { next }
        const message = { role: 'user', content: [{ type: 'text', text: next.text }, ...next.images], timestamp: Date.now(), details: promptDetails(input, prepared) }
        active.queued.push({ id: randomUUID(), text, mode, message, input })
        enqueueMessage(active, active.queued.at(-1))
        this.changed(id)
        return { session: this.detail(id) }
      })
      const result = await control.task
      return result.next ? this.message(id, input, { history, nativeInput: { action: 'transform', ...result.next } }) : result.session
    }
    for (const key of ['provider', 'modelId', 'thinkingLevel']) if (input[key]) record[key] = input[key]
    record.error = null
    record.state = 'running'
    this.beginExecution(id)
    try {
      const active = await this.open(id, { history })
      await active.task
      checkStopping()
      if (pendingNativeInput(active)) throw fail(409, 'Wait for the plugin operation to finish, or stop it.')
      const owned = currentNativeControl(active)
      await Promise.allSettled([...active.controls].filter((control) => control !== owned).map((control) => control.task))
      checkStopping()
      record.state = 'running'
      record.error = null
      active.checkpointError = null
      active.startError = null
      active.limitReason = null
      this.permissions.resume(id)
      const model = this.models.resolve(record)
      await active.session.setModel(model)
      checkStopping()
      active.session.setThinkingLevel(record.thinkingLevel)
      record.thinkingLevel = active.session.thinkingLevel
      const prepared = normalizePrompt(input, model)
      checkStopping()
      if (!nativeInput && nativeCommand(active, prepared.text)) return await this.pluginCommand(id, active, prepared, false)
      this.armDeadline(id, active)
      if (!record.messages.length) record.title = (text || 'Attached files').split('\n')[0].slice(0, 72)
      this.changed(id, true)
      const accepted = Promise.withResolvers()
      const control = runNativeControl(active, 'input', async (lease) => {
        active.pendingPromptDetails = promptDetails(input, prepared)
        active.startingWithHistory = history
        active.pendingPromptAck = accepted
        active.pendingPromptControl = lease
        active.pendingPromptEntryCount = active.session.sessionManager.getEntryCount()
        active.startingUserMessage = null
        const prompt = nativeInput?.action === 'transform' ? nativeInput : prepared
        const task = active.session.prompt(prompt.text, { images: prompt.images, expandPromptTemplates: !nativeInput, preflightResult: (disposition) => {
          lease.disposition = disposition
          if (disposition === 'started') lease.kind = 'model'
          if (disposition === 'handled' && !lease.signal.aborted && active.pendingPromptControl === lease) {
            active.pendingPromptAck = null
            active.pendingPromptControl = null
            active.pendingPromptDetails = null
            accepted.resolve()
          }
        } })
        this.trackTask(id, active, task, lease)
        await active.task
      }, { skipInput: Boolean(nativeInput) })
      void control.task.catch((error) => accepted.reject(error))
      await accepted.promise
      if (control.disposition === 'handled') await control.task
      active.startingWithHistory = false
    } catch (error) {
      if (error.code === 'stopping') { const active = this.live.get(id); if (active) active.startingWithHistory = false; throw error }
      const active = this.live.get(id)
      if (active) {
        active.startingWithHistory = false
        active.queued = []
        active.suspendedQueues = null
        active.session?.clearQueue()
      }
      record.error = error.message
      record.state = 'error'
      record.execution.phase = 'error'
      record.execution.reason = error.message
      clearTimeout(active?.runTimer)
      this.changed(id, true)
      throw error
    }
    return this.detail(id)
  }

  async updateQueued(id, messageId, mode) {
    this.checkHistoryAvailable(id)
    const record = this.record(id)
    if (mode !== undefined && mode !== 'steer') throw fail(400, 'Queued messages can only be promoted to steer.')
    const stopping = this.stopping.get(id)
    if (stopping?.pending || stopping?.removing) throw fail(409, 'The session is stopping.')
    const active = this.live.get(id)
    if (!active?.session || active.preparingQueued.has(messageId)) throw fail(409, 'This message has already been sent, removed, or is being processed.')
    const wake = () => {
      void Promise.resolve(active.queueResume).then(() => {
        if (this.live.get(id) === active && active.session.isIdle && !this.stopping.get(id)?.pending) this.onEvent(id, { type: 'agent_settled' })
      })
    }
    const control = runNativeControl(active, 'queue', async (lease) => {
      if (!mode) {
        if (!editQueue(active, messageId)) throw fail(409, 'This message has already been sent or removed.')
        return
      }
      // Hold the actual native message before awaiting plugin input/UI. Otherwise
      // Pi can consume the old follow-up while its Steer confirmation is open.
      const index = active.queued.findIndex((entry) => entry.id === messageId)
      const entry = editQueue(active, messageId)
      if (!entry) throw fail(409, 'This message has already been sent or removed.')
      active.queued.splice(index, 0, entry)
      active.preparingQueued.set(entry.id, entry)
      try {
        const prepared = preparedMessage(entry.message)
        const processed = await active.session.extensionRunner.emitInput(prepared.text, prepared.images, 'interactive', 'steer')
        assertNativeControl(active)
        if (this.stopping.get(id) !== stopping || stopping?.pending || stopping?.removing) throw Object.assign(fail(409, 'The session is stopping.'), { code: 'stopping' })
        if (lease.error) throw fail(400, lease.error)
        if (!active.queued.includes(entry)) throw fail(409, 'This message has already been sent or removed.')
        if (processed.action === 'handled') active.queued = active.queued.filter((item) => item !== entry)
        else {
          if (processed.action === 'transform') entry.message.content = [{ type: 'text', text: processed.text }, ...(processed.images ?? prepared.images)]
          entry.mode = mode
          enqueueMessage(active, entry)
        }
      } catch (error) {
        if (!lease.signal.aborted && !record.error && active.queued.includes(entry)) enqueueMessage(active, entry)
        throw error
      } finally { active.preparingQueued.delete(entry.id) }
    })
    try { await control.task }
    finally { wake(); this.changed(id) }
    return this.detail(id)
  }

  async workspaceDirectory(id) {
    this.checkHistoryAvailable(id)
    const record = this.record(id)
    if (!record.project || !this.projectWorkspaces) throw fail(409, 'This conversation has no LayerFS workspace.')
    if (this.permissions.stopped.has(id)) throw fail(409, 'The session was stopped.')
    await this.prepareWorkspace(id)
    if (this.permissions.stopped.has(id)) throw fail(409, 'The session was stopped.')
    return record.workspace.path
  }

  async executeWorkspace(id, input, { signal, onData }) {
    this.checkHistoryAvailable(id)
    const record = this.record(id)
    this.checkProjectAvailable(record.project)
    if (!record.project || !this.projectWorkspaces) throw fail(409, 'This conversation has no LayerFS workspace.')
    if (this.permissions.stopped.has(id)) throw fail(409, 'The session was stopped.')
    const controller = new AbortController()
    const executions = this.workspaceExecutions.get(id) ?? new Set()
    this.workspaceExecutions.set(id, executions)
    const execution = { controller, task: null }
    executions.add(execution)
    execution.task = this.projectWorkspaces.exec(record, input, {
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      onData,
      onChange: () => this.changed(id, true),
    })
    try { return await execution.task }
    finally {
      executions.delete(execution)
      if (!executions.size) this.workspaceExecutions.delete(id)
    }
  }

  async stopWorkspaceExecutions(id) {
    const executions = [...(this.workspaceExecutions.get(id) ?? [])]
    for (const execution of executions) execution.controller.abort()
    await Promise.allSettled(executions.map((execution) => execution.task))
  }

  checkProjectAvailable(name) {
    if (name && this.deletingProjects.has(name)) throw Object.assign(fail(409, 'This project is being deleted.'), { code: 'Busy' })
  }

  async prepareWorkspace(id, { history = false } = {}) {
    this.checkHistoryAvailable(id, history)
    const record = this.record(id)
    this.checkProjectAvailable(record.project)
    if (this.workspacePreparations.has(id)) return this.workspacePreparations.get(id)
    const task = this.projectWorkspaces.prepare(record, () => this.changed(id, true))
    this.workspacePreparations.set(id, task)
    try { return await task }
    finally { if (this.workspacePreparations.get(id) === task) this.workspacePreparations.delete(id) }
  }

  async removeProject(name, remove) {
    this.checkProjectAvailable(name)
    const sessions = [...this.records.values()].filter((record) => record.project === name)
    if ([...this.creatingProjects.values()].includes(name) || sessions.some((record) => record.state === 'running' || needsRecovery(record) || this.workspaceExecutions.has(record.id) || this.workspacePreparations.has(record.id) || this.historyOperations.has(record.id))) {
      throw Object.assign(fail(409, 'Stop this project’s agent tasks before deleting it.'), { code: 'Busy' })
    }
    this.deletingProjects.add(name)
    try {
      for (const record of sessions) await this.stop(record.id)
      return await remove()
    } finally { this.deletingProjects.delete(name) }
  }

  canSkipSessionRecovery(record) {
    // An interrupted turn can have launched children before their cards were
    // saved. Only a conversation that never opened Pi can skip its recovery.
    return record.sessionFile === null && record.children.length === 0 && !existsSync(join(this.dir, record.id, 'pending-subagent-stops.json'))
  }

  projectHistory(record, manager, options) {
    record.messages = sessionTranscript(manager, options)
    record.usage = sessionUsage(manager)
    for (const message of record.messages) {
      if (message.role !== 'user') continue
      if (message.details?.connectText !== undefined) message.text = message.details.connectText
      if (message.details?.connectAttachments) message.attachments = message.details.connectAttachments
      if (message.details) message.details = Object.fromEntries(Object.entries(message.details).filter(([key]) => !['connectText', 'connectAttachments'].includes(key)))
      const entry = message.entryId && manager.getEntry(message.entryId)
      message.canRestore = Boolean(entry && (!record.project || checkpointFor(manager, entry)))
    }
  }

  checkHistoryAvailable(id, owned = false, stopping = false) {
    if (!owned && this.historyOperations.has(id)) throw fail(409, 'This conversation’s history is being updated.')
    const mutation = this.controlMutations.get(id)
    if (!stopping && mutation && currentNativeControl(mutation.active) !== mutation) throw fail(409, 'A plugin is changing this conversation.')
  }

  historyOperation(id, work, { requireHistory = true } = {}) {
    this.checkHistoryAvailable(id)
    const record = this.record(id)
    this.checkProjectAvailable(record.project)
    const stopping = this.stopping.get(id)
    const owned = this.currentControl(id)
    const commandMutation = owned?.kind === 'command' && !owned.signal.aborted && this.controlMutations.get(id) === owned
    if ((record.state === 'running' && !commandMutation) || needsRecovery(record) || stopping?.pending || stopping?.removing || this.workspaceExecutions.has(id) || this.workspacePreparations.has(id) || (this.live.get(id)?.session && !this.live.get(id).session.isIdle)) {
      throw fail(409, 'Stop this conversation and its subagents before changing its history.')
    }
    if (requireHistory && (!record.sessionFile || !existsSync(record.sessionFile))) throw fail(400, 'This conversation has no saved messages yet.')
    const task = Promise.resolve().then(() => work(record))
    this.historyOperations.set(id, task)
    return task.finally(() => { if (this.historyOperations.get(id) === task) this.historyOperations.delete(id) })
  }

  historyTarget(record, manager, entryId) {
    const entry = manager.getBranch().find((item) => item.id === entryId)
    if (entry?.type !== 'message' || entry.message.role !== 'user') throw fail(400, 'Choose a user message on the current conversation path.')
    const checkpoint = checkpointFor(manager, entry)
    if (record.project && !checkpoint) throw fail(409, 'This message has no saved LayerFS checkpoint. Continue the conversation to create new restore points.')
    const draft = entry.message.details?.connectText ?? (typeof entry.message.content === 'string' ? entry.message.content : entry.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'))
    return { entry, checkpoint, draft, attachments: entry.message.details?.connectAttachments ?? [] }
  }

  async closeHistorySession(id, { reason = 'quit', targetSessionFile } = {}) {
    const active = this.live.get(id)
    if (!active) return
    await active.childRefresh
    await active.session.extensionRunner.emit({ type: 'session_shutdown', reason, ...(targetSessionFile ? { targetSessionFile } : {}) })
    clearTimeout(active.emitTimer)
    active.session.dispose()
    this.live.delete(id)
  }

  async restoreHistory(record, entryId) {
    let manager = this.live.get(record.id)?.session?.sessionManager ?? SessionManager.open(record.sessionFile)
    const target = this.historyTarget(record, manager, entryId)
    const previousLeafId = manager.getLeafId()
    await this.stop(record.id, { history: true })
    await this.closeHistorySession(record.id)
    const runDir = join(this.dir, record.id)
    manager = cloneSession(record.sessionFile, record.project ? runDir : record.cwd, runDir)
    if (record.project) await this.projectWorkspaces.restore(record, target.checkpoint, () => this.changed(record.id, true))
    if (target.entry.parentId === null) manager.resetLeaf()
    else manager.branch(target.entry.parentId)
    // branch/resetLeaf alone are in-memory. A state-only child makes the chosen cursor survive restart.
    manager.appendCustomEntry('connect.rollback', { entryId, previousLeafId, checkpoint: target.checkpoint })
    record.sessionFile = manager.getSessionFile()
    record.children = []
    record.approvals = []
    record.error = null
    record.state = 'idle'
    this.projectHistory(record, manager)
    this.changed(record.id, true)
    return { session: this.detail(record.id), draft: target.draft, attachments: target.attachments }
  }

  rollback(id, { entryId } = {}) {
    return this.historyOperation(id, (record) => this.restoreHistory(record, entryId))
  }

  edit(id, input = {}) {
    if (!input.text?.trim() && !input.attachments?.length) throw fail(400, 'A message is required.')
    const model = this.models.resolve({ ...this.record(id), ...input })
    normalizePrompt(input, model)
    return this.historyOperation(id, async (record) => {
      await this.restoreHistory(record, input.entryId)
      return this.message(id, input, { history: true })
    })
  }

  fork(id, { entryId, position = 'before' } = {}) {
    return this.historyOperation(id, async (record) => {
      const source = this.live.get(id)?.session?.sessionManager ?? SessionManager.open(record.sessionFile)
      const target = entryId ? await commandForkTarget(this, record, source, entryId, position) : null
      await this.stop(id, { history: true })
      await this.closeHistorySession(id, { reason: 'fork' })
      const checkpoint = record.project ? target?.checkpoint ?? await this.projectWorkspaces.checkpoint(record, () => this.changed(id, true)) : null
      const copyId = randomUUID()
      this.historyOperations.set(copyId, this.historyOperations.get(id))
      try {
        await this.createRecord(copyId, {
          title: `Copy of ${record.title}`.slice(0, 72), cwd: record.cwd, project: record.project,
          provider: record.provider, modelId: record.modelId, thinkingLevel: record.thinkingLevel, permissionMode: record.permissionMode,
          limits: record.limits,
        }, { publish: false })
        const copy = this.record(copyId)
        copy.forkedFrom = { sessionId: id, ...(entryId ? { entryId } : {}) }
        if (copy.project) await this.projectWorkspaces.fork(copy, checkpoint, () => this.save(copyId))
        const runDir = join(this.dir, copyId)
        const manager = cloneSession(record.sessionFile, copy.project ? runDir : copy.cwd, runDir)
        if (target) {
          if (position === 'at') manager.branch(target.entry.id)
          else if (target.entry.parentId === null) manager.resetLeaf()
          else manager.branch(target.entry.parentId)
        }
        manager.appendCustomEntry('connect.fork', { sessionId: id, entryId: entryId ?? null, checkpoint })
        copy.sessionFile = manager.getSessionFile()
        this.projectHistory(copy, manager)
        this.changed(copyId, true)
        return { session: this.detail(copyId), ...(target ? { draft: target.draft, attachments: target.attachments } : {}) }
      } catch (error) {
        const copy = this.records.get(copyId)
        if (copy) {
          try {
            if (copy.project) await this.projectWorkspaces.release(copy, () => this.save(copyId))
            this.permissions.forget(copyId)
            this.records.delete(copyId)
            rmSync(join(this.dir, copyId), { recursive: true })
          } catch (cleanupError) {
            copy.needsStop = true
            copy.state = 'error'
            copy.error = `Copy failed: ${error.message}. Workspace cleanup incomplete: ${cleanupError.message}`
            this.changed(copyId, true)
          }
        }
        throw error
      } finally { this.historyOperations.delete(copyId) }
    })
  }

  stop(id, { history = false, reason } = {}) {
    this.checkHistoryAvailable(id, history, true)
    const record = this.record(id)
    const previousStop = this.stopping.get(id)
    if (previousStop?.pending || previousStop?.removing) {
      const active = this.live.get(id) ?? this.controlMutations.get(id)?.active
      const owned = currentNativeControl(active)
      // A session command can own the cleanup already in flight. An external
      // Stop still cancels that command, while its own reentrant cleanup does not.
      if (previousStop.pending && [...(active?.controls ?? [])].some((control) => control.kind === 'command' && control !== owned && !control.signal.aborted)) cancelNativeControls(active, owned)
      return previousStop.task
    }
    const stopping = { pending: true }
    this.stopping.set(id, stopping)
    const wasRunning = record.state === 'running'
    record.execution.phase = 'stopping'
    if (reason) record.execution.reason = reason
    this.permissions.cancelSession(id)
    stopping.task = Promise.resolve().then(async () => {
      let active = this.live.get(id) ?? this.controlMutations.get(id)?.active
      if (active || needsRecovery(record)) record.needsStop = true
      if (!active && needsRecovery(record) && !this.canSkipSessionRecovery(record)) active = await this.open(id, { history })
      if (active) {
        clearTimeout(active.runTimer)
        try { await active.opening }
        catch (error) {
          if (active.recoveryRequired || this.live.get(id) === active) throw error
          active = null
        }
      }
      if (active) {
        const controls = cancelNativeControls(active)
        active.session.clearQueue()
        active.queued = []
        active.suspendedQueues = null
        const [, stopped] = await Promise.all([active.session.abort(), active.extensions.stopChildren(), this.stopWorkspaceExecutions(id)])
        await active.session.abort()
        await Promise.allSettled(controls)
        await active.task
        await active.childRefresh
        await active.refreshChildren?.()
        active.session.clearQueue()
        active.queued = []
        active.suspendedQueues = null
        record.error = stopped.pending.length || stopped.errors.length
          ? `Subagent stop incomplete: ${[...stopped.pending, ...stopped.errors.map((e) => e.message)].join('; ')}`
          : null
      } else {
        await this.stopWorkspaceExecutions(id)
        record.error = null
      }
      await this.workspacePreparations.get(id)?.catch(() => {})
      if (record.error) throw fail(409, record.error)
      if (record.project && this.projectWorkspaces) await this.projectWorkspaces.release(record, () => this.changed(id, true))
      delete record.needsStop
      record.state = 'idle'
      record.execution.phase = reason || wasRunning ? 'interrupted' : 'idle'
      if (reason) record.execution.reason = reason
      this.changed(id, true)
      return this.detail(id)
    }).catch((error) => {
      record.error = error.message
      record.state = 'error'
      record.execution.phase = 'error'
      this.changed(id, true)
      throw error
    }).finally(() => { stopping.pending = false })
    return stopping.task
  }

  updateLimits(id, input) {
    const limits = runLimits(input, this.record(id).limits)
    return this.historyOperation(id, async (record) => {
      await this.stop(id, { history: true })
      await this.closeHistorySession(id)
      record.limits = limits
      this.changed(id, true)
      return this.detail(id)
    }, { requireHistory: false })
  }

  async continue(id, input = {}) {
    this.checkHistoryAvailable(id)
    const record = this.record(id)
    if (record.archived) throw fail(409, 'Restore this conversation before continuing.')
    this.checkProjectAvailable(record.project)
    if (!record.messages.length) throw fail(400, 'Send a message before continuing this conversation.')
    if (record.state === 'running' || this.stopping.get(id)?.pending || (this.live.get(id)?.session && !this.live.get(id).session.isIdle)) throw fail(409, 'Wait for this conversation to finish before continuing.')
    const model = this.models.resolve({ ...record, ...input })
    for (const key of ['provider', 'modelId', 'thinkingLevel']) if (input[key]) record[key] = input[key]
    record.state = 'running'
    try {
      if (record.needsStop || (!this.live.has(id) && needsRecovery(record))) await this.stop(id)
      const previousStop = this.stopping.get(id)
      const checkStopping = () => {
        if (this.stopping.get(id) !== previousStop || previousStop?.pending || previousStop?.removing) throw Object.assign(fail(409, 'The session is stopping.'), { code: 'stopping' })
      }
      record.state = 'running'
      record.error = null
      this.beginExecution(id)
      const active = await this.open(id)
      await active.task
      checkStopping()
      this.permissions.resume(id)
      await active.session.setModel(model)
      checkStopping()
      active.session.setThinkingLevel(record.thinkingLevel)
      active.checkpointError = null
      active.startError = null
      active.limitReason = null
      this.armDeadline(id, active)
      this.changed(id, true)
      this.trackTask(id, active, active.session.sendCustomMessage({
        customType: 'connect.continue',
        content: 'Continue the task from the current saved state. Use the existing conversation and tool results. Do not repeat commands that already completed unless a new check is needed. If the previous response failed, recover from that failure and finish the task.',
        display: false,
      }, { triggerTurn: true }))
    } catch (error) {
      if (error.code === 'stopping') throw error
      record.error = error.message
      record.state = 'error'
      record.execution.phase = 'error'
      this.changed(id, true)
      throw error
    }
    return this.detail(id)
  }

  async stopChild(id, childId) {
    this.checkHistoryAvailable(id)
    const record = this.record(id)
    if (this.stopping.get(id)?.pending) throw fail(409, 'The session is stopping.')
    const active = await this.open(id)
    const result = await active.extensions.stopChild(childId)
    await active.refreshChildren()
    if (result.pending.length || result.errors.length) throw fail(409, `Subagent stop incomplete: ${[...result.pending, ...result.errors.map((item) => item.message)].join('; ')}`)
    this.changed(id, true)
    return this.detail(id)
  }

  async compact(id) {
    this.checkHistoryAvailable(id)
    if (this.record(id).archived) throw fail(409, 'Restore this conversation before compacting it.')
    const active = await this.open(id)
    if (this.record(id).state === 'running') throw fail(409, 'Stop the current turn before compacting.')
    await active.session.compact()
    this.changed(id, true)
    return this.detail(id)
  }

  async remove(id) {
    this.checkHistoryAvailable(id)
    if (this.stopping.get(id)?.removing) throw fail(409, 'The session is being deleted.')
    const stopped = this.stop(id)
    const stopping = this.stopping.get(id)
    // Keep the stop barrier active through asynchronous extension shutdown.
    stopping.removing = true
    try {
      await stopped
      if (this.record(id).error) throw fail(409, this.record(id).error)
      const active = this.live.get(id)
      if (active) {
        await active.childRefresh
        await active.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
        active.session.dispose()
      }
      this.live.delete(id)
      this.stopping.delete(id)
      this.permissions.forget(id)
      this.records.delete(id)
      rmSync(join(this.dir, id), { recursive: true })
      return { id }
    } finally {
      stopping.removing = false
    }
  }

  async close() {
    await Promise.allSettled([...this.historyOperations.values()])
    const ids = new Set([...this.live.keys(), ...[...this.records.values()].filter((r) => needsRecovery(r) || r.workspace?.sandbox).map((r) => r.id)])
    try {
      const results = await Promise.allSettled([...ids].map(async (id) => {
        await this.stop(id)
        if (this.record(id).error) throw new Error(this.record(id).error)
        const active = this.live.get(id)
        if (!active) return
        await active.childRefresh
        await active.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
        active.session.dispose()
      }))
      const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
      if (failures.length) throw new AggregateError(failures, failures.map((error) => error.message).join('; '))
      this.live.clear()
      this.stopping.clear()
    } finally {
      await this.permissions.close()
    }
  }
}
