import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StepJournal } from '../tools/demo/step-journal.mjs'
import { DemoRunner } from '../tools/demo/runner.mjs'

function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), 'preset-journal-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  return { state, file: join(state, 'demo-steps.ndjson') }
}

test('step journal migrates old receipts and reconstructs final and interrupted outcomes', t => {
  const { file } = fixture(t), journal = new StepJournal(file)
  const legacy = { old: { status: 'done', result: { head: 'old-head' } } }
  journal.load(legacy)
  journal.append('new', { status: 'running', argv: ['file', 'write'], invocationId: 'invocation-1' })
  const resumed = new StepJournal(file).load({})
  assert.deepEqual(resumed.old, legacy.old)
  assert.equal(resumed.new.status, 'running')
  assert.equal(resumed.new.invocationId, 'invocation-1')
  journal.append('new', { status: 'done', result: { head: 'new-head' } })
  assert.equal(new StepJournal(file).load({}).new.result.head, 'new-head')
})

test('partial journal refuses recovery rather than dropping mutation custody', t => {
  const { file } = fixture(t)
  writeFileSync(file, '{"v":1,"key":"partial"')
  assert.throws(() => new StepJournal(file).load({}), /incomplete receipt/)
})

test('runner checkpoints stay small and interrupted mutations are not replayed', async t => {
  const { state } = fixture(t)
  let calls = 0
  const runner = new DemoRunner({ state, driver: { invoke: async () => { calls++; return { kind: 'Committed', head: 'head' } } } })
  runner.manifest = { projects: {}, steps: {} }
  runner.journal = new StepJournal(runner.journalFile); runner.journal.load()
  for (let n = 0; n < 1000; n++) runner.recordStep(`old-${n}`, { status: 'done', result: { text: 'x'.repeat(100) } })
  runner.save()
  assert.ok(readFileSync(runner.file).length < 500)
  assert.equal(new StepJournal(runner.journalFile).load()['old-999'].status, 'done')
  runner.recordStep('uncertain', { status: 'running', argv: ['file', 'write'] })
  await assert.rejects(runner.once('uncertain', ['file', 'write']), /no certain final result/)
  assert.equal(calls, 0)
  await runner.once('new', ['file', 'write'])
  assert.equal(calls, 1)
  assert.equal(new StepJournal(runner.journalFile).load().new.status, 'done')
})

test('runner journals invocation identity and records failure without retry', async t => {
  const { state } = fixture(t)
  let calls = 0
  const runner = new DemoRunner({ state, driver: { invoke: async (_argv, options) => {
    calls++; options.onInvocation({ id: 'call-id', actionId: 'action-id' })
    throw Object.assign(new Error('lost answer'), { code: 'Unknown' })
  } } })
  runner.manifest = { steps: {} }
  runner.journal = new StepJournal(runner.journalFile); runner.journal.load()
  await assert.rejects(runner.once('write', ['file', 'write']), /lost answer/)
  const receipt = new StepJournal(runner.journalFile).load().write
  assert.equal(receipt.status, 'uncertain')
  assert.equal(receipt.invocationId, 'call-id')
  assert.equal(receipt.actionId, 'action-id')
  await assert.rejects(runner.once('write', ['file', 'write']), /no certain final result/)
  assert.equal(calls, 1)
})

test('cleanup keeps the journal when inventory verification fails, clears it only after proof', async t => {
  const { state } = fixture(t)
  const runner = new DemoRunner({ state, driver: {}, report: () => {} })
  runner.manifest = { resources: { store: {}, machine: {}, sandbox: {} }, borrowed: {}, projects: { old: {} }, steps: {} }
  runner.journal = new StepJournal(runner.journalFile); runner.journal.load()
  runner.recordStep('old', { status: 'done', result: { head: 'saved' } })
  const plan = { remove: { stores: [], machines: [], sandboxes: [] }, preserved: { store: [], machine: [], sandbox: [] }, retainMachines: [] }
  runner.inventory = async family => family === 'store' ? [{ name: 'unexpected-store' }] : []
  await assert.rejects(runner.cleanup(false, plan), /Cleanup verification failed/)
  assert.equal(new StepJournal(runner.journalFile).load().old.result.head, 'saved')
  runner.inventory = async () => []
  await runner.cleanup(false, plan)
  assert.equal(runner.manifest.cleanupReceipt.verified, true)
  assert.equal(readFileSync(runner.journalFile, 'utf8'), '')
  assert.deepEqual(runner.manifest.steps, {})
})

test('journal failure after a mutation keeps uncertain custody', async t => {
  const { state } = fixture(t)
  const runner = new DemoRunner({ state, driver: { invoke: async () => ({ kind: 'Committed', head: 'saved' }) } })
  runner.manifest = { steps: {} }
  runner.journal = new StepJournal(runner.journalFile); runner.journal.load()
  const append = runner.journal.append.bind(runner.journal)
  let writes = 0
  runner.journal.append = (key, step) => {
    if (++writes === 2) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    append(key, step)
  }
  await assert.rejects(runner.once('write', ['file', 'write']), /disk full/)
  assert.equal(new StepJournal(runner.journalFile).load().write.status, 'uncertain')
})

