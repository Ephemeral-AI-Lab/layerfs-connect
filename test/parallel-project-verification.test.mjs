import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DemoRunner } from '../tools/demo/runner.mjs'
import { projectHistorySteps } from '../tools/demo/recipe.mjs'
import { CONTENT_VERSION } from '../tools/demo/presets.mjs'
import { DemoHistory } from './support/demo-history.mjs'

const pause = () => new Promise(resolve => setImmediate(resolve))
function fixture(t, invoke) {
  const state = mkdtempSync(join(tmpdir(), 'parallel-verify-')), history = new DemoHistory(), updates = []
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const stores = [['website', 'design'], ['gateway', 'billing'], ['compiler', 'sdk'], ['embeddings', 'evaluation']].map((projects, index) => ({ name: `store-${index}`, machine: 'native', projects }))
  const driver = { spec: {}, invoke: async (argv, options) => {
    assert.equal(options.read, true, 'verification uses reads exclusively')
    await invoke?.(argv, runner)
    if (argv[0] === 'store') return { machine: 'native' }
    if (argv[0] === 'project') return { project: argv[2] }
    return history.invoke(argv, options)
  } }
  const runner = new DemoRunner({ state, historyDensity: 'base', driver, progress: value => updates.push(value) })
  runner.preset = { machines: [], stores }; runner.manifest = { contentVersion: CONTENT_VERSION, projects: {}, steps: {} }
  for (const store of stores) for (const name of store.projects) {
    const project = `${store.name}/${name}`
    history.init(project, runner.source(store.name, name)); runner.manifest.projects[project] = { seeded: true }
    for (const step of projectHistorySteps(store.name, name, { density: 'base' })) runner.manifest.steps[`${step.key}:${project}`] = { status: 'done', argv: step.argv, result: history.invoke(step.argv, { input: step.input }) }
  }
  return { runner, history, updates }
}

test('verification overlaps four stores while fully checking projects in store order', { timeout: 5000 }, async t => {
  const active = new Map(), projectStarts = []
  let inFlight = 0, peak = 0
  const { runner, updates } = fixture(t, async (argv, current) => {
    const store = argv[2].split('/')[0]
    inFlight++; peak = Math.max(peak, inFlight); active.set(store, (active.get(store) ?? 0) + 1)
    assert.ok(inFlight <= 4); assert.equal(active.get(store), 1)
    if (argv[0] === 'project') {
      const definition = current.preset.stores.find(item => item.name === store), name = argv[2].split('/')[1]
      if (name === definition.projects[1]) assert.equal(current.manifest.projects[`${store}/${definition.projects[0]}`].verification.commits, 24)
      projectStarts.push(argv[2])
    }
    await pause()
    inFlight--; active.set(store, active.get(store) - 1)
  })
  const result = await runner.verify({ activity: false })
  assert.equal(result.projects, 8); assert.equal(peak, 4); assert.equal(inFlight, 0)
  assert.equal(new Set(projectStarts.slice(0, 4).map(project => project.split('/')[0])).size, 4)
  for (const project of Object.values(runner.manifest.projects)) {
    assert.equal(project.verification.commits, 24); assert.equal(project.verification.layers, 5)
    assert.equal(project.verification.publicationReceiptsVerified, true)
  }
  assert.deepEqual(updates.map(value => value.completed), Array.from({ length: 9 }, (_, index) => index))
  assert.ok(updates.every(value => value.total === 8))
})

test('verification failure drains dispatched reads and stops further pages and project starts', { timeout: 5000 }, async t => {
  let release, ready, arrivals = 0, inFlight = 0, captureCalls = 0
  const siblings = new Promise(resolve => { release = resolve }), allArrived = new Promise(resolve => { ready = resolve }), calls = []
  const failure = new Error('saved history page unavailable')
  const { runner, updates } = fixture(t, async argv => {
    calls.push(argv)
    if (argv[0] !== 'branch' || argv[1] !== 'list') return
    inFlight++; if (++arrivals === 4) ready()
    try {
      await allArrived
      if (argv[2].startsWith('store-0/')) throw failure
      await siblings
    } finally { inFlight-- }
  })
  runner.verifyActivityCapture = async () => { captureCalls++; return { complete: true } }
  let returned = false
  const pending = runner.verify({ activity: false }).then(() => { returned = true; return null }, error => { returned = true; return error })
  await allArrived; await pause()
  assert.equal(returned, false, 'the operation remains active until sibling reads settle')
  assert.equal(inFlight, 3)
  const countAtFailure = calls.length
  release()
  assert.equal(await pending, failure)
  assert.equal(inFlight, 0); assert.equal(calls.length, countAtFailure)
  assert.equal(captureCalls, 0, 'failed verification cannot produce a capture success receipt')
  assert.equal(calls.filter(argv => argv[0] === 'project').length, 4, 'second projects were never started')
  assert.equal(calls.some(argv => argv[0] === 'branch' && argv[1] === 'commits'), false, 'no continuation started after failure')
  assert.deepEqual(updates.map(value => value.completed), [0])
  assert.ok(Object.values(runner.manifest.projects).every(project => !project.verification))
})
