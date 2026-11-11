import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_HISTORY_LIMITS, runHistoryDAG } from '../tools/demo/history-scheduler.mjs'
import { projectHistoryPlan, projectHistorySteps, resolveHistoryStep } from '../tools/demo/recipe.mjs'
import { DemoRunner } from '../tools/demo/runner.mjs'
import { StepJournal } from '../tools/demo/step-journal.mjs'

const pause = () => new Promise(resolve => setImmediate(resolve))
const node = (key, dependsOn = []) => ({ key, dependsOn })

test('DAG admission is fair and bounds actual dispatched calls globally, per store and per project', { timeout: 5000 }, async () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({ project: `project-${index}`, store: `store-${index >> 1}`, steps: Array.from({ length: 6 }, (_, lane) => node(`lane-${lane}`)) }))
  const active = new Map(), stores = new Map(), starts = []
  let global = 0, peak = 0
  await runHistoryDAG(tasks, async task => {
    global++; peak = Math.max(peak, global); active.set(task.project, (active.get(task.project) ?? 0) + 1); stores.set(task.store, (stores.get(task.store) ?? 0) + 1)
    starts.push(task.project)
    assert.ok(global <= 8); assert.ok(active.get(task.project) <= 3); assert.ok(stores.get(task.store) <= 3)
    await pause()
    global--; active.set(task.project, active.get(task.project) - 1); stores.set(task.store, stores.get(task.store) - 1)
  }, { concurrency: 8 })
  assert.equal(peak, 8); assert.equal(starts.length, 48)
  assert.equal(new Set(starts.slice(0, 8)).size, 8, 'each project receives initial service')
  assert.equal(global, 0)
})

test('DAG waits for confirmed dependencies; failure stops admission and drains launched siblings', { timeout: 5000 }, async () => {
  let release, entered
  const sibling = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const calls = [], settled = []
  const task = { project: 'p', store: 's', steps: [node('bad'), node('slow'), node('after-bad', ['bad']), node('after-slow', ['slow'])] }
  const running = runHistoryDAG([task], async (_task, step) => {
    calls.push(step.key)
    if (step.key === 'bad') { await started; throw new Error('effect unknown') }
    entered(); await sibling; settled.push(step.key)
  }, { concurrency: 2, perStore: 2, perProject: 2 })
  await started; await pause()
  assert.deepEqual(calls, ['bad', 'slow'])
  let returned = false; running.catch(() => { returned = true })
  await pause(); assert.equal(returned, false)
  release(); await assert.rejects(running, /effect unknown/)
  assert.deepEqual(settled, ['slow']); assert.equal(calls.length, 2)
})

test('DAG rejects malformed or cyclic plans before any effects', async () => {
  let calls = 0
  for (const steps of [[node('a', ['missing'])], [node('a', ['b']), node('b', ['a'])], [node('a'), node('a')]]) {
    await assert.rejects(runHistoryDAG([{ project: 'p', store: 's', steps }], async () => { calls++ }))
  }
  assert.equal(calls, 0)
})

test('dense plan orders every branch head and main publication while admitting independent chains', { timeout: 5000 }, async () => {
  const steps = projectHistorySteps('store', 'design', { cycles: 1 }), completed = new Set(), heads = new Set(), pubs = new Set()
  let peak = 0, active = 0, writePublishOverlap = false
  await runHistoryDAG([{ project: 'store/design', store: 'store', steps }], async (_task, step) => {
    for (const dependency of step.dependsOn) assert.ok(completed.has(dependency), dependency)
    const isPub = step.argv[1] === 'publish', branch = step.argv[3]
    if (isPub) { assert.equal(pubs.size, 0); pubs.add(branch) } else { assert.ok(!heads.has(branch)); heads.add(branch) }
    if (pubs.has(branch) && heads.has(branch)) writePublishOverlap = true
    peak = Math.max(peak, ++active)
    await pause()
    active--; if (isPub) pubs.delete(branch); else heads.delete(branch)
    completed.add(step.key)
  }, { concurrency: 8, perStore: 3, perProject: 3 })
  assert.equal(completed.size, 357); assert.equal(peak, 3); assert.equal(writePublishOverlap, false)
  assert.equal(projectHistoryPlan('design', { cycles: 1 }).commits, 288)
  assert.equal(projectHistoryPlan('design').commits, 2400, 'pilot limit never changes production tiers')
  assert.throws(() => projectHistoryPlan('design', { cycles: 0 }), /Invalid cycle/)
})

test('publish resolves its exact immutable receipt without using a future write receipt', () => {
  const step = projectHistorySteps('store', 'design', { cycles: 1 }).find(step => step.key === 'dense.001.integration.publish.1')
  const argv = resolveHistoryStep(step, { 'dense.001.integration.write.1': { head: 'commit-one' }, 'dense.001.integration.write.2': { head: 'commit-two' } })
  assert.equal(argv.at(-1), 'commit-one'); assert.match(step.argv.at(-1), /^<commit:/)
  assert.throws(() => resolveHistoryStep(step, {}), /Missing immutable Commit receipt/)
})

