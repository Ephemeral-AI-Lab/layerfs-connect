// A chat's subagents: each child run's numbers (tokens, cost, turns, tools,
// time) and its own conversation, read from the child's Pi session file.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { sep } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'

import { sessionUsage } from './runtime.js'
import { sessionTranscript } from './transcript.js'

const stats = new Map()

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
      try { numbers = fileStats(child.sessionFile) } catch { numbers = {} }
    }
    const merged = { ...child, ...(task ? { task } : {}) }
    for (const [key, value] of Object.entries(numbers)) if (value !== undefined) merged[key] = value
    merged.conversation = inside(dir, child.sessionFile)
    return merged
  })
}

/** One child's conversation, read-only; empty until its session file exists. */
export function childConversation(record, dir, childId) {
  const child = describeChildren(record, dir).find((item) => item.id === childId)
  if (!child) return null
  if (!child.conversation) return { child, messages: [] }
  const messages = sessionTranscript(SessionManager.open(child.sessionFile))
  return { child, messages }
}
