// The SDK trace lines of a run's agents: each agent's bash calls (and its
// background jobs) append to <runDir>/traces/<agent>.jsonl, labelled
// LAYERFS_TRACE_STEP=<agent>:<index>. Each file is read from where the last
// read stopped, on a timer and whenever a step ends (the SDK writes a call's
// line before the call returns, so a finished bash call's lines are all
// there by then). Finished lines are kept by step label for the expect
// check and handed on as TraceCall objects; start lines (LAYERFS_TRACE_START)
// are handed on too, so the live view shows calls still running.
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'

const CHUNK = 1 << 20

/** A finished trace line as the views show it. */
export function traceCall(line, agent) {
  const args = line.args ?? {}
  const pick = (k) => (typeof line[k] === 'string' ? line[k] : typeof args[k] === 'string' ? args[k] : null)
  return {
    id: String(line.id),
    agent,
    step: line.step ?? '',
    method: line.method,
    ok: typeof line.ok === 'boolean' ? line.ok : null,
    kind: line.kind ?? null,
    code: line.code ?? null,
    ms: typeof line.ms === 'number' ? line.ms : null,
    start: line.start,
    branch: pick('branch'),
    sandbox: pick('sandbox'),
    path: pick('path'),
    commit: typeof line.commit === 'string' ? line.commit : null,
  }
}

export class Traces {
  /**
   * @param {(line: object, agent: string) => void} onLine called once per finished line
   * @param {(line: object, agent: string) => void} [onStart] called once per call's start line
   */
  constructor(onLine, onStart = () => {}) {
    this.onLine = onLine
    this.onStart = onStart
    /** agent -> { file, offset, rest } */
    this.files = new Map()
    /** step label -> finished lines */
    this.byStep = new Map()
  }

  follow(agent, file) {
    if (!this.files.has(agent)) this.files.set(agent, { file, offset: 0, rest: '' })
  }

  /** Reads what is new in one agent's file (all files without an agent). */
  read(agent = null) {
    for (const [name, tail] of this.files) {
      if (agent && name !== agent) continue
      if (!existsSync(tail.file)) continue
      const size = statSync(tail.file).size
      while (tail.offset < size) {
        const length = Math.min(CHUNK, size - tail.offset)
        const buffer = Buffer.alloc(length)
        const fd = openSync(tail.file, 'r')
        try {
          readSync(fd, buffer, 0, length, tail.offset)
        } finally {
          closeSync(fd)
        }
        tail.offset += length
        const parts = (tail.rest + buffer.toString('utf8')).split('\n')
        tail.rest = parts.pop()
        for (const raw of parts) this.take(raw, name)
      }
    }
  }

  take(raw, agent) {
    let line
    try {
      line = JSON.parse(raw)
    } catch {
      return
    }
    if (line?.layerfs_trace !== 1) return
    if (line.phase === 'start') return this.onStart(line, agent)
    const label = line.step ?? ''
    if (!this.byStep.has(label)) this.byStep.set(label, [])
    this.byStep.get(label).push(line)
    this.onLine(line, agent)
  }

  /** The finished lines of one step label, in the order they were written. */
  lines(label) {
    return this.byStep.get(label) ?? []
  }

  start(ms = 200) {
    this.timer = setInterval(() => {
      try {
        this.read()
      } catch {
        // a trace is diagnostic; the next read tries again
      }
    }, ms)
    this.timer.unref()
  }

  stop() {
    clearInterval(this.timer)
    try {
      this.read()
    } catch {
      // as above
    }
  }
}
