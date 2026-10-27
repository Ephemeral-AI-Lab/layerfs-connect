// Background bash jobs (bash run_in_background), read and stopped with
// job_output, job_kill and job_list as dsh's job tools do: job_output gives
// the output since the previous read, waits with `wait` up to `timeout_ms`
// (default 30 s, cap 10 min: dsh tool-jobs), and ends with a status line;
// a timed-out wait leaves the job running. The run kills what is left when
// it ends.
import { KEEP, startBash, Tail } from './bash.js'

export const WAIT_DEFAULT_MS = 30_000
export const WAIT_CAP_MS = 600_000

export class Job {
  /**
   * @param {object} o
   * @param {string} o.id job id ("job-<n>")
   * @param {string} o.label the bash call's description
   * @param {(chunk: Buffer, stream: 'stdout' | 'stderr') => void} o.onOutput
   */
  constructor({ id, name, label, command, cwd, env, onOutput }) {
    this.id = id
    this.name = name
    this.label = label
    this.state = 'running'
    this.exitCode = null
    this.signal = null
    this.reason = null
    this.started = Date.now()
    this.ended = null
    // everything both streams wrote, in order, for job_output
    this.chunks = []
    this.kept = 0
    this.written = 0
    this.readTo = 0
    this.stdout = new Tail()
    this.stderr = new Tail()
    const take = (stream) => (chunk) => {
      this[stream].push(chunk)
      this.chunks.push(chunk)
      this.kept += chunk.length
      this.written += chunk.length
      while (this.kept - this.chunks[0].length >= KEEP) this.kept -= this.chunks.shift().length
      onOutput(chunk, stream)
    }
    this.proc = startBash({ command, cwd, env, onStdout: take('stdout'), onStderr: take('stderr') })
    this.done = this.proc.done.then((r) => {
      this.exitCode = r.exitCode
      this.signal = r.signal
      if (this.state === 'running') this.state = r.error ? 'failed' : r.exitCode === 0 ? 'completed' : 'failed'
      if (r.error) this.reason = r.error.message
      this.ended = Date.now()
      return this
    })
  }

  kill(reason = 'killed') {
    if (this.state !== 'running') return false
    this.state = 'killed'
    this.reason = reason
    this.proc.kill()
    return true
  }

  status() {
    if (this.state === 'running') return '[status: running]'
    if (this.state === 'killed') return `[status: killed, ${this.reason}]`
    if (this.signal) return `[status: ${this.state}, signal ${this.signal}]`
    if (this.reason) return `[status: ${this.state}, ${this.reason}]`
    return `[status: ${this.state}, exit ${this.exitCode}]`
  }

  /** The output written since the last read, and the status line. */
  read() {
    const start = this.written - this.kept
    const from = Math.max(this.readTo, start)
    const buf = Buffer.concat(this.chunks)
    const text = buf.subarray(from - start).toString('utf8')
    const lost = this.readTo < start ? `[some output was dropped from memory]\n` : ''
    this.readTo = this.written
    return `${lost}${text}${text && !text.endsWith('\n') ? '\n' : ''}${this.status()}`
  }

  /** Waits for the job to end, up to `ms`. */
  async wait(ms) {
    let timer
    await Promise.race([this.done, new Promise((resolve) => (timer = setTimeout(resolve, ms)))])
    clearTimeout(timer)
  }

  line() {
    return `${this.id} [bash] ${this.state} — ${this.label}`
  }
}
