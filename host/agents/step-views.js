// What each bash call of a chat did to LayerFS, for the chat page: the
// parser's segments of its command (what each line means to do, parse/) and
// the LayerFS calls its trace recorded (what ran, trace.js), joined by the
// tool call's id. A command never changes, so its segments are kept per call;
// the trace is read again only when its file has grown.
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { segments } from '../parse/index.js'
import { chatCalls } from './trace.js'

const parsed = new Map()
const traces = new Map()
const MAX_PARSED = 4000
const MAX_TRACES = 200

/** A command's segments; [] when the parser cannot read it (the page then shows the command plain). */
function segmentsOf(id, command) {
  const key = `${id}\u0000${command}`
  if (!parsed.has(key)) {
    if (parsed.size >= MAX_PARSED) parsed.delete(parsed.keys().next().value)
    let value
    try { value = segments(command) } catch { value = [] }
    parsed.set(key, value)
  }
  return parsed.get(key)
}

/** An agent's LayerFS calls by tool call id, read again when its trace file changed. */
function callsOf(traceDir, agent) {
  const file = join(traceDir, `${agent}.jsonl`)
  let stamp = 'none'
  try {
    const { size, mtimeMs } = statSync(file)
    stamp = `${size}:${mtimeMs}`
  } catch { /* no trace yet */ }
  const known = traces.get(file)
  if (known?.stamp === stamp) return known.calls
  const calls = stamp === 'none' ? new Map() : chatCalls(traceDir, agent)
  if (!known && traces.size >= MAX_TRACES) traces.delete(traces.keys().next().value)
  traces.set(file, { stamp, calls })
  return calls
}

/** An agent's messages (the chat's root, or a child's), each bash tool call with `view: { segments, calls }`. */
export function withStepViews(messages, traceDir, agent = 'root') {
  if (!messages?.some((m) => m.role === 'tool' && m.toolName === 'bash')) return messages
  const calls = callsOf(traceDir, agent)
  return messages.map((message) => {
    const command = message.role === 'tool' && message.toolName === 'bash' ? message.args?.command : undefined
    if (typeof command !== 'string') return message
    return { ...message, view: { segments: segmentsOf(message.id, command), calls: calls.get(message.id) ?? [] } }
  })
}
