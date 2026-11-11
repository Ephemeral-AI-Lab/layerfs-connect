// A conversation's journal (docs/specs/chat-session-store.md): append-only,
// versioned events with unique IDs, kept locally as a write-ahead log until
// they are saved to the project's session branch (store.js).
//
//   <chat>/journal/pending.jsonl   every event the host ingested, with its seq
//   <chat>/journal/ops/*.jsonl     events written by tool processes (recorder.js),
//                                  one file per process, ingested by the host
//   <chat>/journal/artifacts/<id>  content-addressed bodies: large receipts,
//                                  spilled events, tool outputs
//   <chat>/journal/state.json      sequence, capture offsets and save state
//
// The local log is never treated as a disposable cache while it holds events
// newer than `saved_through`. Sequence numbers give stable pagination order;
// they are not filesystem ancestry.
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { join, relative } from 'node:path'
import { normalize } from './operations.js'

export const SCHEMA = 'connect.session.journal/1'
export const VERSION = 1
/** No journal line exceeds this; LayerFS file reads window long lines. */
export const MAX_LINE = 32 * 1024
export const CHECKPOINT_TYPE = 'connect.user-checkpoint'

/** Append and fsync, so a recorded intent survives a crash of this process. */
export function appendDurable(file, text) {
  const fd = openSync(file, 'a', 0o600)
  try {
    const buffer = Buffer.from(text)
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/** Writes a content-addressed artifact into `dir` once; answers its id. */
export function writeArtifact(dir, buffer) {
  const id = sha256(buffer)
  const file = join(dir, id)
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(`${file}.${process.pid}.tmp`, buffer, { mode: 0o600 })
    renameSync(`${file}.${process.pid}.tmp`, file)
  }
  return id
}

const HEADER_FIELDS = ['v', 'id', 'seq', 'type', 'session_id', 'at', 'agent_id', 'operation_id', 'inherited_from']

/** One event as a bounded line; a larger event keeps its header and spills its payload to an artifact. */
export function eventLine(event, artifacts) {
  const line = JSON.stringify(event)
  if (Buffer.byteLength(line) <= MAX_LINE) return line
  const header = Object.fromEntries(HEADER_FIELDS.filter((k) => event[k] !== undefined).map((k) => [k, event[k]]))
  const payload = Object.fromEntries(Object.entries(event).filter(([k]) => !HEADER_FIELDS.includes(k)))
  return JSON.stringify({ ...header, spilled: writeArtifact(artifacts, Buffer.from(JSON.stringify(payload))) })
}

export const newEvent = (type, payload, sessionId) => ({ v: VERSION, id: randomUUID(), type, session_id: sessionId, at: new Date().toISOString(), ...payload })

function readLines(file, from = 0) {
  if (!existsSync(file)) return { lines: [], offset: from }
  const size = statSync(file).size
  if (size <= from) return { lines: [], offset: size < from ? 0 : from, truncated: size < from }
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(size - from)
    let read = 0
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, from + read)
      if (!n) break
      read += n
    }
    const end = buffer.lastIndexOf(0x0a, read - 1)
    if (end < 0) return { lines: [], offset: from }
    return { lines: buffer.subarray(0, end).toString('utf8').split('\n').filter(Boolean), offset: from + end + 1 }
  } finally { closeSync(fd) }
}

const defaultState = () => ({ schema: SCHEMA, next_seq: 1, saved_through: 0, ingested: {}, pi: {}, outputs: {}, store: null, flush: null, error: null, conflict: null })

export class SessionJournal {
  /** @param {string} chatDir the conversation's local folder; @param {string} sessionId */
  constructor(chatDir, sessionId) {
    this.chatDir = chatDir
    this.sessionId = sessionId
    this.dir = join(chatDir, 'journal')
    this.opsDir = join(this.dir, 'ops')
    this.artifacts = join(this.dir, 'artifacts')
    this.pendingFile = join(this.dir, 'pending.jsonl')
    this.stateFile = join(this.dir, 'state.json')
    mkdirSync(this.opsDir, { recursive: true, mode: 0o700 })
    mkdirSync(this.artifacts, { recursive: true, mode: 0o700 })
    this.state = existsSync(this.stateFile) ? { ...defaultState(), ...JSON.parse(readFileSync(this.stateFile, 'utf8')) } : defaultState()
    this.cache = { offset: 0, events: [], ids: new Set() }
    this.folded = null
  }

