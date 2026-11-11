import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chatLive } from '../agents/trace.js'
import { LiveState } from '../runs/live.js'

const line = (id, method, time, fields = {}) => ({ layerfs_trace: 1, id, method, start: new Date(time).toISOString(), ...fields })
test('named workspace use joins the mount handle and releases it across agents', () => {
  const state = new LiveState()
  state.ended(line('m', 'workspace.mount', 1000, { ok: true, sandbox: 's', path: '/workspaces/123', ws: 's:feature', branch: 'feature' }), 'parent')
  state.started(line('x', 'workspace.exec', 1100, { ws: 's:feature', args: { ws: 's:feature', command: 'true' } }), 'child')
  assert.deepEqual(state.view().mounts[0].users, ['parent', 'child'])
  assert.equal(state.view().running[0].branch, 'feature')
  state.ended(line('x', 'workspace.exec', 1100, { ok: true, ws: 's:feature' }), 'child')
  state.ended(line('u', 'workspace.unmount', 1200, { ok: true, ws: 's:feature' }), 'child')
  assert.equal(state.view().mounts.length, 0)
  assert.equal(state.view().running.length, 0)
})
test('live calls with the same local id remain distinct across agents', () => {
  const state = new LiveState()
  state.started(line('1', 'file.read', 1000), 'root')
  state.started(line('1', 'file.read', 1000), 'child')
  state.ended(line('1', 'file.read', 1000, { ok: true }), 'root')
  assert.deepEqual(state.view().running.map(call => call.agent), ['child'])
})
test('cross-agent replay orders lifecycle events and incrementally accepts partial appended lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sandbox-live-'))
  const write = (name, rows) => writeFileSync(join(dir, name + '.jsonl'), rows.map(JSON.stringify).join('\n') + '\n')
  try {
    write('z-owner', [line('m', 'workspace.mount', 1000, { ok: true, sandbox: 's', ws: 's:named', path: '/workspaces/1', branch: 'feature' })])
    write('a-helper', [line('u', 'workspace.unmount', 2000, { ok: true, ws: 's:named' })])
    assert.equal(chatLive(dir, { running: true }).live.mounts.length, 0)
    appendFileSync(join(dir, 'z-owner.jsonl'), JSON.stringify(line('x', 'workspace.exec', 3000, { phase: 'start', ws: 's:other' })).slice(0, -1))
    assert.equal(chatLive(dir, { running: true }).live.running.length, 0)
    appendFileSync(join(dir, 'z-owner.jsonl'), '}\n')
    assert.equal(chatLive(dir, { running: true }).live.running.length, 1)
    assert.equal(chatLive(dir).live.running.length, 0)
    assert.equal(chatLive(dir, { running: true }).live.running.length, 0, 'A future prompt must not revive an interrupted call')
    write('z-owner', [line('n', 'sandbox.create', 4000, { ok: true, sandbox: 'fresh' })])
    assert.equal(chatLive(dir, { running: true }).live.running.length, 0, 'Truncation resets the projection')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('late completion of an older named mount cannot remove the newer instance', () => {
  const state = new LiveState()
  state.ended(line('old', 'workspace.mount', 1000, { ok: true, ws: 's:named', path: '/workspaces/1', branch: 'old' }), 'root')
  state.ended(line('fresh', 'workspace.mount', 3000, { ok: true, ws: 's:named', path: '/workspaces/2', branch: 'fresh' }), 'root')
  state.ended(line('late', 'workspace.unmount', 2000, { ok: true, ws: 's:named' }), 'child')
  assert.equal(state.view().mounts[0].branch, 'fresh')
})
