import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent'
import { AgentManager } from '../agents/index.js'
import { CHECKPOINT_TYPE } from '../agents/history.js'

const sdk = dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')))
const { loadExtensionFromFactory } = await import(join(sdk, 'core/extensions/loader.js'))
const model = { provider: 'context-fixture', modelId: 'fixture-model', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture-only-key' }
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const userTexts = (detail) => detail.messages.filter((message) => message.role === 'user').map((message) => message.text)
const stale = /stale|disposed|replacement|invalidat/i

function fakeWorkspaces() {
  const trees = new Map(), snapshots = new Map(), forks = []
  let sequence = 0
  const tree = (record) => {
    if (!trees.has(record.workspace.branch)) trees.set(record.workspace.branch, new Map())
    return trees.get(record.workspace.branch)
  }
  return {
    forks,
    initial: (id) => ({ branch: `chat-${id}`, state: 'pending', sandbox: null, path: null, head: null, commitCount: 0, lastSaved: null, error: null }),
    context: async () => [],
    async prepare(record, changed) { tree(record); Object.assign(record.workspace, { state: 'ready', path: '/workspace', sandbox: 'fixture' }); changed?.() },
    async checkpoint(record, changed) {
      await this.prepare(record, changed)
      const head = `context-checkpoint-${++sequence}`
      snapshots.set(head, new Map(tree(record)))
      record.workspace.head = head
      return { project: record.project, branch: record.workspace.branch, ref: head, head, baseLayer: 'fixture-initial-layer' }
    },
    async fork(record, checkpoint, changed) {
      forks.push({ id: record.id, checkpoint })
      trees.set(record.workspace.branch, new Map(snapshots.get(checkpoint.ref)))
      Object.assign(record.workspace, { state: 'ready', path: '/workspace', sandbox: 'fixture', head: checkpoint.head })
      changed?.()
    },
    async release(record, changed) { Object.assign(record.workspace, { state: 'closed', path: null, sandbox: null }); changed?.() },
    write(record, path, text) { tree(record).set(path, text) },
    read(record, path) { return tree(record).get(path) },
  }
}

async function fixture(t, { project = false } = {}) {
  const state = await mkdtemp(join(tmpdir(), 'connect-native-context-'))
  const cwd = join(state, 'work')
  await mkdir(cwd)
  const workspaces = project ? fakeWorkspaces() : null
  const events = [], starts = [], calls = []
  const controls = { cancelSwitch: null, cancelFork: false, switchGate: null, switchStarted: null, waitSwitchReason: null }
  let execute
  const originalReload = DefaultResourceLoader.prototype.reload
  DefaultResourceLoader.prototype.reload = async function (...args) {
    await originalReload.apply(this, args)
    const result = this.getExtensions()
    const extension = await loadExtensionFromFactory((pi) => {
      pi.on('session_start', (event, ctx) => starts.push({ reason: event.reason, file: ctx.sessionManager.getSessionFile(), id: ctx.sessionManager.getSessionId() }))
      pi.on('session_before_switch', async (event) => {
        calls.push({ type: 'switch', reason: event.reason })
        if (controls.waitSwitchReason === event.reason && controls.switchGate) { controls.switchStarted.resolve(); await controls.switchGate.promise }
        if (controls.cancelSwitch === event.reason) return { cancel: true }
      })
      pi.on('session_before_fork', (event) => { calls.push({ type: 'fork', entryId: event.entryId, position: event.position }); if (controls.cancelFork) return { cancel: true } })
      pi.registerCommand('native-context', { description: 'Deterministic native context fixture', handler: async (_args, ctx) => execute(ctx) })
    }, cwd, this.eventBus, result.runtime, '<native-context-fixture>')
    result.extensions.push(extension)
  }
  let manager
  t.after(async () => {
    controls.switchGate?.resolve()
    try { await manager?.close() }
    finally { DefaultResourceLoader.prototype.reload = originalReload; await rm(state, { recursive: true, force: true }) }
  })
  manager = await AgentManager.create({ state, defaultCwd: cwd, projectEnvironment: async () => ({}), projectWorkspaces: workspaces })
  manager.on('event', (event) => events.push(structuredClone(event)))
  await manager.models.configure(model)
  const create = (input = {}) => manager.create({ ...(project ? { project: 'context-project', runs: 'mount' } : {}), ...input })
  async function seed(id, texts = ['First task', 'Second task']) {
    const active = await manager.open(id)
    const entries = []
    for (const [index, text] of texts.entries()) {
      const checkpoint = project ? await workspaces.checkpoint(manager.record(id)) : null
      active.session.sessionManager.appendCustomEntry(CHECKPOINT_TYPE, { checkpoint })
      const user = active.session.sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() })
      const assistant = active.session.sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: `Saved answer ${index + 1}` }], api: model.api, provider: model.provider, model: model.modelId, usage, stopReason: 'stop', timestamp: Date.now() })
      entries.push({ user, assistant })
    }
    active.session.refreshContext()
    manager.changed(id, true)
    return { active, entries }
  }
  async function run(id, callback) {
    execute = callback
    return manager.message(id, { text: '/native-context' })
  }
  const navigations = () => events.filter((event) => event.type === 'chat-navigate')
  const recordForFile = (file) => [...manager.records.values()].find((record) => record.sessionFile === file)
  return { manager, create, seed, run, cwd, workspaces, starts, calls, controls, events, navigations, recordForFile }
}

