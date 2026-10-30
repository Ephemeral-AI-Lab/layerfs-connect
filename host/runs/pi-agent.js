// A live agent: pi (@earendil-works/pi-coding-agent) drives it with a real
// language model instead of a scenario's steps. It stands in for agent.js's
// Agent inside a Run (same fields and methods the Run reads). Its bash tool
// runs exactly as a scripted bash step does: `bash -c` in the agent's folder
// with Run.env (the layerfs shim, the trace file and label), each call a
// step the Run records with its LayerFS trace calls. Root also has a
// subagent tool: each call starts a fresh child agent on the same project
// and model, and returns the child's reply.
//
// Each turn ends in a reply step. In a live session (live-run.js) root goes
// idle after it and the session waits for the user's next message; in the
// spike (pi-spike.js) root's first reply ends the run. A child is done after
// its one reply. Model keys are kept out of every bash call the model makes.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Type } from 'typebox'
import { stepView } from '../parse/index.js'
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, startBash, Tail } from './bash.js'

/** What the model gets back of a call's output, per stream (the record keeps bash.js's KEEP). */
const MODEL_KEEP = 30 * 1024
/** Environment names that carry model credentials: never handed to the model's commands. */
const SECRET = /(_API_KEY|_AUTH_TOKEN|_OAUTH_TOKEN|_ACCESS_KEY_ID|_SECRET_ACCESS_KEY|_SESSION_TOKEN)$/

export const SYSTEM_PROMPT = `You are an agent working on a LayerFS project. LayerFS keeps a project's files as Branches of Commits in a Store; main is the published line.

You have one tool, bash. Each call runs \`bash -c\` on the host in a scratch folder that is NOT the project: the project's files are only reachable through LayerFS.

Use the \`layerfs\` command (already on PATH; the project is $LAYERFS_PROJECT). Run \`layerfs help\` or \`layerfs help <family>\` when unsure. Output is JSON unless you pass --text.
- Read files: layerfs fs list <ref> [/path], layerfs fs read <ref> <path>, fs grep, fs glob.
- Change files without running anything: layerfs fs write|edit|apply|mkdir|rm|mv on a Branch (each is one Commit). Fork a Branch first: layerfs branch fork <name> [from].
- Run programs (install, build, test, serve): layerfs sandbox create prints a Sandbox number; layerfs workspace mount <sandbox> <branch> prints ws as <sandbox>:<path>; layerfs workspace exec <ws> '<command>' runs it inside; layerfs workspace commit <ws> -m '<msg>' saves changes; layerfs workspace unmount <ws>; layerfs sandbox close <sandbox>.
- Publish a Branch to main: layerfs branch publish <branch>.

Work in small steps and check results. Before you finish, commit what you mean to keep, unmount every Workspace you mounted and close every Sandbox you created. End with a short plain summary of what you did.`

const SUBAGENTS = `

You also have a subagent tool. It starts a helper agent with the same tools (bash and layerfs) on the same project. Use it for separate pieces of work that can go on side by side, for example two Branches in two Sandboxes; several subagent calls in one message run at the same time. A subagent knows nothing of this conversation: give it the whole task, which Branch to fork or use, and what to report. Each returns its final reply to you. For one small change, just do it yourself.`

const CHILD = `

You are a subagent: another agent gave you one task. Do it, then end with a short plain reply saying what you did and what it left (Branches, Commits, results). Your reply goes back to that agent.`

