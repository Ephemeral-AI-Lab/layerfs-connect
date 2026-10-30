// A scenario chat's next answer, worked out from the conversation alone: how
// far root's steps got, and what it says next. Ported from dsh-layerfs's
// scripted model (packages/mock/src/plan.js) to Pi's messages. Nothing is kept
// between requests, so a reload, a restart or a model switch changes nothing.
//
// Walking the assistant messages against the steps gives the position. A
// message with a tool call is one call step: its result must hold (the exit
// the step expects, and its `expect` codes in the call's LayerFS trace lines),
// or the scenario stops there. A text-only message is the reply step when one
// is due. Placeholders ({{sandbox}}, {{ws}}, {{commit:<ref>}}) are filled from
// what the conversation has shown so far.
//
// Chats play scenarios of one agent whose steps are bash calls and replies;
// `chatReady` says why any other scenario does not play here yet.
import { callCodes, inOrder } from '../../tools/lib/expect.mjs'
import { PLACEHOLDER } from '../../tools/lib/scenario.mjs'

/** Pi's bash ends a non-zero exit's output with this line. */
const EXIT = /Command exited with code (\d+)\s*$/
const SANDBOX = /"sandbox"\s*:\s*"([^"]+)"/g
const WS = /"ws"\s*:\s*"([^"]+)"/g

const textOf = (message) => typeof message.content === 'string'
  ? message.content
  : (message.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')
const callsOf = (message) => (message.content ?? []).filter((block) => block.type === 'toolCall')

/** Null when the scenario plays in a chat; otherwise why not. */
export function chatReady(scenario) {
  if (scenario.sessions) return 'it plays several sessions at once'
  const agents = Object.keys(scenario.agents)
  if (agents.length !== 1) return `it has ${agents.length} agents`
  for (const step of scenario.agents[agents[0]]) {
    if (step.kind !== 'call') continue
    if (step.call.name !== 'bash') return `it calls ${step.call.name}`
    if (step.call.args.run_in_background) return 'it runs background jobs'
  }
  return null
}

/**
 * The next answer for `scenario` (a chat-ready one) from Pi `messages`:
 *   { kind: 'call', call: { name, args }, say, step }   call this tool
 *   { kind: 'text', text, last }                        say this; `last` when it is the final reply
 *   { kind: 'error', message }                          the scenario stops here
 * @param {(toolCallId: string) => object[] | null} traceOf a bash call's finished trace lines
 */
export function nextReply(scenario, messages, traceOf) {
  const root = Object.keys(scenario.agents)[0]
  const steps = scenario.agents[root]
  const results = new Map()
  let sandbox = null
  let ws = null
  const commits = new Map()
  for (const message of messages) {
    if (message.role === 'toolResult') results.set(String(message.toolCallId), { text: textOf(message), isError: message.isError === true })
    if (message.role === 'assistant' || message.role === 'system') continue
    const text = textOf(message)
    for (const found of text.matchAll(SANDBOX)) sandbox = found[1]
    for (const found of text.matchAll(WS)) ws = found[1]
    if (message.role === 'user') {
      for (const { pattern, refs } of scenario.templates ?? []) {
        const found = text.match(pattern)
        if (found) refs.forEach((ref, i) => commits.set(ref, found[i + 1]))
      }
    }
  }

  let index = 0
  let replyAt = -1
  // after a reply the agent goes on once a user message comes
  const woken = (before) => steps[index - 1]?.kind !== 'reply' || messages.slice(replyAt + 1, before).some((m) => m.role === 'user')
  for (const [k, message] of messages.entries()) {
    if (message.role !== 'assistant') continue
    // a stopped or failed answer did nothing: its calls never ran
    if (message.stopReason === 'error' || message.stopReason === 'aborted') continue
    const calls = callsOf(message)
    if (!calls.length) {
      if (steps[index]?.kind === 'reply' && woken(k)) { index++; replyAt = k }
      continue
    }
    const step = steps[index]
    if (step?.kind !== 'call') return { kind: 'error', message: `the conversation has a ${calls[0].name} call where ${step ? `${step.at} is a reply` : 'the script has no steps left'}` }
    if (calls.length !== 1 || calls[0].name !== step.call.name) return { kind: 'error', message: `${step.at} calls ${step.call.name}, and the conversation has ${calls.map((c) => c.name).join(', ')}` }
    const result = results.get(String(calls[0].id))
    if (!result) return { kind: 'error', message: `${step.at}: its ${step.call.name} call has no result` }
    const failure = checkBash(step, String(calls[0].id), result, traceOf)
    if (failure) return { kind: 'error', message: `${failure}, so the scenario stops here.\n\n${result.text.slice(-600)}` }
    for (const found of result.text.matchAll(SANDBOX)) sandbox = found[1]
    for (const found of result.text.matchAll(WS)) ws = found[1]
    if (step.commits) {
      const printed = commitsIn(result.text)
      if (printed.length !== step.commits.length) return { kind: 'error', message: `${step.at} names ${step.commits.length} Commit(s) (${step.commits.join(', ')}) and its call printed ${printed.length}, so the scenario stops here` }
      step.commits.forEach((ref, i) => commits.set(ref, printed[i]))
    }
    index++
  }

  const step = steps[index]
  if (!step) return { kind: 'text', text: 'Done.', last: false }
  if (!woken(messages.length)) return { kind: 'text', text: 'Waiting for a message.', last: false }
  const missing = []
  const fill = (text) => text.replace(PLACEHOLDER, (all, what, ref) => {
    const value = what === 'sandbox' ? sandbox : what === 'ws' ? ws : commits.get(ref)
    if (value == null) missing.push(all)
    return value ?? all
  })
  if (step.kind === 'reply') {
    const text = fill(step.text)
    if (missing.length) return { kind: 'error', message: `${step.at}: the conversation shows no value for ${missing.join(', ')}` }
    return { kind: 'text', text, last: index === steps.length - 1 }
  }
  const { command, description, timeoutMs } = step.call.args
  const args = { command: fill(String(command)) }
  if (missing.length) return { kind: 'error', message: `${step.at}: the conversation shows no value for ${missing.join(', ')}` }
  if (description) args.description = description
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) args.timeout = Math.ceil(timeoutMs / 1000)
  return { kind: 'call', call: { name: 'bash', args }, say: step.say ?? null, step: step.at, phase: step.phase ?? null, done: index, of: steps.length }
}

/** Why a finished bash call does not match its step, or null when it does. */
function checkBash(step, callId, result, traceOf) {
  const exit = result.text.match(EXIT)
  if (result.isError && !exit) return `${step.at} (${step.call.args.description ?? 'bash'}) did not finish`
  const code = exit ? Number(exit[1]) : 0
  if (step.expect) {
    const lines = traceOf(callId)
    const codes = callCodes(lines ?? [])
    if (!inOrder(codes, step.expect)) return `${step.at} (${step.call.args.description ?? 'bash'}) expected ${step.expect.join(', ')}; its LayerFS calls show ${codes.length ? codes.join(', ') : 'nothing'}`
  }
  if (code !== step.exit) return `${step.at} (${step.call.args.description ?? 'bash'}) exited ${code}, and the step expects ${step.exit}`
  return null
}

/** The Commit ids a call printed, in order: the `head` of its Committed or Merged JSON lines. */
export function commitsIn(text) {
  const out = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{') || !t.includes('"head"')) continue
    let value
    try { value = JSON.parse(t) } catch { continue }
    if ((value?.kind === 'Committed' || value?.kind === 'Merged') && typeof value.head === 'string') out.push(value.head)
  }
  return out
}
