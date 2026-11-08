import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cancelExecs, registerExec } from '../agents/exec-cancel.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentWorkspaces } from '../agents/workspaces.js'

function fixture(exec, commit = async () => ({ kind: 'UpToDate' })) {
  const record = { id: 'a', workspace: { handle: 'box:chat', state: 'ready', commitCount: 0 } }
  const cancels = []
  const manager = new AgentWorkspaces({ projects: { lfs: { workspace: { exec, commit, exec_cancel: async (ws, id) => { cancels.push({ ws, id }); return { outcome: 'ended' } } } } } })
  manager.open = async () => {}
  return { manager, record, cancels }
}
test('fresh exec IDs are persisted before launch and frames above 1MiB are retained once', { timeout: 3000 }, async () => {
  const out = [], ids = [], persisted = []
  let f
  f = fixture(async (ws, command, options) => {
    assert.equal(f.record.workspace.execution.ws, ws)
    assert.equal(persisted.at(-1), options.exec_id)
    ids.push(options.exec_id)
    options.stdout(Buffer.alloc(1024 * 1024 + 3, 65))
    return { kind: 'exit:125', exit_code: 125, stdout: 'duplicate', stdout_bytes: 1024 * 1024 + 3 }
  })
  for (let n = 0; n < 2; n++) assert.equal((await f.manager.run(f.record, { command: 'test' }, { onChange: () => persisted.push(f.record.workspace.execution?.exec_id), onData: bytes => out.push(bytes) })).exitCode, 125)
  assert.notEqual(ids[0], ids[1])
  assert.equal(Buffer.concat(out).length, 2 * (1024 * 1024 + 3))
})
test('pre-registration cancel is sent once even after ended and double Stop', { timeout: 3000 }, async () => {
  const controller = new AbortController(), started = Promise.withResolvers(), finished = Promise.withResolvers()
  const f = fixture(async () => { started.resolve(); await finished.promise; return { kind: 'cancelled', exit_code: 137 } })
  const task = f.manager.run(f.record, { command: 'sleep 30' }, { signal: controller.signal })
  await started.promise
  controller.abort()
  await Promise.all([f.manager.cancel(f.record), f.manager.cancel(f.record)])
  assert.equal(f.cancels.length, 1)
  finished.resolve()
  assert.equal((await task).exitCode, 137)
  assert.equal(f.record.workspace.state, 'ready')
})
test('Stop pending before launch never spawns, and Commit refusal preserves command outcome', { timeout: 3000 }, async () => {
  const controller = new AbortController()
  const f = fixture(async () => assert.fail('queued command launched'))
  await assert.rejects(f.manager.run(f.record, { command: 'test' }, { signal: controller.signal, onChange: () => controller.abort() }), { name: 'AbortError' })
  const g = fixture(async () => ({ kind: 'exit:0', exit_code: 0 }), async () => { throw Object.assign(new Error('changed head'), { code: 'Conflict' }) })
  const out = []
  const result = await g.manager.run(g.record, { command: 'test' }, { onData: data => out.push(data) })
  assert.equal(result.exitCode, 0)
  assert.equal(result.saveError.code, 'Conflict')
  assert.match(Buffer.concat(out).toString(), /Not saved: Conflict/)
})


test('unknown cancellation is not replayed; explicit retry requires fresh Workspace status', { timeout: 3000 }, async () => {
  const f = fixture(async () => {})
  f.record.workspace.execution = { ws: 'box:chat', exec_id: 'unknown-launch', finished: false }
  const calls = []
  f.manager.lfs.workspace.exec_cancel = async () => { calls.push('cancel'); if (calls.length === 1) throw Object.assign(new Error('lost reply'), { code: 'Unknown' }); return { outcome: 'cancelled', signal: 'SIGTERM' } }
  f.manager.lfs.workspace.status = async () => { calls.push('status'); return { base: null } }
  assert.equal((await f.manager.cancel(f.record)).outcome, 'unknown')
  assert.equal((await f.manager.cancel(f.record)).outcome, 'unknown')
  assert.deepEqual(calls, ['cancel'])
  assert.equal((await f.manager.cancel(f.record, undefined, true)).outcome, 'cancelled')
  assert.deepEqual(calls, ['cancel', 'status', 'cancel'])
})


