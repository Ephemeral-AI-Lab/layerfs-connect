// A conversation's journal saved in its LayerFS project (docs/specs/chat-session-store.md):
// one application-managed branch per conversation, `connect.session.<id>`,
// forked from the project's main Layer. Connect writes only its reserved subtree:
//
//   /.connect/session/manifest.json            identity, owner and save cursor
//   /.connect/session/segments/<from>-<to>.jsonl  immutable bounded event segments
//   /.connect/session/artifacts/<sha256>.b64      content-addressed bodies (base64 lines)
//
// Each segment and the manifest change in one `file.apply`. There is no
// transaction with code branches; a lost reply is reconciled by reading the
// branch, never by assuming. Session-storage calls go through the host's own
// client: they are not user operations and are never traced as such.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { errorFacts, errorStatus, projectIds } from './operations.js'
import { SCHEMA as JOURNAL_SCHEMA, sha256 } from './journal.js'

export const SESSION_PREFIX = 'connect.session.'
export const MANIFEST_SCHEMA = 'connect.session/1'
export const ROOT = '/.connect/session'
export const MANIFEST = `${ROOT}/manifest.json`
const SEGMENT_EVENTS = 500
const SEGMENT_BYTES = 256 * 1024
const APPLY_BYTES = 1024 * 1024

export const sessionBranch = (sessionId) => `${SESSION_PREFIX}${String(sessionId).toLowerCase()}`
export const isSessionBranch = (name) => typeof name === 'string' && name.startsWith(SESSION_PREFIX)
const pad = (n) => String(n).padStart(12, '0')
export const segmentPath = (from, to) => `${ROOT}/segments/${pad(from)}-${pad(to)}.jsonl`
export const artifactPath = (id) => `${ROOT}/artifacts/${id}.b64`
const notFound = (error) => ['NoSuchBranch', 'NotFound', 'NoSuchPath', 'NoSuchFile', 'NoSuchEntry'].includes(error?.code)

const base64Lines = (buffer) => (buffer.toString('base64').match(/.{1,76}/g) ?? ['']).join('\n') + '\n'

/** Whole text of a saved file, through LayerFS's bounded line windows. */
export async function readText(lfs, project, branch, path, commit) {
  let start = 1, out = ''
  for (;;) {
    const page = await lfs.file.read(project, branch, path, commit, { start_line: start })
    if (page.line_truncated) throw Object.assign(new Error(`${path} has a line longer than one LayerFS read window.`), { code: 'Capacity' })
    out += page.text ?? ''
    if (!page.truncated || page.next_line == null) return out
    start = Number(page.next_line)
  }
}

export async function readManifest(lfs, project, branch, commit) {
  try { return JSON.parse(await readText(lfs, project, branch, MANIFEST, commit)) } catch (error) {
    if (notFound(error)) return null
    throw error
  }
}

/** Events referencing artifacts: spilled payloads, tool outputs, full arguments. */
function artifactsOf(event) {
  return [event.spilled, event.artifact, event.receipt_artifact, event.operation?.arguments_artifact].filter((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))
}

/** Event lines in bounded segments (by count and bytes). */
function segments(lines) {
  const out = []
  let current = null
  for (const { seq, text } of lines) {
    const bytes = Buffer.byteLength(text) + 1
    if (!current || current.events >= SEGMENT_EVENTS || current.bytes + bytes > SEGMENT_BYTES) out.push(current = { from: seq, to: seq, events: 0, bytes: 0, text: '' })
    current.to = seq
    current.events++
    current.bytes += bytes
    current.text += `${text}\n`
  }
  return out
}

export class SessionStore {
  /** @param {{ lfs: object, instanceId: string }} o */
  constructor({ lfs, instanceId }) {
    this.lfs = lfs
    this.instanceId = instanceId
  }

  manifest(journal, project, extra = {}) {
    const s = journal.state
    return {
      schema: MANIFEST_SCHEMA, journal_schema: JOURNAL_SCHEMA, app: 'layerfs-connect',
      session_id: journal.sessionId, owner: { instance_id: this.instanceId },
      project: projectIds(project), created_at: s.store?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
      base_ref: s.store?.base_ref ?? null, last_seq: s.saved_through,
      // references keep their origin names; a recorded binding maps them to this project
      binding: s.binding ?? null, ...extra,
    }
  }

