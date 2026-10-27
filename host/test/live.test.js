// runs/live.js: what agents hold, from their trace lines.
//   node --test host/test/live.test.js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LiveState } from '../runs/live.js'

const line = (id, method, fields = {}) => ({ layerfs_trace: 1, id, method, start: '2026-10-27T02:00:00.000Z', ...fields })

test('a mount belongs to its agent until its unmount; exec shows running, then as the last command', () => {
  const live = new LiveState()
  live.ended(line('1', 'sandbox.create', { ok: true, sandbox: '1', ms: 400 }), 'root')
  live.ended(line('2', 'workspace.mount', { ok: true, args: { sandbox: '1', branch: 'header' }, sandbox: '1', path: '/workspaces/1', branch: 'header' }), 'ava')
  live.started(line('3', 'workspace.exec', { args: { sandbox: '1', path: '/workspaces/1', command: 'npm test' } }), 'ava')
  let v = live.view()
  assert.deepEqual(v.sandboxes.map((s) => [s.id, s.agent]), [['1', 'root']])
  assert.equal(v.mounts.length, 1)
  assert.deepEqual([v.mounts[0].agent, v.mounts[0].branch, v.mounts[0].path], ['ava', 'header', '/workspaces/1'])
  assert.deepEqual(v.running.map((c) => [c.agent, c.method, c.command]), [['ava', 'workspace.exec', 'npm test']])

  live.ended(line('3', 'workspace.exec', { ok: true, kind: 'exit:0', args: { sandbox: '1', path: '/workspaces/1', command: 'npm test' } }), 'ava')
  live.ended(line('4', 'workspace.commit', { ok: true, args: { sandbox: '1', path: '/workspaces/1' } }), 'ava')
  v = live.view()
  assert.equal(v.running.length, 0)
  assert.deepEqual(v.mounts[0].last && [v.mounts[0].last.command, v.mounts[0].last.kind], ['npm test', 'exit:0'])
  assert.equal(v.mounts[0].commits, 1)
  assert.equal(v.last.ava.method, 'workspace.commit')

  live.ended(line('5', 'workspace.unmount', { ok: true, args: { sandbox: '1', path: '/workspaces/1' } }), 'ava')
  assert.equal(live.view().mounts.length, 0)
})

test('a failed mount holds nothing; a Sandbox close drops its mounts; a stop clears running calls', () => {
  const live = new LiveState()
  live.ended(line('1', 'workspace.mount', { ok: false, code: 'Busy', args: { sandbox: '2', branch: 'x' } }), 'root')
  assert.equal(live.view().mounts.length, 0)
  assert.equal(live.view().last.root.code, 'Busy')
  live.ended(line('2', 'workspace.mount', { ok: true, sandbox: '2', path: '/workspaces/1', branch: 'x' }), 'root')
  live.ended(line('3', 'sandbox.close', { ok: true, args: { sandbox: '2' } }), 'root')
  assert.equal(live.view().mounts.length, 0)
  live.started(line('4', 'fs.read', { args: { branch: 'x', path: '/a' } }), 'root')
  live.stopped()
  assert.equal(live.view().running.length, 0)
})