test('capture proof follows original invocation actions when setup reuses saved steps', async t => {
  const { state } = fixture(t)
  const runner = new DemoRunner({ state, driver: { spec: { cli: '/pinned/layerfs' } } })
  runner.manifest = { steps: { write: { status: 'done', argv: ['file', 'write'], invocationId: 'write-id', actionId: 'original-build' } } }
  runner.action = { id: 'verification' }
  const requests = []
  runner.activity = { flush: async () => {}, capture: async (actionId, options) => {
    requests.push({ actionId, options })
    return { complete: true, count: 1, expected: options?.expectedIds?.length ?? 1, failedCount: 0, expectedTruncated: 0 }
  } }
  const proof = await runner.verifyActivityCapture()
  assert.equal(proof.complete, true)
  assert.equal(proof.expectedMutations, 1)
  assert.deepEqual(requests[0], { actionId: 'original-build', options: { expectedIds: ['write-id'], expectedInputIds: ['write-id'] } })
  assert.equal(requests[1].actionId, 'verification')
})

test('real fixture rejects missing identities and incomplete or truncated capture', async t => {
  const { state } = fixture(t)
  const runner = new DemoRunner({ state, driver: { spec: { cli: '/pinned/layerfs' } } })
  runner.manifest = { steps: { write: { status: 'done', argv: ['file', 'write'] } } }
  runner.activity = { flush: async () => {}, capture: async () => ({ complete: false }) }
  await assert.rejects(runner.verifyActivityCapture(), /no invocation identity/)
  Object.assign(runner.manifest.steps.write, { invocationId: 'id', actionId: 'build' })
  await assert.rejects(runner.verifyActivityCapture(), /incomplete/)
  runner.activity.capture = async () => ({ complete: true, expectedTruncated: 1 })
  await assert.rejects(runner.verifyActivityCapture(), /truncated/)
})

test('weighted build progress separates actual history commands from preparation units', async t => {
  const { state } = fixture(t), updates = []
  const runner = new DemoRunner({ state, historyDensity: 'base', historySchedule: 'serial', driver: {}, progress: value => updates.push(value) })
  runner.preset = { machines: ['native'], stores: [{ name: 'store', machine: 'native', projects: ['website', 'design'] }] }
  runner.manifest = { projects: {}, steps: {} }
  runner.ensureResource = async () => {}; runner.ensureProject = async () => {}
  runner.query = async () => ({ machine: 'native' })
  runner.seedProjectHistory = async (_store, _name, onStep) => onStep(35)
  await runner.setupConcurrentProjects({ advance: () => {}, reportProgress: () => {} })
  const last = updates.at(-1)
  assert.equal(last.completed, 72)
  assert.equal(last.total, 72)
  assert.equal(last.historyCompleted, 70)
  assert.equal(last.historyTotal, 70)
  assert.equal(last.tasks.filter(task => task.state === 'completed').length, 2)
})

test('status uses the indexed activity summary', async t => {
  const { state } = fixture(t)
  const runner = new DemoRunner({ state, driver: {} })
  runner.manifest = { homeId: 'home', resources: {}, steps: {} }; runner.action = { id: 'status-action' }
  runner.query = async () => ({ items: [] })
  runner.activity = { summaries: async options => { assert.equal(options.actionId, 'status-action'); return { items: [{ id: 'status-action' }] } } }
  assert.equal((await runner.status()).activityCaptured, true)
})

test('verified cleanup discards stale capture proof and project task snapshots', async t => {
  const { state } = fixture(t)
  const runner = new DemoRunner({ state, driver: {}, report: () => {} })
  runner.manifest = { resources: { store: {}, machine: {}, sandbox: {} }, borrowed: {}, projects: {}, steps: {}, activityCapture: { complete: true } }
  runner.historyTasks = [{ state: 'completed' }]
  runner.journal = new StepJournal(runner.journalFile); runner.journal.load()
  runner.inventory = async () => []
  await runner.cleanup(false, { remove: { stores: [], machines: [], sandboxes: [] }, preserved: { store: [], machine: [], sandbox: [] }, retainMachines: [] })
  assert.equal(runner.manifest.activityCapture, undefined)
  assert.equal(runner.historyTasks, undefined)
})

test('verification reports each project with a stable known total', async t => {
  const { DemoHistory } = await import('./support/demo-history.mjs')
  const { projectHistorySteps } = await import('../tools/demo/recipe.mjs')
  const { CONTENT_VERSION } = await import('../tools/demo/presets.mjs')
  const { state } = fixture(t), updates = [], history = new DemoHistory()
  const runner = new DemoRunner({ state, historyDensity: 'base', driver: { spec: {} }, progress: value => updates.push(value) })
  runner.preset = { machines: [], stores: [{ name: 'store', machine: 'native', projects: ['website', 'design'] }] }
  runner.manifest = { contentVersion: CONTENT_VERSION, projects: {}, steps: {} }
  for (const name of ['website', 'design']) {
    const key = `store/${name}`
    history.init(key, runner.source('store', name)); runner.manifest.projects[key] = { seeded: true }
    for (const step of projectHistorySteps('store', name, { density: 'base' })) {
      const result = history.invoke(step.argv, { input: step.input })
      runner.manifest.steps[`${step.key}:${key}`] = { status: 'done', argv: step.argv, result }
    }
  }
  runner.query = async argv => argv[0] === 'store' ? { machine: 'native' } : argv[0] === 'project' ? { project: argv[2] } : history.invoke(argv, { read: true })
  const result = await runner.verify({ activity: false })
  assert.equal(result.projects, 2)
  assert.deepEqual(updates.map(value => [value.completed, value.total]), [[0, 2], [1, 2], [2, 2]])
  assert.equal(runner.manifest.projects['store/design'].verification.commits, 24)
})
