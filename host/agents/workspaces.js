// Mounted commands use CLI event frames and explicit exec-cancel.
// Stop preserves the Workspace and Sandbox; partial writes remain.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeShims } from '../runs/shim.js'
import { workspacesOf } from '../layerfs.js'
import { stringify } from '../cli/json.js'
import { INSTRUCTION_FILES, MAX_INSTRUCTION_BYTES } from './context.js'
import { normalize, projectIds } from '../sessions/operations.js'
import { operationId } from '../sessions/recorder.js'

// Host-generated LayerFS calls of a conversation are recorded as its operations
// (sessions/recorder.js) with their cause: the tool whose command they ran or
// saved, a session boundary (a restore point), or the Workspace lifecycle.
const unrecorded = { record: (_method, _args, run) => run(null) }

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
const fail = (message) => Object.assign(new Error(message), { status: 409 })

/**
 * Whether a chat's bash runs in a LayerFS mount of its own branch. A project
 * chat made now runs in a mount; a folder chat (`runs: 'folder'`) keeps its
 * folder execution until it is explicitly converted.
 */
export const mounted = (record) => !!record.project && record.runs !== 'folder'

/** A Workspace name from a chat's Branch: 1–63 of a-z 0-9 _ . - (the Branch is `chat-<id>`). */
export const workspaceName = (branch) => String(branch).toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 63) || 'chat'

/** A chat's Sandbox name: unique in the home (1–63 of a-z 0-9 _ . -). */
const sandboxName = (id) => `chat.${String(id).toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`.slice(0, 63)

/** Pi stays on the host; a mounted chat's bash calls run in its LayerFS Workspace. */
export class AgentWorkspaces {
  constructor({ projects }) {
    this.projects = projects
    this.queues = new Map()
    this.cancellations = new Map()
  }

  get lfs() {
    return this.projects.lfs
  }

  /** The conversation's recorder (set by AgentManager), or none. */
  recorder(record, context = {}) {
    return this.sessions?.recorder(record.id, context) ?? unrecorded
  }

  /**
   * What a command in a native mounted Sandbox gets for LayerFS: it runs on this
   * host, so it uses Connect's pinned CLI shim and package, this home, and the
   * conversation's journal context. Its SDK and CLI calls are then recorded as
   * the tool's operations. A container Sandbox cannot see host paths: null.
   */
  sandboxEnv(record, context) {
    return record.workspace.runtime === 'native' ? this.toolsEnv(record, context) : null
  }

  /**
   * Whether this chat's bash runs on the host, as the simulations' CLI scripts do:
   * its Sandbox is a container or VM, whose commands cannot reach Connect's CLI.
   * The agent drives its Workspace with `layerfs workspace exec "$LAYERFS_CONNECT_WS" …`.
   */
  hostShell(record) {
    const runtime = record.workspace?.runtime
    return !!runtime && runtime !== 'native' && !!this.sessions && !!process.env.LAYERFS_CONNECT_CLI && !!this.lfs?.home
  }

  /** Connect's recorded CLI shim and package, this home and the tool's journal context, for a command on this host. */
  toolsEnv(record, context) {
    const ws = record.workspace
    const cli = process.env.LAYERFS_CONNECT_CLI
    const home = this.lfs?.home
    if (!this.sessions || !cli || !home) return null
    const chatDir = join(this.sessions.dir, record.id)
    const tools = join(chatDir, 'sandbox-tools')
    const hook = join(tools, 'layerfs-resolve.mjs')
    if (!existsSync(hook)) {
      writeShims({ cli }, tools)
      // `import 'layerfs'` from a script in the Workspace resolves to Connect's package; nothing is written into the mount
      const client = pathToFileURL(fileURLToPath(new URL('../runs/scope-client.js', import.meta.url))).href
      const resolver = `export async function resolve(specifier, context, next) { return specifier === 'layerfs' ? { url: ${JSON.stringify(client)}, shortCircuit: true } : next(specifier, context) }`
      writeFileSync(hook, `import { register } from 'node:module'\nregister(${JSON.stringify(`data:text/javascript,${encodeURIComponent(resolver)}`)})\n`)
    }
    return {
      LAYERFS_HOME: home, LAYERFS_CONNECT_CLI: cli, LAYERFS_CONNECT_PROJECT: record.project,
      LAYERFS_CONNECT_WS: ws.handle ?? '', LAYERFS_CONNECT_BRANCH: ws.branch, LAYERFS_CONNECT_EXECS: join(chatDir, 'exec-launches'),
      NODE_OPTIONS_PREFIX: `--import=${pathToFileURL(hook).href}`,
      ...this.sessions.toolEnv(record.id, context),
      LAYERFS_TRACE: join(chatDir, 'traces', `${context.agent_id}.jsonl`), LAYERFS_TRACE_STEP: `${context.agent_id}:${context.tool_call_id}`, LAYERFS_TRACE_START: '1',
      PATH_PREFIX: join(tools, 'bin'),
    }
  }

