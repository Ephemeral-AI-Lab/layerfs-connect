// Mounted commands use CLI event frames and explicit exec-cancel.
// Stop preserves the Workspace and Sandbox; partial writes remain.
import { randomUUID } from 'node:crypto'
import { workspacesOf } from '../layerfs.js'
import { stringify } from '../cli/json.js'
import { INSTRUCTION_FILES, MAX_INSTRUCTION_BYTES } from './context.js'

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
const fail = (message) => Object.assign(new Error(message), { status: 409 })

/**
 * Whether a chat's bash runs in a LayerFS mount of its own branch. A project
 * chat made now runs bash in its working folder (`runs: 'folder'`); older
 * project chats, made with a mount, keep it.
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
        // a checkpoint names a Commit or a Layer: fork from it, on main as the carrier Branch
        await (/^[0-9a-f]{40,}$/.test(from) ? lfs.branch.fork(key, ws.branch, 'main', from) : lfs.branch.fork(key, ws.branch, from))
      }
      await this.change(record, { branchReady: true }, onChange)
    }
    if (!ws.sandbox) {
      const name = sandboxName(record.id)
      const machine = project.kind === 'postgresql' ? 'native' : project.machine
      await lfs.sandbox.create(key, name, machine)
      await this.change(record, { sandbox: name }, onChange)
    }
    if (ws.path) {
      const mount = (await workspacesOf(lfs, ws.sandbox)).find((w) => w.directory === ws.path)
      if (!mount || mount.branch !== ws.branch) throw fail('This conversation’s LayerFS workspace is no longer available. Its saved branch history is still intact.')
    } else {
      // a named Workspace (#537 §7): its handle is <sandbox>:<name>, the chat's Branch name made a LayerFS name
      const made = await lfs.workspace.mount(ws.sandbox, ws.branch, { name: workspaceName(ws.branch) })
      await this.change(record, { handle: made.ws, path: made.path ?? made.ws.slice(ws.sandbox.length + 1), head: made.base ?? ws.head, baseLayer: made.base_layer ?? ws.baseLayer }, onChange)
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

  async save(record, message, onChange) {
    await this.change(record, { state: 'saving' }, onChange)
    const result = await this.lfs.workspace.commit(record.workspace.handle, { message })
    if (result.kind !== 'Committed' && result.kind !== 'UpToDate') throw new Error(`Unexpected LayerFS commit result: ${result.kind}`)
    await this.change(record, {
      head: result.head ?? record.workspace.head ?? null,
      ...(result.kind === 'Committed' ? { commitCount: record.workspace.commitCount + 1, lastSaved: Date.now() } : {}),
      state: 'ready', error: null,
    }, onChange)
  }

  /** A turn boundary names immutable files: the Workspace's base Commit, or its base Layer before any Commit. */
  checkpoint(record, onChange) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, () => this.checked(record, onChange, async () => {
      await this.open(record, onChange)
      await this.save(record, 'Save conversation checkpoint', onChange)
      const status = await this.lfs.workspace.status(record.workspace.handle)
      const head = status.base ?? null
      const baseLayer = status.base_layer
      if (!baseLayer) throw fail('LayerFS did not report the workspace’s immutable base Layer.')
      await this.change(record, { head, baseLayer }, onChange)
      return { project: record.project, branch: record.workspace.branch, ref: head ?? baseLayer, head, baseLayer }
    }))
  }

  checkCheckpoint(record, checkpoint) {
    if (!record.project || checkpoint?.project !== record.project) throw fail('The checkpoint belongs to a different LayerFS project.')
    if (!checkpoint.ref || checkpoint.ref === 'main' || checkpoint.ref !== (checkpoint.head ?? checkpoint.baseLayer)) {
      throw fail('A workspace checkpoint must name an immutable Commit or Layer.')
    }
  }

  /** Restore through a new Branch; the abandoned timeline and its files remain in history. */
  restore(record, checkpoint, onChange) {
    this.checkCheckpoint(record, checkpoint)
    return this.serial(record, () => this.checked(record, onChange, async () => {
      await this.close(record, onChange)
      record.workspace = { ...this.initial(`${record.id}-r-${randomUUID().slice(0, 8)}`), fromRef: checkpoint.ref, baseLayer: checkpoint.baseLayer, head: checkpoint.head }
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
      record.workspace = { ...this.initial(record.id), fromRef: checkpoint.ref, baseLayer: checkpoint.baseLayer, head: checkpoint.head }
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

  /** Frames supply output exactly once. Command completion and Save are separate. */
  async run(record, { command, agent, toolCallId, timeout }, { signal, onData, onChange }) {
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
    const wrapped = timeout > 0 ? `if command -v timeout >/dev/null 2>&1; then timeout ${Math.ceil(timeout)} bash -c ${quote(command)}; else bash -c ${quote(command)}; fi` : `bash -c ${quote(command)}`
    let result, spawned = false
    try {
      const sink = (bytes) => { void onData?.(Buffer.from(bytes)) }
      result = await this.lfs.workspace.exec(ws.handle, wrapped, { exec_id: execution.exec_id, before_spawn: () => signal?.throwIfAborted(), on_spawn: pid => { spawned = !!pid; execution.pid = pid; void onChange?.() }, stdout: sink, stderr: sink })
      execution.result = JSON.parse(stringify({ kind: result.kind, exit_code: result.exit_code, stop: result.stop, stdout_bytes: result.stdout_bytes, stderr_bytes: result.stderr_bytes }))
    } finally {
      execution.finished = !!result || !spawned
      if (!result && spawned) execution.error = 'Command completion unavailable; remote execution may still be running.'
      if (!result && signal?.aborted) ws.state = 'ready'
      this.cancellations.delete(execution.exec_id)
      signal?.removeEventListener('abort', abort)
      await onChange?.()
    }
    const exitCode = typeof result.exit_code === 'number' ? result.exit_code : null
    let saveError = null
    try { await this.save(record, `Bash ${agent || 'root'} ${toolCallId || ''} (exit ${exitCode})`, onChange) }
    catch (error) {
      saveError = { code: error.code ?? 'Unknown', message: error.message }
      await this.change(record, { state: 'ready', error: `Not saved: ${saveError.code}: ${saveError.message}` }, onChange)
      await onData?.(Buffer.from(`\nNot saved: ${saveError.code}: ${saveError.message}\n`))
    }
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
      await this.lfs.workspace.unmount(ws.handle)
      await this.change(record, { handle: null, path: null }, onChange)
    }
    if (ws.sandbox) {
      try { await this.lfs.sandbox.close(ws.sandbox) } catch (error) {
        if (error.code !== 'NoSuchSandbox' && error.code !== 'NotFound') throw error
      }
      await this.change(record, { sandbox: null }, onChange)
    }
    await this.change(record, { state: 'closed', error: null }, onChange)
  }
}