test('runner journals resolved command and dependencies, refuses unconfirmed receipts without dispatch', async t => {
  const state = mkdtempSync(join(tmpdir(), 'dense-scheduler-')); t.after(() => rmSync(state, { recursive: true, force: true }))
  const calls = [], runner = new DemoRunner({ state, driver: { invoke: async argv => { calls.push(argv); return { kind: 'Added', overwrote_count: 0 } } } })
  runner.manifest = { steps: {} }; runner.journal = new StepJournal(runner.journalFile); runner.journal.load()
  const step = { key: 'publish', argv: ['branch', 'publish', 's/p', 'b', '<commit:write>'], dependsOn: ['write'], commitFrom: 'write', expect: { kind: 'Added', overwroteCount: 0 } }
  await assert.rejects(runner.executeHistoryStep('s/p', step), /Unconfirmed dependency/); assert.equal(calls.length, 0)
  runner.recordStep('write:s/p', { status: 'done', result: { head: 'exact-commit' } })
  await runner.executeHistoryStep('s/p', step)
  assert.equal(calls[0].at(-1), 'exact-commit')
  const saved = new StepJournal(runner.journalFile).load()['publish:s/p']
  assert.deepEqual(saved.dependencies, ['write']); assert.equal(saved.argv.at(-1), 'exact-commit')
  await runner.executeHistoryStep('s/p', step); assert.equal(calls.length, 1, 'confirmed receipts are reused')
  runner.recordStep('write:s/p', { status: 'running', result: { head: 'unconfirmed' } })
  await assert.rejects(runner.executeHistoryStep('s/p', step), /Unconfirmed dependency/); assert.equal(calls.length, 1)
})

test('completed pipeline and legacy seeded histories are reused without new mutations', { timeout: 5000 }, async t => {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const { DemoHistory } = await import('./support/demo-history.mjs')
  const { verifyProject } = await import('../tools/demo/project-verification.mjs')
  const state = mkdtempSync(join(tmpdir(), 'dense-idempotence-')); t.after(() => rmSync(state, { recursive: true, force: true }))
  const folder = join(state, 'source'), history = new DemoHistory()
  for (const [path, content] of Object.entries(projectHistoryPlan('design').definition.files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true }); writeFileSync(join(folder, path), content)
  }
  history.init('store/design', folder)
  let calls = 0
  const runner = new DemoRunner({ state, historyCycles: 1, driver: { invoke: async (argv, options) => { calls++; await pause(); return history.invoke(argv, options) } }, progress: () => {} })
  runner.preset = { machines: ['native'], stores: [{ name: 'store', machine: 'native', projects: ['design'] }] }
  runner.manifest = { projects: { 'store/design': { seeded: false } }, steps: {} }
  runner.journal = new StepJournal(runner.journalFile); runner.journal.load()
  runner.ensureResource = async () => {}; runner.ensureProject = async () => {}; runner.query = async () => ({ machine: 'native' })
  const run = () => runner.setupConcurrentProjects({ advance: () => {}, reportProgress: () => {} })
  await run(); assert.equal(calls, 357)
  const proof = await verifyProject(async argv => history.invoke(argv), 'store', 'design', { steps: Object.fromEntries(Object.entries(runner.manifest.steps).map(([key, value]) => [key.split(':')[0], value.result])) }, { cycles: 1 })
  assert.equal(proof.commits, 288); assert.equal(proof.layers, 60)
  await run(); assert.equal(calls, 357)
  // Preserve the old serial command custody when opening an already built graph.
  for (const [key, receipt] of Object.entries(runner.manifest.steps)) if (receipt.argv[1] === 'publish') runner.recordStep(key, { ...receipt, argv: receipt.argv.slice(0, 4) })
  await run(); assert.equal(calls, 357)
  assert.equal(runner.historyTasks[0].completed, 357)
  runner.recordStep('dense.001.a.write.1:store/design', { status: 'uncertain', argv: ['file', 'write'] })
  await assert.rejects(run(), /no confirmed receipt/); assert.equal(calls, 357)
})


test('every release write waits for its preceding publication on the pinned head-CAS runtime', () => {
  const steps = projectHistorySteps('store', 'design', { cycles: 1 })
  for (const [lane, count] of [['integration', 26], ['release', 27]]) for (let index = 1; index <= count; index++) {
    const key = `dense.001.${lane}`
    const write = steps.find(step => step.key === `${key}.write.${index}`)
    const publish = steps.find(step => step.key === `${key}.publish.${index}`)
    assert.deepEqual(write.dependsOn, [`${key}.publish.${index - 1}`])
    assert.ok(publish.dependsOn.includes(write.key))
    assert.equal(publish.commitFrom, write.key)
  }
  const integration = steps.find(step => step.key === 'dense.001.integration.merge')
  assert.deepEqual(integration.dependsOn, ['dense.001.a.write.80', 'dense.001.b.write.80'], 'maintenance may overlap integration publications')
})


test('production runner and DAG use the measured shared history limits', () => {
  assert.deepEqual(DEFAULT_HISTORY_LIMITS, { concurrency: 12, perStore: 3, perProject: 3 })
  const runner = new DemoRunner({ state: '/tmp/history-defaults-unit-only', driver: {} })
  assert.deepEqual(runner.historyLimits, DEFAULT_HISTORY_LIMITS)
})
