// One recorder for every public LayerFS invocation a conversation makes: SDK
// calls (runs/scope-client.js), explicit CLI calls (runs/cli-shim.mjs) and
// host-generated saves (agents/workspaces.js). It persists an intent with a
// unique operation id before dispatch, then the exact receipt. Context is
// explicit per invocation: a tool process inherits it from its environment;
// the host passes it per call and never mutates a shared environment.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { canonical, errorFacts, errorStatus, shownArguments } from './operations.js'
import { appendDurable, eventLine, newEvent, writeArtifact } from './journal.js'

export const OPS_ENV = 'LAYERFS_CONNECT_OPS'
export const CONTEXT_ENV = 'LAYERFS_CONNECT_CONTEXT'
/** Set on a child process whose invocation an outer recorder already owns. */
export const OPERATION_ENV = 'LAYERFS_CONNECT_OPERATION_ID'

const FULL_ARGS_LIMIT = 64 * 1024 * 1024

export const operationId = () => `op-${randomUUID()}`
/** This process's recorder identity: a pid alone can be reused. */
export const RECORDER_ID = randomUUID()

/** Lossless JSON (exact integers tagged, bytes as base64). */
export function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null, function (k, v) {
    const raw = this[k] // before Buffer#toJSON
    if (ArrayBuffer.isView(raw)) return { $bytes: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('base64') }
    return typeof v === 'bigint' ? { $layerfs: 'i64-v1', decimal: String(v) } : typeof v === 'function' ? undefined : v
  }))
}

/** Where a tool's operations belong, from its Pi entries: the assistant entry holding the call. */
export function toolEntry(manager, toolCallId) {
  const entries = manager?.getEntries?.() ?? []
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.type === 'message' && e.message?.role === 'assistant' && Array.isArray(e.message.content) && e.message.content.some((b) => b.type === 'toolCall' && b.id === toolCallId)) return e.id
  }
  return null
}

export function invocationContext(env = process.env) {
  if (!env[OPS_ENV]) return null
  try {
    const context = JSON.parse(env[CONTEXT_ENV] ?? '{}')
    return context && typeof context === 'object' ? context : null
  } catch { return null }
}

/**
 * @param {object} o
 * @param {(events: object[]) => void} o.write  durable append of events
 * @param {object} o.context  session_id, agent_id, native_session_id, entry_id, tool_call_id
 * @param {string} o.origin   sdk | cli | host
 * @param {(error: Error) => void} [o.onJournalError]
 */
export class OperationRecorder {
  constructor({ write, context = {}, origin, onJournalError = () => {}, artifact = null }) {
    Object.assign(this, { write, context, origin, onJournalError, artifact })
  }

  /**
   * Runs one call once and records it. `run(operationId)` performs the call.
   * @param {object} [o]
   * @param {string} [o.cause]  tool | session_boundary | lifecycle
   * @param {boolean} [o.required]  refuse to dispatch when the intent cannot be persisted
   * @param {(value: object) => Promise<object|null>|object|null} [o.mount]  confirmed mount facts for a Workspace call
   * @param {() => Promise<void>} [o.beforeDispatch]  e.g. commit the intent to the session branch
   * @param {object} [o.context]  per-invocation context overrides
   * @param {object} [o.execution]  machine, sandbox, workspace_instance and other execution facts
   */
  async record(method, args, run, o = {}) {
    const id = o.operationId ?? operationId()
    const context = { ...this.context, ...o.context }
    const full = plain(args)
    const fullText = JSON.stringify(full)
    const shown = shownArguments(args)
    const intent = newEvent('operation.intent', {
      operation_id: id,
      agent_id: context.agent_id ?? null,
      operation: {
        session_id: context.session_id ?? null,
        agent_id: context.agent_id ?? null,
        native_session_id: context.native_session_id ?? null,
        entry_id: context.entry_id ?? null,
        tool_call_id: context.tool_call_id ?? null,
        cause: o.cause ?? (context.tool_call_id ? 'tool' : 'lifecycle'),
        method,
        canonical: canonical(method),
        origin: this.origin,
        started_at: new Date().toISOString(),
        arguments: shown,
        ...(fullText.length <= FULL_ARGS_LIMIT && JSON.stringify(shown) !== fullText && this.artifact ? { arguments_artifact: this.artifact(Buffer.from(fullText)) } : {}),
        execution_context: { machine: null, sandbox: null, workspace_instance: null, ...o.execution, pid: process.pid, recorder: RECORDER_ID },
      },
    }, context.session_id ?? null)
    let persisted = true
    try { this.write([intent]) } catch (error) {
      persisted = false
      if (o.required) throw Object.assign(new Error(`The conversation journal could not record this operation before dispatch: ${error.message}`), { code: 'JournalUnavailable', status: 507 })
      this.onJournalError(error)
    }
    if (o.beforeDispatch && persisted) await o.beforeDispatch(id)
    const t0 = performance.now()
    let value, failure
    try { value = await run(id) } catch (error) { failure = error }
    let mount = null
    if (o.mount) {
      try { mount = (await o.mount(failure ? null : value)) ?? null } catch { mount = null }
    }
    const receipt = newEvent('operation.receipt', {
      operation_id: id,
      agent_id: context.agent_id ?? null,
      status: errorStatus(failure),
      ended_at: new Date().toISOString(),
      ms: Math.round((performance.now() - t0) * 1000) / 1000,
      ...(failure ? { error: errorFacts(failure) } : { value: plain(value) }),
      ...(mount ? { mount } : {}),
    }, context.session_id ?? null)
    try { if (persisted) this.write([receipt]) } catch (error) { this.onJournalError(error) }
    if (failure) throw failure
    return value
  }
}

/**
 * The recorder of a tool process, from its environment; null when the
 * invocation is not part of a conversation, or an outer recorder owns it.
 */
let processRecorder
export function recorderFromEnv(env = process.env, origin = 'sdk') {
  if (env[OPERATION_ENV]) return null
  const context = invocationContext(env)
  if (!context) return null
  if (processRecorder?.dir === env[OPS_ENV] && processRecorder.origin === origin) return processRecorder.recorder
  const dir = env[OPS_ENV]
  const file = join(dir, `${process.pid}-${randomBytes(6).toString('hex')}.jsonl`)
  const artifacts = join(dirname(dir), 'artifacts')
  let warned = false
  const recorder = new OperationRecorder({
    context, origin,
    write: (events) => {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      appendDurable(file, events.map((e) => `${eventLine(e, artifacts)}\n`).join(''))
    },
    artifact: (buffer) => writeArtifact(artifacts, buffer),
    onJournalError: (error) => {
      if (warned) return
      warned = true
      process.stderr.write(`connect: the conversation's LayerFS operation journal is unavailable (${error.message}); operations in this process are not recorded.\n`)
    },
  })
  processRecorder = { dir, origin, recorder }
  return recorder
}