test('native before-switch/fork cancellation leaves chats, cursor and callbacks untouched', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const source = await f.create()
  const { active, entries } = await f.seed(source.id)
  const target = await f.create()
  await f.seed(target.id, ['Target task'])
  const file = active.session.sessionFile
  const count = f.manager.records.size
  let setup = false, callback = false, commandLeaf
  await f.run(source.id, async (ctx) => {
    commandLeaf = ctx.sessionManager.getLeafId()
    f.controls.cancelSwitch = 'new'
    assert.deepEqual(await ctx.newSession({ setup: async () => { setup = true }, withSession: async () => { callback = true } }), { cancelled: true })
    assert.equal(ctx.sessionManager.getSessionFile(), file)
    f.controls.cancelSwitch = 'resume'
    assert.deepEqual(await ctx.switchSession(f.manager.record(target.id).sessionFile, { withSession: async () => { callback = true } }), { cancelled: true })
    f.controls.cancelSwitch = null
    f.controls.cancelFork = true
    assert.deepEqual(await ctx.fork(entries[0].user, { withSession: async () => { callback = true } }), { cancelled: true })
  })
  assert.equal(setup, false)
  assert.equal(callback, false)
  assert.equal(f.manager.records.size, count)
  assert.equal(active.session.sessionManager.getLeafId(), commandLeaf)
  assert.deepEqual(f.navigations(), [])
  assert.deepEqual(f.calls.map((call) => call.type === 'switch' ? call.reason : call.position), ['new', 'resume', 'before'])
})

test('native newSession runs setup and fresh callbacks, inherits settings and keeps local files', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const limits = { bashTimeoutSeconds: 9, maxRetries: 0, instructions: 'Native context fixture instructions.' }
  const source = await f.create({ limits, permissionMode: 'full' })
  const { active } = await f.seed(source.id)
  await writeFile(join(f.cwd, 'local-marker.txt'), 'keep-local-files')
  let next, setupManager, oldContext
  await f.run(source.id, async (ctx) => {
    oldContext = ctx
    const sourceFile = ctx.sessionManager.getSessionFile()
    const result = await ctx.newSession({
      parentSession: sourceFile,
      setup: async (manager) => { setupManager = manager; manager.appendCustomMessageEntry('fixture-setup', 'Setup on replacement', true) },
      withSession: async (fresh) => {
        assert.equal(fresh.sessionManager, setupManager)
        assert.notEqual(fresh.sessionManager.getSessionFile(), sourceFile)
        assert.ok(fresh.sessionManager.buildSessionProjection().messages.some((message) => message.customType === 'fixture-setup'))
        await fresh.sendMessage({ customType: 'fixture-fresh', content: 'Fresh callback message', display: true })
        next = f.recordForFile(fresh.sessionManager.getSessionFile())
      },
    })
    assert.deepEqual(result, { cancelled: false })
    assert.throws(() => ctx.sessionManager, stale)
  })
  assert.ok(next)
  assert.equal(next.cwd, f.cwd)
  assert.deepEqual(next.limits, limits)
  assert.equal(next.permissionMode, 'full')
  assert.deepEqual(userTexts(f.manager.detail(next.id)), [])
  assert.ok(f.manager.detail(next.id).messages.some((message) => message.text === 'Fresh callback message'))
  assert.equal(f.manager.live.get(next.id).session.sessionManager.getHeader().parentSession, active.session.sessionFile)
  assert.equal(await readFile(join(f.cwd, 'local-marker.txt'), 'utf8'), 'keep-local-files')
  assert.throws(() => oldContext.cwd, stale)
  assert.equal(f.navigations().at(-1).sessionId, next.id)
})

