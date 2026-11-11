import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LiveState } from '../runs/live.js'
import { Traces, traceCall } from '../runs/traces.js'

/** Only the selected live view tails files; completed histories are not reparsed per poll. */
export class ChatLiveReader {
  constructor() { this.reset() }
  reset() {
    this.state = new LiveState(); this.calls = new Map(); this.pending = []; this.identities = new Map()
    const take = (line, agent) => this.pending.push({ line, agent })
    this.reader = new Traces(take, take)
  }
  view(directory, running) {
    const files = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.jsonl')) : []
    const current = new Map(files.map(name => {
      const info = statSync(join(directory, name))
      return [name, { identity: `${info.dev}:${info.ino}`, size: info.size }]
    }))
    if ([...this.identities].some(([name, old]) => !current.has(name) || current.get(name).identity !== old.identity || current.get(name).size < old.size)) this.reset()
    for (const name of files) this.reader.follow(name.slice(0, -6), join(directory, name))
    this.reader.read()
    for (const [agent, tail] of this.reader.files) if (tail.rest) {
      try { JSON.parse(tail.rest) } catch { continue }
      this.reader.take(tail.rest, agent); tail.rest = ''
    }
    this.reader.byStep.clear(); this.identities = current
    const timestamp = line => (Date.parse(line.start) || 0) + (line.phase === 'start' ? 0 : line.ms ?? 0)
    this.pending.sort((a, b) => timestamp(a.line) - timestamp(b.line) || a.agent.localeCompare(b.agent))
    for (const { line, agent } of this.pending.splice(0)) {
      if (line.id === undefined) continue
      const key = `${agent}:${line.id}`
      if (line.phase === 'start') {
        if (this.calls.has(key)) continue
        this.state.started(line, agent)
      } else this.state.ended(line, agent)
      this.calls.delete(key); this.calls.set(key, traceCall(line, agent))
    }
    // Keep in-flight calls even when a long call overlaps more than 400 completions.
    for (const [key, value] of this.calls) if (this.calls.size > 400 && value.ok !== null) this.calls.delete(key)
    if (!running) this.state.stopped()
    const live = this.state.view()
    return { calls: [...this.calls.values()], live }
  }
}

const readers = new Map()
export function readChatLive(directory, { running = false } = {}) {
  const reader = readers.get(directory) ?? new ChatLiveReader()
  readers.delete(directory); readers.set(directory, reader)
  if (readers.size > 32) readers.delete(readers.keys().next().value)
  return reader.view(directory, running)
}
