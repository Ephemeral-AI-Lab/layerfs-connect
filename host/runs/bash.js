// One `bash -c` process in its own process group, its output kept as a
// capped tail and read line by line for the values a step captures.
import { spawn } from 'node:child_process'

/** The output kept per stream for the record and the views. */
export const KEEP = 256 * 1024
/** dsh's bash default and cap (packages/shell/bash-local: timeoutMs 120 s, maxTimeoutMs 600 s). */
export const DEFAULT_TIMEOUT_MS = 120_000
export const MAX_TIMEOUT_MS = 600_000
/** How long a group gets between SIGTERM and SIGKILL. */
const GRACE_MS = 2000

/** The last `limit` bytes of a stream. */
export class Tail {
  constructor(limit = KEEP) {
    this.limit = limit
    this.chunks = []
    this.size = 0
    this.truncated = false
  }

  push(chunk) {
    this.chunks.push(chunk)
    this.size += chunk.length
    while (this.size - this.chunks[0].length >= this.limit) {
      this.size -= this.chunks.shift().length
      this.truncated = true
    }
  }

  text() {
    let buf = Buffer.concat(this.chunks)
    if (buf.length > this.limit) {
      buf = buf.subarray(buf.length - this.limit)
      this.truncated = true
    }
    return buf.toString('utf8')
  }
}

/** A stream's complete lines, handed to `onLine` as they arrive (the full output, never cut). */
export class Lines {
  constructor(onLine) {
    this.onLine = onLine
    this.rest = ''
  }

  push(chunk) {
    const parts = (this.rest + chunk.toString('utf8')).split('\n')
    this.rest = parts.pop()
    // a line longer than this holds no value a step captures; keep memory bounded
    if (this.rest.length > 4 * 1024 * 1024) this.rest = ''
    for (const line of parts) this.onLine(line)
  }

  end() {
    if (this.rest) this.onLine(this.rest)
    this.rest = ''
  }
}

/**
 * Starts `bash -c command`. Answers { pid, done, kill } where `done`
 * resolves { exitCode, signal, error } once the process exited and its output
 * closed (or GRACE_MS after the exit, when a child it left keeps the pipes).
 */
export function startBash({ command, cwd, env, onStdout, onStderr }) {
  const child = spawn('bash', ['-c', command], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', onStdout)
  child.stderr.on('data', onStderr)
  let exited = null
  const done = new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.on('error', (error) => finish({ exitCode: null, signal: null, error }))
    child.on('exit', (code, signal) => {
      exited = { exitCode: code, signal, error: null }
      setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        finish(exited)
      }, GRACE_MS).unref()
    })
    child.on('close', (code, signal) => finish(exited ?? { exitCode: code, signal, error: null }))
  })
  return { pid: child.pid, done, kill: () => killGroup(child.pid) }
}

/** SIGTERM to the whole group, then SIGKILL to what is left of it after GRACE_MS. */
export function killGroup(pid) {
  if (!pid) return
  const send = (signal) => {
    try {
      process.kill(-pid, signal)
    } catch {
      // the group is gone already
    }
  }
  send('SIGTERM')
  setTimeout(() => send('SIGKILL'), GRACE_MS).unref()
}