test('native newSession callbacks may replace again without deadlocking or navigating back to the first replacement', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const source = await f.create()
  await f.seed(source.id)
  let first, final
  await f.run(source.id, async (ctx) => {
    await ctx.newSession({ withSession: async (fresh) => {
      first = f.recordForFile(fresh.sessionManager.getSessionFile())
      await fresh.newSession({ withSession: async (last) => { final = f.recordForFile(last.sessionManager.getSessionFile()); await last.sendMessage({ customType: 'fixture-final', content: 'Final replacement', display: true }) } })
      assert.throws(() => fresh.sessionManager, stale)
    } })
  })
  assert.notEqual(first.id, final.id)
  assert.equal(f.manager.records.size, 3)
  assert.ok(f.manager.detail(final.id).messages.some((message) => message.text === 'Final replacement'))
  assert.equal(f.navigations().at(-1).sessionId, final.id)
})

test('native fork distinguishes before-user from at-assistant for local chats and preserves the original', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const source = await f.create()
  const { entries } = await f.seed(source.id)
  const sourceFile = f.manager.record(source.id).sessionFile
  let before
  await f.run(source.id, async (ctx) => {
    assert.deepEqual(await ctx.fork(entries[1].user, { withSession: async (fresh) => { before = f.recordForFile(fresh.sessionManager.getSessionFile()); await fresh.sendMessage({ customType: 'fixture-fork', content: 'Before callback', display: true }) } }), { cancelled: false })
    assert.throws(() => ctx.sessionManager, stale)
  })
  assert.deepEqual(userTexts(f.manager.detail(before.id)), ['First task'])
  assert.equal(f.manager.record(source.id).sessionFile, sourceFile)
  assert.deepEqual(userTexts(f.manager.detail(source.id)), ['First task', 'Second task'])
  let at
  await f.run(source.id, async (ctx) => {
    assert.deepEqual(await ctx.fork(entries[0].assistant, { position: 'at', withSession: async (fresh) => { at = f.recordForFile(fresh.sessionManager.getSessionFile()) } }), { cancelled: false })
  })
  const atMessages = f.manager.detail(at.id).messages
  assert.deepEqual(userTexts(f.manager.detail(at.id)), ['First task'])
  assert.ok(atMessages.some((message) => message.text === 'Saved answer 1'))
  assert.ok(!atMessages.some((message) => message.text === 'Saved answer 2'))
  assert.deepEqual(f.calls.filter((call) => call.type === 'fork').map((call) => call.position), ['before', 'at'])
})

test('native switchSession targets registered chats and cancels unknown paths without side effects', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const source = await f.create()
  const { active } = await f.seed(source.id)
  const target = await f.create()
  const { active: targetActive } = await f.seed(target.id, ['Existing target'])
  const oldTargetContext = targetActive.session.extensionRunner.createCommandContext()
  const file = f.manager.record(target.id).sessionFile
  const count = f.manager.records.size
  await f.run(source.id, async (ctx) => {
    assert.deepEqual(await ctx.switchSession(join(f.cwd, 'unregistered.jsonl')), { cancelled: true })
    assert.equal(ctx.sessionManager.getSessionFile(), active.session.sessionFile)
  })
  assert.equal(f.manager.records.size, count)
  assert.deepEqual(f.navigations(), [])
  await f.run(source.id, async (ctx) => {
    assert.deepEqual(await ctx.switchSession(file, { withSession: async (fresh) => {
      assert.equal(fresh.sessionManager.getSessionFile(), file)
      await fresh.sendMessage({ customType: 'fixture-switched', content: 'Target callback', display: true })
    } }), { cancelled: false })
    assert.throws(() => ctx.sessionManager, stale)
  })
  assert.notEqual(f.manager.live.get(target.id).session, targetActive.session)
  assert.throws(() => oldTargetContext.sessionManager, stale)
  assert.ok(f.starts.some((event) => event.reason === 'resume' && event.file === file))
  assert.ok(f.manager.detail(target.id).messages.some((message) => message.text === 'Target callback'))
  assert.deepEqual(userTexts(f.manager.detail(target.id)), ['Existing target'])
  assert.equal(f.navigations().at(-1).sessionId, target.id)
})

