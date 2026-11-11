// Project-owned conversations (docs/specs/chat-session-store.md): each chat's
// journal, its operation recorders, saves to its project's session branch,
// reconciliation, copying, migration, the rebuildable catalog and portable
// reconstruction. AgentManager owns one ConversationSessions.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { SessionJournal, boundaries } from './journal.js'
import { OperationRecorder, OPS_ENV, CONTEXT_ENV, RECORDER_ID } from './recorder.js'
import { SessionStore, discoverSessions, loadSession, reconstructSession, writeNativeFiles, sessionBranch } from './store.js'
import { SessionCatalog } from './catalog.js'
import { projectIds, refKey, resolvePending, versionRef } from './operations.js'

const PAGE = 200
const FLUSH_DELAY = 1500
const MAX_WAIT = 15000
const BUSY_RETRIES = 5
const MIGRATE_DELAY = 5000
const MIGRATE_SPACING = 250
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })

/** Settings a conversation journals: no runtime handles, credentials or approval tokens. */
export function conversationMeta(record, chatDir) {
  const rel = (file) => (file ? relative(chatDir, file) : null)
  const ws = record.workspace
  return {
    id: record.id, title: record.title, project: record.project ?? null, runs: record.runs ?? null,
    created: record.created, archived: !!record.archived, archivedAt: record.archivedAt ?? null,
    provider: record.provider ?? null, modelId: record.modelId ?? null, thinkingLevel: record.thinkingLevel ?? null,
    limits: record.limits ?? null, permissionMode: record.permissionMode ?? null, forkedFrom: record.forkedFrom ?? null,
    sessionFile: rel(record.sessionFile),
    children: (record.children ?? []).map(({ id, runId, agent, task, state, startedAt, endedAt, sessionFile }) => ({ id, runId, agent, task, state, startedAt, endedAt, sessionFile: rel(sessionFile) })),
    workspace: ws ? { branch: ws.branch, fromRef: ws.fromRef ?? null, head: ws.head ?? null, baseLayer: ws.baseLayer ?? null, branchReady: !!ws.branchReady } : null,
  }
}

export const portable = (record) => !!record?.project && !record.simulation && !record.scenario

const ROW_ITEMS = 50
/** A tool's operations as Chat and Trace rows show them; counts are links, not new Commits. */
export function toolOperations(ops = []) {
  const links = ops.flatMap((o) => o.checkpoints ?? [])
  return {
    count: ops.length,
    links: links.length,
    created: links.filter((l) => l.effect === 'created' || l.effect === 'published').length,
    distinct: new Set(links.map((l) => refKey({ ...l.ref, branch_id: '' }))).size,
    unknown: ops.filter((o) => o.status === 'unknown').length,
    failed: ops.filter((o) => o.status === 'failed').length,
    running: ops.filter((o) => o.status === 'running').length,
    items: ops.slice(0, ROW_ITEMS).map((o) => ({ operation_id: o.operation_id, method: o.method, status: o.status, outcome: o.outcome, cause: o.cause, checkpoints: o.checkpoints, inputs: o.inputs, unresolved: o.unresolved, arguments: o.arguments, started_at: o.started_at, ms: o.ms })),
    truncated: ops.length > ROW_ITEMS,
  }
}

/** Each tool message of an agent with its recorded operations (`operations`). */
export function withOperations(messages, byTool, agent = 'root') {
  if (!byTool?.size || !messages?.length) return messages
  return messages.map((m) => {
    const ops = m.role === 'tool' ? byTool.get(`${agent}:${m.id}`) : null
    return ops ? { ...m, operations: toolOperations(ops) } : m
  })
}

