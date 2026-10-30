// A scenario chat's scripted model (agents/scenario-plan.js): which scenarios
// play in a chat, and the next answer worked out from Pi's messages.
//   node --test host/test/scenario-chat.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileScenario } from '../../tools/lib/scenario.mjs'
import { chatReady, nextReply } from '../agents/scenario-plan.js'

const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const load = (id) => compileScenario(JSON.parse(readFileSync(join(SCENARIOS, id, 'scenario.json'), 'utf8')), { name: id, folder: join(SCENARIOS, id) })

/** The steps of a scenario of one agent, in order. */
const steps = (scenario) => Object.values(scenario.agents)[0]

/** What a step's call prints: a Sandbox and Workspace, and one Committed line per Commit it names. */
const output = (step) => ['{"sandbox":"1","ws":"1:/w"}', ...(step.commits ?? []).map((ref) => JSON.stringify({ kind: 'Committed', head: `head-${ref}` }))].join('\n')

/** Pi's messages after `n` of the scenario's calls held: each call's result exits as its step expects. */
function played(scenario, n, result = (step) => ({ text: step.exit ? `${output(step)}\n\nCommand exited with code ${step.exit}` : output(step), isError: step.exit !== 0 })) {
  const messages = [{ role: 'user', content: 'go', timestamp: 0 }]
  let calls = 0
  for (const [i, step] of steps(scenario).entries()) {
    if (calls === n) break
    if (step.kind === 'reply') { messages.push({ role: 'assistant', content: [{ type: 'text', text: step.text }], stopReason: 'stop' }); continue }
    const id = `call-${i}`
    messages.push({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'bash', arguments: { command: step.call.args.command } }], stopReason: 'toolUse' })
    const { text, isError } = result(step)
    messages.push({ role: 'toolResult', toolCallId: id, toolName: 'bash', content: [{ type: 'text', text }], isError })
    calls++
  }
  return messages
}

/** Trace lines that satisfy every step's `expect`. */
const tracesFor = (scenario) => (callId) => {
  const step = steps(scenario)[Number(callId.split('-')[1])]
  return (step.expect ?? []).map((want) => {
    const [method, outcome] = want.includes('.') ? [want.slice(0, want.indexOf(':')), want.slice(want.indexOf(':') + 1).split('|')[0]] : ['x.y', want]
    return { layerfs_trace: 1, method, ok: true, kind: outcome }
  })
}

test('the scenarios of one agent with bash steps play in a chat; the others say why not', () => {
  for (const id of ['tour', 'conflicts', 'merge', 'shop', 'depot']) assert.equal(chatReady(load(id)), null, id)
  assert.match(chatReady(load('crew')), /agents/)
  assert.match(chatReady(load('sandbox')), /background/)
  assert.match(chatReady(load('teams')), /sessions/)
})

test('a chat starts with the first step and goes on one call at a time', () => {
  const tour = load('tour')
  const first = nextReply(tour, [{ role: 'user', content: 'go', timestamp: 0 }], () => [])
  assert.equal(first.kind, 'call')
  assert.equal(first.call.name, 'bash')
  assert.equal(first.done, 0)
  const second = nextReply(tour, played(tour, 1), tracesFor(tour))
  assert.equal(second.kind, 'call')
  assert.equal(second.done, 1)
})

test('the script\'s last reply is marked last, and a chat past it answers Done.', () => {
  const tour = load('tour')
  const calls = steps(tour).filter((s) => s.kind === 'call').length
  const final = nextReply(tour, played(tour, calls), tracesFor(tour))
  assert.equal(final.kind, "text", final.message)
  assert.equal(final.last, true)
  const after = played(tour, calls)
  after.push({ role: 'assistant', content: [{ type: 'text', text: final.text }], stopReason: 'stop' })
  assert.deepEqual(nextReply(tour, after, tracesFor(tour)), { kind: 'text', text: 'Done.', last: false })
})

test('an expected non-zero exit holds; another exit, or a missing expect code, stops the scenario', () => {
  const conflicts = load('conflicts')
  const at = steps(conflicts).findIndex((s) => s.kind === 'call' && s.exit === 125)
  const callsBefore = steps(conflicts).slice(0, at).filter((s) => s.kind === 'call').length
  // the 125 step itself holds
  const held = nextReply(conflicts, played(conflicts, callsBefore + 1), tracesFor(conflicts))
  assert.equal(held.kind, 'call', held.message)
  // exit 0 where 125 is expected stops it
  const wrongExit = played(conflicts, callsBefore + 1, (step) => ({ text: output(step), isError: false }))
  assert.match(nextReply(conflicts, wrongExit, tracesFor(conflicts)).message, /exited 0, and the step expects 125/)
  // no trace lines where the step expects LayerFS calls
  const tour = load('tour')
  assert.match(nextReply(tour, played(tour, 1), () => []).message, /expected .*its LayerFS calls show nothing/)
})

test('a stopped call does not count, and a call that did not finish stops the scenario', () => {
  const tour = load('tour')
  const messages = played(tour, 1, () => ({ text: 'out\n\nCommand aborted', isError: true }))
  assert.match(nextReply(tour, messages, tracesFor(tour)).message, /did not finish/)
  // an aborted answer (its call never ran) is skipped: the chat goes on from the step before
  const aborted = played(tour, 1)
  aborted.push({ role: 'assistant', content: [], stopReason: 'aborted' })
  assert.equal(nextReply(tour, aborted, tracesFor(tour)).done, 1)
})
