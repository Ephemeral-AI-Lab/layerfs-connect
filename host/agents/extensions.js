import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createConnectBashExtension, LEAD_MARK, WORKER_MARK } from './child-extension.js'

export const CONNECT_TOOLS = ['bash', 'subagent', 'bg_wait', 'subagent_supervisor']
export const CHILD_TOOLS = ['bash', 'contact_supervisor']
export const LEAD_TOOLS = ['bash', 'subagent', 'bg_wait', 'subagent_supervisor', 'contact_supervisor']
/** Tools pi-subagents registers; they go with it when it is off. */
export const SUBAGENT_TOOLS = ['subagent', 'bg_wait', 'subagent_supervisor', 'contact_supervisor']
/** A tool that only works with another one on: off when that one is. */
export const TOOL_NEEDS = { bg_wait: 'subagent', subagent_supervisor: 'subagent' }
/** The tools each kind of agent can have; Settings switches them off globally or per agent. */
export const AGENT_TOOLS = { main: CONNECT_TOOLS, worker: CHILD_TOOLS, lead: LEAD_TOOLS }
/** Connect's hook that adds project instructions; the one hook with a switch (Settings → Hooks and Agents). */
export const INSTRUCTIONS_HOOK = 'layerfs-connect:before_agent_start'
/**
 * Which Pi extensions, agents, tools and hooks are on, kept in agent-setup.json:
 * off everywhere (disabledTools, disabledHooks) or for one agent (agentTools, agentHooks).
 */
export const DEFAULT_SETUP = Object.freeze({
  disabledExtensions: [], disabledTools: [], disabledAgents: [], disabledHooks: [],
  agentTools: { main: [], worker: [], lead: [] },
  agentHooks: { main: [], worker: [], lead: [] },
})

/** Whether chats may start connect-lead (Settings → Agents → Lead). */
export const leadsAllowed = (setup = DEFAULT_SETUP) => !(setup.disabledAgents ?? []).includes('lead')

/** Whether a tool is on for all agents, and why not: its extension or the tool it needs is off, or it is turned off. */
export function toolState(name, setup) {
  if (SUBAGENT_TOOLS.includes(name) && setup.disabledExtensions.includes('pi-subagents')) return { on: false, why: 'extension' }
  const need = TOOL_NEEDS[name]
  if (need && toolState(need, setup).on === false) return { on: false, why: 'needs' }
  return { on: !setup.disabledTools.includes(name), why: setup.disabledTools.includes(name) ? 'off' : null }
}

/** Whether one agent has a tool: it is on for all agents, on for this one, and the tool it needs is too. */
export function agentToolState(name, agent, setup) {
  if (!AGENT_TOOLS[agent].includes(name)) return { on: false, why: 'role' }
  const global = toolState(name, setup)
  if (!global.on) return global
  if ((setup.agentTools?.[agent] ?? []).includes(name)) return { on: false, why: 'agent' }
  const need = TOOL_NEEDS[name]
  if (need && AGENT_TOOLS[agent].includes(need) && !agentToolState(need, agent, setup).on) return { on: false, why: 'agent-needs' }
  return { on: true, why: null }
}

/** The tools each kind of agent gets under a setup (`child` is a worker's). */
export function setupTools(setup = DEFAULT_SETUP) {
  const on = (agent) => AGENT_TOOLS[agent].filter((name) => agentToolState(name, agent, setup).on)
  return { main: on('main'), child: on('worker'), worker: on('worker'), lead: on('lead') }
}

/** Whether an agent gets project instructions: the hook is on for all agents and for this one. */
export const instructionsOn = (agent, setup = DEFAULT_SETUP) =>
  !(setup.disabledHooks ?? []).includes(INSTRUCTIONS_HOOK) && !(setup.agentHooks?.[agent] ?? []).includes(INSTRUCTIONS_HOOK)

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

/** A Pi agent definition's tool lines: what it lists, and what it removes (contact_supervisor comes from pi-subagents' child runtime). */
function toolLines(agent, setup) {
  const on = AGENT_TOOLS[agent].filter((name) => agentToolState(name, agent, setup).on)
  const listed = on.filter((name) => name !== 'contact_supervisor')
  const excluded = AGENT_TOOLS[agent].filter((name) => !on.includes(name))
  return `tools: ${listed.join(', ')}${excluded.length ? `\nexcludeTools: ${excluded.join(', ')}` : ''}`
}
const instructionsLine = (on) => on
  ? "- Root-level project instructions are already loaded in your system prompt; before editing files in a subdirectory, check with `bash` for nested `AGENTS.override.md`, `AGENTS.md`, or `CLAUDE.md` files in that subdirectory.\n"
  : ''

function workerDefinition(setup) {
  return `---
name: connect-worker
description: Complete a focused task using bash in the current workspace.
${toolLines('worker', setup)}
model: inherit
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
extensions: []
async: false
---
${WORKER_MARK} Complete your assigned task, verify your work, and report the outcome, changed file paths, and validation results. Do not start other agents.
- Use \`bash\` for all file reads, searches (\`rg\`, \`find\`, \`sed\`), edits (\`python3\`, \`node\`, \`patch\`, heredocs), and checks. Batch related reads or edits into cohesive commands and use workspace-relative paths.
- You share the conversation's working tree (and serialized LayerFS Workspace in project mode) with the parent agent. Stay strictly within the files and scope assigned by your supervisor; do not create or switch LayerFS branches.
${instructionsLine(instructionsOn('worker', setup))}- Connect gates every \`bash\` command under the conversation's permission policy. Respect any rejection and never retry a rejected action through another command or permission file.
`
}

