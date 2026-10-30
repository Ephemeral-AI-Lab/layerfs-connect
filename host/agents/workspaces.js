import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { INSTRUCTION_FILES, MAX_INSTRUCTION_BYTES } from './context.js'

const CHUNK = 64 * 1024
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
const fail = (message) => Object.assign(new Error(message), { status: 409 })

/**
 * Whether a chat's bash runs in a LayerFS mount of its own branch. A project
 * chat made now runs bash in its working folder (`runs: 'folder'`); older
 * project chats, made with a mount, keep it.
 */
export const mounted = (record) => !!record.project && record.runs !== 'folder'

/** Pi stays on the host; a mounted chat's bash calls run in its LayerFS mount. */
export class AgentWorkspaces {
  constructor({ projects }) {
    this.projects = projects
    this.clients = new Map()
    this.queues = new Map()
  }

  initial(id) {
    return { branch: `chat-${id}`, state: 'pending', sandbox: null, path: null, head: null, commitCount: 0, lastSaved: null, error: null }
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

  async client(record) {
    let client = this.clients.get(record.id)
    if (!client) {
      client = await this.projects.open(record.project)
      this.clients.set(record.id, client)
    }
    return client
  }

  async open(record, onChange) {
    const ws = record.workspace
    const client = await this.client(record)
    const { layerfs } = client
    await this.change(record, { state: 'preparing', error: null }, onChange)
    if (!ws.branchReady) {
      let found = false
      for (let page = 0; page !== null;) {
        const result = await layerfs.project.list_branches(1000, page)
        found ||= result.items.some((branch) => branch.name === ws.branch)
        if (found || !result.hasMore) break
        page = result.nextPagePos ?? (result.items.length ? page + result.items.length : null)
      }
      if (!found) await layerfs.branch.fork(ws.branch, ws.fromRef ?? 'main')
      await this.change(record, { branchReady: true }, onChange)
    }
    if (!ws.sandbox) {
      const { sandbox } = await layerfs.sandbox.create()
      await this.change(record, { sandbox }, onChange)
    }
    let mounts = (await layerfs.sandbox.list_workspaces(ws.sandbox)).items
    let mount = mounts.find((item) => ws.path ? item.path === ws.path : item.branch === ws.branch)
    if (ws.path && (!mount || mount.branch !== ws.branch || (ws.workspaceId && mount.workspace !== ws.workspaceId))) {
      throw fail('This conversation’s LayerFS workspace is no longer available. Its saved branch history is still intact.')
    }
    if (!mount) {
      const mounted = await layerfs.workspace.mount(ws.sandbox, ws.branch)
      await this.change(record, { path: mounted.path }, onChange)
      mounts = (await layerfs.sandbox.list_workspaces(ws.sandbox)).items
      mount = mounts.find((item) => item.path === mounted.path)
    }
    if (!mount || mount.branch !== ws.branch) throw fail('LayerFS did not report this conversation’s mounted workspace.')
    await this.change(record, { path: mount.path, workspaceId: mount.workspace, head: mount.base ?? ws.head }, onChange)
    if (ws.process) {
      await this.stop(record, client, onChange)
      await this.save(record, client, 'Save interrupted command changes', onChange)
    }
    await this.change(record, { state: 'ready', error: null }, onChange)
    return client
  }

  async control(client, ws, command) {
    const result = await client.layerfs.workspace.exec(ws, command)
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || `Workspace control command exited ${result.exitCode}.`)
    return result.stdout
  }

