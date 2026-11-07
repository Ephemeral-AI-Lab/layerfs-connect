import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withStepViews } from '../agents/step-views.js'

const line = (o) => JSON.stringify({ layerfs_trace: 1, ...o })

test('a bash call gets its segments and the LayerFS calls its trace recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'step-views-'))
  const traces = join(dir, 'traces')
  mkdirSync(traces)
  const start = { id: 'a-1', step: 'root:call_1', method: 'branch.fork', start: '2026-11-04T01:34:41.937Z', phase: 'start', args: {} }
  writeFileSync(join(traces, 'root.jsonl'), [
    line(start),
    line({ ...start, phase: 'end', ms: 12, ok: true, branch: 'feature' }),
    line({ id: 'b-1', step: 'root:other', method: 'file.read', start: '2026-11-04T01:34:42.000Z', phase: 'end', ms: 3, ok: true }),
  ].join('\n'))
  const messages = [
    { id: 'u1', role: 'user', text: 'go' },
    { id: 'call_1', role: 'tool', toolName: 'bash', args: { command: 'layerfs branch fork shop/api feature main\necho done' }, text: 'done', status: 'done' },
    { id: 'call_2', role: 'tool', toolName: 'subagent', args: { task: 'x' }, text: '', status: 'done' },
  ]
  const out = withStepViews(messages, traces)
  assert.equal(out[0], messages[0])
  assert.equal(out[2], messages[2])
  const { view } = out[1]
  assert.deepEqual(view.segments.map((s) => [s.form, s.call ?? null, s.lines]), [['cli', 'branch.fork', [1, 1]], ['shell', null, [2, 2]]])
  assert.equal(view.calls.length, 1)
  assert.equal(view.calls[0].method, 'branch.fork')
  assert.equal(view.calls[0].ok, true)
})

test('messages without bash calls come back as they are; a call with no trace has no calls', () => {
  const traces = join(mkdtempSync(join(tmpdir(), 'step-views-')), 'traces')
  const plain = [{ id: 'u1', role: 'user', text: 'hi' }]
  assert.equal(withStepViews(plain, traces), plain)
  const [message] = withStepViews([{ id: 'c', role: 'tool', toolName: 'bash', args: { command: 'ls' }, text: '', status: 'done' }], traces)
  assert.deepEqual(message.view.calls, [])
  assert.equal(message.view.segments[0].form, 'shell')
})

test("a subagent's bash calls read its own trace file, labelled with its agent name", () => {
  const traces = join(mkdtempSync(join(tmpdir(), 'step-views-')), 'traces')
  mkdirSync(traces)
  const agent = 'child-1234'
  const start = { id: 'c-1', step: `${agent}:call_9`, method: 'sandbox.create', start: '2026-11-04T01:34:41.937Z', phase: 'start', args: {} }
  writeFileSync(join(traces, `${agent}.jsonl`), [line(start), line({ ...start, phase: 'end', ms: 40, ok: true })].join('\n'))
  // the root's trace has a line with the same call id: it is not the child's
  writeFileSync(join(traces, 'root.jsonl'), line({ ...start, step: 'root:call_9', method: 'branch.fork', phase: 'end', ok: true }))
  const messages = [{ id: 'call_9', role: 'tool', toolName: 'bash', args: { command: 'layerfs sandbox create shop/api sb1 native' }, text: '', status: 'done' }]
  assert.deepEqual(withStepViews(messages, traces, agent)[0].view.calls.map((c) => c.method), ['sandbox.create'])
  assert.deepEqual(withStepViews(messages, traces)[0].view.calls.map((c) => c.method), ['branch.fork'])
})
