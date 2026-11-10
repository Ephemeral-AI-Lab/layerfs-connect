import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const compile = file => ts.transpileModule(readFileSync(new URL(`../src/renderer/src/layerfs/${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const model = await import(`data:text/javascript;base64,${Buffer.from(compile('machine-progress.ts')).toString('base64')}`)
const initial = (id = 'one') => ({ id, name: 'test-lima', kind: 'start', platform: 'lima', startedAt: 1, status: 'running', stages: [] })
const call = { id: 'command', argv: ['machine', 'start', '--progress', '--', 'test-lima'], status: 'running' }
const event = (stage, state, at, extra = {}) => ({ id: `${stage}-${state}`, type: 'cli.progress', invocationId: 'command', at, seq: at, data: { progress: { stage, state, ...extra } } })

test('rapid stages retain history, start time and measured completion duration', () => {
  const events = [event('bundle-validation', 'started', 10), event('bundle-validation', 'completed', 11, { elapsed_ms: 1 }), event('provider-and-worker', 'started', 12), event('provider-and-worker', 'completed', 13, { elapsed_ms: 1 })]
  const value = model.mergeMachineActivity(initial(), { id: 'one', invocations: [call], events })
  assert.deepEqual(value.stages, [{ stage: 'bundle-validation', state: 'completed', at: 10, elapsedMs: 1 }, { stage: 'provider-and-worker', state: 'completed', at: 12, elapsedMs: 1 }])
  assert.equal(value.stages.some(stage => stage.stage === 'sandbox-image'), false, 'unreported stages are never fabricated')
})

test('other actions and non-machine invocations cannot supply startup stages', () => {
  const snapshot = initial()
  assert.equal(model.mergeMachineActivity(snapshot, { id: 'old-attempt', invocations: [call], events: [event('wrong', 'started', 1)] }), snapshot)
  const value = model.mergeMachineActivity(snapshot, { id: 'one', invocations: [{ ...call, argv: ['machine', 'get', '--', 'test-lima'] }], events: [event('wrong', 'started', 1)] })
  assert.deepEqual(value.stages, [])
})

test('stale partial stage history never regresses a completed or failed stage', () => {
  for (const state of ['completed', 'failed']) {
    const finished = model.mergeMachineActivity(initial(), { id: 'one', invocations: [call], events: [event('provider-and-worker', 'started', 10), event('provider-and-worker', state, 30, { elapsed_ms: 20 })] })
    const stale = model.mergeMachineActivity(finished, { id: 'one', invocations: [call], events: [event('provider-and-worker', 'started', 10)] })
    assert.deepEqual(stale.stages, finished.stages)
  }
})

test('failed compatibility and terminal outcome survive later activity reads', () => {
  const snapshot = { ...initial(), status: 'failed', endedAt: 20, error: new Error('protocol mismatch') }
  const value = model.mergeMachineActivity(snapshot, { id: 'one', invocations: [call], events: [event('worker-compatibility', 'failed', 19, { elapsed_ms: 3 })] })
  assert.equal(value.status, 'failed')
  assert.equal(value.error, snapshot.error)
  assert.equal(value.stages[0].state, 'failed')
  for (const error of [{ code: 'Unknown' }, { code: 'no-host' }, { status: 0 }, { transport: 'uncertain' }]) assert.equal(model.startupFailure(error), 'uncertain')
  assert.equal(model.startupFailure({ code: 'Unavailable', status: 503 }), 'failed')
})

test('mutation correlation is exact; duplicate start is blocked and uncertain requests are not replayed', async () => {
  const listeners = new Set(), reads = []
  globalThis.location = { hash: '#/machines/test-lima' }
  globalThis.__machineProgressDeps = {
    useSyncExternalStore: (_subscribe, get) => get(),
    mergeMachineActivity: model.mergeMachineActivity, startupFailure: model.startupFailure,
    activityApi: { get: async id => { reads.push(id); return null } },
    connectBridge: { onStream: listener => { listeners.add(listener); return () => listeners.delete(listener) }, subscribe: async () => true },
  }
  const code = `const {useSyncExternalStore,mergeMachineActivity,startupFailure,activityApi,connectBridge}=globalThis.__machineProgressDeps;\n${compile('use-machine-progress.ts').replace(/^import .*$/gm, '')}`
  const store = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  let reject, attempts = 0, activity
  const failure = Object.assign(new Error('response lost'), { code: 'Unknown' })
  const operation = store.performMachineStartup({ name: 'test-lima', platform: 'lima', kind: 'start' }, action => {
    attempts++; activity = action
    assert.equal(listeners.size, 1, 'observer is installed before mutation')
    return new Promise((_resolve, no) => { reject = no })
  })
  assert.equal(store.useMachineProgress('test-lima').status, 'running')
  const boardSnapshot = store.useMachineStartups()
  assert.equal(boardSnapshot, store.useMachineStartups(), 'unchanged board snapshot has stable identity')
  assert.equal(boardSnapshot.find(item => item.name === 'test-lima')?.status, 'running')
  store.clearMachineProgress('test-lima')
  assert.equal(store.useMachineProgress('test-lima').status, 'running', 'active work cannot be dismissed')
  await assert.rejects(store.performMachineStartup({ name: 'test-lima', platform: 'lima', kind: 'start' }, async () => { attempts++ }), /already has/)
  reject(failure)
  await assert.rejects(operation, error => error === failure)
  assert.equal(attempts, 1)
  assert.equal(activity.target, 'test-lima')
  assert.equal(activity.name, 'machine.start')
  assert.equal(activity.origin, 'user')
  assert.equal(store.useMachineProgress('test-lima').id, activity.id)
  assert.equal(store.useMachineProgress('test-lima').status, 'uncertain')
  assert.equal(listeners.size, 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reads, [activity.id])
  let resolveOld, oldAction, newAction
  globalThis.__machineProgressDeps.activityApi.get = id => id === oldAction?.id
    ? new Promise(resolve => { resolveOld = resolve })
    : Promise.resolve({ id, invocations: [call], events: [event('worker-compatibility', 'completed', 100)] })
  await store.performMachineStartup({ name: 'test-lima', platform: 'lima', kind: 'start' }, async action => { oldAction = action })
  await store.performMachineStartup({ name: 'test-lima', platform: 'lima', kind: 'start' }, async action => { newAction = action })
  await new Promise(resolve => setImmediate(resolve))
  resolveOld({ id: oldAction.id, invocations: [call], events: [event('obsolete-stage', 'started', 80)] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(store.useMachineProgress('test-lima').id, newAction.id)
  assert.deepEqual(store.useMachineProgress('test-lima').stages.map(stage => stage.stage), ['worker-compatibility'], 'late GET from an old attempt cannot replace the new attempt')
  store.clearMachineProgress('test-lima')
  assert.equal(store.useMachineProgress('test-lima'), undefined)
  assert.deepEqual(store.useMachineStartups(), [])
  delete globalThis.__machineProgressDeps
})
