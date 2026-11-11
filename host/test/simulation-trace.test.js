import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { traceSimulationStep } from '../simulations/trace.js'
import { chatCalls } from '../agents/trace.js'

test('real simulation calls attach confirmed and failed receipts to the matching main or child Bash step', async t => {
  const state = mkdtempSync(join(tmpdir(), 'simulation-trace-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const context = { state, chatId: 'chat', sessionId: 'pi-worker', toolCallId: 'tool-1', argv: ['branch', 'fork', 'store/project', 'feature', 'main'] }
  let executions = 0
  const receipt = await traceSimulationStep(context, async () => { executions++; return { head: 'confirmed-head' } })
  assert.equal(receipt.head, 'confirmed-head')
  const main = chatCalls(join(state, 'chats/chat/traces')).get('tool-1')
  assert.equal(main.length, 1)
  assert.equal(main[0].commit, 'confirmed-head')
  assert.equal(main[0].ok, true)
  assert.equal(main[0].method, 'branch.fork')
  await assert.rejects(traceSimulationStep({ ...context, agentId: 'a01-worker', toolCallId: 'tool-2', argv: ['workspace', 'commit', 'box:mounted', '--message', 'Checkpoint'] }, async () => { executions++; throw Object.assign(new Error('Confirmed refusal'), { code: 'NotMounted' }) }), /Confirmed refusal/)
  const child = chatCalls(join(state, 'chats/chat/traces'), 'child-pi-worker').get('tool-2')
  assert.equal(child.length, 1)
  assert.equal(child[0].ok, false)
  assert.equal(child[0].code, 'NotMounted')
  assert.equal(child[0].sandbox, 'box')
  assert.equal(child[0].path, 'mounted')
  assert.equal(executions, 2, 'Tracing never replays an invocation')
})