  /** The session branch, made on first save; an existing one must be this conversation's and this owner's. */
  async ensureBranch(journal, project) {
    const s = journal.state
    // ownership is verified once per owner; a journal rebuilt from another installation is not owned until adopted
    if (s.store?.project === project && s.store.branch && s.store.owner === this.instanceId) return s.store
    const branch = sessionBranch(journal.sessionId)
    let info
    try { info = await this.lfs.branch.get(project, branch) } catch (error) { if (!notFound(error)) throw error }
    if (info) {
      const manifest = await readManifest(this.lfs, project, branch)
      if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.session_id !== journal.sessionId) throw this.conflict(journal, 'A branch with this conversation’s session name exists but is not its verified session journal.', { branch })
      if (manifest.owner?.instance_id !== this.instanceId) throw this.conflict(journal, 'This conversation’s session branch is owned by another Connect installation. Take over ownership explicitly to continue saving here.', { branch, owner: manifest.owner })
      // a head this journal did not record stays for checkHead to judge
      s.store = { project, branch, head: s.store?.branch === branch ? s.store.head : info.head ?? null, created_at: manifest.created_at, base_ref: manifest.base_ref, owner: this.instanceId }
      s.saved_through = Math.max(s.saved_through, Number(manifest.last_seq) || 0)
    } else {
      const forked = await this.lfs.branch.fork(project, branch, 'main')
      s.store = { project, branch, head: forked.head ?? null, created_at: new Date().toISOString(), base_ref: { ...projectIds(project), branch_id: 'main', commit_id: forked.base, version_kind: 'Layer' }, owner: this.instanceId }
    }
    journal.saveState()
    return s.store
  }

  conflict(journal, message, detail = {}) {
    journal.state.conflict = { message, detail, at: new Date().toISOString() }
    journal.saveState()
    return Object.assign(new Error(message), { code: 'SessionOwnership', status: 409 })
  }

  /** A save whose reply was lost: its segment is on the branch, or it was not applied. */
  async reconcile(journal) {
    const s = journal.state
    const flush = s.flush
    if (!flush || flush.status !== 'unknown') return { reconciled: false }
    let present = null
    try { present = await readText(this.lfs, s.store.project, s.store.branch, flush.path) } catch (error) { if (!notFound(error)) throw error }
    if (present !== null && sha256(Buffer.from(present)) === flush.sha256) {
      const info = await this.lfs.branch.get(s.store.project, s.store.branch)
      Object.assign(s, { saved_through: Math.max(s.saved_through, flush.to), flush: null, error: null })
      s.store.head = info.head ?? s.store.head
      journal.saveState()
      return { reconciled: true, applied: true }
    }
    // our own idempotent data write: not on the branch, so it may be written again
    s.flush = null
    journal.saveState()
    return { reconciled: true, applied: false }
  }

  /** The head must still be the one this owner last saved. */
  async checkHead(journal) {
    const s = journal.state
    const info = await this.lfs.branch.get(s.store.project, s.store.branch)
    const head = info.head ?? null
    if (head === s.store.head) return
    const manifest = await readManifest(this.lfs, s.store.project, s.store.branch)
    if (manifest?.owner?.instance_id === this.instanceId && manifest.session_id === journal.sessionId && Number(manifest.last_seq) === s.saved_through) {
      s.store.head = head
      journal.saveState()
      return
    }
    throw this.conflict(journal, 'The session branch changed outside this conversation’s owner; refusing to publish divergent history.', { expected: s.store.head, found: head, manifest_last_seq: manifest?.last_seq ?? null })
  }

  /**
   * Saves every journal event not yet saved, with the artifacts they need.
   * @returns {Promise<object>} the journal's status
   */
  async flush(journal, project) {
    const s = journal.state
    if (s.conflict) throw Object.assign(new Error(s.conflict.message), { code: 'SessionOwnership', status: 409 })
    journal.ingest()
    try {
      await this.ensureBranch(journal, project)
      await this.reconcile(journal)
      await this.checkHead(journal)
      const events = journal.events(false).filter((e) => e.seq > s.saved_through)
      if (!events.length) { s.error = null; journal.saveState(); return journal.status() }
      await this.saveArtifacts(journal, events)
      const lines = events.map((e) => ({ seq: e.seq, text: JSON.stringify(e) }))
      for (const segment of segments(lines)) {
        const path = segmentPath(segment.from, segment.to)
        s.flush = { status: 'saving', from: segment.from, to: segment.to, path, sha256: sha256(Buffer.from(segment.text)), at: new Date().toISOString() }
        journal.saveState()
        let value
        try {
          value = await this.lfs.file.apply(project, s.store.branch, [
            // a write needs its parent; mkdir makes missing parents and keeps existing ones
            { op: 'mkdir', path: `${ROOT}/segments` },
            { op: 'write', path, content: segment.text },
            { op: 'write', path: MANIFEST, content: `${JSON.stringify(this.manifest(journal, project, { last_seq: segment.to, last_segment: path }), null, 2)}\n` },
          ], { message: `[connect-session:${journal.sessionId}] journal ${segment.from}-${segment.to}` })
        } catch (error) {
          if (errorStatus(error) === 'unknown') s.flush = { ...s.flush, status: 'unknown', error: errorFacts(error) }
          else Object.assign(s, { flush: null, error: errorFacts(error) })
          journal.saveState()
          throw error
        }
        // file.apply has no expected-head condition; its receipt's parent proves whether another writer came between
        const expected = s.store.head ?? null
        const parent = value.commit && 'parent' in value.commit ? value.commit.parent ?? null : expected
        Object.assign(s, { saved_through: segment.to, flush: null, error: null })
        s.store.head = value.head ?? s.store.head
        journal.saveState()
        if (parent !== expected) throw this.conflict(journal, 'Another writer saved to this conversation’s session branch between the ownership check and this save. This save landed on top of it; further saves are refused until ownership is resolved.', { expected, parent, head: value.head })
      }
      return journal.status()
    } catch (error) {
      if (error.code !== 'SessionOwnership' && !s.flush && !s.error) { s.error = errorFacts(error); journal.saveState() }
      throw error
    }
  }

  /**
   * Explicit ownership takeover (one owner per conversation). Allowed only when
   * the branch holds nothing this journal lacks: the saved manifest's cursor is
   * at or behind this journal's own saved cursor. Otherwise histories diverged;
   * import the saved conversation as a separate copy instead.
   */
  async adopt(journal, project) {
    const s = journal.state
    const branch = s.store?.branch ?? sessionBranch(journal.sessionId)
    const info = await this.lfs.branch.get(project, branch)
    const manifest = await readManifest(this.lfs, project, branch)
    if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.session_id !== journal.sessionId) throw Object.assign(new Error('The session branch has no verified manifest for this conversation.'), { code: 'SessionOwnership', status: 409 })
    if (Number(manifest.last_seq) > s.saved_through || (s.conflict?.detail?.parent && s.conflict.detail.parent !== s.conflict.detail.expected)) {
      throw Object.assign(new Error('The session branch holds history this conversation does not have. Import the saved conversation as a separate copy; histories are never combined silently.'), { code: 'SessionDiverged', status: 409 })
    }
    const value = await this.lfs.file.apply(project, branch, [{ op: 'write', path: MANIFEST, content: `${JSON.stringify({ ...this.manifest(journal, project), created_at: manifest.created_at, base_ref: manifest.base_ref, adopted_from: manifest.owner ?? null }, null, 2)}\n` }], { message: `[connect-session:${journal.sessionId}] ownership taken over` })
    const parent = value.commit && 'parent' in value.commit ? value.commit.parent ?? null : info.head ?? null
    if (parent !== (info.head ?? null)) throw this.conflict(journal, 'The session branch changed during the takeover.', { expected: info.head ?? null, parent })
    s.store = { ...(s.store ?? {}), project, branch, head: value.head, created_at: manifest.created_at, base_ref: manifest.base_ref, owner: this.instanceId }
    Object.assign(s, { conflict: null, error: null })
    journal.saveState()
    return journal.status()
  }

  savedArtifacts(journal) {
    const file = join(journal.dir, 'saved-artifacts.txt')
    return { file, ids: new Set(existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []) }
  }

  async saveArtifacts(journal, events) {
    const { file, ids } = this.savedArtifacts(journal)
    const needed = [...new Set(events.flatMap(artifactsOf))].filter((id) => !ids.has(id))
    let batch = [], bytes = 0
    const send = async () => {
      if (!batch.length) return
      const store = journal.state.store
      const value = await this.lfs.file.apply(store.project, store.branch, [{ op: 'mkdir', path: `${ROOT}/artifacts` }, ...batch.map((b) => ({ op: 'write', path: artifactPath(b.id), content: b.text }))], { message: `[connect-session:${journal.sessionId}] artifacts` })
      appendFileSync(file, batch.map((b) => `${b.id}\n`).join(''))
      const expected = store.head ?? null
      const parent = value.commit && 'parent' in value.commit ? value.commit.parent ?? null : expected
      store.head = value.head ?? store.head
      journal.saveState()
      if (parent !== expected) throw this.conflict(journal, 'Another writer saved to this conversation’s session branch while its artifacts were saved; further saves are refused until ownership is resolved.', { expected, parent, head: value.head })
      batch = []
      bytes = 0
    }
    for (const id of needed) {
      const body = journal.readArtifact(id)
      if (!body) continue // reported as missing by the fold
      const text = base64Lines(body)
      if (bytes + text.length > APPLY_BYTES) await send()
      batch.push({ id, text })
      bytes += text.length
    }
    await send()
  }
}

