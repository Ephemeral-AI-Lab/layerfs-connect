// The local conversation catalog: a rebuildable SQLite projection of every
// journal's saved-version links, for reverse lookups (a History version ->
// the operations that produced or referenced it, across conversations). It is
// never an authority: deleting it loses nothing, and each conversation is
// re-indexed from its journal when its sequence moved. This is Connect's own
// local file, not LayerFS's Store backend.
import { rmSync } from 'node:fs'

const SCHEMA = 2
let sqlite = null
try { sqlite = await import('node:sqlite') } catch { sqlite = null }

export class SessionCatalog {
  /** @param {string|null} file  null keeps the projection in memory */
  constructor(file) {
    this.memory = null
    this.db = null
    if (file && sqlite) {
      try { this.db = this.openDb(file) } catch {
        rmSync(file, { force: true })
        try { this.db = this.openDb(file) } catch { this.db = null }
      }
    }
    if (!this.db) this.memory = { sessions: new Map(), links: [] }
  }

  get backend() { return this.db ? 'sqlite' : 'memory' }

  openDb(file) {
    const db = new sqlite.DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF')
    const version = db.prepare('PRAGMA user_version').get().user_version
    if (version !== SCHEMA) {
      db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS links')
      db.exec(`CREATE TABLE sessions (session_id TEXT PRIMARY KEY, project TEXT, indexed_seq INTEGER NOT NULL);
        CREATE TABLE links (session_id TEXT NOT NULL, operation_id TEXT NOT NULL, role TEXT NOT NULL, store_id TEXT NOT NULL, project_id TEXT NOT NULL,
          branch_id TEXT NOT NULL, commit_id TEXT NOT NULL, version_kind TEXT NOT NULL, effect TEXT, method TEXT, agent_id TEXT, tool_call_id TEXT,
          status TEXT, started_at TEXT, inherited_from TEXT);
        CREATE INDEX links_version ON links (store_id, project_id, commit_id);
        CREATE INDEX links_session ON links (session_id);
        PRAGMA user_version = ${SCHEMA};`)
    }
    return db
  }

  indexedSeq(sessionId) {
    if (this.memory) return this.memory.sessions.get(sessionId)?.indexed_seq ?? -1
    return this.db.prepare('SELECT indexed_seq FROM sessions WHERE session_id = ?').get(sessionId)?.indexed_seq ?? -1
  }

  /** Replaces one conversation's rows from its folded operations. */
  index(sessionId, project, operations, seq) {
    const rows = []
    for (const op of operations) {
      const base = { session_id: sessionId, operation_id: op.operation_id, method: op.method, agent_id: op.agent_id ?? null, tool_call_id: op.tool_call_id ?? null, status: op.status, started_at: op.started_at ?? null, inherited_from: op.inherited_from ?? null }
      for (const link of op.checkpoints ?? []) rows.push({ ...base, role: 'output', effect: link.effect, ...link.ref })
      for (const ref of op.inputs ?? []) rows.push({ ...base, role: 'input', effect: null, ...ref })
    }
    if (this.memory) {
      this.memory.links = this.memory.links.filter((r) => r.session_id !== sessionId).concat(rows)
      this.memory.sessions.set(sessionId, { project, indexed_seq: seq })
      return
    }
    const insert = this.db.prepare('INSERT INTO links (session_id, operation_id, role, store_id, project_id, branch_id, commit_id, version_kind, effect, method, agent_id, tool_call_id, status, started_at, inherited_from) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM links WHERE session_id = ?').run(sessionId)
      for (const r of rows) insert.run(r.session_id, r.operation_id, r.role, r.store_id, r.project_id, r.branch_id, r.commit_id, r.version_kind, r.effect, r.method, r.agent_id, r.tool_call_id, r.status, r.started_at, r.inherited_from)
      this.db.prepare('INSERT INTO sessions (session_id, project, indexed_seq) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET project = excluded.project, indexed_seq = excluded.indexed_seq').run(sessionId, project, seq)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  drop(sessionId) {
    if (this.memory) {
      this.memory.links = this.memory.links.filter((r) => r.session_id !== sessionId)
      this.memory.sessions.delete(sessionId)
      return
    }
    this.db.prepare('DELETE FROM links WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
  }

  /** Operations linking one saved version, oldest first; producers are `output` rows with effect `created`/`published`. */
  forVersion({ store_id, project_id, commit_id }, limit = 200) {
    if (this.memory) return this.memory.links.filter((r) => r.store_id === store_id && r.project_id === project_id && r.commit_id === commit_id).slice(0, limit)
    return this.db.prepare('SELECT * FROM links WHERE store_id = ? AND project_id = ? AND commit_id = ? ORDER BY started_at LIMIT ?').all(store_id, project_id, commit_id, limit).map((r) => ({ ...r }))
  }

  close() { this.db?.close() }
}