export class PiAgent {
  /**
   * @param {import('./run.js').Run} run
   * @param {string} name
   * @param {object} o
   * @param {string} o.prompt the first message (root's task)
   * @param {object} o.model a pi-ai Model
   * @param {object} o.modelRuntime pi's ModelRuntime (credentials, catalog)
   * @param {string} [o.thinkingLevel]
   * @param {string} [o.systemPrompt]
   * @param {(event: object) => void} [o.onEvent] every pi session event, for a caller that logs them
   */
  constructor(run, name, { prompt, model, modelRuntime, thinkingLevel = 'medium', systemPrompt = SYSTEM_PROMPT, subagents = false, onEvent = () => {}, sessionDir = null, resume = false, steps = 0 }, parent = null) {
    this.run = run
    this.name = name
    this.parent = parent
    this.options = { model, modelRuntime, thinkingLevel, systemPrompt, subagents, onEvent }
    this.sessionDir = sessionDir ?? join(run.dir, 'pi', name)
    /** Open pi's last session in sessionDir (a live session the host restarted under) instead of a new one. */
    this.resume = resume
    /** Its calls and replies as they come: { kind, call? } (Run.summary counts them; a resumed agent's earlier ones are placeholders). */
    this.steps = Array.from({ length: steps }, () => ({ kind: 'earlier' }))
    this.index = steps
    this.state = 'waiting'
    this.children = new Map()
    this.jobs = new Map()
    this.cwd = run.work
    this.turning = false
    this.since = Date.now()
    this.thinking = null
    this.inbox = prompt ? [prompt] : []
    this.session = null
    /** The model's text before its next calls: the next step's `say`. */
    this.say = null
    this.lastText = ''
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 }
    this.error = null
    /** Set by abort(): the turn ends as stopped. */
    this.aborted = false
  }

  view() {
    return {
      name: this.name,
      parent: this.parent?.name ?? null,
      state: this.state,
      done: this.index,
      of: this.steps.length,
      since: this.since,
      thinking: this.thinking,
      live: true,
      model: `${this.options.model.provider}/${this.options.model.id}`,
      usage: this.usage,
    }
  }

  setState(state) {
    if (this.state === state) return
    this.state = state
    this.since = Date.now()
    // the Run ended it (stopped, failed): the model's request and its call stop too
    if ((state === 'stopped' || state === 'failed') && this.session) this.session.abort().catch(() => {})
    this.run.agentChanged(this)
  }

  /** A live agent waits for nothing it named: Run.checkStuck asks. */
  unsettled() {
    return []
  }

  receive(from, text) {
    this.inbox.push(text)
    this.wake()
  }

  settled(child, text) {
    this.inbox.push(`${child} replied:\n${text}`)
    this.wake()
  }

  wake() {
    if ((this.state === 'idle' || this.state === 'waiting') && !this.turning && !this.run.over && this.inbox.length) void this.turn()
  }

  /** Ends the current turn as stopped: the model's request and its running calls stop. */
  abort() {
    if (!this.turning) return
    this.aborted = true
    this.session?.abort().catch(() => {})
  }

  /** Switches the model for the next turn (live sessions: the composer's model chip). */
  async useModel({ model, modelRuntime, thinkingLevel }) {
    Object.assign(this.options, { model, modelRuntime, thinkingLevel })
    if (this.session) {
      await this.session.setModel(model)
      this.session.setThinkingLevel(thinkingLevel)
    }
  }

  /**
   * One prompt to pi, run until the model stops calling tools; its last text
   * is the reply. Resolves { reply } or { failure } ('stopped' when aborted).
   */
  async turn() {
    if (this.turning) return { failure: 'already working' }
    this.turning = true
    this.error = null
    this.setState('running')
    let outcome
    try {
      this.session ??= await this.open()
      const prompt = this.inbox.splice(0).join('\n\n')
      this.lastText = ''
      await this.session.prompt(prompt)
      if (this.aborted) outcome = { failure: 'stopped' }
      else if (this.error) outcome = { failure: this.error }
      else outcome = { reply: this.lastText || this.session.getLastAssistantText() || '(no reply)' }
    } catch (error) {
      outcome = { failure: this.aborted ? 'stopped' : error.message }
    } finally {
      this.thinking = null
      this.turning = false
      this.aborted = false
    }
    this.ended(outcome)
    return outcome
  }

  /** A turn ended: its reply is a step; then root idles (live), the run ends (spike) or a child is done. */
  ended({ reply, failure }) {
    const { run } = this
    if (reply !== undefined) {
      const index = this.steps.length
      this.steps.push({ kind: 'reply' })
      const result = run.stepStarted(this, index)
      result.view = stepView({ reply }, index, this.name, run.root)
      run.stepEnded(result, { state: 'ok', output: reply })
      this.index = this.steps.length
    }
    if (this.parent) {
      this.setState(failure ? (failure === 'stopped' ? 'stopped' : 'failed') : 'done')
      if (reply !== undefined && !run.over) run.message(this.name, this.parent.name, reply)
      return
    }
    if (run.turnEnded) {
      this.setState('idle')
      return run.turnEnded(failure ?? null)
    }
    if (run.over) return
    if (failure) return run.fail(`${this.name}: ${failure}`, this)
    run.message(this.name, null, reply)
    this.setState('done')
    run.rootDone()
  }

  async open() {
    const { createAgentSession, createExtensionRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent')
    const { model, modelRuntime, thinkingLevel, subagents } = this.options
    const systemPrompt = this.options.systemPrompt + (subagents ? SUBAGENTS : '') + (this.parent ? CHILD : '')
    const dir = this.sessionDir
    mkdirSync(dir, { recursive: true })
    mkdirSync(this.cwd, { recursive: true })
    // nothing discovered from the host: no ~/.pi settings, AGENTS.md, skills or extensions
    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => systemPrompt,
      getSystemPromptSource: () => undefined,
      getAppendSystemPrompt: () => [],
      getAppendSystemPromptSources: () => [],
      extendResources: () => {},
      reload: async () => {},
    }
    const { session } = await createAgentSession({
      cwd: this.cwd,
      agentDir: dir,
      model,
      thinkingLevel,
      modelRuntime,
      resourceLoader,
      noTools: 'builtin',
      customTools: subagents ? [this.bashTool(), this.subagentTool()] : [this.bashTool()],
      sessionManager: this.resume ? SessionManager.continueRecent(this.cwd, dir) : SessionManager.create(this.cwd, dir),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } }),
    })
    session.subscribe((event) => this.onEvent(event))
    this.sessionFile = session.sessionManager?.getSessionFile?.() ?? null
    return session
  }

  onEvent(event) {
    this.options.onEvent(event)
    if (event.type === 'turn_start') {
      this.thinking = Date.now()
      this.run.agentChanged(this)
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      const m = event.message
      this.thinking = null
      const u = m.usage ?? {}
      this.usage.input += u.input ?? 0
      this.usage.output += u.output ?? 0
      this.usage.cacheRead += u.cacheRead ?? 0
      this.usage.cacheWrite += u.cacheWrite ?? 0
      this.usage.cost += u.cost?.total ?? 0
      this.usage.turns++
      const text = m.content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
      if (m.content.some((c) => c.type === 'toolCall')) this.say = text || null
      else if (text) this.lastText = text
      if (m.stopReason === 'error') this.error = m.errorMessage ?? 'the model request failed'
      this.run.agentChanged(this)
    }
  }

  /** pi's bash tool, run as a Run step (tools.js Tools.bash, without a script's checks). */
  bashTool() {
    return {
      name: 'bash',
      label: 'bash',
      description: 'Run one bash command (`bash -c`) on the host in your scratch folder. The `layerfs` command reaches the project. Returns the exit code, stdout and stderr (each cut to its last 30 KB).',
      parameters: Type.Object({
        command: Type.String({ description: 'The bash command to run.' }),
        description: Type.Optional(Type.String({ description: 'Five to ten words on what the command does.' })),
        timeoutMs: Type.Optional(Type.Number({ description: `Timeout in ms; default ${DEFAULT_TIMEOUT_MS}, at most ${MAX_TIMEOUT_MS}.` })),
      }),
      executionMode: 'sequential',
      execute: (toolCallId, params, signal) => this.bash(params, signal),
    }
  }

  async bash(args, signal) {
    const { run } = this
    if (run.over) throw new Error('the run has ended')
    const index = this.steps.length
    const step = { kind: 'call', call: { name: 'bash', args } }
    this.steps.push(step)
    const result = run.stepStarted(this, index)
    // the step carries its own view: no script holds it
    result.view = stepView({ bash: { command: args.command, description: args.description }, ...(this.say ? { say: this.say } : {}) }, index, this.name, run.root)
    this.say = null
    const label = `${this.name}:${index}`
    const env = Object.fromEntries(Object.entries(run.env(this, label)).filter(([k]) => !SECRET.test(k)))
    const out = new Tail()
    const err = new Tail()
    const timeoutMs = Math.min(Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const proc = startBash({ command: args.command, cwd: this.cwd, env, onStdout: (b) => out.push(b), onStderr: (b) => err.push(b) })
    const untrack = run.track(proc)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)
    const onAbort = () => proc.kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = await proc.done
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    untrack()
    run.traces.read(this.name)
    const fields = { exitCode: done.exitCode, stdout: out.text(), stderr: err.text(), truncated: out.truncated || err.truncated }
    const checks = []
    if (done.error) checks.push({ name: 'exit', ok: false, detail: `bash did not start: ${done.error.message}` })
    else if (timedOut) checks.push({ name: 'timeout', ok: false, detail: `timed out after ${timeoutMs}ms; its process group was killed` })
    else if (done.signal) checks.push({ name: 'exit', ok: false, detail: `killed by signal ${done.signal}` })
    // a failing command is the model's to read, not the run's end
    run.stepEnded(result, { state: run.over || this.aborted ? 'stopped' : 'ok', ...fields, checks })
    this.index = this.steps.length
    if (!run.over) run.progress(this)
    const status = done.error ? `bash did not start: ${done.error.message}` : timedOut ? `timed out after ${timeoutMs} ms (killed)` : done.signal ? `killed by ${done.signal}` : `exit code ${done.exitCode}`
    const cut = (s) => (s.length > MODEL_KEEP ? `[…cut to the last ${MODEL_KEEP} bytes]\n${s.slice(-MODEL_KEEP)}` : s)
    const text = [status, fields.stdout && `stdout:\n${cut(fields.stdout)}`, fields.stderr && `stderr:\n${cut(fields.stderr)}`].filter(Boolean).join('\n')
    return { content: [{ type: 'text', text }], details: { exitCode: done.exitCode, step: label } }
  }

  /** Root's subagent tool: a fresh child agent per call, whose reply is the answer. */
  subagentTool() {
    return {
      name: 'subagent',
      label: 'subagent',
      description:
        'Start a subagent: a helper agent with its own bash tool on the same LayerFS project and model. It knows nothing of this conversation, so the task must say everything it needs. Returns its final reply. Several subagent calls in one message run at the same time.',
      parameters: Type.Object({
        name: Type.String({ description: 'A short name for it: lowercase words joined by dashes, such as "tests" or "fix-docs".' }),
        task: Type.String({ description: 'The whole task: what to do, on which Branch, and what to report back.' }),
      }),
      executionMode: 'parallel',
      execute: (toolCallId, params, signal) => this.subagent(params, signal),
    }
  }

  async subagent(args, signal) {
    const { run } = this
    if (run.over) throw new Error('the session is not working')
    const name = run.agentName(args.name)
    const index = this.steps.length
    this.steps.push({ kind: 'call', call: { name: 'subagent', args } })
    const result = run.stepStarted(this, index)
    result.view = stepView({ subagent: { prompt: args.task, description: name }, ...(this.say ? { say: this.say } : {}) }, index, this.name, run.root)
    this.say = null
    const { model, modelRuntime, thinkingLevel, systemPrompt, onEvent } = this.options
    const child = new PiAgent(run, name, { prompt: args.task, model, modelRuntime, thinkingLevel, systemPrompt, onEvent }, this)
    child.cwd = join(this.cwd, 'agents', name)
    this.children.set(name, child)
    run.addAgent(child)
    run.message(this.name, name, args.task)
    const onAbort = () => child.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const { reply, failure } = await child.turn()
    signal?.removeEventListener('abort', onAbort)
    const text = reply !== undefined ? reply : `${name} ended without a reply: ${failure}`
    run.stepEnded(result, { state: run.over || this.aborted ? 'stopped' : 'ok', output: text })
    this.index = this.steps.length
    if (!run.over) run.progress(this)
    return { content: [{ type: 'text', text: reply !== undefined ? `${name} replied:\n${reply}` : text }], details: { agent: name } }
  }
}