/** Every verified session journal of a project, through paged branch listing. */
export async function discoverSessions(lfs, project) {
  const found = []
  let page_pos
  for (;;) {
    const page = await lfs.branch.list(project, { page_size: 200, ...(page_pos != null ? { page_pos } : {}) })
    for (const branch of page.items ?? []) {
      if (!isSessionBranch(branch.name)) continue
      let manifest = null, problem = null
      try { manifest = await readManifest(lfs, project, branch.name) } catch (error) { problem = `${error.code ?? 'Unknown'}: ${error.message}` }
      const sessionId = branch.name.slice(SESSION_PREFIX.length)
      if (!problem && (!manifest || manifest.schema !== MANIFEST_SCHEMA)) problem = 'No verified Connect session manifest.'
      else if (!problem && manifest.session_id !== sessionId) problem = 'The manifest names a different conversation.'
      found.push({ branch: branch.name, head: branch.head ?? null, session_id: sessionId, manifest, valid: !problem, problem })
    }
    if (!page.has_more || page.next_page_pos == null) return found
    page_pos = page.next_page_pos
  }
}

/** A saved journal's events (seq order) and a reader for its artifacts. */
export async function loadSession(lfs, project, branch) {
  const names = []
  let page_pos
  for (;;) {
    const page = await lfs.file.list(project, branch, `${ROOT}/segments`, undefined, { page_size: 500, ...(page_pos != null ? { page_pos } : {}) })
    names.push(...(page.items ?? []).filter((i) => i.type !== 'directory' && i.name.endsWith('.jsonl')).map((i) => i.path ?? `${ROOT}/segments/${i.name}`))
    if (!page.has_more || page.next_page_pos == null) break
    page_pos = page.next_page_pos
  }
  names.sort()
  const events = []
  for (const path of names) for (const raw of (await readText(lfs, project, branch, path)).split('\n')) if (raw) events.push(JSON.parse(raw))
  events.sort((a, b) => a.seq - b.seq)
  const artifact = async (id) => {
    try { return Buffer.from((await readText(lfs, project, branch, artifactPath(id))).replace(/\s+/g, ''), 'base64') } catch (error) {
      if (notFound(error)) return null
      throw error
    }
  }
  return { events, artifact }
}

