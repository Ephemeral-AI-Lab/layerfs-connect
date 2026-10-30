import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentManager } from '../agents/index.js'

async function fixture(t, { prepare, release, validate } = {}) {
  const state = await mkdtemp(join(tmpdir(), 'connect-workspace-lifecycle-'))
  const previous = { agent: process.env.PI_CODING_AGENT_DIR, temp: process.env.PI_SUBAGENTS_TEMP_ROOT }
  const calls = { prepared: [], released: [], model: 0, permissionsClosed: false }
  const workspaces = {
    initial: (id) => ({ branch: `chat-${id}`, state: 'pending', sandbox: null, path: null }),
    async prepare(record, changed) {
      calls.prepared.push(record.id)
      if (prepare) await prepare(record)
      Object.assign(record.workspace, { state: 'ready', sandbox: '1', path: '/workspaces/1' })
      changed()
    },
    async release(record, changed) {
      calls.released.push(record.id)
      if (release) await release(record)
      Object.assign(record.workspace, { state: 'closed', sandbox: null, path: null })
      changed()
    },
    exec: () => assert.fail('No command should execute in a lifecycle test'),
  }
  const manager = new AgentManager({
    state, agentDir: join(state, 'pi'), defaultCwd: state,
    projectEnvironment: validate ?? (async () => {}), projectWorkspaces: workspaces,
    models: {
      snapshot: () => ({ selected: {} }),
      resolve: () => { calls.model++; throw new Error('The configured model is unavailable.') },
    },
  })
  const stopped = new Set()
  manager.permissions = {
    stopped,
    cancelSession: (id) => stopped.add(id),
    resume: (id) => stopped.delete(id),
    forget: (id) => stopped.add(id),
    connection: (_id, runDir) => join(runDir, 'approval-connection.json'),
    close: async () => { calls.permissionsClosed = true },
  }
  t.after(async () => {
    await rm(state, { recursive: true, force: true })
    if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previous.agent
    if (previous.temp === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous.temp
  })
  const create = (project = 'project') => manager.create({ project, permissionMode: 'full' })
  return { state, manager, calls, workspaces, create }
}

test('stop cleans up a new workspace when its first preparation fails during opening', async (t) => {
  const entered = Promise.withResolvers()
  const preparation = Promise.withResolvers()
  const f = await fixture(t, { prepare: async (record) => {
    record.workspace.sandbox = '1'
    entered.resolve()
    await preparation.promise
  } })
  const chat = await f.create()
  const message = assert.rejects(f.manager.message(chat.id, { text: 'Start work' }), /Mount failed/)
  await entered.promise
  const stopping = f.manager.stop(chat.id)
  preparation.reject(new Error('Mount failed'))
  await message
  assert.equal((await stopping).state, 'idle')
  assert.deepEqual(f.calls.released, [chat.id])
  assert.equal(f.manager.record(chat.id).workspace.state, 'closed')
  assert.equal(f.manager.record(chat.id).needsStop, undefined)
})

test('an interrupted first open with no Pi session can stop and delete after model setup fails', async (t) => {
  const f = await fixture(t)
  const chat = await f.create()
  await assert.rejects(f.manager.message(chat.id, { text: 'Start work' }), /configured model is unavailable/)
  assert.equal(f.calls.model, 1)
  assert.equal(f.manager.record(chat.id).sessionFile, null)
  // A crash during opening restores needsStop, but no model ever ran.
  f.manager.record(chat.id).needsStop = true
  assert.equal((await f.manager.stop(chat.id)).state, 'idle')
  assert.equal(f.calls.model, 1, 'Stopping must not require the unavailable model again.')
  assert.deepEqual(await f.manager.remove(chat.id), { id: chat.id })
})

for (const evidence of ['persisted Pi session', 'unconfirmed child stop']) {
  test(`failed recovery retains the workspace when there is a ${evidence}`, async (t) => {
    const f = await fixture(t)
    const chat = await f.create()
    const record = f.manager.record(chat.id)
    record.needsStop = true
    if (evidence === 'persisted Pi session') record.sessionFile = join(f.state, 'previous-session.jsonl')
    else await writeFile(join(f.state, 'chats', chat.id, 'pending-subagent-stops.json'), '["unconfirmed-child"]')
    await assert.rejects(f.manager.stop(chat.id), /configured model is unavailable/)
    assert.equal(record.needsStop, true)
    assert.deepEqual(f.calls.released, [])
    assert.ok(f.manager.records.has(chat.id))
  })
}

test('failure of an already opening recovery cannot clear the child-stop obligation', async (t) => {
  const entered = Promise.withResolvers()
  const preparation = Promise.withResolvers()
  const f = await fixture(t, { prepare: async () => { entered.resolve(); await preparation.promise } })
  const chat = await f.create()
  const record = f.manager.record(chat.id)
  record.sessionFile = join(f.state, 'previous-session.jsonl')
  record.needsStop = true
  const opening = assert.rejects(f.manager.open(chat.id), /Recovery mount failed/)
  await entered.promise
  const stopping = assert.rejects(f.manager.stop(chat.id), /Recovery mount failed/)
  preparation.reject(new Error('Recovery mount failed'))
  await Promise.all([opening, stopping])
  assert.equal(record.needsStop, true)
  assert.deepEqual(f.calls.released, [])
})

test('project deletion blocks new work through the actual removal callback', async (t) => {
  const f = await fixture(t)
  const first = await f.create()
  const second = await f.create()
  const entered = Promise.withResolvers()
  const removal = Promise.withResolvers()
  const deleting = f.manager.removeProject('project', async () => { entered.resolve(); return removal.promise })
  await entered.promise
  for (const action of [
    () => f.create(),
    () => f.manager.message(first.id, { text: 'Race with deletion' }),
    () => f.manager.prepareWorkspace(second.id),
    () => f.manager.open(first.id),
    () => f.manager.executeWorkspace(first.id, { command: 'pwd' }, {}),
    () => f.manager.removeProject('project', async () => assert.fail('A second deletion started')),
  ]) await assert.rejects(action(), { status: 409, code: 'Busy' })
  assert.equal((await f.create('another-project')).project, 'another-project')
  removal.resolve({ removed: true })
  assert.deepEqual(await deleting, { removed: true })
  assert.equal(f.manager.deletingProjects.has('project'), false)
})

test('a failed project deletion releases its barrier for a retry', async (t) => {
  const f = await fixture(t)
  await f.create()
  await assert.rejects(f.manager.removeProject('project', async () => { throw new Error('Store is busy') }), /Store is busy/)
  assert.equal(f.manager.deletingProjects.has('project'), false)
  await f.create()
  assert.deepEqual(await f.manager.removeProject('project', async () => ({ removed: true })), { removed: true })
})

test('a conversation being created prevents deleting its project', async (t) => {
  const entered = Promise.withResolvers()
  const validation = Promise.withResolvers()
  const f = await fixture(t, { validate: async () => { entered.resolve(); await validation.promise } })
  const creating = f.create()
  await entered.promise
  await assert.rejects(f.manager.removeProject('project', async () => assert.fail('Project deletion raced with create')), { status: 409, code: 'Busy' })
  validation.resolve()
  await creating
  assert.equal(f.manager.creatingProjects.size, 0)
})

test('pending workspace preparation blocks project deletion and is drained before stop releases it', async (t) => {
  const entered = Promise.withResolvers()
  const preparation = Promise.withResolvers()
  const f = await fixture(t, { prepare: async () => { entered.resolve(); await preparation.promise } })
  const chat = await f.create()
  const preparing = f.manager.prepareWorkspace(chat.id)
  await entered.promise
  await assert.rejects(f.manager.removeProject('project', async () => assert.fail('Project deletion raced with prepare')), { status: 409, code: 'Busy' })
  const stopping = f.manager.stop(chat.id)
  await new Promise(setImmediate)
  assert.deepEqual(f.calls.released, [])
  preparation.resolve()
  await preparing
  await stopping
  assert.deepEqual(f.calls.released, [chat.id])
  assert.equal(f.manager.workspacePreparations.size, 0)
  assert.equal(f.manager.record(chat.id).workspace.state, 'closed')
})

test('close waits for every workspace cleanup before closing permissions and reporting failures', async (t) => {
  const bothEntered = Promise.withResolvers()
  const slowCleanup = Promise.withResolvers()
  let firstId
  let entered = 0
  const f = await fixture(t, { release: async (record) => {
    if (++entered === 2) bothEntered.resolve()
    if (record.id === firstId) throw new Error('First workspace is still busy')
    await slowCleanup.promise
  } })
  const first = await f.create()
  const second = await f.create()
  firstId = first.id
  for (const id of [first.id, second.id]) f.manager.record(id).workspace.sandbox = '1'
  let settled = false
  const closing = f.manager.close().finally(() => { settled = true })
  const rejected = assert.rejects(closing, (error) => error instanceof AggregateError && /First workspace is still busy/.test(error.message))
  await bothEntered.promise
  await new Promise(setImmediate)
  assert.equal(settled, false)
  assert.equal(f.calls.permissionsClosed, false)
  slowCleanup.resolve()
  await rejected
  assert.equal(f.manager.record(second.id).workspace.state, 'closed')
  assert.equal(f.calls.permissionsClosed, true)
})