test('lost CLI transport retains unfinished remote launch custody for explicit Stop', { timeout: 3000 }, async () => {
  const f = fixture(async (_ws, _command, options) => {
    options.on_spawn(12345)
    throw Object.assign(new Error('lost final reply'), { code: 'Unknown', transport: 'transport-unknown' })
  })
  await assert.rejects(f.manager.run(f.record, { command: 'sleep 30' }, {}), /lost final reply/)
  assert.equal(f.record.workspace.execution.finished, false)
  assert.equal(f.record.workspace.execution.pid, 12345)
  assert.match(f.record.workspace.execution.error, /may still be running/)
  await f.manager.cancel(f.record)
  assert.deepEqual(f.cancels, [{ ws: 'box:chat', id: f.record.workspace.execution.exec_id }])
})


test('folder launch retry observes fresh status and never resends when that read fails', { timeout: 3000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'connect-registry-cancel-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  registerExec(directory, { ws: 'box:chat', exec_id: 'owned-launch', cli: '/owned/layerfs', home: '/owned/home' })
  const file = join(directory, 'owned-launch.json')
  const calls = []
  const first = await cancelExecs(directory, async (_spec, argv) => { calls.push(argv[1]); throw Object.assign(new Error('lost reply'), { code: 'Unknown' }) })
  assert.equal(first[0].outcome, 'unknown')
  assert.deepEqual(calls, ['exec-cancel'])
  calls.length = 0
  await cancelExecs(directory, async (_spec, argv, options) => { calls.push(argv[1]); assert.equal(options.read, true); throw Object.assign(new Error('cannot observe'), { code: 'Unavailable' }) })
  assert.deepEqual(calls, ['status'])
  assert.equal(JSON.parse(readFileSync(file)).cancel.outcome, 'unknown')
  calls.length = 0
  await cancelExecs(directory, async (_spec, argv) => { calls.push(argv[1]); return argv[1] === 'status' ? { base: 'saved-pin' } : { outcome: 'cancelled', signal: 'SIGTERM' } })
  assert.deepEqual(calls, ['status', 'exec-cancel'])
  const retained = JSON.parse(readFileSync(file))
  assert.equal(retained.observation.base, 'saved-pin')
  assert.equal(retained.cancel.outcome, 'cancelled')
})


test('Stop drains rejected output delivery without losing cancellation or partial Save facts', { timeout: 3000 }, async () => {
  const controller = new AbortController()
  let saves = 0
  const f = fixture(async (_ws, _command, options) => {
    options.on_spawn(12345)
    controller.abort()
    options.stdout(Buffer.from('partial output'))
    return { kind: 'cancelled', exit_code: 143, stop: 'SIGTERM' }
  }, async () => { saves++; throw Object.assign(new Error('changed head'), { code: 'Conflict' }) })
  const result = await f.manager.run(f.record, { command: 'test' }, { signal: controller.signal, onData: async () => { throw new DOMException('The stream was cancelled', 'AbortError') } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(result.kind, 'cancelled')
  assert.equal(result.exitCode, 143)
  assert.equal(result.saveError.code, 'Conflict')
  assert.equal(saves, 1)
  assert.equal(f.record.workspace.execution.finished, true)
  assert.equal(f.record.workspace.execution.result.exit_code, 143)
  assert.equal(f.record.workspace.handle, 'box:chat')
})

test('an output consumer failure is handled after preserving the completed command and Save', { timeout: 3000 }, async () => {
  const delivery = new Error('output connection failed')
  let saves = 0
  const f = fixture(async (_ws, _command, options) => {
    options.stdout(Buffer.from('first'))
    return { kind: 'exit:0', exit_code: 0 }
  }, async () => { saves++; return { kind: 'UpToDate' } })
  await assert.rejects(f.manager.run(f.record, { command: 'test' }, { onData: async () => { await Promise.resolve(); throw delivery } }), delivery)
  assert.equal(saves, 1)
  assert.equal(f.record.workspace.execution.finished, true)
  assert.equal(f.record.workspace.execution.result.exit_code, 0)
})