  /** Read instructions from the actual mount, never the host control directory. */
  context(record, onChange) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, async () => {
      const client = await this.open(record, onChange)
      const output = await this.control(client, record.workspace,
        `for file in ${INSTRUCTION_FILES.map(quote).join(' ')}; do if [ -f "$file" ]; then if [ "$(wc -c < "$file")" -gt ${MAX_INSTRUCTION_BYTES} ]; then printf 'Project instructions exceed 1 MiB: %s\\n' "$file" >&2; exit 1; fi; printf '%s\\n' "$file"; base64 < "$file" | tr -d '\\n'; break; fi; done`)
      if (!output) return []
      const separator = output.indexOf('\n')
      return [{ path: `${record.workspace.path}/${output.slice(0, separator)}`, content: Buffer.from(output.slice(separator + 1), 'base64').toString('utf8').replace(/^\uFEFF/, '') }]
    })
  }

  async stop(record, client, onChange) {
    const process = record.workspace.process
    if (!process) return
    if (!process.id) {
      const owned = []
      for (let page = 0; page !== null;) {
        const result = await client.backend.daemon.process.list(1000, page)
        owned.push(...result.items.filter((item) => item.path === record.workspace.path && item.command.includes(process.directory)))
        if (!result.hasMore) break
        page = result.nextPagePos ?? (result.items.length ? page + result.items.length : null)
      }
      if (owned.length !== 1) throw fail('The workspace command’s start could not be confirmed. Its workspace has been retained.')
      process.id = owned[0].id
      await onChange?.()
    }
    const result = await client.backend.daemon.process.cancel(process.id)
    if (result.status !== 'stopped') throw fail('The workspace command has not stopped yet. Its changes remain in the workspace; try Stop again.')
    await this.change(record, { process: null }, onChange)
  }

  async save(record, client, message, onChange) {
    await this.change(record, { state: 'saving' }, onChange)
    const result = await client.layerfs.workspace.commit(record.workspace, message)
    if (result.kind !== 'Committed' && result.kind !== 'UpToDate') throw new Error(`Unexpected LayerFS commit result: ${result.kind}`)
    await this.change(record, {
      head: result.head ?? null,
      ...(result.kind === 'Committed' ? { commitCount: record.workspace.commitCount + 1, lastSaved: Date.now() } : {}),
      state: 'ready', error: null,
    }, onChange)
  }

  /** A turn boundary names immutable files, including the initial Layer before any Commit. */
  checkpoint(record, onChange) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, () => this.checked(record, onChange, async () => {
      const client = await this.open(record, onChange)
      await this.save(record, client, 'Save conversation checkpoint', onChange)
      const status = await client.backend.daemon.workspace.status(record.workspace)
      const head = status.base ?? null
      const baseLayer = status.baseLayer
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

  /** One bounded output page; the actual command never receives host environment or credentials. */
  async read(client, ws, run, onData) {
    const directory = quote(run.directory)
    const text = await this.control(client, ws,
      `set -o pipefail; dd if=${directory}/output bs=${CHUNK} skip=${run.offset} count=${CHUNK} iflag=skip_bytes,count_bytes status=none | base64 | tr -d '\\n' || exit; printf '\\n'; if [ -f ${directory}/exit ]; then cat ${directory}/exit; fi`)
    const [encoded, status] = text.split('\n')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length) {
      await onData?.(bytes)
      run.offset += bytes.length
    }
    return { bytes: bytes.length, exitCode: status === undefined || status === '' ? null : Number(status) }
  }

  exec(record, input, options = {}) {
    record.workspace ??= this.initial(record.id)
    return this.serial(record, () => this.checked(record, options.onChange, () => this.run(record, input, options)))
  }

  async run(record, { command, agent, toolCallId, timeout }, { signal, onData, onChange }) {
    signal?.throwIfAborted()
    const client = await this.open(record, onChange)
    signal?.throwIfAborted()
    const ws = record.workspace
    const run = { id: null, directory: `/tmp/connect-command-${randomUUID()}`, offset: 0 }
    const directory = quote(run.directory)
    await this.control(client, ws, `mkdir -m 700 -- ${directory} && : > ${directory}/output`)
    // The first hold prevents the command running before its process identity is saved.
    // The second keeps that identity alive for SDK cancellation, including any descendants.
    const wrapper = `while [ ! -f ${directory}/go ]; do sleep 0.05; done\nbash -c ${quote(command)} > ${directory}/output 2>&1\nstatus=$?\nprintf '%s\\n' "$status" > ${directory}/exit\nwhile :; do sleep 3600; done`
    await this.change(record, { process: run, state: 'running', error: null }, onChange)
    const started = await client.backend.daemon.process.start(ws, wrapper)
    run.id = started.process
    await this.change(record, { process: run, state: 'running', error: null }, onChange)
    const timed = new AbortController()
    const timer = timeout > 0 ? setTimeout(() => timed.abort(new Error(`Command timed out after ${timeout} seconds.`)), timeout * 1000) : null
    const abort = signal ? AbortSignal.any([signal, timed.signal]) : timed.signal
    let error = null
    let exitCode = null
    try {
      abort.throwIfAborted()
      await this.control(client, ws, `touch -- ${directory}/go`)
      while (exitCode === null) {
        abort.throwIfAborted()
        const output = await this.read(client, ws, run, onData)
        exitCode = output.exitCode
        if (exitCode === null && output.bytes < CHUNK) await pause(120, undefined, { signal: abort })
      }
    } catch (cause) {
      error = abort.aborted ? abort.reason : cause
    } finally {
      clearTimeout(timer)
    }
    // A cancelled HTTP request is not evidence that the Sandbox process stopped.
    // Keep the persisted process when this refuses or returns "stopping".
    await this.stop(record, client, onChange)
    if (!error) {
      try { while ((await this.read(client, ws, run, onData)).bytes === CHUNK) {} } catch (cause) {
        error = abort.aborted ? abort.reason : cause
      }
    }
    await this.save(record, client, `Bash ${agent || 'root'} ${toolCallId || ''}${exitCode === null ? ' (interrupted)' : ` (exit ${exitCode})`}`, onChange)
    await this.control(client, ws, `rm -rf -- ${directory}`)
    if (error) throw error
    return { exitCode }
  }

  release(record, onChange) {
    if (!record.workspace) return Promise.resolve()
    return this.serial(record, () => this.checked(record, onChange, () => this.close(record, onChange)))
  }

  async close(record, onChange) {
    const ws = record.workspace
    if (!ws || ws.state === 'closed') return
    if (!ws.sandbox) {
      await this.clients.get(record.id)?.layerfs.close()
      this.clients.delete(record.id)
      await this.change(record, { state: 'closed', error: null }, onChange)
      return
    }
    const client = ws.path ? await this.open(record, onChange) : await this.client(record)
    if (ws.path) {
      await this.stop(record, client, onChange)
      await this.save(record, client, 'Save conversation workspace', onChange)
      await client.layerfs.workspace.unmount(ws)
      await this.change(record, { path: null, workspaceId: null }, onChange)
    }
    try { await client.layerfs.sandbox.close(ws.sandbox) } catch (error) {
      // An empty Sandbox may have completed its idle shutdown since unmount.
      if (ws.path || ws.process || error.code !== 'NoSuchSandbox') throw error
    }
    await this.change(record, { sandbox: null }, onChange)
    await client.layerfs.close()
    this.clients.delete(record.id)
    await this.change(record, { state: 'closed', error: null }, onChange)
  }
}