  static exists(chatDir) { return existsSync(join(chatDir, 'journal', 'state.json')) }

  saveState() {
    writeFileSync(`${this.stateFile}.tmp`, JSON.stringify(this.state), { mode: 0o600 })
    renameSync(`${this.stateFile}.tmp`, this.stateFile)
  }

  /** Durable before it returns; the event's seq is its ingestion order. */
  append(type, payload = {}) {
    return this.appendEvent(newEvent(type, payload, payload.session_id ?? this.sessionId))
  }

  appendEvent(event) { return this.appendEvents([event])[0] }

  /** Several events with one fsync and one state write. */
  appendEvents(events) {
    if (!events.length) return []
    const stamped = events.map((event, i) => ({ ...event, seq: this.state.next_seq + i }))
    appendDurable(this.pendingFile, stamped.map((e) => `${eventLine(e, this.artifacts)}\n`).join(''))
    this.state.next_seq += stamped.length
    this.saveState()
    return stamped
  }

  artifact(buffer) { return writeArtifact(this.artifacts, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)) }
  readArtifact(id) {
    const file = join(this.artifacts, id)
    return /^[0-9a-f]{64}$/.test(id) && existsSync(file) ? readFileSync(file) : null
  }

  /** Moves new tool-process events into the log; a repeated event id is folded once. */
  ingest() {
    let changed = false
    const known = new Set(this.knownIds())
    for (const name of readdirSync(this.opsDir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const file = join(this.opsDir, name)
      const { lines, offset } = readLines(file, this.state.ingested[name] ?? 0)
      for (const raw of lines) {
        let event
        try { event = JSON.parse(raw) } catch { continue }
        if (!event?.id || known.has(event.id)) continue
        known.add(event.id)
        const stamped = { ...event, seq: this.state.next_seq++ }
        appendDurable(this.pendingFile, `${eventLine(stamped, this.artifacts)}\n`)
        changed = true
      }
      if (offset !== (this.state.ingested[name] ?? 0)) { this.state.ingested[name] = offset; changed = true }
    }
    if (changed) this.saveState()
    return changed
  }

  knownIds() { this.events(false); return this.cache.ids }

  /** Every ingested event in seq order, spilled payloads restored. */
  events(ingest = true) {
    if (ingest) this.ingest()
    const { lines, offset } = readLines(this.pendingFile, this.cache.offset)
    for (const raw of lines) {
      let event
      try { event = JSON.parse(raw) } catch { continue }
      if (this.cache.ids.has(event.id)) continue
      this.cache.ids.add(event.id)
      this.cache.events.push(event)
      this.folded = null
    }
    this.cache.offset = offset
    return this.cache.events
  }

  /** An event with any spilled payload restored (or `missing` when its artifact is absent). */
  expand(event) {
    if (!event.spilled) return event
    const body = this.readArtifact(event.spilled)
    return body ? { ...event, ...JSON.parse(body.toString('utf8')) } : { ...event, missing: event.spilled }
  }

  fold() {
    const events = this.events()
    if (!this.folded || this.folded.count !== events.length) this.folded = { count: events.length, value: fold(events.map((e) => this.expand(e)), (id) => this.readArtifact(id)) }
    return this.folded.value
  }

  lastSeq() { return this.state.next_seq - 1 }

  /** Captures new complete lines of a Pi session file; a rewritten file starts a new generation. */
  capturePi(file, agentId) {
    if (!file || !existsSync(file)) return 0
    const rel = relative(this.chatDir, file)
    if (rel.startsWith('..')) return 0
    const known = this.state.pi[rel] ?? { offset: 0, lines: 0, generation: 0, prefix_sha: null }
    const body = readFileSync(file)
    // Pi appends; any change to the bytes already captured (a clone, a rewrite, a truncation) starts a new generation
    const rewritten = known.offset > 0 && (body.length < known.offset || sha256(body.subarray(0, known.offset)) !== known.prefix_sha)
    const events = []
    if (rewritten) {
      Object.assign(known, { generation: known.generation + 1, offset: 0, lines: 0 })
      events.push(newEvent('pi.rewrite', { agent_id: agentId, file: rel, generation: known.generation }, this.sessionId))
    }
    // only complete lines: a line being written is taken next time
    const end = body.lastIndexOf(0x0a)
    const lines = end < known.offset ? [] : body.subarray(known.offset, end).toString('utf8').split('\n').filter(Boolean)
    for (const raw of lines) {
      let line
      try { line = JSON.parse(raw) } catch { line = { connect_unparsed: raw } }
      events.push(newEvent('pi.line', { agent_id: agentId, file: rel, generation: known.generation, index: known.lines++, line }, this.sessionId))
    }
    if (end >= known.offset) {
      known.offset = end + 1
      known.prefix_sha = sha256(body.subarray(0, known.offset))
    }
    this.state.pi[rel] = known
    this.appendEvents(events)
    this.saveState()
    return lines.length
  }

  /** Tool outputs as artifacts; a grown output records its newer body. */
  captureOutputs() {
    const dir = join(this.chatDir, 'tool-output')
    if (!existsSync(dir)) return 0
    let n = 0
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.log'))) {
      const file = join(dir, name)
      const { size, mtimeMs } = statSync(file)
      const stamp = `${size}:${mtimeMs}`
      if (this.state.outputs[name] === stamp) continue
      const artifact = this.artifact(readFileSync(file))
      this.append('artifact.ref', { kind: 'tool-output', path: `tool-output/${name}`, artifact, bytes: size })
      this.state.outputs[name] = stamp
      n++
    }
    if (n) this.saveState()
    return n
  }

  /** Locally recorded / saved to project / save-unknown, and why when not saved. */
  status() {
    const last = this.lastSeq()
    const s = this.state
    const state = s.conflict ? 'conflict' : s.flush?.status === 'unknown' ? 'save-unknown' : s.flush?.status === 'saving' ? 'saving' : s.error ? 'failed' : !s.store ? 'local' : s.saved_through >= last ? 'saved' : 'local'
    return { state, last_seq: last, saved_through: s.saved_through, pending: Math.max(0, last - s.saved_through), store: s.store, flush: s.flush, error: s.error, conflict: s.conflict }
  }
}