  /** What this mount instance confirms about the Workspace a call names. */
  facts(record) {
    const ws = record.workspace
    return { project: record.project, branch: ws.branch, base_layer: ws.baseLayer ?? null, sandbox: ws.sandbox ?? null, workspace_instance: ws.handle ?? null }
  }

  initial(id) {
    return { branch: `chat-${id}`, state: 'pending', sandbox: null, handle: null, path: null, head: null, commitCount: 0, lastSaved: null, error: null }
  }

  async change(record, values, onChange) {
    Object.assign(record.workspace, values)
    await onChange?.()
  }

  serial(record, work) {
    const previous = this.queues.get(record.id) ?? Promise.resolve()
    const result = previous.then(work)
    const settled = result.catch(() => {})
    this.queues.set(record.id, settled)
    void settled.then(() => { if (this.queues.get(record.id) === settled) this.queues.delete(record.id) })
    return result
  }

  async checked(record, onChange, work) {
    try { return await work() } catch (error) {
      if (error.name !== 'AbortError') await this.change(record, { state: 'error', error: error.message }, onChange)
      throw error
    }
  }

  prepare(record, onChange) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, () => this.checked(record, onChange, () => this.open(record, onChange)))
  }

  async open(record, onChange) {
    const ws = record.workspace
    const lfs = this.lfs
    // a LayerFS 1.1.0 chat (a bare project key, numbered Sandboxes) is read-only here
    const project = await this.projects.record(record.project)
    const key = project.project
    await this.change(record, { state: 'preparing', error: null }, onChange)
    if (!ws.branchReady) {
      try {
        await lfs.branch.get(key, ws.branch)
      } catch (error) {
        if (error.code !== 'NoSuchBranch' && error.code !== 'NotFound') throw error
        const from = ws.fromRef ?? 'main'
        const exact = /^[0-9a-f]{40,}$/.test(from)
        // a checkpoint names a Commit or a Layer: fork from it, on main as the carrier Branch
        await this.recorder(record).record('branch.fork', { project: key, name: ws.branch, from_branch: exact ? 'main' : from, ...(exact ? { from_commit: from } : {}) },
          () => (exact ? lfs.branch.fork(key, ws.branch, 'main', from) : lfs.branch.fork(key, ws.branch, from)),
          { cause: ws.restoreBoundary ? 'session_boundary' : 'lifecycle', execution: ws.restoreBoundary ? { restore: ws.restoreBoundary } : {}, mount: () => ({ project: key, inputs: ws.fromVersion ? [ws.fromVersion] : [] }) })
      }
      await this.change(record, { branchReady: true }, onChange)
    }
    if (!ws.sandbox) {
      const name = sandboxName(record.id)
      const machine = project.kind === 'postgresql' ? 'native' : project.machine
      await this.recorder(record).record('sandbox.create', { project: key, name, machine }, () => lfs.sandbox.create(key, name, machine), { cause: 'lifecycle', execution: { machine, sandbox: name } })
      await this.change(record, { sandbox: name }, onChange)
    }
    if (ws.path) {
      const mount = (await workspacesOf(lfs, ws.sandbox)).find((w) => w.directory === ws.path)
      if (!mount || mount.branch !== ws.branch) throw fail('This conversation’s LayerFS workspace is no longer available. Its saved branch history is still intact.')
    } else {
      // a named Workspace (#537 §7): its handle is <sandbox>:<name>, the chat's Branch name made a LayerFS name
      const made = await this.recorder(record).record('workspace.mount', { sandbox: ws.sandbox, branch: ws.branch, name: workspaceName(ws.branch) },
        () => lfs.workspace.mount(ws.sandbox, ws.branch, { name: workspaceName(ws.branch) }), { cause: 'lifecycle', execution: { sandbox: ws.sandbox, project: key } })
      await this.change(record, { handle: made.ws, path: made.path ?? made.ws.slice(ws.sandbox.length + 1), head: made.base ?? ws.head, baseLayer: made.base_layer ?? ws.baseLayer, runtime: made.runtime ?? null }, onChange)
    }
    await this.change(record, { handle: ws.handle ?? `${ws.sandbox}:${ws.path}`, state: 'ready', error: null }, onChange)
    return lfs
  }

  async control(ws, command) {
    const result = await this.lfs.workspace.exec(ws.handle, command)
    if (result.exit_code !== 0) throw new Error(result.stderr || result.stdout || `Workspace control command exited ${result.exit_code}.`)
    return result.stdout
  }

  /** Read instructions from the actual mount, never the host control directory. */
  context(record, onChange) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, async () => {
      await this.open(record, onChange)
      const output = await this.control(record.workspace,
        `for file in ${INSTRUCTION_FILES.map(quote).join(' ')}; do if [ -f "$file" ]; then if [ "$(wc -c < "$file")" -gt ${MAX_INSTRUCTION_BYTES} ]; then printf 'Project instructions exceed 1 MiB: %s\\n' "$file" >&2; exit 1; fi; printf '%s\\n' "$file"; base64 < "$file" | tr -d '\\n'; break; fi; done`)
      if (!output) return []
      const separator = output.indexOf('\n')
      return [{ path: `${record.workspace.path}/${output.slice(0, separator)}`, content: Buffer.from(output.slice(separator + 1), 'base64').toString('utf8').replace(/^\uFEFF/, '') }]
    })
  }

  /**
   * Saves the Workspace once, as a recorded workspace.commit whose message
   * carries its operation's correlation token (recovery evidence, not identity).
   * An unchanged save before any Commit links the base Layer confirmed by status.
   */
  async save(record, message, onChange, { cause = 'lifecycle', context = {}, required = false, beforeDispatch } = {}) {
    await this.change(record, { state: 'saving' }, onChange)
    const ws = record.workspace
    const id = operationId()
    const token = `[connect-op:${id}]`
    const facts = this.facts(record)
    const result = await this.recorder(record, context).record('workspace.commit', { ws: ws.handle, message: `${token} ${message}` }, () => this.lfs.workspace.commit(ws.handle, { message: `${token} ${message}` }), {
      operationId: id, cause, required, beforeDispatch,
      execution: { sandbox: ws.sandbox, workspace_instance: ws.handle, correlation_token: token, mount: facts, before_head: ws.head ?? null },
      mount: async (value) => {
        if (value?.kind !== 'UpToDate' || value.head) return facts
        const status = await this.lfs.workspace.status(ws.handle)
        return { ...facts, base_layer: status.base_layer ?? null, verified_by: 'workspace.status' }
      },
    })
    if (result.kind !== 'Committed' && result.kind !== 'UpToDate') throw new Error(`Unexpected LayerFS commit result: ${result.kind}`)
    await this.change(record, {
      head: result.head ?? record.workspace.head ?? null,
      ...(result.kind === 'Committed' ? { commitCount: record.workspace.commitCount + 1, lastSaved: Date.now() } : {}),
      state: 'ready', error: null,
    }, onChange)
    return { value: result, operation_id: id, facts }
  }

  /**
   * A turn boundary names immutable files: the Workspace's base Commit, or its
   * base Layer before any Commit, as a typed saved reference from the save's receipt.
   * `beforeDispatch` commits the save's intent to the session journal first.
   */
  checkpoint(record, onChange, { beforeDispatch } = {}) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, () => this.checked(record, onChange, async () => {
      await this.open(record, onChange)
      const saved = await this.save(record, 'Save conversation checkpoint', onChange, { cause: 'session_boundary', required: !!this.sessions, beforeDispatch })
      const status = await this.lfs.workspace.status(record.workspace.handle)
      const head = status.base ?? null
      const baseLayer = status.base_layer
      if (!baseLayer) throw fail('LayerFS did not report the workspace’s immutable base Layer.')
      const typed = normalize({ method: 'workspace.commit', args: { ws: record.workspace.handle }, value: saved.value, mount: { ...saved.facts, base_layer: baseLayer } })
      const workspace_ref = typed.checkpoints[0]?.ref ?? null
      await this.change(record, { head, baseLayer }, onChange)
      // the receipt's version is the boundary; status confirms the same binding
      const ref = workspace_ref?.commit_id ?? head ?? baseLayer
      return { project: record.project, branch: record.workspace.branch, ref, head: workspace_ref?.version_kind === 'Commit' ? ref : head, baseLayer, workspace_ref, operation_id: saved.operation_id, position: 'before' }
    }))
  }

  checkCheckpoint(record, checkpoint) {
    if (!record.project || checkpoint?.project !== record.project) throw fail('The checkpoint belongs to a different LayerFS project.')
    if (!checkpoint.ref || checkpoint.ref === 'main' || checkpoint.ref !== (checkpoint.head ?? checkpoint.baseLayer)) {
      throw fail('A workspace checkpoint must name an immutable Commit or Layer.')
    }
    const ref = checkpoint.workspace_ref
    const ids = projectIds(record.project)
    if (ref && (ref.commit_id !== checkpoint.ref || ref.store_id !== ids?.store_id || ref.project_id !== ids?.project_id)) throw fail('The checkpoint’s saved reference does not match its project and version.')
  }

  /** Restore through a new Branch; the abandoned timeline and its files remain in history. */
  restore(record, checkpoint, onChange, boundary = null) {
    this.checkCheckpoint(record, checkpoint)
    return this.serial(record, () => this.checked(record, onChange, async () => {
      await this.close(record, onChange)
      record.workspace = { ...this.initial(`${record.id}-r-${randomUUID().slice(0, 8)}`), fromRef: checkpoint.ref, fromVersion: checkpoint.workspace_ref ?? null, restoreBoundary: boundary, baseLayer: checkpoint.baseLayer, head: checkpoint.head }
      await onChange?.()
      await this.open(record, onChange)
      return record.workspace
    }))
  }

  /** A new conversation starts from a source checkpoint without sharing its mutable mount. */
  fork(record, checkpoint, onChange) {
    this.checkCheckpoint(record, checkpoint)
    return this.serial(record, () => this.checked(record, onChange, async () => {
      if (record.workspace?.branchReady || record.workspace?.sandbox || record.workspace?.path) {
        throw fail('Fork needs a new conversation without an existing workspace.')
      }
      record.workspace = { ...this.initial(record.id), fromRef: checkpoint.ref, fromVersion: checkpoint.workspace_ref ?? null, baseLayer: checkpoint.baseLayer, head: checkpoint.head }
      await onChange?.()
      await this.open(record, onChange)
      return record.workspace
    }))
  }

  exec(record, input, options = {}) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, () => this.checked(record, options.onChange, () => this.run(record, input, options)))
  }

  /** Cancel once: phase 1 records pre-registration cancellation for 30 s. */
  async cancel(record, onChange, retry = false) {
    const execution = record.workspace?.execution
    if (!execution || execution.finished) return execution?.cancel
    // a host-shell command is a process group on this host
    if (execution.host) {
      try { if (execution.pid) process.kill(-execution.pid, 'SIGTERM') } catch { /* already gone */ }
      execution.cancelRequested = true
      execution.cancel = { outcome: 'cancelled' }
      await onChange?.()
      return execution.cancel
    }
    if (retry && execution.cancel?.outcome === 'unknown') this.cancellations.delete(execution.exec_id)
    if (this.cancellations.has(execution.exec_id)) return this.cancellations.get(execution.exec_id)
    const task = Promise.resolve().then(async () => {
      execution.cancelRequested = true
      await onChange?.()
      try {
        if (retry && execution.cancel?.outcome === 'unknown') execution.observation = JSON.parse(stringify(await this.lfs.workspace.status(execution.ws)))
        execution.cancel = await this.lfs.workspace.exec_cancel(execution.ws, execution.exec_id)
      }
      catch (error) { execution.cancel = { outcome: 'unknown', message: error.message, code: error.code } }
      await onChange?.()
      return execution.cancel
    })
    this.cancellations.set(execution.exec_id, task)
    return task
  }

  /** The host folder a host-shell chat's bash starts in: outside the Workspace, so nothing in it is committed. */
  hostDir(record) {
    const dir = join(this.sessions.dir, record.id, 'host-work')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
  }

  /** One bash command on this host, in its own process group; Stop ends the group. */
  runOnHost(record, command, env, { timeout, signal, sink, onSpawn }) {
    signal?.throwIfAborted()
    const shellEnv = {
      // the host's own LayerFS settings stay out, except the bundle its machines' workers were started from
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LAYERFS_') || key === 'LAYERFS_BUNDLE')),
      ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.endsWith('_PREFIX'))),
      PATH: `${env.PATH_PREFIX}:${process.env.PATH ?? ''}`,
      NODE_OPTIONS: `${env.NODE_OPTIONS_PREFIX} ${process.env.NODE_OPTIONS ?? ''}`.trim(),
    }
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', command], { cwd: this.hostDir(record), env: shellEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const kill = () => { try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ } }
      const deadline = timeout > 0 ? setTimeout(kill, Math.ceil(timeout) * 1000) : null
      signal?.addEventListener('abort', kill, { once: true })
      child.once('spawn', () => onSpawn(child.pid))
      child.stdout.on('data', sink)
      child.stderr.on('data', sink)
      child.once('error', reject)
      child.once('close', (code, sig) => {
        clearTimeout(deadline)
        signal?.removeEventListener('abort', kill)
        // the group ends with its command, as a Sandbox command's does
        kill()
        resolve({ kind: code === null ? `signal:${sig}` : `exit:${code}`, exit_code: code, stop: sig ? 'signal' : 'group' })
      })
    })
  }

  /** Frames supply output exactly once. Command completion and Save are separate. */
  async run(record, { command, agent, toolCallId, entryId = null, nativeSessionId = null, timeout }, { signal, onData, onChange }) {
    const context = { agent_id: agent || 'root', tool_call_id: toolCallId ?? null, entry_id: entryId, native_session_id: nativeSessionId }
    signal?.throwIfAborted()
    await this.open(record, onChange)
    signal?.throwIfAborted()
    const ws = record.workspace
    const execution = { ws: ws.handle, exec_id: `connect-${randomUUID()}`, finished: false, cancelRequested: false }
    await this.change(record, { state: 'running', error: null, execution }, onChange)
    if (signal?.aborted) {
      execution.finished = true
      await this.change(record, { state: 'ready' }, onChange)
      signal.throwIfAborted()
    }
    const abort = () => { void this.cancel(record, onChange) }
    signal?.addEventListener('abort', abort, { once: true })
    const env = this.sandboxEnv(record, context)
    const prelude = env ? `${Object.entries(env).filter(([k]) => !k.endsWith('_PREFIX')).map(([k, v]) => `export ${k}=${quote(v)}`).join('; ')}; export PATH=${quote(env.PATH_PREFIX)}:"$PATH"; export NODE_OPTIONS=${quote(env.NODE_OPTIONS_PREFIX)}" \${NODE_OPTIONS:-}"; ` : ''
    const wrapped = prelude + (timeout > 0 ? `if command -v timeout >/dev/null 2>&1; then timeout ${Math.ceil(timeout)} bash -c ${quote(command)}; else bash -c ${quote(command)}; fi` : `bash -c ${quote(command)}`)
    let result, spawned = false, deliveryError
    let output = Promise.resolve(), pendingOutput = 0, outputDrained
    // Invoke frames in order without queueing their bytes behind an async consumer.
    // Handle rejected delivery immediately, then drain before recording completion.
    const delivered = () => { if (--pendingOutput === 0) outputDrained() }
    const sink = (bytes) => {
      if (deliveryError) return
      if (pendingOutput++ === 0) output = new Promise(resolve => { outputDrained = resolve })
      try {
        Promise.resolve(onData?.(Buffer.from(bytes))).then(delivered, error => { deliveryError = error; delivered() })
      } catch (error) { deliveryError = error; delivered() }
    }
    try {
      if (this.hostShell(record)) {
        // a container/VM Sandbox: bash runs here, as the simulations' CLI scripts do; its LayerFS calls go through
        // Connect's recorded CLI (`layerfs workspace exec "$LAYERFS_CONNECT_WS" …` reaches the Workspace)
        execution.host = true
        result = await this.runOnHost(record, command, this.toolsEnv(record, context), { timeout, signal, sink, onSpawn: (pid) => { spawned = !!pid; execution.pid = pid; void onChange?.() } })
      } else result = await this.recorder(record, context).record('workspace.exec', { ws: ws.handle, command, exec_id: execution.exec_id },
        () => this.lfs.workspace.exec(ws.handle, wrapped, { exec_id: execution.exec_id, before_spawn: () => signal?.throwIfAborted(), on_spawn: pid => { spawned = !!pid; execution.pid = pid; void onChange?.() }, stdout: sink, stderr: sink }),
        { cause: 'tool', execution: { sandbox: ws.sandbox, workspace_instance: ws.handle } })
      execution.result = JSON.parse(stringify({ kind: result.kind, exit_code: result.exit_code, stop: result.stop, stdout_bytes: result.stdout_bytes, stderr_bytes: result.stderr_bytes }))
    } finally {
      await output
      execution.finished = !!result || !spawned
      if (!result && spawned) execution.error = 'Command completion unavailable; remote execution may still be running.'
      if (!result && signal?.aborted) ws.state = 'ready'
      this.cancellations.delete(execution.exec_id)
      signal?.removeEventListener('abort', abort)
      // a LayerFS call whose process ended with the command (Stop, a kill) has an unknown outcome now, not at the next load;
      // one still running in a live descendant stays running
      try { this.sessions?.settleOrphans(record.id) } catch { /* reported by the journal's status */ }
      await onChange?.()
    }
    const exitCode = typeof result.exit_code === 'number' ? result.exit_code : null
    let saveError = null
    // the automatic save this tool call caused: one of its operations, with its own receipt
    try { await this.save(record, `Bash ${agent || 'root'} ${toolCallId || ''} (exit ${exitCode})`, onChange, { cause: 'tool', context }) }
    catch (error) {
      saveError = { code: error.code ?? 'Unknown', message: error.message }
      await this.change(record, { state: 'ready', error: `Not saved: ${saveError.code}: ${saveError.message}` }, onChange)
      sink(Buffer.from(`\nNot saved: ${saveError.code}: ${saveError.message}\n`))
    }
    await output
    if (deliveryError && !signal?.aborted) throw deliveryError
    return { exitCode, kind: result.kind, stop: result.stop, saveError }
  }

  release(record, onChange) {
    if (!record.workspace) return Promise.resolve()
    return this.serial(record, () => this.checked(record, onChange, () => this.close(record, onChange)))
  }

  async close(record, onChange) {
    const ws = record.workspace
    if (!ws || ws.state === 'closed') return
    if (ws.sandbox && ws.handle) {
      await this.save(record, 'Save conversation workspace', onChange)
      await this.recorder(record).record('workspace.unmount', { ws: ws.handle }, () => this.lfs.workspace.unmount(ws.handle), { cause: 'lifecycle', execution: { sandbox: ws.sandbox, workspace_instance: ws.handle } })
      await this.change(record, { handle: null, path: null }, onChange)
    }
    if (ws.sandbox) {
      try { await this.recorder(record).record('sandbox.close', { name: ws.sandbox }, () => this.lfs.sandbox.close(ws.sandbox), { cause: 'lifecycle', execution: { sandbox: ws.sandbox } }) } catch (error) {
        if (error.code !== 'NoSuchSandbox' && error.code !== 'NotFound') throw error
      }
      await this.change(record, { sandbox: null }, onChange)
    }
    await this.change(record, { state: 'closed', error: null }, onChange)
  }
}
