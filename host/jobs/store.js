// Connect-owned transfer records. A restart retains custody, never replays work.
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from '../cli/json.js'

export class JobStore {
  constructor(directory) {
    this.file = directory ? join(directory, 'storage-jobs.json') : null
    this.jobs = new Map()
    if (!this.file) return
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    let records
    try { records = JSON.parse(readFileSync(this.file, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return
      throw new Error(`Storage job records could not be read: ${error.message}`)
    }
    if (!Array.isArray(records)) throw new Error('Storage job records are malformed')
    for (const record of records) {
      if (!record.ended) Object.assign(record, { ended: Date.now(), outcome: 'interrupted', error: { code: 'Interrupted', message: 'Host restarted; final result unavailable. Remote work may still finish.', phase: record.phase, detail: null }, recovery: null })
      this.jobs.set(record.id, record)
    }
    this.save()
  }
  save() {
    if (!this.file) return
    const records = [...this.jobs.values()]
    while (records.length > 30) {
      const at = records.findIndex(j => j.ended)
      if (at < 0) break
      this.jobs.delete(records[at].id)
      records.splice(at, 1)
    }
    writeFileSync(`${this.file}.tmp`, stringify(records), { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
  }
}
