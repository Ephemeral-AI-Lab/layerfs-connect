// A chat's Trace: the rows a session's Trace tab showed (runs/trajectory.js),
// for a chat. A chat keeps what trajectory() reads in its own places: Pi's
// session log (the branch the chat is on now) stands for the agent's pi log,
// and each tool call of that log is a step, whose LayerFS calls are the
// chat's traces/root.jsonl lines labelled root:<toolCallId>
// (child-extension.js). A scenario chat's answers are its script's steps,
// and its final checks end the root's rows.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LiveState } from '../runs/live.js'
import { traceCall } from '../runs/traces.js'
import { trajectory, writeNotes } from '../runs/trajectory.js'

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '')
const at = (entry) => Date.parse(entry?.timestamp) || entry?.message?.timestamp || null

/** The root agent's LayerFS calls by tool call id: a call's end line replaces its start line. */
export function chatCalls(traceDir) {
  const file = join(traceDir, 'root.jsonl')
  const byStep = new Map()
  if (!existsSync(file)) return byStep
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.startsWith('{')) continue
    let line
    try { line = JSON.parse(raw) } catch { continue } // a line being written
    if (line?.layerfs_trace !== 1 || typeof line.step !== 'string' || !line.step.startsWith('root:')) continue
    const callId = line.step.slice('root:'.length)
    if (!byStep.has(callId)) byStep.set(callId, new Map())
    const calls = byStep.get(callId)
    if (line.phase === 'start' && calls.has(String(line.id))) continue
    calls.set(String(line.id), traceCall(line, 'root'))
  }
  return new Map([...byStep].map(([id, calls]) => [id, [...calls.values()]]))
}

/** LayerFS calls a chat's Live keeps: the newest, by agent and call id. */
const LIVE_CALLS = 400

/**
 * A chat's Live (the project page's diagram): its newest LayerFS calls and
 * what its agents hold in LayerFS now (running calls, Sandboxes, mounted
 * Workspaces), read from every agent's trace lines (traces/<agent>.jsonl), as
 * a scenario run's were. A chat no longer working has nothing running.
 */
export function chatLive(traceDir, { running = false } = {}) {
  const state = new LiveState()
  const calls = new Map()
  const files = existsSync(traceDir) ? readdirSync(traceDir).filter((name) => name.endsWith('.jsonl')) : []
  for (const name of files) {
    const agent = name.slice(0, -'.jsonl'.length)
    for (const raw of readFileSync(join(traceDir, name), 'utf8').split('\n')) {
      if (!raw.startsWith('{')) continue
      let line
      try { line = JSON.parse(raw) } catch { continue } // a line being written
      if (line?.layerfs_trace !== 1 || line.id === undefined) continue
      const key = `${agent}:${line.id}`
      if (line.phase === 'start') {
        if (calls.has(key)) continue
        state.started(line, agent)
      } else state.ended(line, agent)
      calls.delete(key)
      calls.set(key, traceCall(line, agent))
    }
  }
  if (!running) state.stopped()
  return { calls: [...calls.values()].slice(-LIVE_CALLS), live: state.view() }
}

/** Each tool call of Pi's log as a run's step (RunDetail steps): its command, output, exit and LayerFS calls. */
function steps(entries, calls, running) {
  const out = []
  const results = new Map()
  for (const e of entries) if (e.type === 'message' && e.message?.role === 'toolResult') results.set(e.message.toolCallId, e)
  for (const e of entries) {
    if (e.type !== 'message' || e.message?.role !== 'assistant' || !Array.isArray(e.message.content)) continue
    for (const call of e.message.content.filter((b) => b.type === 'toolCall')) {
      const args = call.arguments ?? {}
      const result = results.get(call.id)
      const text = result ? textOf(result.message.content) : null
      const exit = text === null ? null : /Command exited with code (\d+)\s*$/.exec(text)
      const ended = result ? at(result) : null
      out.push({
        agent: 'root',
        index: out.length,
        view: {
          tool: call.name,
          text: typeof args.command === 'string' ? args.command : typeof args.task === 'string' ? args.task : JSON.stringify(args, null, 2),
          description: typeof args.description === 'string' ? args.description : null,
          background: false,
        },
        started: ended !== null && Number.isFinite(result.message.durationMs) ? ended - result.message.durationMs : at(e),
        ended,
        stdout: text,
        stderr: null,
        output: text,
        exitCode: call.name !== 'bash' || text === null ? null : exit ? Number(exit[1]) : result.message.isError ? null : 0,
        checks: [],
        calls: calls.get(call.id) ?? [],
        state: result ? (result.message.isError ? (/Command aborted\s*$/.test(text) ? 'stopped' : 'failed') : 'ok') : running ? 'running' : 'stopped',
      })
    }
  }
  return out
}

/**
 * One page of the chat's Trace rows (TracePage).
 * @param {object} o
 * @param {object} o.record  the chat's record (its scenario, state)
 * @param {object[]} o.entries  Pi's session branch (getBranch())
 * @param {string} o.dir  the chat's folder (its traces/)
 */
export function chatTrace({ record, entries, dir, before = null, limit }) {
  const running = record.state === 'running'
  const s = record.scenario ?? null
  const run = {
    kind: 'live',
    agents: [{ name: 'root', parent: null }],
    steps: steps(entries, chatCalls(join(dir, 'traces')), running),
    messages: [],
    checks: s?.checks ?? [],
    started: record.created ?? null,
    ended: s && ['passed', 'failed'].includes(s.state) ? record.updated ?? null : null,
    state: s?.state ?? record.state,
    error: s?.error ?? null,
    folder: s?.folder ?? null,
  }
  const page = trajectory({ run, agent: 'root', pi: entries, notes: writeNotes(dir), before, limit })
  // a scenario chat's model is its script: its answers read as the script's steps did
  if (s) for (const r of page.records) if (r.kind === 'assistant') r.scripted = true
  return page
}