const summaryOf = (op) => ({
  operation_id: op.operation_id, seq: op.seq, session_id: op.session_id ?? null, agent_id: op.agent_id ?? null, entry_id: op.entry_id ?? null,
  tool_call_id: op.tool_call_id ?? null, cause: op.cause ?? null, method: op.method, canonical: op.canonical ?? null, origin: op.origin ?? null,
  status: op.status, started_at: op.started_at ?? null, ended_at: op.ended_at ?? null, ms: op.ms ?? null, outcome: op.outcome ?? null,
  error: op.error ?? null, arguments: op.arguments ?? {}, inputs: op.inputs ?? [], checkpoints: op.checkpoints ?? [], pending: op.pending ?? [],
  unresolved: op.unresolved ?? null, execution_context: op.execution_context ?? null, mount_facts: op.mount_facts ?? null,
  inherited_from: op.inherited_from ?? null, missing_intent: !!op.missing_intent, reconciliation: op.reconciliation ?? null,
  receipt_preview: op.receipt_preview ?? null, has_receipt: !!op.receipt_event, arguments_artifact: op.arguments_artifact ?? null,
})

export class ConversationSessions {
  /**
   * @param {object} o
   * @param {string} o.dir     the chats folder
   * @param {string} o.state   the app's state folder (instance id, catalog)
   * @param {() => object|null} o.lfs  the host's own LayerFS client (untraced)
   */
  constructor({ dir, state, lfs = () => null, onStatus = () => {} }) {
    this.dir = dir
    this.lfsOf = lfs
    // told when a conversation's save state changes, so open views refresh (AgentManager)
    this.onStatus = onStatus
    this.lastStatus = new Map()
    this.journals = new Map()
    this.flushes = new Map()
    this.timers = new Map()
    this.lanes = new Map()
    this.busy = new Map()
    this.instanceId = this.instance(state)
    this.catalog = new SessionCatalog(join(state, 'session-index.sqlite'))
  }

  get lfs() { return this.lfsOf() }

  lane(key, work) {
    const previous = this.lanes.get(key) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(work)
    const settled = task.catch(() => {})
    this.lanes.set(key, settled)
    void settled.then(() => { if (this.lanes.get(key) === settled) this.lanes.delete(key) })
    return task
  }

