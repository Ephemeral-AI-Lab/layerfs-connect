// The scenario format's checks (v3), for the tools: a port of dsh-layerfs's
// packages/mock/src/scenario.js validation and compile, with dsh's SDK
// settings renamed (an SDK step imports @layerfs/agent, not
// $DSH_LAYERFS_SDK). The engine has its own loader (host/runs/); this one
// lets the tools and tests check a scenario folder without the engine. The
// format itself is described in scenarios/README.md.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { readSeed } from '../../host/seed.js'

const TYPE = 'layerfs-scenario'
export const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const REF = /^@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/
const IMAGE = /^sha256:[0-9a-f]{64}$/
/** The load-time placeholders, and what a folder path used for {{scenario}} may not hold. */
const FOLDER = '{{scenario}}'
const IMAGE_AT = '{{image}}'
const UNQUOTABLE = /["$`\\]/
/** The placeholders filled while a run plays, and a Commit ref's spelling. */
export const PLACEHOLDER = /\{\{(sandbox|ws|commit:([^{}\s]+))\}\}/g
const COMMIT_REF = /^[^\s{}"'`$\\]+$/
/** An expect entry: [<method>:]<outcome>[|<outcome>…]. */
const METHOD = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/
const OUTCOME = /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?$/
/** The older SDK's trace names, and today's. */
const RETIRED = [
  [/^sandbox\.(mount|exec|commit|unmount)$/, (m) => `workspace.${m[1]}`],
  [/^operator\.process\.(.+)$/, (m) => `backend.daemon.process.${m[1]}`],
]
/** The tags a scenario may have. */
export const FORMS = ['cli', 'sdk']
export const WORKLOADS = ['node', 'rust']
export const TOPICS = ['conflicts', 'merge', 'publish', 'multi-agent', 'background', 'sandbox']
/** An SDK step: one inline Node script fed on stdin, after comment lines. */
export const SDK_SCRIPT = /^(?:#[^\n]*\n)*node --input-type=module <<'([A-Z_]+)'\n[\s\S]*\n\1\n?$/
/** What only an SDK script uses (dsh's was DSH_LAYERFS_(SDK|BACKEND)). */
export const SDK_USE = /@layerfs\/(agent|backend)\b|LayerFS\.open\(/

/** The tools agents have: argument names, and which arguments are agent or job ids. */
export const TOOLS = {
  bash: { args: ['description', 'command', 'timeoutMs', 'workdir', 'run_in_background'], required: ['description', 'command'] },
  subagent: { args: ['description', 'prompt', 'cwd'], required: ['description', 'prompt'] },
  send_message: { args: ['agent_id', 'message'], required: ['agent_id', 'message'], agent: 'agent_id' },
  interrupt_agent: { args: ['agent_id'], required: ['agent_id'], agent: 'agent_id' },
  list_agents: { args: ['scope'], required: [] },
  job_output: { args: ['job_id', 'wait', 'timeout_ms'], required: ['job_id'], job: 'job_id' },
  job_kill: { args: ['job_id', 'reason'], required: ['job_id'], job: 'job_id' },
  job_list: { args: [], required: [] },
  working_directory: { args: ['cd'], required: [] },
}
const STEP_FIELDS = ['say', 'phase', 'note', 'expect', 'exit', 'commits', 'as']

export class ScenarioError extends Error {
  constructor(where, message) {
    super(`${where}: ${message}`)
    this.name = 'ScenarioError'
  }
}

/** Every scenario folder under `dir` that holds a scenario.json, by folder name, in `order`. */
export function loadScenarios(dir) {
  const scenarios = new Map()
  if (!existsSync(dir)) return scenarios
  const loaded = []
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'scenario.json')
    if (existsSync(file) && statSync(file).isFile()) loaded.push(loadScenario(join(dir, name)))
  }
  for (const s of loaded.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))) scenarios.set(s.name, s)
  return scenarios
}

