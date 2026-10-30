// Settings → Extensions, Tools, Hooks and Commands: what Connect loads into a
// chat's Pi session, which of it is on, and why some of it cannot be turned off.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AGENT_TOOLS, CHILD_TOOLS, CONNECT_TOOLS, DEFAULT_SETUP, INSTRUCTIONS_HOOK, LEAD_TOOLS, TOOL_NEEDS, agentToolState, instructionsOn, leadsAllowed, toolState } from './extensions.js'

const fail = (status, message) => Object.assign(new Error(message), { status })

/** The Pi extensions Connect loads, in load order. */
const EXTENSIONS = [
  {
    id: 'layerfs-connect',
    title: 'LayerFS Connect',
    description: 'The gated bash tool, project instructions and LayerFS checkpoints. Chats cannot run without it.',
    package: 'layerfs-connect',
    builtin: true,
    locked: 'Required: it provides bash and the permission gate',
  },
  {
    id: 'pi-subagents',
    title: 'pi-subagents',
    description: 'Child agents (connect-worker and connect-lead), background runs and supervision.',
    package: 'pi-subagents',
    builtin: false,
    locked: null,
  },
]

/** Short, plain notes on each tool; Pi's own descriptions are written for the model. */
const TOOLS = {
  bash: { extension: 'layerfs-connect', description: 'Runs a shell command in the workspace. All file reading, searching and editing goes through it, under the chat’s permission policy.', parameters: ['command', 'timeout'] },
  subagent: { extension: 'pi-subagents', description: 'Starts child agents for focused pieces of the task.', parameters: ['agent', 'task', 'workflow', 'args', 'async', 'model', 'cwd', 'worktree', 'output', 'action', 'id', 'message', 'options'] },
  bg_wait: { extension: 'pi-subagents', description: 'Waits for background child runs to finish.', parameters: ['id', 'nonBlocking', 'all', 'timeoutMs', 'stopOnAttention'] },
  subagent_supervisor: { extension: 'pi-subagents', description: 'Reads, answers and steers running child agents.', parameters: ['action', 'to', 'message', 'replyTo'] },
  contact_supervisor: { extension: 'pi-subagents', description: 'Lets a child agent message the agent that started it.', parameters: ['reason', 'message', 'interview'] },
}

/** What a Pi event is. */
const EVENTS = {
  session_start: 'A chat’s agent starts or resumes',
  session_shutdown: 'A chat’s agent closes',
  session_tree: 'The conversation’s history is navigated',
  session_before_switch: 'Just before the chat switches to another history',
  session_before_fork: 'Just before the chat is forked',
  session_before_compact: 'Just before older turns are summarized',
  session_compact: 'Older turns were summarized',
  before_agent_start: 'Before each run, while the system prompt is built',
  agent_start: 'A run starts',
  agent_end: 'A run ends',
  agent_settled: 'A run and its follow-ups have finished',
  turn_start: 'Each model turn starts',
  turn_end: 'Each model turn ends',
  message_start: 'A message enters the conversation',
  input: 'Your message arrives, before the agent sees it',
  tool_result: 'A tool call returns',
  model_select: 'The chat’s model changes',
  context_with_system: 'The model’s context is put together',
  before_provider_request: 'Just before a request goes to the model provider',
}

/** What Connect does on each event it handles; all of it is required. */
const CONNECT_HOOKS = {
  before_agent_start: 'Adds project instructions (AGENTS.md, CLAUDE.md) to the system prompt; workspace notes stay when it is off',
  session_start: 'Wires subagent events and limits what child agents may use',
  session_shutdown: 'Releases that wiring',
  turn_start: 'Counts the chat’s turns and stops runs that no longer own the chat',
  message_start: 'Saves a LayerFS checkpoint before each of your messages',
}

/** Why each of Connect's other hooks has no switch. */
const CONNECT_REQUIRED = {
  session_start: 'Required: it limits what child agents may use',
  session_shutdown: 'Required: it releases that limit',
  turn_start: 'Required: it stops runs that no longer own the chat',
  message_start: 'Required: rollback restores these checkpoints',
}
const AGENT_IDS = ['main', 'worker', 'lead']

/** The events pi-subagents handles, for when no chat has it loaded (a test checks this against a live chat). */
export const SUBAGENT_EVENTS = [
  'session_start', 'session_tree', 'before_agent_start', 'turn_end', 'input', 'model_select', 'tool_result', 'agent_end',
  'session_before_switch', 'session_before_fork', 'session_compact', 'session_shutdown', 'context_with_system',
  'agent_start', 'message_start', 'agent_settled', 'session_before_compact',
]

