import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createConnectBashExtension } from './child-extension.js'

export const CONNECT_TOOLS = ['bash', 'subagent', 'bg_wait', 'subagent_supervisor']
const CHILD_TOOLS = ['bash', 'contact_supervisor']
const STOPPABLE = new Set(['queued', 'pending', 'running', 'paused'])
const CHILD_MODULE = new URL('./child-extension.js', import.meta.url).href
const resources = new Map()

/** A display snapshot must be complete before it can authorize whole-chat cleanup. */
export function subagentStopTargets(status, knownIds = []) {
  const snapshot = status?.asyncSnapshot
  if (!snapshot) throw new Error('Subagent status did not include a background run inventory; the chat has been retained.')
  if (snapshot.omitted?.runs > 0 || snapshot.omitted?.byteLimitExceeded) {
    throw new Error('The background subagent inventory was truncated. Stop individual runs before deleting this chat; its state has been retained.')
  }
  return [...new Set([
    ...knownIds,
    // Logical completion does not establish that the runner has exited.
    ...snapshot.runs.map((run) => run.id),
  ])]
}

const worker = `---
name: connect-worker
description: Complete a focused task using bash in the current workspace.
tools: bash
model: inherit
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
extensions: []
async: false
---
You are a focused worker in LayerFS Connect. Complete your assigned task, verify your work, and report the outcome, changed file paths, and validation results. Do not start other agents.
- Use \`bash\` for all file reads, searches (\`rg\`, \`find\`, \`sed\`), edits (\`python3\`, \`node\`, \`patch\`, heredocs), and checks. Batch related reads or edits into cohesive commands and use workspace-relative paths.
- You share the conversation's working tree (and serialized LayerFS Workspace in project mode) with the parent agent. Stay strictly within the files and scope assigned by your supervisor; do not create or switch LayerFS branches.
- Root-level project instructions are already loaded in your system prompt; before editing files in a subdirectory, check with \`bash\` for nested \`AGENTS.override.md\`, \`AGENTS.md\`, or \`CLAUDE.md\` files in that subdirectory.
- Connect gates every \`bash\` command under the conversation's permission policy. Respect any rejection and never retry a rejected action through another command or permission file.
`

const lead = `---
name: connect-lead
description: Coordinate a task that explicitly needs further delegation.
tools: bash, subagent, bg_wait, subagent_supervisor, contact_supervisor
model: inherit
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
extensions: []
async: false
allowNestedSubagents: true
allowedAgents: connect-worker, connect-lead
---
You are a team lead in LayerFS Connect. Coordinate your assigned workstream, integrate worker results, verify behavior, and report the final outcome and changed files to your supervisor.
- Use \`bash\` for native file inspection, edits, and verification. Batch related reads or edits into cohesive commands and use workspace-relative paths.
- Delegate bounded tasks to \`connect-worker\` and use \`connect-lead\` only when another coordination layer is genuinely needed. Because all agents share the conversation's working tree (and serialized LayerFS Workspace in project mode), assign disjoint file scopes to parallel workers and never ask workers to create or mount separate LayerFS branches.
- Root-level project instructions are already loaded in your system prompt; before editing files in a subdirectory, check with \`bash\` for nested \`AGENTS.override.md\`, \`AGENTS.md\`, or \`CLAUDE.md\` files in that subdirectory.
- Connect gates every \`bash\` command under the conversation's permission policy. Respect any rejection and never retry a rejected action through another command, child agent, or permission file.
`

/**
 * Prepare Pi resources inside Connect's private state directory. The host must
 * use the same agentDir for every session and its model/auth runtime.
 * env contains shell overrides only; never pass a copy of process.env here.
 */