/** One scenario folder, checked and compiled; throws ScenarioError naming the step at fault. */
export function loadScenario(folder) {
  const name = basename(folder)
  const file = join(folder, 'scenario.json')
  if (!NAME.test(name)) throw new ScenarioError(file, 'the folder name is the scenario id: lowercase letters, digits and -')
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new ScenarioError(file, error.message)
  }
  return compileScenario(raw, { name, folder, where: file })
}

/** Checks a parsed scenario and compiles it. */
export function compileScenario(raw, { name, folder, where = name, root = 'root' }) {
  const fail = (path, message) => {
    throw new ScenarioError(`${where} ${path}`, message)
  }
  if (!isAbsolute(folder)) folder = resolve(folder)
  if (!isObject(raw)) fail('', 'must be an object')
  only(raw, ['type', 'version', 'title', 'blurb', 'prompt', 'order', 'tags', 'fixture', 'image', 'agents', 'sessions'], '', fail)
  if (raw.sessions !== undefined) return compileSessions(raw, { name, folder, where, fail })
  if (raw.type !== TYPE) fail('type', `must be "${TYPE}"`)
  if (raw.version !== 3) fail('version', 'must be 3')
  if (typeof raw.title !== 'string' || !raw.title) fail('title', 'must be a non-empty string')
  if (raw.blurb !== undefined && typeof raw.blurb !== 'string') fail('blurb', 'must be a string')
  if (raw.prompt !== undefined && (typeof raw.prompt !== 'string' || !raw.prompt.trim())) fail('prompt', 'must be a non-empty string')
  if (raw.order !== undefined && !Number.isInteger(raw.order)) fail('order', 'must be an integer')
  const { tags, form } = checkTags(raw.tags, fail)
  if (raw.image !== undefined && (typeof raw.image !== 'string' || !IMAGE.test(raw.image))) fail('image', 'is a runtime image digest, sha256:<64 hex>')
  let fixture = null
  let seed = null
  if (raw.fixture !== undefined) {
    const at = resolve(folder, String(raw.fixture))
    if (at.endsWith('.json')) {
      if (!existsSync(at) || !statSync(at).isFile()) fail('fixture', `${raw.fixture} is not a file`)
      try {
        readSeed(at)
      } catch (error) {
        fail('fixture', error.message)
      }
      seed = at
    } else {
      if (!existsSync(at) || !statSync(at).isDirectory()) fail('fixture', `${raw.fixture} is not a folder`)
      fixture = at
    }
  }
  if (!isObject(raw.agents) || !Array.isArray(raw.agents[root])) fail('agents', root === 'root' ? "must hold a root agent's steps" : `must hold the steps of ${root}, the session's own agent`)

  const prompts = new Map()
  const parents = new Map()
  const produced = new Map()
  const used = []
  const context = { folder, image: raw.image ?? null, form, fail, prompts, parents, produced, used }
  const agents = {}
  for (const [agent, steps] of Object.entries(raw.agents)) {
    if (!NAME.test(agent)) fail(`agents.${agent}`, 'an agent name is lowercase letters, digits and -')
    if (!Array.isArray(steps) || !steps.length) fail(`agents.${agent}`, 'must be a non-empty list of steps')
    agents[agent] = compileSteps(steps, `agents.${agent}`, { ...context, agent })
  }
  for (const [child, parent] of parents) {
    if (!agents[child]) fail(`agents.${parent}`, `starts ${child}, which has no steps under agents`)
    if (child === root) fail(`agents.${parent}`, `${root} is the run's own agent and cannot be started`)
  }
  for (const agent of Object.keys(agents)) {
    if (agent !== root && !parents.has(agent)) fail(`agents.${agent}`, 'no subagent step starts this agent')
  }
  for (const { ref, at } of used) if (!produced.has(ref)) fail(at, `{{commit:${ref}}} names a Commit no step's commits lists`)

  // the messages that carry a Commit id to another agent, as patterns its receiver matches
  const templates = []
  for (const steps of Object.values(agents)) {
    for (const step of steps) {
      const text = step.kind === 'reply' ? step.text : step.call.name === 'send_message' ? step.call.args.message : null
      if (text && /\{\{commit:/.test(text)) templates.push(template(text))
    }
  }
  const all = Object.values(agents).flat()
  const calls = [...new Set(all.flatMap((s) => s.expect ?? []).map(methodOf).filter(Boolean))].sort()
  const counts = { agents: Object.keys(agents).length, steps: all.filter((s) => s.kind === 'call').length, calls }
  return { name, title: raw.title, blurb: raw.blurb ?? '', prompt: raw.prompt ?? null, order: raw.order ?? null, tags, form, counts, fixture, seed, image: raw.image ?? null, root, agents, prompts, parents, templates, sessions: null }
}

/**
 * A scenario of several sessions on one project: `sessions` in place of
 * `agents`, `{ "<session>": { prompt, agents: { "<session>": [Step…], "<child>": … } } }`.
 * Each session is its own run with its own root agent, named after the
 * session; a launch resets the project once and starts every session
 * together. Each compiles as a scenario of its own (the same checks), and
 * agent names are unique over all sessions. The result also holds every
 * agent merged (`agents`, `prompts`, `parents`, `templates`), for the tools
 * that read a scenario's steps whole.
 */
function compileSessions(raw, { name, folder, where, fail }) {
  if (raw.agents !== undefined) fail('sessions', 'a scenario has agents or sessions, not both')
  if (raw.prompt !== undefined) fail('prompt', "a scenario of sessions has a prompt per session, not one")
  if (!isObject(raw.sessions) || Object.keys(raw.sessions).length < 2) fail('sessions', 'must hold two or more sessions')
  const { sessions: _, ...common } = raw
  const sessions = []
  const owner = new Map()
  for (const [session, value] of Object.entries(raw.sessions)) {
    const at = `sessions.${session}`
    if (!NAME.test(session)) fail(at, 'a session name is lowercase letters, digits and -')
    if (!isObject(value)) fail(at, 'must be an object')
    only(value, ['prompt', 'agents'], at, fail)
    if (typeof value.prompt !== 'string' || !value.prompt.trim()) fail(`${at}.prompt`, "must be a non-empty string: the user's request to the session")
    const scenario = compileScenario({ ...common, prompt: value.prompt, agents: value.agents }, { name, folder, where: `${where} ${at}`, root: session })
    for (const agent of Object.keys(scenario.agents)) {
      if (owner.has(agent)) fail(`${at}.agents.${agent}`, `is also an agent of session ${owner.get(agent)}: agent names are unique over the sessions`)
      owner.set(agent, session)
    }
    sessions.push({ name: session, prompt: value.prompt, scenario })
  }
  const first = sessions[0].scenario
  const merged = (key) => new Map(sessions.flatMap((s) => [...s.scenario[key]]))
  const agents = Object.assign({}, ...sessions.map((s) => s.scenario.agents))
  const calls = [...new Set(sessions.flatMap((s) => s.scenario.counts.calls))].sort()
  const counts = { agents: Object.keys(agents).length, steps: sessions.reduce((n, s) => n + s.scenario.counts.steps, 0), calls, sessions: sessions.length }
  return { ...first, prompt: null, root: null, counts, agents, prompts: merged('prompts'), parents: merged('parents'), templates: sessions.flatMap((s) => s.scenario.templates), sessions }
}

/** The tags: exactly one form, at most one workload, one to three topics, nothing else. */
function checkTags(tags, fail) {
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string') || new Set(tags).size !== tags.length) fail('tags', 'is a list of distinct tags')
  for (const t of tags) {
    if (![...FORMS, ...WORKLOADS, ...TOPICS].includes(t)) fail('tags', `${t} is not a tag: forms ${FORMS.join(', ')}; workloads ${WORKLOADS.join(', ')}; topics ${TOPICS.join(', ')}`)
  }
  const forms = tags.filter((t) => FORMS.includes(t))
  const workloads = tags.filter((t) => WORKLOADS.includes(t))
  const topics = tags.filter((t) => TOPICS.includes(t))
  if (forms.length !== 1) fail('tags', `names exactly one form (${FORMS.join(' or ')})`)
  if (workloads.length > 1) fail('tags', `names at most one workload (${WORKLOADS.join(' or ')})`)
  if (topics.length < 1 || topics.length > 3) fail('tags', `names one to three topics (${TOPICS.join(', ')})`)
  return { tags: [...forms, ...workloads, ...topics], form: forms[0] }
}

function compileSteps(steps, path, context) {
  const { agent, fail } = context
  const out = []
  const children = new Set()
  const jobs = new Set()
  steps.forEach((step, index) => {
    const at = `${path}[${index}]`
    if (!isObject(step)) fail(at, 'a step is an object')
    if ('reply' in step) {
      only(step, ['reply', 'until', 'phase', 'note'], at, fail)
      if (typeof step.reply !== 'string' || !step.reply) fail(at, 'reply is a non-empty string')
      // a turn may be a reply alone (a child answering its parent), but not next to a wait for children
      const before = out[out.length - 1]
      if (before?.kind === 'reply' && (before.until.length || step.until !== undefined)) {
        fail(at, 'a reply next to a reply that waits for children: a turn around a wait holds at least one call')
      }
      let until = []
      if (step.until !== undefined) {
        if (!Array.isArray(step.until) || !step.until.length) fail(`${at}.until`, 'lists the children to wait for')
        for (const child of step.until) if (!children.has(child)) fail(`${at}.until`, `${child} is not started by an earlier step of ${agent}`)
        if (index === steps.length - 1) fail(`${at}.until`, 'the last reply has nothing to wait for')
        until = [...step.until]
      }
      placeholders(step.reply, `${at}.reply`, context)
      out.push({ kind: 'reply', text: step.reply, until, at, phase: step.phase ?? null, note: step.note ?? null })
      return
    }
    const tools = Object.keys(TOOLS).filter((tool) => tool in step)
    if (tools.length !== 1) fail(at, `a step is one call to one of ${Object.keys(TOOLS).join(', ')}, or a reply`)
    const [tool] = tools
    only(step, [tool, ...STEP_FIELDS], at, fail)
    const args = step[tool]
    if (!isObject(args)) fail(`${at}.${tool}`, "the tool's arguments are an object")
    const spec = TOOLS[tool]
    only(args, spec.args, `${at}.${tool}`, fail)
    for (const key of spec.required) if (args[key] === undefined) fail(`${at}.${tool}.${key}`, 'is required')
    const call = { name: tool, args: { ...args } }

    if (tool === 'bash') {
      if (typeof args.command !== 'string' || !args.command) fail(`${at}.bash.command`, 'must be a non-empty string')
      call.args.command = loadTime(args.command, `${at}.bash.command`, context)
      checkForm(call.args.command, `${at}.bash.command`, context)
      placeholders(call.args.command, `${at}.bash.command`, context)
      const background = args.run_in_background === true
      if (step.as !== undefined) {
        if (!background) fail(`${at}.as`, 'names a background job: set run_in_background')
        if (!NAME.test(step.as) || jobs.has(step.as)) fail(`${at}.as`, 'is a new job name: lowercase letters, digits and -')
        jobs.add(step.as)
        call.job = step.as
      }
      if (step.exit !== undefined) {
        if (!Number.isInteger(step.exit) || step.exit < 0 || step.exit > 255) fail(`${at}.exit`, "is the call's exit status, 0 to 255")
        if (background) fail(`${at}.exit`, "a background call's exit is its job's, which job_output shows")
      }
      if (step.commits !== undefined) {
        if (!Array.isArray(step.commits) || !step.commits.length) fail(`${at}.commits`, 'lists the refs of the Commit ids the call prints, in order')
        if (background) fail(`${at}.commits`, "a background call prints its job's id, not Commits")
        for (const ref of step.commits) {
          if (typeof ref !== 'string' || !COMMIT_REF.test(ref)) fail(`${at}.commits`, `${JSON.stringify(ref)} is not a ref: no spaces, braces, quotes, $ or \\`)
          if (context.produced.has(ref)) fail(`${at}.commits`, `${ref} is already named by ${context.produced.get(ref)}`)
          context.produced.set(ref, at)
        }
      }
    } else {
      for (const field of ['as', 'exit', 'commits']) if (step[field] !== undefined) fail(`${at}.${field}`, 'belongs to a bash step')
    }
    if (step.expect !== undefined) {
      if (tool !== 'bash') fail(`${at}.expect`, "only a bash step's LayerFS calls are traced")
      if (!Array.isArray(step.expect) || !step.expect.length) fail(`${at}.expect`, 'lists outcome codes')
      step.expect.forEach((code, k) => checkCode(code, `${at}.expect[${k}]`, fail))
    }

    if (tool === 'subagent') {
      const child = args.description
      if (typeof child !== 'string' || !NAME.test(child)) fail(`${at}.subagent.description`, "names the child agent: one of this scenario's agents")
      if (typeof args.prompt !== 'string' || !args.prompt) fail(`${at}.subagent.prompt`, 'must be a non-empty string')
      if (args.prompt.includes('{{')) fail(`${at}.subagent.prompt`, 'holds no placeholder: a child is known by its prompt as written; send a Commit id with send_message')
      if (context.parents.has(child)) fail(`${at}.subagent`, `${child} is already started by ${context.parents.get(child)}`)
      for (const [other, prompt] of context.prompts) {
        if (prompt.includes(args.prompt) || args.prompt.includes(prompt)) {
          fail(`${at}.subagent.prompt`, `must not contain or be contained in ${other}'s prompt: a child is known by its prompt`)
        }
      }
      context.prompts.set(child, args.prompt)
      context.parents.set(child, agent)
      children.add(child)
      call.child = child
    }
    if (tool === 'send_message') placeholders(String(args.message), `${at}.send_message.message`, context)
    if (spec.agent) {
      const ref = String(args[spec.agent]).match(REF)?.[1]
      if (!ref || !children.has(ref)) fail(`${at}.${tool}.${spec.agent}`, `is "@<child>" for a child ${agent} started earlier`)
      call.refs = { [spec.agent]: { agent: ref } }
    }
    if (spec.job) {
      const ref = String(args[spec.job]).match(REF)?.[1]
      if (!ref || !jobs.has(ref)) fail(`${at}.${tool}.${spec.job}`, `is "@<job>" for a background bash step of ${agent} named with as`)
      call.refs = { [spec.job]: { job: ref } }
    }

    if (step.say !== undefined && (typeof step.say !== 'string' || !step.say)) fail(`${at}.say`, 'must be a non-empty string')
    out.push({ kind: 'call', call, say: step.say ?? null, expect: step.expect ?? null, exit: step.exit ?? 0, commits: step.commits ?? null, at, phase: step.phase ?? null, note: step.note ?? null })
  })
  if (out[out.length - 1].kind !== 'reply') out.push({ kind: 'reply', text: 'Done.', until: [], at: `${path} (end)`, phase: null, note: null })
  return out
}

/** {{scenario}} and {{image}} in a bash command, filled when the scenario loads. */
function loadTime(command, at, { folder, image, fail }) {
  let out = command
  if (out.includes(FOLDER)) {
    // Windows accepts forward separators in native Node paths; Bash and
    // JavaScript strings must not read the native backslashes as escapes
    if (process.platform === 'win32') folder = folder.replaceAll('\\', '/')
    if (UNQUOTABLE.test(folder)) fail(at, `uses ${FOLDER}, and the scenario folder ${folder} holds a character double quotes do not keep (", $, \` or \\)`)
    out = out.replaceAll(FOLDER, folder)
  }
  if (out.includes(IMAGE_AT)) {
    if (!image) fail(at, `uses ${IMAGE_AT}, and the scenario names no image`)
    out = out.replaceAll(IMAGE_AT, image)
  }
  return out
}

/** A bash command in the scenario's form: one SDK script (sdk), or plain layerfs lines that use no SDK (cli). */
function checkForm(command, at, { form, fail }) {
  if (form === 'sdk' && !SDK_SCRIPT.test(command)) fail(at, "an sdk scenario's bash step is one inline Node script: node --input-type=module <<'JS' … JS, after comment lines")
  if (form === 'cli' && SDK_USE.test(command)) fail(at, "a cli scenario's bash step uses the layerfs command, not the SDK")
}

/** Records the {{commit:<ref>}} placeholders of `text` for the scenario-wide check. */
function placeholders(text, at, { used }) {
  for (const m of text.matchAll(PLACEHOLDER)) if (m[2] !== undefined) used.push({ ref: m[2], at })
}

/** A message with {{commit:<ref>}} as a pattern its receiver finds the Commit ids by. */
function template(text) {
  const refs = []
  let source = ''
  let last = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    source += escape(text.slice(last, m.index))
    if (m[2] !== undefined) {
      refs.push(m[2])
      source += '([A-Za-z0-9_.-]+)'
    } else source += '[^\\s"]+'
    last = m.index + m[0].length
  }
  source += escape(text.slice(last))
  return { pattern: new RegExp(source), refs }
}
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The method of an expect entry, or null when it names none. */
export function methodOf(code) {
  const first = String(code).split('|')[0]
  const colon = first.indexOf(':')
  const dot = first.indexOf('.')
  // a method has a dot before its first ":"; an outcome alone (Mounted, exit:0) has none
  return dot >= 0 && (colon < 0 || dot < colon) ? first.slice(0, colon < 0 ? first.length : colon) : null
}

/** One expect entry: its shape, and no name of the older SDK. */
export function checkCode(code, at, fail) {
  if (typeof code !== 'string' || !code) fail(at, 'an outcome code is a non-empty string')
  const [first, ...more] = code.split('|')
  const colon = first.indexOf(':')
  const method = methodOf(code)
  const outcome = method === null ? first : first.slice(method.length + 1)
  if (method !== null && !METHOD.test(method)) fail(at, `${code}: ${method} is not a method name (family.call)`)
  if (method !== null && colon < 0) fail(at, `${code}: write the outcome after the method (${method}:<kind>)`)
  for (const [pattern, today] of RETIRED) {
    const m = method?.match(pattern)
    if (m) fail(at, `${code}: ${method} is the older SDK's name; the trace calls it ${today(m)} (${today(m)}:${outcome}${more.length ? `|${more.join('|')}` : ''})`)
  }
  if (method === 'sandbox.create' && outcome === 'Ready') fail(at, `${code}: the older SDK's answer; today's sandbox.create has no kind, so its code is sandbox.create:ok`)
  if (!OUTCOME.test(outcome)) fail(at, `${code}: ${outcome || 'nothing'} is not an outcome (a kind, a refusal code, ok or exit:<n>)`)
  for (const alt of more) {
    if (!alt || alt.includes(':') || !/^[A-Za-z0-9_-]+$/.test(alt)) fail(at, `${code}: an alternative after "|" is one kind, code or number, with no ":"`)
  }
}

function only(value, keys, at, fail) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(at, `unknown field ${key}`)
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
