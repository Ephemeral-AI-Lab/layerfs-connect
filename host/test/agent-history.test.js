import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import test, { after } from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { AgentManager } from '../agents/index.js'
import { agentRoute } from '../agents/routes.js'
import { sessionTranscript } from '../agents/transcript.js'
import { CHECKPOINT_TYPE, checkpointFor } from '../agents/history.js'

const state = await mkdtemp(join(tmpdir(), 'connect-history-state-'))
after(() => rm(state, { recursive: true, force: true }))
const text = (value) => typeof value === 'string' ? value : (value ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
const users = (session) => session.messages.filter((message) => message.role === 'user')

async function fixture(t, workspaces) {
  const dir = await mkdtemp(join(tmpdir(), 'connect-history-'))
  const cwd = join(dir, 'work')
  await mkdir(cwd)
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const part of req) raw += part
    const request = JSON.parse(raw)
    requests.push(request)
    const prompt = text(request.messages.findLast((message) => message.role === 'user')?.content)
    const id = randomUUID()
    const chunk = (delta, finish_reason = null) => ({ id, object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: `Answer to ${prompt}` }))}\n\n`)
    if (prompt.includes('WAIT')) await pause(120)
    res.end(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\ndata: [DONE]\n\n`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let manager
  const open = async () => {
    manager = await AgentManager.create({ state, defaultCwd: cwd, projectEnvironment: async () => ({}), projectWorkspaces: workspaces })
  }
  await open()
  await manager.models.configure({ provider: 'history-fixture', modelId: 'fixture-model', api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-history-key' })
  t.after(async () => {
    await manager.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  const settle = async (id) => {
    for (let count = 0; count < 400; count++) {
      const session = manager.detail(id)
      if (session.state !== 'running') return session
      await pause(10)
    }
    throw new Error('Conversation did not settle.')
  }
  const send = async (id, value) => { await manager.message(id, { text: value }); return settle(id) }
  return { cwd, requests, settle, send, get manager() { return manager }, restart: async () => { await manager.close(); await open() } }
}

function fakeWorkspaces() {
  const checkpoints = []
  const restores = []
  let beforeCheckpoint = async () => {}, beforeRestore = async () => {}, beforeFork = async () => {}, beforeRelease = async () => {}
  return {
    checkpoints, restores,
    set beforeCheckpoint(value) { beforeCheckpoint = value },
    set beforeRestore(value) { beforeRestore = value },
    set beforeFork(value) { beforeFork = value },
    set beforeRelease(value) { beforeRelease = value },
    initial: (id) => ({ branch: `chat-${id}`, state: 'pending', sandbox: null, path: null, head: null, commitCount: 0, lastSaved: null, error: null }),
    context: async () => [],
    async prepare(record, changed) { Object.assign(record.workspace, { state: 'ready', sandbox: '1', path: '/workspace' }); changed?.() },
    async checkpoint(record, changed) {
      await beforeCheckpoint(record)
      await this.prepare(record, changed)
      const cp = { project: record.project, branch: record.workspace.branch, ref: `commit-${checkpoints.length}`, head: `commit-${checkpoints.length}`, baseLayer: 'initial-layer' }
      checkpoints.push(cp)
      return cp
    },
    async restore(record, checkpoint, changed) { await beforeRestore(record); restores.push(checkpoint); Object.assign(record.workspace, { ...this.initial(record.id), branch: `restored-${randomUUID()}`, state: 'ready', path: '/workspace', sandbox: '1', head: checkpoint.head }); changed?.() },
    async fork(record, checkpoint, changed) { await beforeFork(record); Object.assign(record.workspace, { state: 'ready', path: '/workspace', sandbox: '1', head: checkpoint.head }); changed?.() },
    async release(record, changed) { await beforeRelease(record); Object.assign(record.workspace, { state: 'closed', path: null, sandbox: null }); changed?.() },
  }
}

test('stable message entries support rollback, edit, and independent copies while preserving old files', async (t) => {
  const f = await fixture(t)
  const chat = await f.manager.create({ permissionMode: 'full' })
  const first = await f.send(chat.id, 'first prompt')
  const firstId = users(first)[0].entryId
  assert.ok(firstId)
  assert.equal(users(first)[0].canRestore, true)
  const second = await f.send(chat.id, 'second prompt')
  const secondId = users(second)[1].entryId
  assert.equal(users(second)[0].entryId, firstId)
  const sourceFile = f.manager.record(chat.id).sessionFile
  await writeFile(join(f.cwd, 'local.txt'), 'Keep local files')
  const rolled = await agentRoute(f.manager, 'POST', ['sessions', chat.id, 'rollback'], { entryId: secondId })
  assert.equal(rolled.draft, 'second prompt')
  assert.deepEqual(users(rolled.session).map((message) => message.entryId), [firstId])
  assert.notEqual(f.manager.record(chat.id).sessionFile, sourceFile)
  assert.ok((await readFile(sourceFile, 'utf8')).includes('second prompt'))
  assert.equal(await readFile(join(f.cwd, 'local.txt'), 'utf8'), 'Keep local files')
  await f.restart()
  assert.deepEqual(users(f.manager.detail(chat.id)).map((message) => message.entryId), [firstId])
  await assert.rejects(async () => f.manager.rollback(chat.id, { entryId: secondId }), /current conversation path/)
  const edited = await agentRoute(f.manager, 'POST', ['sessions', chat.id, 'edit'], { entryId: firstId, text: 'edited prompt' })
  assert.equal(edited.id, chat.id)
  const final = await f.settle(chat.id)
  assert.deepEqual(users(final).map((message) => message.text), ['edited prompt'])
  const copied = await agentRoute(f.manager, 'POST', ['sessions', chat.id, 'fork'], {})
  assert.notEqual(copied.session.id, chat.id)
  assert.deepEqual(users(copied.session).map((message) => message.entryId), users(final).map((message) => message.entryId))
  assert.notEqual(f.manager.record(copied.session.id).sessionFile, f.manager.record(chat.id).sessionFile)
  await f.send(copied.session.id, 'copy only')
  assert.deepEqual(users(f.manager.detail(chat.id)).map((message) => message.text), ['edited prompt'])
  const before = await f.manager.fork(chat.id, { entryId: users(final)[0].entryId })
  assert.equal(before.draft, 'edited prompt')
  assert.equal(users(before.session).length, 0)
})

test('pure history operations work without a configured model and stale selections fail before editing history', async (t) => {
  const f = await fixture(t)
  const chat = await f.manager.create({ permissionMode: 'full' })
  const first = await f.send(chat.id, 'source prompt')
  const entryId = users(first)[0].entryId
  const file = f.manager.record(chat.id).sessionFile
  await assert.rejects(async () => f.manager.edit(chat.id, { entryId, text: 'invalid edit', provider: 'missing-provider', modelId: 'missing-model' }), /Unknown model/)
  assert.equal(f.manager.record(chat.id).sessionFile, file)
  assert.deepEqual(users(f.manager.detail(chat.id)).map((message) => message.text), ['source prompt'])
  await f.manager.models.removeProvider('history-fixture')
  await f.restart()
  const count = f.requests.length
  const copied = await f.manager.fork(chat.id)
  assert.equal(users(copied.session)[0].entryId, entryId)
  const rolled = await f.manager.rollback(chat.id, { entryId })
  assert.equal(rolled.draft, 'source prompt')
  assert.equal(users(rolled.session).length, 0)
  assert.equal(f.requests.length, count)
})

test('each actual user message gets a workspace checkpoint, including queued follow-up and steering', async (t) => {
  const workspaces = fakeWorkspaces()
  const f = await fixture(t, workspaces)
  for (const mode of ['followUp', 'steer']) {
    const chat = await f.manager.create({ project: 'project', runs: 'mount', permissionMode: 'full' })
    await f.manager.message(chat.id, { text: `WAIT initial ${mode}` })
    await f.manager.message(chat.id, { text: `queued ${mode}`, mode })
    const final = await f.settle(chat.id)
    assert.equal(final.state, 'idle', final.error)
    assert.equal(users(final).length, 2)
    assert.ok(users(final).every((message) => message.entryId && message.canRestore))
    const manager = SessionManager.open(f.manager.record(chat.id).sessionFile)
    const entries = manager.getBranch().filter((entry) => entry.type === 'message' && entry.message.role === 'user')
    const checkpoints = entries.map((entry) => checkpointFor(manager, entry))
    assert.ok(checkpoints.every(Boolean))
    assert.notEqual(checkpoints[0].ref, checkpoints[1].ref)
    await f.manager.rollback(chat.id, { entryId: entries[1].id })
    assert.equal(workspaces.restores.at(-1).ref, checkpoints[1].ref)
    const remaining = f.manager.detail(chat.id).messages.find((message) => message.role === 'user')
    await f.manager.edit(chat.id, { entryId: remaining.entryId, text: 'Edited with project instructions' })
    const edited = await f.settle(chat.id)
    assert.equal(edited.state, 'idle', edited.error)
    assert.equal(users(edited)[0].text, 'Edited with project instructions')
  }
})

test('history changes block sends, stops, deletions and other history changes until workspace restore finishes', async (t) => {
  const workspaces = fakeWorkspaces()
  const f = await fixture(t, workspaces)
  const chat = await f.manager.create({ project: 'project', runs: 'mount', permissionMode: 'full' })
  const final = await f.send(chat.id, 'saved prompt')
  const entered = Promise.withResolvers(), gate = Promise.withResolvers()
  workspaces.beforeRestore = async () => { entered.resolve(); await gate.promise }
  const restoring = f.manager.rollback(chat.id, { entryId: users(final)[0].entryId })
  await entered.promise
  for (const action of [
    () => f.manager.message(chat.id, { text: 'race' }), () => f.manager.stop(chat.id),
    () => f.manager.remove(chat.id), () => f.manager.compact(chat.id), () => f.manager.fork(chat.id),
    () => f.manager.open(chat.id), () => f.manager.workspaceDirectory(chat.id),
    () => f.manager.prepareWorkspace(chat.id), () => f.manager.executeWorkspace(chat.id, { command: 'pwd' }, {}),
    () => f.manager.removeProject('project', async () => assert.fail('Project was removed during restore')),
  ]) await assert.rejects(async () => action(), { status: 409 })
  gate.resolve()
  await restoring
  assert.equal(f.manager.historyOperations.size, 0)
})

test('a new copied conversation cannot run until both its workspace and transcript are ready', async (t) => {
  const workspaces = fakeWorkspaces()
  const f = await fixture(t, workspaces)
  const chat = await f.manager.create({ project: 'project', runs: 'mount', permissionMode: 'full' })
  await f.send(chat.id, 'saved prompt')
  const entered = Promise.withResolvers(), gate = Promise.withResolvers()
  let copyId
  workspaces.beforeFork = async (record) => { copyId = record.id; entered.resolve(); await gate.promise }
  const events = []
  f.manager.on('event', (event) => events.push(event))
  const copying = f.manager.fork(chat.id)
  await entered.promise
  assert.equal(events.some((event) => event.session.id === copyId), false, 'An unfinished copy must not appear as an empty chat.')
  for (const id of [chat.id, copyId]) {
    await assert.rejects(async () => f.manager.message(id, { text: 'premature prompt' }), { status: 409 })
    await assert.rejects(async () => f.manager.remove(id), { status: 409 })
  }
  gate.resolve()
  const copied = await copying
  assert.equal(copied.session.id, copyId)
  assert.equal(users(copied.session)[0].text, 'saved prompt')
  assert.equal(f.manager.historyOperations.size, 0)
})

test('failed copy creation cleans only its new resources, retaining recovery evidence if release fails', async (t) => {
  const workspaces = fakeWorkspaces()
  const f = await fixture(t, workspaces)
  const chat = await f.manager.create({ project: 'project', runs: 'mount', permissionMode: 'full' })
  await f.send(chat.id, 'source prompt')
  const before = f.manager.list().map((session) => session.id)
  workspaces.beforeFork = async () => { throw new Error('Copy mount failed') }
  await assert.rejects(f.manager.fork(chat.id), /Copy mount failed/)
  assert.deepEqual(f.manager.list().map((session) => session.id).sort(), [...before].sort())
  workspaces.beforeRelease = async (record) => { if (record.id !== chat.id) throw new Error('Sandbox still busy') }
  await assert.rejects(f.manager.fork(chat.id), /Copy mount failed/)
  const retained = f.manager.list().find((session) => !before.includes(session.id))
  assert.equal(retained.state, 'error')
  assert.match(retained.error, /cleanup incomplete/)
  assert.equal(f.manager.record(retained.id).needsStop, true)
  workspaces.beforeRelease = async () => {}
  await f.manager.remove(retained.id)
})

test('failed checkpoints abort before the model request; copied pending notices never restart old work', async (t) => {
  const workspaces = fakeWorkspaces()
  const f = await fixture(t, workspaces)
  const bad = await f.manager.create({ project: 'project', runs: 'mount', permissionMode: 'full' })
  workspaces.beforeCheckpoint = async () => { throw new Error('Checkpoint unavailable') }
  await assert.rejects(f.manager.message(bad.id, { text: 'must not request a model' }), /Checkpoint unavailable/)
  const failed = await f.settle(bad.id)
  assert.equal(failed.state, 'error')
  assert.match(failed.error, /Checkpoint unavailable/)
  assert.equal(f.requests.length, 0)
  workspaces.beforeCheckpoint = async () => {}
  const chat = await f.manager.create({ permissionMode: 'full' })
  const final = await f.send(chat.id, 'saved prompt')
  await f.manager.stop(chat.id)
  await f.manager.closeHistorySession(chat.id)
  const manager = SessionManager.open(f.manager.record(chat.id).sessionFile)
  const pending = manager.appendCustomEntry('subagent-notify-pending', { message: { customType: 'subagent-notify', content: 'must not wake copied work', display: false } })
  // Put the notice before a user boundary so it survives rollback's selected parent path.
  manager.appendCustomEntry(CHECKPOINT_TYPE, { checkpoint: null })
  const entryId = manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'later prompt' }], timestamp: Date.now() })
  const rolled = await f.manager.rollback(chat.id, { entryId })
  assert.equal(rolled.draft, 'later prompt')
  const clone = SessionManager.open(f.manager.record(chat.id).sessionFile)
  assert.equal(clone.getEntry(pending).customType, 'connect.copied-subagent-notice')
  const count = f.requests.length
  await f.manager.open(chat.id)
  await pause(30)
  assert.equal(f.requests.length, count)
  assert.equal(users(final)[0].entryId, users(f.manager.detail(chat.id))[0].entryId)
})

test('provenance IDs survive compaction projections instead of depending on message indexes', () => {
  const manager = SessionManager.inMemory('/tmp')
  const first = manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'first' }], timestamp: 1 })
  const second = manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'kept' }], timestamp: 2 })
  const before = sessionTranscript(manager).find((message) => message.entryId === second)
  manager.appendCompaction('Earlier context', second, 1000)
  const after = sessionTranscript(manager)
  assert.equal(after.find((message) => message.entryId === second).id, before.id)
  assert.equal(after.some((message) => message.entryId === first), false)
})
