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
    // a call that changes the project's store: what it did (the Trace tab lists them)
    ...(WRITES[line.method] ? writeNote(line) : {}),
  }
}

/**
 * The SDK methods that change a project's store (its Branches, Commits and
 * Layers), by the kind the Trace tab shows. Every other method reads it, or
 * changes only Sandboxes and Workspaces (sandbox.create/close,
 * workspace.mount/unmount/exec): those save nothing until workspace.commit.
 */
export const WRITES = Object.freeze({
  'fs.write': 'file',
  'fs.apply': 'file',
  'fs.edit': 'file',
  'fs.mkdir': 'file',
  'fs.rm': 'file',
  'fs.mv': 'file',
  'fs.cp': 'file',
  'workspace.commit': 'workspace',
  'branch.fork': 'fork',
  'branch.merge': 'merge',
  'branch.publish': 'publish',
  'project.init': 'init',
})

/** What a write's trace line says beyond the call: its message (or why it was refused), sizes, and the Branches it named. */
export function writeNote(line) {
  const args = line.args ?? {}
  const sizes = line.sizes && typeof line.sizes === 'object' ? line.sizes : null
  const str = (v) => (typeof v === 'string' ? v : null)
  const message = line.ok === false ? str(line.message) : str(args.message)
  return {
    message: message ? message.slice(0, 500) : null,
    sizes: sizes ? { logical: sizes.logical ?? null, stored: sizes.newStored ?? null } : null,
    // fork: the Branch it forked from; merge: the two it merged and the one it made; publish: the Layer it added
    from: str(args.from),
    onto: line.method === 'branch.merge' ? str(args.branch) : null,
    with: str(args.with),
    name: str(args.name),
    layer: str(line.layer),
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