/**
 * Rebuilds a conversation's local folder from saved events: its journal,
 * artifacts, native Pi session files and tool outputs. Settings come from the
 * latest `conversation.meta`; runtime mounts are not restored.
 */
export async function reconstructSession({ events, artifact }, chatDir, { store }) {
  const journalDir = join(chatDir, 'journal')
  mkdirSync(join(journalDir, 'artifacts'), { recursive: true, mode: 0o700 })
  mkdirSync(join(journalDir, 'ops'), { recursive: true, mode: 0o700 })
  const missing = []
  const local = async (id) => {
    const file = join(journalDir, 'artifacts', id)
    if (existsSync(file)) return readFileSync(file)
    const body = await artifact(id)
    if (!body || sha256(body) !== id) { missing.push(id); return null }
    writeFileSync(file, body, { mode: 0o600 })
    return body
  }
  for (const id of new Set(events.flatMap(artifactsOf))) await local(id)
  writeFileSync(join(journalDir, 'pending.jsonl'), events.map((e) => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 })
  const last = events.at(-1)?.seq ?? 0
  writeFileSync(join(journalDir, 'state.json'), JSON.stringify({ schema: JOURNAL_SCHEMA, next_seq: last + 1, saved_through: last, ingested: {}, pi: {}, outputs: {}, store, flush: null, error: null, conflict: null, reconstructed: true }), { mode: 0o600 })
  return { last, missing }
}

/** Native files from folded Pi lines and tool-output artifacts. */
export function writeNativeFiles(folded, chatDir, readArtifact) {
  const files = []
  for (const [rel, file] of folded.pi) {
    if (rel.startsWith('..') || rel.startsWith('/')) continue
    const path = join(chatDir, rel)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, file.lines.filter(Boolean).map((line) => line.connect_unparsed ?? JSON.stringify(line)).join('\n') + '\n', { mode: 0o600 })
    files.push({ rel, path, agent_id: file.agent_id, lines: file.lines.length })
  }
  for (const [rel, output] of folded.outputs) {
    if (!/^tool-output\/[a-f0-9]{64}\.log$/.test(rel)) continue
    const body = readArtifact(output.artifact)
    if (!body) continue
    mkdirSync(join(chatDir, 'tool-output'), { recursive: true, mode: 0o700 })
    writeFileSync(join(chatDir, rel), body, { mode: 0o600 })
  }
  return files
}