  instance(state) {
    const file = join(state, 'connect-instance.json')
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).instance_id
    mkdirSync(state, { recursive: true })
    const instance_id = randomUUID()
    writeFileSync(file, JSON.stringify({ instance_id, created: new Date().toISOString() }), { mode: 0o600 })
    return instance_id
  }

  journal(id) {
    if (!this.journals.has(id)) this.journals.set(id, new SessionJournal(join(this.dir, id), id))
    return this.journals.get(id)
  }

  /** A loaded or new conversation's journal; an older local chat is imported with its gaps labelled. */
  ensure(record) {
    const chatDir = join(this.dir, record.id)
    const existed = SessionJournal.exists(chatDir)
    const journal = this.journal(record.id)
    if (!existed) {
      const legacy = !!record.sessionFile || (record.messages?.length ?? 0) > 0
      if (legacy) journal.append('migration.imported', { from: 'connect-local-chat', note: 'Imported from local chat history. Earlier LayerFS operations have no recorded receipts; diagnostic trace lines are not saved-version links.' })
      else journal.append('conversation.created', { created: record.created ?? Date.now() })
      if (record.forkedFrom?.sessionId && legacy) journal.append('copy.from', { source_session_id: record.forkedFrom.sessionId, entry_id: record.forkedFrom.entryId ?? null, legacy: true })
    }
    this.settleOrphans(record.id)
    return journal
  }

  /**
   * Recorder for calls the host dispatches for a conversation; context is per call.
   * `origin` is `cli` when the host runs a tool's explicit CLI command (simulations).
   */
  recorder(id, context = {}, origin = 'host') {
    const journal = this.journal(id)
    return new OperationRecorder({
      origin, context: { session_id: id, agent_id: 'host', ...context },
      write: (events) => journal.appendEvents(events), artifact: (b) => journal.artifact(b),
      onJournalError: (error) => this.storageError(id, 'journal', error),
    })
  }

  /** Environment that lets a tool process record into this conversation (recorder.js). */
  toolEnv(id, context) {
    return { [OPS_ENV]: join(this.dir, id, 'journal', 'ops'), [CONTEXT_ENV]: JSON.stringify({ session_id: id, ...context }) }
  }

  gap(id, reason, scope, extra = {}) {
    const journal = this.journal(id)
    const known = journal.fold().gaps.some((g) => g.scope === scope && g.reason === reason)
    if (!known) journal.append('coverage.gap', { reason, scope, ...extra })
  }

  storageError(id, scope, error) {
    try { this.journal(id).state.error = { code: error.code ?? 'Unknown', message: error.message, scope }; this.journal(id).saveState() } catch { /* reported by status */ }
  }

  /** A running intent whose recording process is gone has an unknown outcome, never a success. */
  settleOrphans(id) {
    const journal = this.journal(id)
    for (const op of journal.fold().operations.values()) {
      if (op.status !== 'running') continue
      if (op.execution_context?.recorder === RECORDER_ID) continue
      const pid = op.execution_context?.pid
      if (pid && pid !== process.pid) {
        try { process.kill(pid, 0); continue } catch { /* gone */ }
      }
      journal.append('operation.reconciled', { operation_id: op.operation_id, status: 'unknown', note: 'The recording process ended before a receipt was written. Inspect saved history before relying on or repeating this operation.', evidence: { pid } })
    }
  }

  /** Local capture: settings, Pi files of the conversation and its children, tool outputs. */
  capture(record) {
    const journal = this.journal(record.id)
    const chatDir = join(this.dir, record.id)
    const meta = conversationMeta(record, chatDir)
    const text = JSON.stringify(meta)
    if (journal.state.meta_text !== text) {
      journal.append('conversation.meta', { meta })
      journal.state.meta_text = text
      journal.saveState()
    }
    journal.capturePi(record.sessionFile, 'root')
    for (const child of record.children ?? []) if (child.sessionFile) journal.capturePi(child.sessionFile, `child-${child.id}`)
    journal.captureOutputs()
    journal.ingest()
    return journal
  }

  /** Saves the journal to the project's session branch; serialized per conversation. */
  flush(record, { reason = 'boundary', force = false } = {}) {
    const previous = this.flushes.get(record.id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      // a simulation's journal holds its recorded operations only: its scripted Pi files stay where the run keeps them
      const journal = record.simulation ? this.journal(record.id) : this.capture(record)
      const lfs = this.lfs
      // merge sources' kinds are read first (reads only), so their reconciliation is part of this save, not left pending after it
      if (lfs && record.project) await this.resolvePendingKinds(record).catch(() => {})
      if (!portable(record) || !lfs) { this.index(record); return this.status(record) }
      if (!force && journal.state.conflict) return this.status(record)
      try {
        // one session save per Store at a time from this host: conversations do not contend with each other
        await this.lane(record.project.split('/')[0], () => new SessionStore({ lfs, instanceId: this.instanceId }).flush(journal, record.project))
        this.busy.delete(record.id)
      } catch (error) {
        // a definite Busy refusal applied nothing; this journal write (not a user operation) is tried again, a bounded number of times
        if (error.code === 'Busy' || /Storage\(Busy\)/.test(error.message)) {
          const tries = (this.busy.get(record.id) ?? 0) + 1
          this.busy.set(record.id, tries)
          if (tries <= BUSY_RETRIES) this.schedule(record, 500 * tries)
        }
        if (reason === 'explicit') throw error
      }
      this.index(record)
      return this.status(record)
    })
    const settled = task.finally(() => { if (this.flushes.get(record.id) === settled) this.flushes.delete(record.id) })
    this.flushes.set(record.id, settled)
    return settled
  }

  /** Debounced flush at tool and turn boundaries; streaming text is batched, never longer than MAX_WAIT. */
  schedule(record, delay = FLUSH_DELAY) {
    const pending = this.timers.get(record.id)
    const first = pending?.first ?? Date.now()
    clearTimeout(pending?.timer)
    const wait = Math.max(0, Math.min(delay, first + MAX_WAIT - Date.now()))
    this.timers.set(record.id, { first, timer: setTimeout(() => {
      this.timers.delete(record.id)
      void this.flush(record).catch(() => {})
    }, wait).unref() })
  }

  /**
   * Saves conversations not yet in their project (older local chats), one at a
   * time after startup, so loading never bursts writes. Each keeps its labelled
   * migration gap; a failure stays in that conversation's status.
   */
  migrate(records, { delay = MIGRATE_DELAY, spacing = MIGRATE_SPACING } = {}) {
    // also a saved conversation with events recorded since (an orphaned intent settled at load), so its project copy catches up
    const queue = [...records].filter((r) => portable(r) && !this.journal(r.id).state.conflict && (!this.journal(r.id).state.store || this.journal(r.id).status().pending > 0))
    if (!queue.length || !this.lfs) return Promise.resolve([])
    const results = []
    this.migration = (async () => {
      await new Promise((r) => setTimeout(r, delay).unref())
      for (const record of queue) {
        if (this.closing) break
        results.push({ id: record.id, status: await this.flush(record).catch((e) => ({ state: 'failed', error: e.message })) })
        await new Promise((r) => setTimeout(r, spacing).unref())
      }
      return results
    })()
    return this.migration
  }

  /** Flushes every scheduled save now (app close). */
  async drain(records) {
    this.closing = true
    await Promise.allSettled([...this.flushes.values()])
    for (let attempt = 0; attempt <= BUSY_RETRIES && this.timers.size; attempt++) {
      const ids = [...this.timers.keys()]
      for (const id of ids) clearTimeout(this.timers.get(id).timer)
      this.timers.clear()
      if (attempt) await new Promise((r) => setTimeout(r, 300 * attempt))
      // a Busy save schedules itself again; the loop takes those until they pass or the bound ends
      await Promise.allSettled(ids.map((id) => records.get(id)).filter(Boolean).map((r) => this.flush(r)))
    }
    for (const { timer } of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /** Merge sources whose kind the receipt does not state: resolved through branch.get_commit, recorded as reconciliation. */
  async resolvePendingKinds(record) {
    const lfs = this.lfs
    if (!lfs) return
    const journal = this.journal(record.id)
    const tried = new Set(journal.state.kinds_tried ?? [])
    for (const op of journal.fold().operations.values()) {
      if (!op.pending?.length || op.status !== 'succeeded' || tried.has(op.operation_id)) continue
      const { inputs, failures } = await resolvePending(lfs, op.pending)
      journal.append('operation.reconciled', { operation_id: op.operation_id, inputs, note: failures.length ? 'Some merge source kinds could not be read; they stay unresolved.' : 'Merge source kinds read through branch.get_commit in each source branch.', evidence: { via: 'branch.get_commit', failures } })
      tried.add(op.operation_id)
    }
    // an unchanged file.* write on a branch without Commits names no version; while that branch still has no
    // head, its version is its base Layer (only a Commit moves a side branch off its fork base)
    for (const op of journal.fold().operations.values()) {
      const r = op.receipt_preview
      if (op.canonical !== 'fs.write_like' || op.status !== 'succeeded' || op.checkpoints?.length || r?.kind !== 'UpToDate' || r.head != null || tried.has(op.operation_id)) continue
      const project = op.arguments?.project, branch = r.branch ?? op.arguments?.branch
      tried.add(op.operation_id)
      let info
      try { info = await lfs.branch.get(project, branch) } catch { continue }
      if (info.head != null || !info.base) continue
      const ref = versionRef(project, branch, info.base, 'Layer')
      if (ref) journal.append('operation.reconciled', { operation_id: op.operation_id, checkpoints: [{ ref, effect: 'unchanged' }], unresolved: null, note: 'The branch still had no Commit, so the unchanged write left its base Layer.', evidence: { via: 'branch.get', head: null, base: info.base } })
    }
    journal.state.kinds_tried = [...tried]
    journal.saveState()
  }

  /**
   * Reconciles unknown outcomes without replay: a session save is checked on its
   * branch; a Workspace commit is found by its correlation token in saved history.
   */
  async reconcile(record) {
    const lfs = this.lfs
    if (!lfs) throw fail(503, 'LayerFS is not available in this host.')
    const journal = this.capture(record)
    const out = { session: null, operations: [] }
    if (portable(record) && journal.state.flush?.status === 'unknown' && journal.state.store) {
      out.session = await new SessionStore({ lfs, instanceId: this.instanceId }).reconcile(journal)
    }
    for (const op of journal.fold().operations.values()) {
      if (op.status !== 'unknown') continue
      const token = op.execution_context?.correlation_token
      const facts = op.mount_facts ?? op.execution_context?.mount ?? null
      if (op.method !== 'workspace.commit' || !token || !facts?.project || !facts.branch) {
        out.operations.push({ operation_id: op.operation_id, resolved: false, reason: 'No correlation evidence; the outcome stays unknown. Inspect History before repeating it.' })
        continue
      }
      const page = await lfs.branch.commits(facts.project, facts.branch, { page_size: 100 })
      const found = (page.items ?? []).find((c) => typeof c.message === 'string' && c.message.includes(token))
      if (found) {
        const ref = versionRef(facts.project, facts.branch, found.ref?.id ?? found.id, 'Commit')
        journal.append('operation.reconciled', { operation_id: op.operation_id, status: 'succeeded', checkpoints: [{ ref, effect: 'created' }], unresolved: null, note: 'A saved Commit carries this operation’s correlation token.', evidence: { via: 'branch.commits', commit: ref.commit_id } })
        out.operations.push({ operation_id: op.operation_id, resolved: true, ref })
      } else out.operations.push({ operation_id: op.operation_id, resolved: false, reason: 'No Commit among the branch’s newest 100 carries this token. It may not have saved, or saved nothing new; the outcome stays unknown.' })
    }
    this.index(record)
    // the conversation's status as every view reads it (portable, branch), not the journal's alone
    return { ...out, status: this.status(record) }
  }

  /** Explicit ownership takeover of this conversation's session branch (store.js adopt). */
  async adopt(record) {
    const lfs = this.lfs
    if (!lfs || !portable(record)) throw fail(409, 'This conversation is not saved to a project.')
    const journal = this.capture(record)
    await this.lane(record.project.split('/')[0], () => new SessionStore({ lfs, instanceId: this.instanceId }).adopt(journal, record.project))
    return this.flush(record, { reason: 'explicit', force: true })
  }

  status(record) {
    const journal = this.journal(record.id)
    const status = { ...journal.status(), portable: portable(record), local_only: portable(record) ? null : record.simulation ? 'simulation' : record.scenario ? 'scenario' : 'no-project', branch: journal.state.store?.branch ?? (portable(record) ? sessionBranch(record.id) : null) }
    // a conversation that is not saved to a project has only its local state to report
    const key = status.portable ? `${status.state}:${status.saved_through}:${status.pending}` : status.state
    if (this.lastStatus.has(record.id) && this.lastStatus.get(record.id) !== key) queueMicrotask(() => this.onStatus(record.id, status))
    this.lastStatus.set(record.id, key)
    return status
  }

  index(record) {
    const journal = this.journal(record.id)
    const seq = journal.lastSeq()
    if (this.catalog.indexedSeq(record.id) === seq) return
    this.catalog.index(record.id, record.project ?? null, [...journal.fold().operations.values()], seq)
  }

  /** Operations by tool call (root or child agent) for Chat summaries and Trace rows. */
  byTool(id) {
    const out = new Map()
    for (const op of this.journal(id).fold().operations.values()) {
      if (!op.tool_call_id) continue
      const key = `${op.agent_id ?? 'root'}:${op.tool_call_id}`
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(summaryOf(op))
    }
    return out
  }

  /** One filtered page, in stable ingestion order (newest last). */
  operations(record, query = {}) {
    const journal = this.journal(record.id)
    const folded = journal.fold()
    const filters = {
      agent: query.agent || null, tool: query.tool || null, method: query.method || null, status: query.status || null,
      project: query.project || null, branch: query.branch || null, linked: query.linked === '1' || query.linked === true,
      cause: query.cause || null,
    }
    let items = [...folded.operations.values()].sort((a, b) => a.seq - b.seq).filter((op) => {
      if (filters.agent && (op.agent_id ?? 'root') !== filters.agent) return false
      if (filters.tool && op.tool_call_id !== filters.tool) return false
      if (filters.method && op.method !== filters.method) return false
      if (filters.status && op.status !== filters.status) return false
      if (filters.cause && op.cause !== filters.cause) return false
      if (filters.linked && !op.checkpoints?.length) return false
      const refs = [...(op.checkpoints ?? []).map((l) => l.ref), ...(op.inputs ?? [])]
      if (filters.project && ![op.arguments?.project, op.mount_facts?.project, ...refs.map((r) => `${r.store_id}/${r.project_id}`)].includes(filters.project)) return false
      if (filters.branch && ![op.arguments?.branch, op.arguments?.name, op.mount_facts?.branch, ...refs.map((r) => r.branch_id)].includes(filters.branch)) return false
      return true
    })
    const total = items.length
    const limit = Math.max(1, Math.min(1000, Number(query.limit) || PAGE))
    // `from` pins the page's start, so a view paged back stays one contiguous range while newer operations arrive
    const start = query.from == null || query.from === '' ? null : Math.max(0, Math.min(total, Number(query.from) || 0))
    const end = start != null ? Math.min(total, start + limit) : query.before == null || query.before === '' ? total : Math.max(0, Math.min(total, Number(query.before)))
    const from = start ?? Math.max(0, end - limit)
    items = items.slice(from, end)
    const all = [...folded.operations.values()]
    return {
      items: items.map(summaryOf), total, from,
      facets: {
        agents: [...new Set(all.map((o) => o.agent_id ?? 'root'))].sort(),
        methods: [...new Set(all.map((o) => o.method))].sort(),
        projects: [...new Set(all.flatMap((o) => [o.arguments?.project, o.mount_facts?.project]).filter(Boolean))].sort(),
        statuses: [...new Set(all.map((o) => o.status))].sort(),
      },
      counts: { operations: all.length, links: all.reduce((n, o) => n + (o.checkpoints?.length ?? 0), 0), distinct_versions: new Set(all.flatMap((o) => (o.checkpoints ?? []).map((l) => refKey({ ...l.ref, branch_id: '' })))).size, unknown: all.filter((o) => o.status === 'unknown').length },
      coverage: { gaps: folded.gaps, conflicts: folded.conflicts },
      persistence: this.status(record),
    }
  }

  /** One operation with its exact arguments and receipt. */
  operation(record, operationId) {
    const journal = this.journal(record.id)
    const op = journal.fold().operations.get(operationId)
    if (!op) throw fail(404, 'This operation is not part of the conversation.')
    const event = op.receipt_event ? journal.events(false).find((e) => e.id === op.receipt_event) : null
    const receipt = event ? journal.expand(event) : null
    const args = op.arguments_artifact ? journal.readArtifact(op.arguments_artifact) : null
    return { ...summaryOf(op), receipt: receipt ? { value: receipt.value ?? null, error: receipt.error ?? null, mount: receipt.mount ?? null, missing: receipt.missing ?? null } : null, full_arguments: args ? JSON.parse(args.toString('utf8')) : null }
  }

  /** Restore boundaries this conversation saved: `before` a user message, with the workspace version. */
  boundaries(record) {
    const folded = this.journal(record.id).fold()
    const file = record.sessionFile ? relative(join(this.dir, record.id), record.sessionFile) : null
    return boundaries((folded.pi.get(file)?.lines ?? []).filter(Boolean))
  }

  /** Producing and referencing operations of one saved version, across this home's conversations of the project. */
  versionLinks(records, project, commit) {
    const ids = projectIds(project)
    if (!ids) throw fail(400, 'Name a project as <store>/<project>.')
    for (const record of records) if (record.project === project || existsSync(join(this.dir, record.id, 'journal'))) this.index(record)
    const rows = this.catalog.forVersion({ ...ids, commit_id: commit })
    // an imported conversation keeps its origin names; its explicit binding maps them to this project
    const bound = records.filter((r) => r.project === project && this.journal(r.id).state.binding?.to === project)
    for (const from of new Set(bound.map((r) => this.journal(r.id).state.binding.from))) {
      const origin = projectIds(from)
      const sessions = new Set(bound.filter((r) => this.journal(r.id).state.binding.from === from).map((r) => r.id))
      rows.push(...this.catalog.forVersion({ ...origin, commit_id: commit }).filter((r) => sessions.has(r.session_id)).map((r) => ({ ...r, bound_from: from })))
    }
    const titled = (r) => ({ ...r, title: records.find((x) => x.id === r.session_id)?.title ?? null })
    return {
      producers: rows.filter((r) => r.role === 'output' && ['created', 'published'].includes(r.effect)).map(titled),
      references: rows.filter((r) => !(r.role === 'output' && ['created', 'published'].includes(r.effect))).map(titled),
      backend: this.catalog.backend,
    }
  }

  /** A copy keeps its source's operations with their original identities, plus the copy relationship. */
  copy(sourceId, targetId, { entryId = null, position = null } = {}) {
    const source = this.journal(sourceId)
    const target = this.journal(targetId)
    source.ingest()
    const inherited = source.events(false).filter((e) => e.type.startsWith('operation.') || e.type === 'coverage.gap' || e.type === 'migration.imported').map((e) => source.expand(e))
    const events = [
      { v: 1, id: randomUUID(), type: 'copy.from', session_id: targetId, at: new Date().toISOString(), source_session_id: sourceId, entry_id: entryId, position, source_last_seq: source.lastSeq() },
      ...inherited.map(({ seq, spilled, ...e }) => ({ ...e, inherited_from: e.inherited_from ?? sourceId })),
    ]
    for (const e of inherited) for (const id of [e.operation?.arguments_artifact].filter(Boolean)) {
      const body = source.readArtifact(id)
      if (body) target.artifact(body)
    }
    target.appendEvents(events)
  }

  forget(id) {
    clearTimeout(this.timers.get(id)?.timer)
    this.timers.delete(id)
    this.journals.delete(id)
    this.catalog.drop(id)
  }

  /** Session journals saved in a project, verified by manifest, with which ones this home already has. */
  async discover(project, localIds) {
    const lfs = this.lfs
    if (!lfs) throw fail(503, 'LayerFS is not available in this host.')
    return (await discoverSessions(lfs, project)).map((s) => ({ ...s, local: localIds.has(s.session_id) }))
  }

  /**
   * Rebuilds a conversation from its project on a fresh local folder. A
   * different Store/project name needs an explicit binding from the manifest's
   * origin; identical names are never joined implicitly across homes.
   */
  async import(project, sessionId, { binding = null, exists = () => false } = {}) {
    const lfs = this.lfs
    if (!lfs) throw fail(503, 'LayerFS is not available in this host.')
    if (exists(sessionId)) throw fail(409, 'This conversation is already in this home.')
    const found = (await discoverSessions(lfs, project)).find((s) => s.session_id === sessionId)
    if (!found) throw fail(404, 'No saved conversation with this id in the project.')
    if (!found.valid) throw fail(409, `The saved conversation cannot be verified: ${found.problem}`)
    const origin = found.manifest.project
    const here = projectIds(project)
    let map = null
    if (origin && (origin.store_id !== here.store_id || origin.project_id !== here.project_id)) {
      if (!binding || binding.from !== `${origin.store_id}/${origin.project_id}` || binding.to !== project) throw fail(409, `This conversation was saved in ${origin.store_id}/${origin.project_id}. Importing it under ${project} needs an explicit binding from that origin.`, 'BindingRequired')
      map = { from: binding.from, to: project }
    } else if (found.manifest.binding?.to === project && projectIds(found.manifest.binding.from)) {
      // saved here after an explicit binding: its references keep that origin, so the recorded binding carries over
      map = { from: found.manifest.binding.from, to: project }
    }
    const chatDir = join(this.dir, sessionId)
    mkdirSync(chatDir, { recursive: true })
    const saved = await loadSession(lfs, project, found.branch)
    const { missing } = await reconstructSession(saved, chatDir, { store: { project, branch: found.branch, head: found.head, created_at: found.manifest.created_at, base_ref: found.manifest.base_ref } })
    this.journals.delete(sessionId)
    const journal = this.journal(sessionId)
    const folded = journal.fold()
    writeNativeFiles(folded, chatDir, (id) => journal.readArtifact(id))
    const meta = folded.meta ?? {}
    journal.state.meta_text = JSON.stringify(meta)
    journal.state.binding = map
    journal.saveState()
    return { meta, chatDir, missing, binding: map, branch: found.branch }
  }
}
