// A chat's subagents: each child run's numbers (tokens, cost, turns, tools,
// time) and its own conversation, read from the child's Pi session file.
import { existsSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, sep } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'

import { sessionUsage } from './runtime.js'
import { sessionTranscript } from './transcript.js'
import { withStepViews } from './step-views.js'
import { chatTrace } from './trace.js'

const stats = new Map()
const traceIdentities = new Map()

/** Session identity is in the first line; never load a full child history for the live graph. */
export function childTraceIdentity(dir, file) {
  if (!inside(dir, file)) return null
  try {
    const info = statSync(file), identity = `${info.dev}:${info.ino}`
    const cached = traceIdentities.get(file)
    if (cached?.identity === identity) return cached.agent
    const fd = openSync(file, 'r'), buffer = Buffer.alloc(8192)
    let size
    try { size = readSync(fd, buffer, 0, buffer.length, 0) } finally { closeSync(fd) }
    const header = JSON.parse(buffer.toString('utf8', 0, size).split('\n')[0])
    if (header.type !== 'session' || typeof header.id !== 'string') return null
    const agent = `child-${header.id}`
    traceIdentities.set(file, { identity, agent })
    if (traceIdentities.size > 500) traceIdentities.delete(traceIdentities.keys().next().value)
    return agent
  } catch { return null }
}

/** Whether `file` is a session file inside the chat's own folder (child files live there). */
function inside(dir, file) {
  if (!file || !existsSync(file)) return false
  try {
    const root = realpathSync(dir)
    return realpathSync(file).startsWith(root + sep)
  } catch { return false }
}

/** A child session file's totals; cached until the file changes. */
function fileStats(file) {
  const { mtimeMs, size } = statSync(file)
  const cached = stats.get(file)
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.value
  const manager = SessionManager.open(file)
  const entries = manager.getEntries()
  const usage = sessionUsage(manager)
  const times = entries.map((entry) => Date.parse(entry.timestamp)).filter(Number.isFinite)
  const value = {
    tokens: usage.input + usage.output,
    cost: usage.cost,
    turns: entries.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant').length,
    requestTurns: entries.filter((entry) => entry.type === 'message' && entry.message.role === 'user').length,
    toolCount: usage.toolCalls,
    startedAt: times.length ? Math.min(...times) : undefined,
    endedAt: times.length ? Math.max(...times) : undefined,
  }
  stats.set(file, { mtimeMs, size, value })
  if (stats.size > 500) stats.delete(stats.keys().next().value)
  return value
}

/** Each subagent call's arguments by its run, so a background child keeps the task it was given. */
function callsByRun(messages) {
  const calls = new Map()
  for (const message of messages) {
    if (message.role !== 'tool' || message.toolName !== 'subagent') continue
    const runId = message.details?.runId ?? message.details?.asyncId
    if (runId) calls.set(runId, message.args ?? {})
  }
  return calls
}

/**
 * The children as the chat page shows them: the task each was given, and
 * tokens, cost, turns, tools and time, from its session file when it has
 * one, else from what pi-subagents reported while it ran.
 */
export function describeChildren(record, dir) {
  const calls = callsByRun(record.messages ?? [])
  return (record.children ?? []).map((child) => {
    const args = calls.get(child.runId) ?? {}
    const index = Number(child.id.split(':').at(-1))
    const task = child.task || args.tasks?.[index]?.task || args.chain?.[index]?.task || args.task
    let numbers = {}
    if (inside(dir, child.sessionFile)) {
      try {
        const { requestTurns, ...measured } = fileStats(child.sessionFile)
        numbers = record.simulation ? { ...measured, turns: requestTurns } : measured
      } catch { numbers = {} }
    }
    const merged = { ...child, ...(task ? { task } : {}) }
    for (const [key, value] of Object.entries(numbers)) if (value !== undefined) merged[key] = value
    merged.conversation = inside(dir, child.sessionFile)
    merged.traceAgent = childTraceIdentity(dir, child.sessionFile)
    return merged
  })
}

/**
 * One child's conversation, read-only; empty until its session file exists.
 * Its bash calls carry step views from its own trace (traces/child-<its Pi
 * session id>.jsonl, child-extension.js), as the chat's own do.
 */
export function childConversation(record, dir, childId) {
  const child = describeChildren(record, dir).find((item) => item.id === childId)
  if (!child) return null
  if (!child.conversation) return { child, messages: [] }
  const manager = SessionManager.open(child.sessionFile)
  const messages = withStepViews(sessionTranscript(manager, { running: ['running', 'pending', 'queued', 'paused'].includes(child.state) }), join(dir, 'traces'), `child-${manager.getSessionId()}`)
  return { child, messages }
}

/** A child's own paginated Trace, using its Pi branch and its own LayerFS calls. */
export function childTrace(record, dir, childId, { before = null, limit } = {}) {
  const child = describeChildren(record, dir).find((item) => item.id === childId)
  if (!child) return null
  const manager = child.conversation ? SessionManager.open(child.sessionFile) : null
  const page = chatTrace({
    record: {
      state: ['running', 'pending', 'queued', 'paused'].includes(child.state) ? 'running' : 'idle',
      created: child.startedAt, updated: child.endedAt,
    },
    entries: manager?.getBranch() ?? [], dir, before, limit,
    traceAgent: manager ? `child-${manager.getSessionId()}` : undefined,
  })
  return { ...page, agent: child.agent }
}