function packageVersion(name) {
  try {
    let dir = name === 'layerfs-connect'
      ? fileURLToPath(new URL('../..', import.meta.url))
      : dirname(fileURLToPath(import.meta.resolve(name)))
    for (let i = 0; i < 4; i += 1, dir = dirname(dir)) {
      const file = join(dir, 'package.json')
      if (!existsSync(file)) continue
      const pkg = JSON.parse(readFileSync(file, 'utf8'))
      if (pkg.name === name) return pkg.version
    }
  } catch {}
  return null
}
const VERSIONS = Object.fromEntries(EXTENSIONS.map((extension) => [extension.package, packageVersion(extension.package)]))

/** Reads and writes agent-setup.json: the extensions and tools turned off. */
export class AgentSetup {
  constructor(file) {
    this.file = file
    this.value = DEFAULT_SETUP
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      this.value = {
        disabledExtensions: (saved.disabledExtensions ?? []).filter((id) => EXTENSIONS.some((e) => e.id === id && !e.locked)),
        disabledTools: (saved.disabledTools ?? []).filter((name) => name in TOOLS && name !== 'bash'),
        disabledAgents: (saved.disabledAgents ?? []).filter((id) => id === 'lead'),
        disabledHooks: (saved.disabledHooks ?? []).filter((id) => id === INSTRUCTIONS_HOOK),
        agentTools: Object.fromEntries(AGENT_IDS.map((agent) => [agent, (saved.agentTools?.[agent] ?? []).filter((name) => AGENT_TOOLS[agent].includes(name) && name !== 'bash')])),
        agentHooks: Object.fromEntries(AGENT_IDS.map((agent) => [agent, (saved.agentHooks?.[agent] ?? []).filter((id) => id === INSTRUCTIONS_HOOK)])),
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(`[agents] ignoring ${file}: ${error.message}`)
    }
  }

  get() { return this.value }

  /**
   * Turns one extension, agent, tool or hook on or off: a tool or hook for
   * all agents, or with `agent` for that one. Refuses the locked ones.
   */
  change({ kind, id, enabled, agent }) {
    if (agent !== undefined && !AGENT_IDS.includes(agent)) throw fail(404, `No agent ${agent}`)
    if (typeof enabled !== 'boolean') throw fail(400, 'enabled must be true or false.')
    const setup = this.value
    let next
    if (kind === 'extension') {
      const extension = EXTENSIONS.find((e) => e.id === id)
      if (!extension) throw fail(404, `No extension ${id}`)
      if (extension.locked) throw fail(409, `${extension.title} cannot be turned off. ${extension.locked}.`)
      next = { ...setup, disabledExtensions: toggle(setup.disabledExtensions, id, enabled) }
    } else if (kind === 'agent') {
      const agent = AGENTS.find((item) => item.id === id)
      if (!agent) throw fail(404, `No agent ${id}`)
      const lock = agentLock(id, setup)
      if (lock) throw fail(409, `${agent.title} cannot be changed: ${lock}.`)
      next = { ...setup, disabledAgents: toggle(setup.disabledAgents ?? [], id, enabled) }
    } else if (kind === 'tool') {
      if (!(id in TOOLS)) throw fail(404, `No tool ${id}`)
      if (agent && !AGENT_TOOLS[agent].includes(id)) throw fail(404, `${id} is not one of this agent’s tools`)
      const lock = agent ? agentToolLock(id, agent, setup) : toolLock(id, setup)
      if (lock) throw fail(409, `${id} cannot be changed: ${lock}.`)
      next = agent
        ? { ...setup, agentTools: { ...setup.agentTools, [agent]: toggle(setup.agentTools?.[agent] ?? [], id, enabled) } }
        : { ...setup, disabledTools: toggle(setup.disabledTools, id, enabled) }
    } else if (kind === 'hook') {
      const lock = hookLock(id, setup, agent)
      if (lock) throw fail(409, `${id} cannot be changed: ${lock}.`)
      next = agent
        ? { ...setup, agentHooks: { ...setup.agentHooks, [agent]: toggle(setup.agentHooks?.[agent] ?? [], id, enabled) } }
        : { ...setup, disabledHooks: toggle(setup.disabledHooks ?? [], id, enabled) }
    } else {
      throw fail(400, 'kind must be extension, agent, tool or hook.')
    }
    writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
    this.value = next
    return next
  }
}