export async function createConnectExtensions({ cwd, agentDir, runDir, env = {}, approvalFile, workspace = false, instructions = '', defaultBashTimeoutSeconds = 120, allowNestedSubagents = false, onSubagentEvent = () => {}, onUserMessage = async () => {}, onTurnStart = async () => {} }) {
  process.env.PI_CODING_AGENT_DIR = agentDir
  process.env.PI_SUBAGENTS_TEMP_ROOT = join(agentDir, 'subagents')
  const traceDir = join(runDir, 'traces')
  const configDir = join(agentDir, 'extensions', 'subagent')
  await mkdir(traceDir, { recursive: true })
  if (!resources.has(agentDir)) resources.set(agentDir, (async () => {
    await Promise.all([mkdir(configDir, { recursive: true }), mkdir(join(agentDir, 'agents'), { recursive: true })])
    await Promise.all([
      writeFile(join(agentDir, 'agents', 'connect-worker.md'), worker),
      writeFile(join(agentDir, 'agents', 'connect-lead.md'), lead),
      writeFile(join(configDir, 'config.json'), JSON.stringify({
        toolActivation: 'eager',
        asyncByDefault: false,
        fleetView: false,
        asyncWidget: false,
        enableSlashCommands: false,
        artifactDir: 'session',
      }, null, 2) + '\n'),
    ])
  })())
  await resources.get(agentDir)

  // The generated module is also importable by pi-subagents' detached runner.
  // Required child extensions are inherited through every nested launch.
  const childExtensionPath = join(runDir, 'connect-child.mjs')
  await writeFile(childExtensionPath,
    `import { createConnectBashExtension } from ${JSON.stringify(CHILD_MODULE)};\n` +
    `export default createConnectBashExtension(${JSON.stringify({ cwd, env, traceDir, runDir, approvalFile, workspace, instructions, defaultBashTimeoutSeconds })});\n`,
    { mode: 0o600 })

  // Import after setting PI_CODING_AGENT_DIR: the package resolves its own paths.
  const [{ default: subagents }, { registerSubagentCapabilityCeiling }, { registerRequiredChildExtensions }] = await Promise.all([
    import('pi-subagents'),
    import('pi-subagents/capability-ceiling'),
    import('pi-subagents/required-child-extensions'),
  ])
  let events
  let started = false
  const jobs = new Map()
  const pendingStopFile = join(runDir, 'pending-subagent-stops.json')
  let unconfirmed = []
  try { unconfirmed = JSON.parse(await readFile(pendingStopFile, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }

  function rpc(method, params = {}, { timeoutMs = 15_000 } = {}) {
    if (!started) return Promise.reject(new Error('The Pi session has not started.'))
    return new Promise((resolve, reject) => {
      const requestId = randomUUID()
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Subagent ${method} timed out.`))
      }, timeoutMs)
      const unsubscribe = events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => {
        clearTimeout(timer)
        unsubscribe()
        if (reply.success) resolve(reply.data)
        else reject(new Error(reply.error?.message ?? `Subagent ${method} failed.`))
      })
      events.emit('subagents:rpc:v1:request', { version: 1, requestId, method, params })
    })
  }

  const extension = (pi) => {
    events = pi.events
    subagents(pi)
    createConnectBashExtension({ cwd, env, traceDir, runDir, agent: 'root', approvalFile, workspace, instructions, defaultBashTimeoutSeconds })(pi)
    pi.on('turn_start', onTurnStart)
    // before_agent_start is per run; message_start also covers queued follow-ups and steering messages.
    pi.on('message_start', async (event, ctx) => {
      if (event.message.role !== 'user') return
      try { await onUserMessage(event.message) }
      catch (error) { ctx.abort(); throw error }
    })
    let ceiling
    let required
    const unsubscribe = []
    pi.on('session_start', (_event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId()
      const identities = new Set([sessionId, ctx.sessionManager.getSessionFile()])
      unsubscribe.splice(0).forEach((dispose) => dispose())
      ceiling?.dispose()
      required?.dispose()
      ceiling = registerSubagentCapabilityCeiling({
        sessionId,
        source: 'layerfs-connect',
        ceiling: {
          allowedTools: allowNestedSubagents ? [...new Set([...CHILD_TOOLS, ...CONNECT_TOOLS])] : CHILD_TOOLS,
          allowedAgents: allowNestedSubagents ? ['connect-worker', 'connect-lead'] : ['connect-worker'],
        },
      })
      required = registerRequiredChildExtensions({
        sessionId,
        extensions: [{ id: 'layerfs-connect-bash', path: childExtensionPath }],
        requireForAllRunners: true,
      })
      for (const channel of ['subagent:async-started', 'subagent:async-complete', 'subagent:child-status', 'subagent:process-terminal']) {
        unsubscribe.push(events.on(channel, (data) => {
          if (data?.sessionId && !identities.has(data.sessionId)) return
          const id = data?.id ?? data?.runId
          if (id && channel === 'subagent:async-started') jobs.set(id, data)
          if (id && channel === 'subagent:async-complete') jobs.delete(id)
          onSubagentEvent({ ...data, type: channel })
        }))
      }
      started = true
    })
    pi.on('session_shutdown', () => {
      started = false
      ceiling?.dispose()
      required?.dispose()
      unsubscribe.splice(0).forEach((dispose) => dispose())
    })
  }

  async function status() {
    // A targeted fleet read refreshes persisted jobs even for an SDK without UI.
    return rpc('status', { view: 'fleet' })
  }

  async function stopRuns(ids, snapshot, deadline) {
    const remaining = () => ({ timeoutMs: Math.max(1, deadline - Date.now()) })
    // The package only restores active jobs after a host restart. Keep exact
    // unresolved run IDs until their public terminal proof is observed.
    unconfirmed = [...new Set([...unconfirmed, ...ids])]
    await writeFile(pendingStopFile, JSON.stringify(unconfirmed) + '\n', { mode: 0o600 })
    const errors = []
    await Promise.all([...ids].map(async (id) => {
      const state = snapshot.asyncSnapshot.runs.find((run) => run.id === id)?.state
      if (state && !STOPPABLE.has(state)) return
      try { await rpc('stop', { id }, remaining()) }
      catch (error) { errors.push({ id, message: error.message }) }
    }))
    let pending = [...ids]
    while (pending.length && Date.now() < deadline) {
      const observations = await Promise.all(pending.map(async (id) => {
        try {
          const current = await rpc('status', { id }, remaining())
          const processStopped = current.details?.lifecycleStatus?.processTerminal?.state === 'observed'
          const workflowStopped = current.details?.workflowTerminalProof?.state === 'observed' && current.details.workflowTerminalProof.dispatchClosed
          return processStopped || workflowStopped ? null : id
        } catch (error) {
          if (!errors.some((item) => item.id === id)) errors.push({ id, message: error.message })
          return id
        }
      }))
      pending = observations.filter(Boolean)
      if (pending.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())))
    }
    unconfirmed = [...new Set([...unconfirmed.filter((id) => !ids.has(id)), ...pending])]
    await writeFile(pendingStopFile, JSON.stringify(unconfirmed) + '\n', { mode: 0o600 })
    return { requested: [...ids], pending, errors: errors.filter((error) => pending.includes(error.id)) }
  }

  let stopping = Promise.resolve()
  function serialStop(work) {
    const task = stopping.then(work)
    stopping = task.catch(() => {})
    return task
  }

  /** Call alongside parent abort so foreground and background children drain. */
  function stopChildren({ timeoutMs = 10_000 } = {}) {
    return serialStop(async () => {
      if (!started) return { requested: [], pending: [], errors: [] }
      const deadline = Date.now() + timeoutMs
      const snapshot = await rpc('status', { view: 'fleet' }, { timeoutMs })
      let ids
      try { ids = new Set(subagentStopTargets(snapshot, [...jobs.keys(), ...unconfirmed])) }
      catch (error) { return { requested: [], pending: [], errors: [{ id: 'inventory', message: error.message }] } }
      return stopRuns(ids, snapshot, deadline)
    })
  }

  /** The SDK stops a run, including all children belonging to a parallel run. */
  function stopChild(childId, { timeoutMs = 10_000 } = {}) {
    return serialStop(async () => {
      if (!started) throw new Error('The Pi session has not started.')
      const deadline = Date.now() + timeoutMs
      const snapshot = await rpc('status', { view: 'fleet' }, { timeoutMs })
      const runs = snapshot.asyncSnapshot?.runs ?? []
      const run = runs.find((item) => item.id === childId)?.id ?? asyncSnapshotChildren(snapshot).find((child) => child.id === childId)?.runId
      const id = run ?? ([...jobs.keys(), ...unconfirmed].includes(childId) ? childId : null)
      if (!id) throw new Error('This child run is not available in the conversation’s current subagent inventory.')
      return stopRuns(new Set([id]), snapshot, deadline)
    })
  }

  return {
    tools: [...CONNECT_TOOLS],
    extensionFactories: [{ name: 'layerfs-connect', factory: extension }],
    childExtensionPath,
    traceDir,
    status,
    rpc,
    stopChildren,
    stopChild,
  }
}

/** Normalize the package's streamed tool details for Connect child cards. */
export function subagentChildren(result, { final = false, fallbackId = 'subagent' } = {}) {
  const details = result?.details ?? result ?? {}
  const runId = details.runId ?? details.asyncId ?? fallbackId
  return (details.results ?? []).map((child, index) => ({
    id: `${child.runId ?? runId}:${child.index ?? index}`,
    runId: child.runId ?? runId,
    agent: child.agent,
    task: child.task === '[prompt redacted]' ? result?.args?.task : child.task,
    state: child.stopped || child.interrupted ? 'stopped' : final ? (child.exitCode === 0 ? 'completed' : 'failed') : (child.progress?.status ?? 'running'),
    text: child.finalOutput ?? child.progress?.recentOutput?.join('\n') ?? '',
    currentTool: child.progress?.currentTool ?? null,
    sessionFile: child.sessionFile ?? null,
    model: child.model ?? null,
    error: child.error ?? null,
  }))
}

const childState = (state) => ({ complete: 'completed', started: 'running', pending: 'queued', cancelled: 'stopped' })[state] ?? state

/** Public background lifecycle events contain summaries without transcript reads. */
export function asyncSubagentChildren(event) {
  const runId = event.runId ?? event.id
  if (!runId) return []
  if (event.type === 'subagent:async-started') {
    return (event.agents ?? [event.agent ?? 'worker']).map((agent, index) => ({ id: `${runId}:${index}`, runId, agent, state: 'running' }))
  }
  if (event.type === 'subagent:child-status') {
    return [{ id: `${runId}:${event.stepIndex ?? 0}`, runId, agent: event.agent, state: childState(event.status) }]
  }
  if (event.type !== 'subagent:async-complete') return []
  return (event.results?.length ? event.results : [event]).map((child, index) => ({
    id: `${runId}:${child.index ?? index}`,
    runId,
    agent: child.agent ?? event.agent ?? 'worker',
    state: childState(child.status ?? child.state ?? (child.success === false || event.success === false ? 'failed' : 'completed')),
    text: child.finalOutput ?? child.summary ?? child.output ?? '',
    sessionFile: child.sessionPath ?? child.sessionFile ?? null,
    error: child.error ?? null,
  }))
}

/** Status snapshots cover running async jobs even when Pi has no terminal UI. */
export function asyncSnapshotChildren(status) {
  return (status.asyncSnapshot?.runs ?? []).flatMap((run) => {
    const children = run.children?.length ? run.children : [run]
    return children.filter((child) => child.kind !== 'host-step').map((child, index) => ({
      id: `${run.id}:${child.id?.startsWith('step:') ? child.id.slice(5) : index}`,
      runId: run.id,
      agent: child.agent ?? child.label ?? run.label,
      state: childState(child.state),
      currentTool: child.activity?.currentTool ?? null,
      model: child.model ?? null,
    }))
  })
}