test('native reload emits a fresh session_start while retaining the saved chat and project branch', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t, { project: true })
  const source = await f.create()
  const { active } = await f.seed(source.id)
  const file = active.session.sessionFile
  const branch = f.manager.record(source.id).workspace.branch
  const starts = f.starts.length
  await f.run(source.id, async (ctx) => { await ctx.reload(); assert.throws(() => ctx.sessionManager, stale) })
  assert.equal(f.manager.live.get(source.id).session, active.session)
  assert.equal(f.manager.record(source.id).sessionFile, file)
  assert.equal(f.manager.record(source.id).workspace.branch, branch)
  assert.equal(f.starts.length, starts + 1)
  assert.equal(f.starts.at(-1).reason, 'reload')
  assert.deepEqual(userTexts(f.manager.detail(source.id)), ['First task', 'Second task'])
})

test('project newSession forks the current file state; unsupported navigation and at-assistant fork cancel unchanged', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t, { project: true })
  const source = await f.create()
  const { active, entries } = await f.seed(source.id)
  const original = f.manager.record(source.id)
  f.workspaces.write(original, 'marker.txt', 'current-project-tree')
  const file = original.sessionFile, head = original.workspace.head, branch = original.workspace.branch, count = f.manager.records.size
  await f.run(source.id, async (ctx) => {
    const commandLeaf = ctx.sessionManager.getLeafId()
    assert.deepEqual(await ctx.navigateTree(entries[0].user), { cancelled: true })
    assert.deepEqual(await ctx.fork(entries[0].assistant, { position: 'at' }), { cancelled: true })
    assert.equal(ctx.sessionManager.getLeafId(), commandLeaf)
  })
  assert.equal(f.manager.records.size, count)
  assert.equal(original.sessionFile, file)
  assert.equal(original.workspace.head, head)
  assert.equal(original.workspace.branch, branch)
  assert.deepEqual(f.navigations(), [])
  let next
  await f.run(source.id, async (ctx) => { await ctx.newSession({ withSession: async (fresh) => { next = f.recordForFile(fresh.sessionManager.getSessionFile()) } }) })
  assert.notEqual(next.workspace.branch, branch)
  assert.equal(next.project, original.project)
  assert.equal(f.workspaces.read(next, 'marker.txt'), 'current-project-tree')
  assert.equal(f.workspaces.read(original, 'marker.txt'), 'current-project-tree')
  assert.deepEqual(userTexts(f.manager.detail(next.id)), [])
})

test('local navigateTree uses Pi in place and preserves the command context', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const source = await f.create()
  const { active, entries } = await f.seed(source.id)
  const file = active.session.sessionFile
  await f.run(source.id, async (ctx) => {
    assert.deepEqual(await ctx.navigateTree(entries[1].user, { label: 'fixture-return-point' }), { cancelled: false })
    assert.equal(ctx.sessionManager, active.session.sessionManager)
    assert.equal(ctx.sessionManager.getSessionFile(), file)
    assert.ok(ctx.sessionManager.getEntries().some((entry) => entry.type === 'label' && entry.targetId === entries[1].user && entry.label === 'fixture-return-point'))
  })
  assert.equal(f.manager.live.get(source.id).session, active.session)
  assert.equal(f.manager.record(source.id).sessionFile, file)
  assert.deepEqual(userTexts(f.manager.detail(source.id)), ['First task'])
})

test('project fork at a user entry includes that message and uses its exact saved file checkpoint', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t, { project: true })
  const source = await f.create()
  const record = f.manager.record(source.id)
  f.workspaces.write(record, 'history.txt', 'saved-before-user')
  const { entries } = await f.seed(source.id)
  f.workspaces.write(record, 'history.txt', 'current-after-user')
  let copied
  await f.run(source.id, async (ctx) => {
    assert.deepEqual(await ctx.fork(entries[0].user, { position: 'at', withSession: async (fresh) => { copied = f.recordForFile(fresh.sessionManager.getSessionFile()) } }), { cancelled: false })
  })
  assert.deepEqual(userTexts(f.manager.detail(copied.id)), ['First task'])
  assert.ok(!f.manager.detail(copied.id).messages.some((message) => message.text === 'Saved answer 1'))
  assert.equal(f.workspaces.read(copied, 'history.txt'), 'saved-before-user')
  assert.equal(f.workspaces.read(record, 'history.txt'), 'current-after-user')
  assert.notEqual(copied.workspace.branch, record.workspace.branch)
})