/** The agents a chat can run: its own, and the two subagents Connect defines (extensions.js). */
const AGENTS = [
  {
    id: 'main', title: 'Main agent', name: null,
    description: 'The chat’s own agent. It works in the chat’s workspace and can hand pieces of the task to subagents.',
    startedBy: 'You, one per chat', model: 'The chat’s model',
    instructions: 'Connect’s system prompt: the workspace, file work through bash, LayerFS commit rules, and project instructions',
  },
  {
    id: 'worker', title: 'Worker', name: 'connect-worker',
    description: 'A focused subagent for one bounded piece of the task. It cannot start other agents.',
    startedBy: 'The main agent or a lead', model: 'Its parent’s',
    instructions: 'Stay within the assigned files, verify the work, report changed paths and checks',
  },
  {
    id: 'lead', title: 'Lead', name: 'connect-lead',
    description: 'A subagent that coordinates workers for a larger workstream and combines their results.',
    startedBy: 'The main agent', model: 'Its parent’s',
    instructions: 'Give parallel workers separate files, integrate their results, verify, report to its parent',
  },
]

/**
 * The hooks that run in each agent. A child agent is its own Pi process:
 * Connect's bash extension loads in every one, and pi-subagents loads its
 * child runtime there, not the extension the main agent has (its main
 * extension returns early in a child). The child hooks below are those in
 * pi-subagents 0.84.0's child runtime source; it wires more internally.
 */
const CHILD_HOOKS = {
  worker: [
    { event: 'before_agent_start', extension: 'layerfs-connect', purpose: 'Adds project instructions and workspace notes to the system prompt' },
    { event: 'before_agent_start', extension: 'pi-subagents', purpose: 'Marks where the parent’s task ends and the child’s work begins' },
  ],
  lead: [
    { event: 'session_start', extension: 'pi-subagents', purpose: 'Opens the channel that starts and supervises nested workers' },
    { event: 'session_shutdown', extension: 'pi-subagents', purpose: 'Closes that channel' },
  ],
}

/** Why an agent's switch cannot be used now, or null. Only leads can be turned off. */
function agentLock(id, setup) {
  if (id === 'main') return 'Required: it is the chat itself'
  if (setup.disabledExtensions.includes('pi-subagents')) return 'Turns on with pi-subagents'
  if (!toolState('subagent', setup).on) return 'Turns on with subagent'
  if (id === 'worker') return 'Always available while subagent is on'
  return null
}

/** Why one agent's switch for a tool cannot be used now, or null. */
function agentToolLock(name, agent, setup) {
  const global = toolLock(name, setup)
  if (global) return global
  if (!toolState(name, setup).on) return 'Off for all agents in Tools'
  const state = agentToolState(name, agent, setup)
  if (state.why === 'agent-needs') return `Turns on with ${TOOL_NEEDS[name]} for this agent`
  return null
}

/**
 * Why a hook's switch cannot be used now, or null. Only Connect's project
 * instructions hook has one; with `agent`, it is also off while it is off
 * for all agents. pi-subagents' hooks switch with it.
 */
function hookLock(id, setup, agent) {
  const [extension, event] = id.split(':')
  if (extension === 'pi-subagents') return agent && agent !== 'main' ? 'Inside pi-subagents’ child runtime' : 'Switches with pi-subagents'
  if (extension !== 'layerfs-connect' || !(event in CONNECT_HOOKS)) return 'No such hook'
  if (id !== INSTRUCTIONS_HOOK) return CONNECT_REQUIRED[event] ?? 'Required by LayerFS Connect'
  if (agent && agent !== 'main' && !CHILD_HOOKS.worker.some((hook) => hook.extension === extension && hook.event === event)) return 'This agent does not run it'
  if (agent && (setup.disabledHooks ?? []).includes(id)) return 'Off for all agents in Hooks'
  return null
}

const toggle = (list, id, enabled) => enabled ? list.filter((item) => item !== id) : [...new Set([...list, id])]

/** Why a tool's switch cannot be used now, or null. */
function toolLock(name, setup) {
  if (name === 'bash') return 'Required: it is the agents’ only tool for files and commands'
  const state = toolState(name, setup)
  if (state.why === 'extension') return `Turns on with ${TOOLS[name].extension}`
  if (state.why === 'needs') return `Turns on with ${TOOL_NEEDS[name]}`
  return null
}

/**
 * Every extension, tool, hook and command, grouped by the extension that
 * brings it, with whether it is on and why it cannot be switched. `session`,
 * a live Pi session, adds what Pi reports (hooks, parameters, commands).
 */
