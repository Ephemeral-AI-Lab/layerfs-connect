import { appendFileSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { stringify } from '../../host/cli/json.js'

/** Append before a mutation starts; a missing final receipt is never replayable. */
export class StepJournal {
  constructor(path) { this.path = path; this.records = 0 }
  load(legacy = {}) {
    const steps = { ...legacy }, journalKeys = new Set()
    if (existsSync(this.path)) {
      if (lstatSync(this.path).isSymbolicLink()) throw new Error('The preset step journal must not be a symlink.')
      const text = readFileSync(this.path, 'utf8')
      if (text && !text.endsWith('\n')) throw new Error('The preset step journal ends with an incomplete receipt. Inspect the journal and CLI Activity; mutations will not be replayed.')
      for (const line of text.split('\n')) {
        if (!line) continue
        const record = JSON.parse(line)
        if (record.v !== 1 || typeof record.key !== 'string' || !record.step?.status) throw new Error('The preset step journal is malformed. Inspect it before continuing.')
        steps[record.key] = record.step; journalKeys.add(record.key); this.records++
      }
    } else {
      writeFileSync(this.path, '', { mode: 0o600, flag: 'wx' })
    }
    for (const [key, step] of Object.entries(legacy)) if (!journalKeys.has(key)) this.append(key, step)
    return steps
  }
  append(key, step) {
    appendFileSync(this.path, `${stringify({ v: 1, key, step })}\n`, { mode: 0o600 })
    this.records++
  }
  clear() {
    // The caller must independently verify resource deletion first.
    writeFileSync(this.path, '', { mode: 0o600 }); this.records = 0
  }
  metadata() { return { version: 1, file: this.path.split('/').at(-1), records: this.records } }
}