/** Workspace facts confirmed by earlier receipts: Sandbox -> project, ws -> branch. */
function mountIndex() {
  const sandboxes = new Map(), mounts = new Map()
  return {
    sandboxes, mounts,
    observe(op, value) {
      if (op.status !== 'succeeded') return
      const args = op.arguments ?? {}
      if (op.method === 'sandbox.create') sandboxes.set(value?.name ?? args.name, args.project ?? value?.project)
      if (op.method === 'workspace.mount') {
        const sandbox = args.sandbox ?? value?.sandbox
        const facts = { project: sandboxes.get(sandbox) ?? op.execution_context?.project ?? null, branch: value?.branch ?? args.branch, base_layer: value?.base_layer ?? null }
        for (const ws of [value?.ws, value?.path && `${sandbox}:${value.path}`, value?.name && `${sandbox}:${value.name}`]) if (ws) mounts.set(ws, facts)
      }
      if (op.method === 'workspace.unmount') mounts.delete(args.ws)
    },
  }
}

const TERMINAL = new Set(['succeeded', 'failed', 'unknown'])

/**
 * Folds events into the logical records: operations by id with their typed
 * links, Pi files by generation, settings, copies and coverage gaps.
 */
export function fold(events, readArtifact = () => null) {
  const operations = new Map()
  const pi = new Map()
  const outputs = new Map()
  const gaps = []
  const copies = []
  const conflicts = []
  let meta = null
  const mounts = mountIndex()
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'operation.intent') {
      if (operations.has(e.operation_id)) continue
      operations.set(e.operation_id, { ...e.operation, operation_id: e.operation_id, seq: e.seq, status: 'running', checkpoints: [], inputs: [], pending: [], unresolved: null, inherited_from: e.inherited_from ?? null })
    } else if (e.type === 'operation.receipt') {
      const op = operations.get(e.operation_id) ?? { operation_id: e.operation_id, seq: e.seq, method: e.method, missing_intent: true, checkpoints: [], inputs: [], pending: [] }
      operations.set(e.operation_id, op)
      if (TERMINAL.has(op.status) && op.receipt_event) {
        if (op.receipt_event !== e.id && op.status !== e.status) conflicts.push({ operation_id: e.operation_id, kept: op.receipt_event, ignored: e.id })
        continue
      }
      const value = e.value ?? (e.receipt_artifact ? parseArtifact(readArtifact(e.receipt_artifact)) : null)
      const mount = e.mount ?? (op.method === 'workspace.commit' ? mounts.mounts.get(op.arguments?.ws) ?? null : null)
      const typed = normalize({ method: op.method, args: op.arguments ?? {}, value, error: e.error, mount })
      Object.assign(op, {
        status: e.status ?? typed.status, ended_at: e.ended_at, ms: e.ms ?? null, outcome: typed.outcome, error: e.error ?? null,
        checkpoints: typed.checkpoints, inputs: typed.inputs, pending: typed.pending, unresolved: typed.unresolved,
        receipt_artifact: e.receipt_artifact ?? null, receipt_preview: e.value ? preview(e.value) : null, receipt_event: e.id,
        mount_facts: mount, value_missing: !value && !e.error,
      })
      mounts.observe(op, value)
    } else if (e.type === 'operation.reconciled') {
      const op = operations.get(e.operation_id)
      if (!op) continue
      if (e.status && !['succeeded', 'failed'].includes(op.status)) op.status = e.status
      if (e.checkpoints) op.checkpoints = e.checkpoints
      if (e.inputs) {
        op.inputs = [...op.inputs, ...e.inputs]
        op.pending = op.pending.filter((p) => !e.inputs.some((i) => i.commit_id === p.commit && i.branch_id === p.branch))
      }
      if (e.unresolved !== undefined) op.unresolved = e.unresolved
      op.reconciliation = [...(op.reconciliation ?? []), { at: e.at, note: e.note ?? null, evidence: e.evidence ?? null }]
    } else if (e.type === 'pi.line') {
      const file = pi.get(e.file) ?? { agent_id: e.agent_id, generation: -1, lines: [] }
      if (e.generation > file.generation) Object.assign(file, { generation: e.generation, lines: [] })
      if (e.generation === file.generation) file.lines[e.index] = e.line
      pi.set(e.file, file)
    } else if (e.type === 'artifact.ref' && e.kind === 'tool-output') outputs.set(e.path, { artifact: e.artifact, bytes: e.bytes })
    else if (e.type === 'conversation.meta') meta = e.meta
    else if (e.type === 'coverage.gap') gaps.push({ seq: e.seq, at: e.at, reason: e.reason, scope: e.scope ?? null, operation_id: e.operation_id ?? null })
    else if (e.type === 'copy.from') copies.push({ source_session_id: e.source_session_id, entry_id: e.entry_id ?? null, position: e.position ?? null, at: e.at })
    else if (e.type === 'migration.imported') gaps.push({ seq: e.seq, at: e.at, reason: e.note ?? 'Imported from local chat history; earlier operations have no recorded receipts.', scope: 'migration' })
  }
  return { operations, pi, outputs, meta, gaps, copies, conflicts }
}

function parseArtifact(buffer) {
  if (!buffer) return null
  try { return JSON.parse(buffer.toString('utf8')) } catch { return null }
}

/** A small view of a receipt for lists; the full receipt is kept losslessly. */
function preview(value) {
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v.length > 200 ? `${v.slice(0, 199)}…` : v
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    else if (Array.isArray(v)) out[`${k}_count`] = v.length
  }
  return out
}

/** Boundary data from Pi's checkpoint entries: `before` the next user message. */
export function boundaries(lines) {
  const out = []
  const byParent = new Map()
  for (const line of lines) if (line?.parentId) byParent.set(line.parentId, [...(byParent.get(line.parentId) ?? []), line])
  for (const line of lines) {
    if (line?.type !== 'custom' || line.customType !== CHECKPOINT_TYPE || !line.data?.checkpoint) continue
    const user = (byParent.get(line.id) ?? []).find((child) => child.type === 'message' && child.message?.role === 'user')
    out.push({ anchor_entry_id: line.id, entry_id: user?.id ?? null, position: 'before', workspace_ref: line.data.checkpoint.workspace_ref ?? null, operation_id: line.data.checkpoint.operation_id ?? null, legacy: !line.data.checkpoint.workspace_ref })
  }
  return out
}