export function capabilityCatalog(setup = DEFAULT_SETUP, { session, busy = [] } = {}) {
  const loaded = new Map((session?.extensionRunner?.extensions ?? [])
    .filter((extension) => !extension.hidden)
    .map((extension) => [/^<inline:(.+)>$/.exec(extension.path)?.[1] ?? extension.path, extension]))
  const extensionOn = (id) => !setup.disabledExtensions.includes(id)
  const liveParameters = (name) => {
    const definition = session?.getToolDefinition?.(name) ?? [...loaded.values()].map((extension) => extension.tools.get(name)?.definition).find(Boolean)
    return definition ? Object.keys(definition.parameters?.properties ?? {}) : null
  }

  const tools = Object.entries(TOOLS).map(([name, note]) => ({
    name,
    extension: note.extension,
    description: note.description,
    parameters: liveParameters(name) ?? note.parameters,
    agents: [CONNECT_TOOLS.includes(name) && 'main', CHILD_TOOLS.includes(name) && 'worker', LEAD_TOOLS.includes(name) && 'lead'].filter(Boolean),
    enabled: toolState(name, setup).on,
    locked: toolLock(name, setup),
    // agents that have it turned off for themselves (Settings → Agents)
    offFor: AGENT_IDS.filter((agent) => toolState(name, setup).on && (setup.agentTools?.[agent] ?? []).includes(name)),
  }))

  const hooks = EXTENSIONS.flatMap((extension) => {
    const live = loaded.get(extension.id)
    const events = live ? [...live.handlers.keys()] : extension.id === 'pi-subagents' ? SUBAGENT_EVENTS : Object.keys(CONNECT_HOOKS)
    return events.map((event) => {
      const id = `${extension.id}:${event}`
      return {
        id,
        event,
        extension: extension.id,
        description: EVENTS[event] ?? '',
        purpose: extension.id === 'layerfs-connect' ? CONNECT_HOOKS[event] ?? null : null,
        handlers: live ? live.handlers.get(event)?.length ?? 0 : null,
        enabled: extensionOn(extension.id) && !(setup.disabledHooks ?? []).includes(id),
        // pi-subagents' hooks switch with it: part of one can leave it half-working
        locked: hookLock(id, setup),
        offFor: AGENT_IDS.filter((agent) => id === INSTRUCTIONS_HOOK && !(setup.disabledHooks ?? []).includes(id) && (setup.agentHooks?.[agent] ?? []).includes(id)),
      }
    })
  })

  const commands = [...loaded.entries()].flatMap(([id, extension]) => [...extension.commands.values()].map((command) => ({
    name: command.name, description: command.description ?? '', extension: id,
  })))

  const agents = AGENTS.map((agent) => {
    const names = agent.id === 'main' ? CONNECT_TOOLS : agent.id === 'worker' ? CHILD_TOOLS : LEAD_TOOLS
    const usable = agent.id === 'main' || (toolState('subagent', setup).on && (agent.id === 'worker' || leadsAllowed(setup)))
    const own = (hook) => {
      const id = `${hook.extension}:${hook.event}`
      const enabled = id === INSTRUCTIONS_HOOK ? instructionsOn(agent.id, setup) : true
      return { id, event: hook.event, extension: hook.extension, purpose: hook.purpose ?? null, enabled, locked: hookLock(id, setup, agent.id) }
    }
    const agentHooks = (agent.id === 'main'
      ? hooks.filter((hook) => extensionOn(hook.extension))
      : [...CHILD_HOOKS.worker, ...(agent.id === 'lead' ? CHILD_HOOKS.lead : [])].filter((hook) => extensionOn(hook.extension))
    ).map(own)
    return {
      ...agent,
      enabled: usable,
      locked: agentLock(agent.id, setup),
      tools: names.map((name) => ({ name, enabled: agentToolState(name, agent.id, setup).on, locked: agentToolLock(name, agent.id, setup) })),
      extensions: [...new Set(agentHooks.map((hook) => hook.extension).concat(names.filter((name) => agentToolState(name, agent.id, setup).on).map((name) => TOOLS[name].extension)))],
      hooks: agentHooks,
      hooksNote: agent.id === 'main' ? null : 'pi-subagents’ child runtime also enforces tool budgets and permissions inside the child; Connect cannot list those hooks',
    }
  })

  return {
    live: !!session,
    agents,
    // chats whose run blocks changes now
    busy,
    extensions: EXTENSIONS.map((extension) => ({
      id: extension.id,
      title: extension.title,
      description: extension.description,
      package: extension.package,
      version: VERSIONS[extension.package],
      builtin: extension.builtin,
      enabled: extensionOn(extension.id),
      locked: extension.locked,
      tools: tools.filter((tool) => tool.extension === extension.id).map((tool) => tool.name),
      hooks: hooks.filter((hook) => hook.extension === extension.id).map((hook) => hook.event),
      commands: commands.filter((command) => command.extension === extension.id).map((command) => command.name),
      // pi-subagents' own slash commands stay off in Connect (its config.json)
      commandsNote: extension.id === 'pi-subagents' ? 'Its slash commands are turned off in Connect' : null,
    })),
    tools,
    hooks,
    commands,
  }
}
