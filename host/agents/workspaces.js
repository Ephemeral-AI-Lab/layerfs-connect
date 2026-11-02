// A mounted chat's LayerFS Workspace on 2.0: its own Branch, a Sandbox named
// after the chat on the project's Store's machine (a PostgreSQL project's on
// native), and one Workspace (`ws` handle `<sandbox>:<path>`). Bash runs in
// the foreground with workspace.exec: its output arrives when the command
// ends, and it cannot be stopped mid-way. Background start, list and cancel
// and live output come with a later LayerFS (§9 Q2); a command's timeout is
// the shell's `timeout` where the machine has it.
import { randomUUID } from 'node:crypto'
import { workspacesOf } from '../layerfs.js'
import { INSTRUCTION_FILES, MAX_INSTRUCTION_BYTES } from './context.js'

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
const fail = (message) => Object.assign(new Error(message), { status: 409 })

/**
 * Whether a chat's bash runs in a LayerFS mount of its own branch. A project
 * chat made now runs bash in its working folder (`runs: 'folder'`); older
 * project chats, made with a mount, keep it.
 */
export const mounted = (record) => !!record.project && record.runs !== 'folder'

/** A chat's Sandbox name: unique in the home (1–63 of a-z 0-9 _ . -). */
const sandboxName = (id) => `chat.${String(id).toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`.slice(0, 63)

/** Pi stays on the host; a mounted chat's bash calls run in its LayerFS Workspace. */
export class AgentWorkspaces {
  constructor({ projects }) {
    this.projects = projects
    this.queues = new Map()
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
      const made = await lfs.workspace.mount(ws.sandbox, ws.branch)
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

  /**
   * One foreground bash command: workspace.exec, its output passed on when it
   * ends (inline up to 1 MiB a stream, through the sinks above that), then a
   * Commit. An abort before it starts stops it; one after cannot (a call is
   * not cancelled; §9 Q2), so the command finishes and is saved.
   */
  async run(record, { command, agent, toolCallId, timeout }, { signal, onData, onChange }) {
    signal?.throwIfAborted()
    await this.open(record, onChange)
    signal?.throwIfAborted()
    const ws = record.workspace
    await this.change(record, { state: 'running', error: null }, onChange)
    const wrapped = timeout > 0 ? `if command -v timeout >/dev/null 2>&1; then timeout ${Math.ceil(timeout)} bash -c ${quote(command)}; else bash -c ${quote(command)}; fi 2>&1` : `bash -c ${quote(command)} 2>&1`
    let streamed = false
    const sink = (bytes) => {
      streamed = true
      void onData?.(Buffer.from(bytes))
    }
    const result = await this.lfs.workspace.exec(ws.handle, wrapped, { stdout: sink, stderr: sink })
    if (!streamed) {
      const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
      if (text) await onData?.(Buffer.from(text))
    }
    const exitCode = typeof result.exit_code === 'number' ? result.exit_code : null
    await this.save(record, `Bash ${agent || 'root'} ${toolCallId || ''}${exitCode === null ? ' (no exit code)' : ` (exit ${exitCode})`}`, onChange)
    return { exitCode }
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
