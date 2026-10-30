import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ApprovalService } from '../agents/permissions.js'
import { updateSession } from '../agents/session-metadata.js'

function fixture() {
  const record = { id: 'chat', title: 'Original', state: 'idle', project: 'project', children: [], archived: false, workspace: { branch: 'chat-original', head: 'saved-commit', state: 'ready' } }
  const changes = []
  const manager = {
    historyOperations: new Map(), stopping: new Map(),
    record: () => record,
    detail: () => structuredClone(record),
    checkProjectAvailable: () => {},
    checkHistoryAvailable: (id) => { if (manager.historyOperations.has(id)) throw Object.assign(new Error('History is busy'), { status: 409 }) },
    stop: async () => { record.workspace.state = 'closed' },
    changed: (id, persist) => changes.push({ id, persist }),
  }
  return { manager, record, changes }
}

test('rename and archive preserve conversation and file history; restore does not start work', async () => {
  const { manager, record, changes } = fixture()
  record.state = 'running'
  await updateSession(manager, 'chat', { title: '  A useful title  ' })
  assert.equal(record.title, 'A useful title')
  assert.throws(() => updateSession(manager, 'chat', { archived: true }), { status: 409 })
  record.state = 'idle'
  const archived = await updateSession(manager, 'chat', { archived: true })
  assert.equal(archived.archived, true)
  assert.equal(typeof archived.archivedAt, 'number')
  assert.deepEqual(archived.workspace, { branch: 'chat-original', head: 'saved-commit', state: 'closed' })
  let stops = 0
  manager.stop = async () => { stops++ }
  const restored = await updateSession(manager, 'chat', { archived: false })
  assert.equal(restored.archived, false)
  assert.equal(restored.archivedAt, null)
  assert.equal(stops, 0)
  assert.equal(changes.every((change) => change.persist), true)
})

test('archive holds a barrier through workspace cleanup, and failed cleanup does not archive', async () => {
  const { manager, record } = fixture()
  const cleanup = Promise.withResolvers()
  manager.stop = () => cleanup.promise
  const archiving = updateSession(manager, 'chat', { archived: true })
  assert.throws(() => updateSession(manager, 'chat', { title: 'Concurrent change' }), { status: 409 })
  assert.equal(record.archived, false)
  cleanup.reject(new Error('Workspace is busy'))
  await assert.rejects(archiving, /Workspace is busy/)
  assert.equal(record.archived, false)
  assert.equal(manager.historyOperations.size, 0)
  await updateSession(manager, 'chat', { title: 'Retry rename' })
  assert.equal(record.title, 'Retry rename')
})

test('invalid metadata never replaces a saved title or archive state', () => {
  const { manager, record } = fixture()
  for (const input of [{ title: 1 }, { title: '' }, { title: ' '.repeat(5) }, { title: 'x'.repeat(121) }, { archived: 'yes' }]) {
    assert.throws(() => updateSession(manager, 'chat', input), { status: 400 })
  }
  assert.equal(record.title, 'Original')
  assert.equal(record.archived, false)
})

test('context bridge is session authenticated, readonly, and unavailable after Stop', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'connect-harness-service-'))
  const calls = []
  const manager = { context: async (id) => { calls.push(id); return { instructions: [{ path: '/workspace/AGENTS.md', content: 'Project guidance' }] } } }
  const service = await new ApprovalService(manager).start()
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }) })
  const connection = JSON.parse(await readFile(service.connection('chat', dir), 'utf8'))
  const request = (body, token = connection.token) => fetch(`${connection.url}/context`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  assert.equal((await request({ sessionId: 'chat' }, 'wrong-token')).status, 401)
  assert.equal((await request({ sessionId: 'other' })).status, 403)
  const result = await request({ sessionId: 'chat' })
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { instructions: [{ path: '/workspace/AGENTS.md', content: 'Project guidance' }] })
  assert.deepEqual(calls, ['chat'])
  assert.equal(service.pending.size, 0)
  service.cancelSession('chat')
  assert.equal((await request({ sessionId: 'chat' })).status, 409)
  assert.deepEqual(calls, ['chat'])
})