function leadDefinition(setup) {
  return `---
name: connect-lead
description: Coordinate a task that explicitly needs further delegation.
${toolLines('lead', setup)}
model: inherit
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
extensions: []
async: false
allowNestedSubagents: true
allowedAgents: connect-worker, connect-lead
---
${LEAD_MARK} Coordinate your assigned workstream, integrate worker results, verify behavior, and report the final outcome and changed files to your supervisor.
- Use \`bash\` for native file inspection, edits, and verification. Batch related reads or edits into cohesive commands and use workspace-relative paths.
- Delegate bounded tasks to \`connect-worker\` and use \`connect-lead\` only when another coordination layer is genuinely needed. Because all agents share the conversation's working tree (and serialized LayerFS Workspace in project mode), assign disjoint file scopes to parallel workers and never ask workers to create or mount separate LayerFS branches.
${instructionsLine(instructionsOn('lead', setup))}- Connect gates every \`bash\` command under the conversation's permission policy. Respect any rejection and never retry a rejected action through another command, child agent, or permission file.
`
}

/**
 * Prepare Pi resources inside Connect's private state directory. The host must
 * use the same agentDir for every session and its model/auth runtime.
 * env contains shell overrides only; never pass a copy of process.env here.
 * sdk.prompt (by agent kind) is what Settings → SDKs adds to each agent's system prompt (sdks.js).
 */
export async function createConnectExtensions({ cwd, agentDir, runDir, env = {}, approvalFile, workspace = false, instructions = '', defaultBashTimeoutSeconds = 120, allowNestedSubagents = false, setup = DEFAULT_SETUP, sdk = {}, onSubagentEvent = () => {}, onUserMessage = async () => {}, onTurnStart = async () => {} }) {
  process.env.PI_CODING_AGENT_DIR = agentDir
  process.env.PI_SUBAGENTS_TEMP_ROOT = join(agentDir, 'subagents')
  const projectInstructions = { main: instructionsOn('main', setup), worker: instructionsOn('worker', setup), lead: instructionsOn('lead', setup) }
  const traceDir = join(runDir, 'traces')
  const configDir = join(agentDir, 'extensions', 'subagent')
  await mkdir(traceDir, { recursive: true })
  // agent definitions follow the setup; every chat shares them, and the setup only changes while none works
  const definitions = { 'connect-worker.md': workerDefinition(setup), 'connect-lead.md': leadDefinition(setup) }
  const key = JSON.stringify(definitions)
  if (resources.get(agentDir)?.key !== key) resources.set(agentDir, { key, ready: (async () => {
    await Promise.all([mkdir(configDir, { recursive: true }), mkdir(join(agentDir, 'agents'), { recursive: true })])
    await Promise.all([
      ...Object.entries(definitions).map(([file, text]) => writeFile(join(agentDir, 'agents', file), text)),
      writeFile(join(configDir, 'config.json'), JSON.stringify({
        toolActivation: 'eager',
        asyncByDefault: false,
        fleetView: false,
        asyncWidget: false,
        enableSlashCommands: false,
        artifactDir: 'session',
      }, null, 2) + '\n'),
    ])
  })() })
  await resources.get(agentDir).ready

  // The generated module is also importable by pi-subagents' detached runner.
  // Required child extensions are inherited through every nested launch.
  // Children may run in this process, where Node keeps the first import of a module:
  // the module reads its settings each time a child starts, so they follow the chat's.
  const childExtensionPath = join(runDir, 'connect-child.mjs')
  await writeFile(join(runDir, 'connect-child.json'), JSON.stringify({ cwd, env, traceDir, runDir, approvalFile, workspace, instructions, defaultBashTimeoutSeconds, projectInstructions, sdk }), { mode: 0o600 })
  await writeFile(childExtensionPath,
    `import { readFileSync } from 'node:fs';\n` +
    `import { createConnectBashExtension } from ${JSON.stringify(CHILD_MODULE)};\n` +
    `export default (pi) => createConnectBashExtension(JSON.parse(readFileSync(new URL('./connect-child.json', import.meta.url), 'utf8')))(pi);\n`,
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

  const subagentsOn = !setup.disabledExtensions.includes('pi-subagents')
  const tools = setupTools(setup)
  const extension = (pi) => {
    // pi-subagents is an extension of its own; both share Pi's event bus
    events = pi.events
    createConnectBashExtension({ cwd, env, traceDir, runDir, agent: 'root', approvalFile, workspace, instructions, defaultBashTimeoutSeconds, projectInstructions, sdk })(pi)
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
      started = true
      if (!subagentsOn) return
      ceiling = registerSubagentCapabilityCeiling({
        sessionId,
        source: 'layerfs-connect',
        ceiling: {
          allowedTools: allowNestedSubagents ? [...new Set([...tools.child, ...tools.lead])] : tools.child,
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
    })
    pi.on('session_shutdown', () => {
      started = false
      ceiling?.dispose()
      required?.dispose()
      unsubscribe.splice(0).forEach((dispose) => dispose())
    })
  }

  async function status() {
    // without pi-subagents a chat has no background runs to list
    if (!subagentsOn) return { asyncSnapshot: { runs: [] } }
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
      if (!started || !subagentsOn) return { requested: [], pending: [], errors: [] }
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
      if (!subagentsOn) throw new Error('pi-subagents is turned off in Settings → Extensions.')
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
    tools: tools.main,
    extensionFactories: [
      ...(subagentsOn ? [{ name: 'pi-subagents', factory: (pi) => subagents(pi) }] : []),
      { name: 'layerfs-connect', factory: extension },
    ],
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
    // live numbers while it runs; its session file has the final ones (children.js)
    tokens: child.progressSummary?.tokens ?? child.progress?.tokens,
    durationMs: child.progressSummary?.durationMs ?? child.progress?.durationMs,
    toolCount: child.progressSummary?.toolCount ?? child.progress?.toolCount,
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
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    }))
  })
}
