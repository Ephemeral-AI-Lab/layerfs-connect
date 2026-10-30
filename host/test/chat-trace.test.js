// A chat's Trace (agents/trace.js): Pi's log and the chat's trace lines read
// as a run's Trace rows (runs/trajectory.js).
//   node --import ./host/resolve-layerfs.js --test host/test/chat-trace.test.js
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chatLive, chatTrace } from '../agents/trace.js'

const ts = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
const msg = (id, n, message) => ({ type: 'message', id, timestamp: ts(n), message })

test('each tool call is a step with its LayerFS calls, exit and auto-checkpoints; a scenario\'s checks end the rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-trace-'))
  try {
    mkdirSync(join(dir, 'traces'))
    const line = (o) => JSON.stringify({ layerfs_trace: 1, step: 'root:call-1', start: ts(3), ...o })
    writeFileSync(join(dir, 'traces', 'root.jsonl'), [
      line({ id: 'a', method: 'branch.fork', args: { branch: 'feature' }, phase: 'start' }),
      line({ id: 'a', method: 'branch.fork', args: { branch: 'feature' }, phase: 'end', ok: true, kind: 'Forked', ms: 2.4 }),
      line({ id: 'b', method: 'fs.apply', args: { branch: 'feature', path: '/a' }, phase: 'end', ok: false, code: 'CONFLICT', ms: 5 }),
      JSON.stringify({ layerfs_trace: 1, step: 'helper:call-9', id: 'c', method: 'x.y', phase: 'end', ok: true }),
      '{"layerfs_trace":1,"step":"root:call-1","id":"d"', // a line being written
    ].join('\n'))
    const entries = [
      { type: 'model_change', id: 'm0', timestamp: ts(0), provider: 'p', modelId: 'one' },
      msg('s', 0, { role: 'system', content: 'You are…' }),
      msg('u', 1, { role: 'user', content: [{ type: 'text', text: 'Fork a branch' }] }),
      msg('a1', 2, { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'layerfs fork', description: 'Fork feature' } }], provider: 'p', model: 'one', usage: { input: 1200, output: 30 }, stopReason: 'toolUse', durationMs: 400 }),
      msg('r1', 4, { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash', content: [{ type: 'text', text: 'out\n\nCommand exited with code 2' }], isError: true, durationMs: 1500 }),
      msg('a2', 6, { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stopReason: 'stop' }),
    ]
    const record = { state: 'idle', created: Date.parse(ts(0)), updated: Date.parse(ts(7)), scenario: { state: 'passed', folder: 'tour_1', checks: [{ name: 'main.landed', ok: true, detail: 'fast-forward' }], error: null } }
    const page = chatTrace({ record, entries, dir })
    assert.deepEqual(page.records.map((r) => r.kind), ['system', 'user', 'assistant', 'tool', 'layerfs', 'layerfs', 'assistant', 'check'])
    const tool = page.records.find((r) => r.kind === 'tool')
    assert.deepEqual([tool.title, tool.exitCode, tool.status, tool.calls], ['Fork feature', 2, 'failed', 2])
    assert.equal(tool.output, 'out\n\nCommand exited with code 2')
    assert.deepEqual(tool.checkpoints, [1])
    assert.deepEqual(tool.writes.map((w) => [w.kind, w.status, w.checkpoint]), [['fork', 'ok', 1], ['file', 'failed', null]])
    const [fork, apply] = page.records.filter((r) => r.kind === 'layerfs')
    assert.deepEqual([fork.title, fork.outcome, fork.parent], ['branch.fork', 'Forked', tool.id])
    assert.deepEqual([apply.status, apply.outcome], ['failed', 'CONFLICT'])
    assert.equal(page.records.at(-1).title, 'main.landed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a chat\'s Live: its newest calls from every agent, what it holds now, and nothing running once it stops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-live-'))
  try {
    const line = (o) => JSON.stringify({ layerfs_trace: 1, step: 'root:call-1', start: ts(1), ...o })
    writeFileSync(join(dir, 'root.jsonl'), [
      line({ id: 's', method: 'sandbox.create', phase: 'end', ok: true, sandbox: '1' }),
      line({ id: 'm', method: 'workspace.mount', args: { sandbox: '1', branch: 'shop_1.main' }, path: '/workspaces/1', sandbox: '1', phase: 'end', ok: true }),
      line({ id: 'x', method: 'workspace.exec', args: { sandbox: '1', path: '/workspaces/1', command: 'npm test' }, phase: 'start' }),
      '{"layerfs_trace":1,"id":"y"', // a line being written
    ].join('\n'))
    writeFileSync(join(dir, 'helper.jsonl'), line({ id: 'h', step: 'helper:call-2', method: 'branch.fork', args: { branch: 'shop_1.side' }, phase: 'end', ok: false, code: 'EXISTS' }))
    const working = chatLive(dir, { running: true })
    assert.deepEqual(working.calls.map((c) => [c.agent, c.id, c.ok]), [['helper', 'h', false], ['root', 's', true], ['root', 'm', true], ['root', 'x', null]])
    assert.deepEqual(working.live.sandboxes.map((s) => s.id), ['1'])
    assert.deepEqual(working.live.mounts.map((m) => [m.sandbox, m.path, m.branch]), [['1', '/workspaces/1', 'shop_1.main']])
    assert.deepEqual(working.live.running.map((r) => [r.id, r.command]), [['x', 'npm test']])
    assert.equal(working.live.last.helper.code, 'EXISTS')
    assert.deepEqual(chatLive(dir).live.running, [])
    assert.deepEqual(chatLive(join(dir, 'none')), { calls: [], live: { running: [], mounts: [], sandboxes: [], last: {} } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