test('native switch cannot enter a target whose Pi is idle inside another command replacement', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const source = await f.create()
  const { active } = await f.seed(source.id)
  const target = await f.create()
  await f.seed(target.id, ['Target original'])
  f.controls.switchGate = Promise.withResolvers()
  f.controls.switchStarted = Promise.withResolvers()
  f.controls.waitSwitchReason = 'new'
  const replacing = f.run(target.id, async (ctx) => { await ctx.newSession() }).then((value) => ({ value }), (error) => ({ error }))
  await f.controls.switchStarted.promise
  try {
    assert.equal(f.manager.live.get(target.id).session.isIdle, true)
    assert.equal(f.manager.controlMutations.has(target.id), true)
    assert.equal(f.manager.record(target.id).state, 'running')
    const file = active.session.sessionFile
    await f.run(source.id, async (ctx) => {
      assert.deepEqual(await ctx.switchSession(f.manager.record(target.id).sessionFile), { cancelled: true })
      assert.equal(ctx.sessionManager.getSessionFile(), file)
    })
    assert.deepEqual(f.navigations(), [])
  } finally {
    f.controls.switchGate.resolve()
    const result = await replacing
    if (result.error) throw result.error
  }
  assert.ok(f.navigations().every((event) => event.fromId === target.id))
})

for (const reason of ['new', 'resume']) {
  test(`Stop cancels a native ${reason} waiting in a before-switch hook without a late replacement`, { timeout: 15_000 }, async (t) => {
    const f = await fixture(t)
    const source = await f.create()
    const { active } = await f.seed(source.id)
    const target = await f.create()
    const { active: targetActive } = await f.seed(target.id, ['Target original'])
    const file = active.session.sessionFile
    f.controls.switchGate = Promise.withResolvers()
    f.controls.switchStarted = Promise.withResolvers()
    f.controls.waitSwitchReason = reason
    const finished = Promise.withResolvers()
    const running = f.run(source.id, async (ctx) => {
      try {
        if (reason === 'new') await ctx.newSession()
        else await ctx.switchSession(f.manager.record(target.id).sessionFile)
      } finally { finished.resolve() }
    }).then((value) => ({ value }), (error) => ({ error }))
    await f.controls.switchStarted.promise
    await f.manager.stop(source.id)
    assert.equal((await running).error?.code, 'stopping')
    f.controls.switchGate.resolve()
    await finished.promise
    assert.equal(f.manager.records.size, 2)
    assert.equal(f.manager.live.get(source.id), active)
    assert.equal(f.manager.live.get(target.id), targetActive)
    assert.equal(f.manager.record(source.id).sessionFile, file)
    assert.deepEqual(f.navigations(), [])
    assert.equal(f.manager.controlMutations.has(source.id), false)
  })
}

test('Stop during native newSession workspace checkpoint cancels the pending replacement', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t, { project: true })
  const source = await f.create()
  const { active } = await f.seed(source.id)
  const started = Promise.withResolvers(), release = Promise.withResolvers(), finished = Promise.withResolvers()
  t.after(() => release.resolve())
  const checkpoint = f.workspaces.checkpoint.bind(f.workspaces)
  f.workspaces.checkpoint = async (...args) => {
    const result = await checkpoint(...args)
    started.resolve()
    await release.promise
    return result
  }
  const running = f.run(source.id, async (ctx) => {
    try { await ctx.newSession() } finally { finished.resolve() }
  }).then((value) => ({ value }), (error) => ({ error }))
  await started.promise
  await f.manager.stop(source.id)
  assert.equal((await running).error?.code, 'stopping')
  release.resolve()
  await finished.promise
  assert.equal(f.manager.records.size, 1)
  assert.equal(f.manager.live.get(source.id), active)
  assert.equal(f.manager.record(source.id).workspace.state, 'closed')
  assert.deepEqual(f.navigations(), [])
})

test('an external Stop during native replacement cleanup cancels the command that initiated cleanup', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t)
  const source = await f.create()
  const { active } = await f.seed(source.id)
  const started = Promise.withResolvers(), release = Promise.withResolvers(), finished = Promise.withResolvers()
  t.after(() => release.resolve())
  const stopChildren = active.extensions.stopChildren.bind(active.extensions)
  active.extensions.stopChildren = async (...args) => { started.resolve(); await release.promise; return stopChildren(...args) }
  const running = f.run(source.id, async (ctx) => {
    try { await ctx.newSession() } finally { finished.resolve() }
  }).then((value) => ({ value }), (error) => ({ error }))
  await started.promise
  const stopping = f.manager.stop(source.id)
  release.resolve()
  await stopping
  await finished.promise
  assert.equal((await running).error?.code, 'stopping')
  assert.equal(f.manager.records.size, 1)
  assert.equal(f.manager.live.get(source.id), active)
  assert.deepEqual(f.navigations(), [])
})
