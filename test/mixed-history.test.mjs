import test from 'node:test'
import assert from 'node:assert/strict'
import { projectHistoryPlan, projectHistorySteps } from '../tools/demo/recipe.mjs'
import { DENSE_TIERS } from '../tools/demo/dense-recipe.mjs'
import { MixedSandboxPool, MIXED_RECIPE_VERSION } from '../tools/demo/mixed-recipe.mjs'
import { DemoRunner } from '../tools/demo/runner.mjs'
import { runHistoryDAG } from '../tools/demo/history-scheduler.mjs'

test('all eight mixed tiers preserve graph targets, exceed30% and count all real CLI calls', () => {
  for (const name of Object.keys(DENSE_TIERS)) {
    const base = projectHistoryPlan(name), mixed = projectHistoryPlan(name, { executionMode: 'mixed' })
    const steps = projectHistorySteps('store', name, { executionMode: 'mixed' })
    assert.equal(steps.length, mixed.cliCalls)
    for (const key of ['commits', 'writes', 'merges', 'publications', 'layers']) assert.equal(mixed[key], base[key])
    assert.ok(mixed.workspaceRevisions / mixed.authoredRevisions >= .3)
    assert.equal(steps.filter(step => step.workspaceRevision).length, mixed.workspaceRevisions)
    assert.equal(mixed.workspaceSessions, mixed.workspaceRevisions / 2)
    assert.equal(mixed.mixedRecipeVersion, MIXED_RECIPE_VERSION)
    const calls = steps.filter(step => step.argv[0] === 'workspace')
    assert.equal(calls.filter(step => step.argv[1] === 'mount').length, mixed.workspaceSessions)
    assert.equal(calls.filter(step => step.argv[1] === 'unmount').length, mixed.workspaceSessions)
    const sessions = new Map()
    for (const step of calls) if (['exec', 'commit'].includes(step.argv[1])) {
      const counts = sessions.get(step.argv[2]) ?? { exec: 0, commit: 0 }; counts[step.argv[1]]++; sessions.set(step.argv[2], counts)
    }
    assert.equal(sessions.size, mixed.workspaceSessions)
    for (const counts of sessions.values()) assert.deepEqual(counts, { exec: 2, commit: 2 })
    assert.equal(steps.filter(step => step.argv[0] === 'sandbox' && step.argv[1] === 'create').length, 1)
    assert.equal(steps.filter(step => step.argv[0] === 'sandbox' && step.argv[1] === 'close').length, 0)
    assert.ok(steps.filter(step => step.argv[0] === 'workspace' && step.argv[1] === 'exec').every(step => Buffer.byteLength(step.argv[3]) <= 2048), 'complete exec bodies fit activity argument capture')
    assert.equal(mixed.sandboxLimit, 3); assert.equal(mixed.workspaceLimit, 16)
  }
})

test('mixed DAG overlaps two independent workspaces and detaches before direct writes and merges', async () => {
  const steps = projectHistorySteps('store', 'design', { executionMode: 'mixed', cycles: 1 })
  const completed = new Set(), mounted = new Set(); let peak = 0
  await runHistoryDAG([{ project: 'store/design', store: 'store', steps }], async (_task, step) => {
    for (const dep of step.dependsOn) assert.ok(completed.has(dep), dep)
    if (step.argv[0] === 'workspace') {
      const [, call, ws] = step.argv
      if (call === 'mount') mounted.add(`${ws}:${step.argv.at(-1)}`)
      else { assert.ok(mounted.has(ws), `${step.key} workspace must be mounted`); if (call === 'unmount') mounted.delete(ws) }
      peak = Math.max(peak, mounted.size)
    }
    if (step.key === 'dense.001.b.write.17') assert.ok(![...mounted].some(ws => ws.includes(':b-001-')))
    if (step.key === 'dense.001.integration.merge') assert.equal(mounted.size, 0)
    await new Promise(resolve => setImmediate(resolve)); completed.add(step.key)
  })
  assert.equal(peak, 2); assert.equal(mounted.size, 0); assert.equal(completed.size, steps.length)
})

test('pool reuses16 workspace slots per sandbox, grows at most3 and retains occupied leases until confirmed release', () => {
  const pool = new MixedSandboxPool('store/design')
  for (let i = 0; i < 48; i++) assert.equal(pool.acquire(`ws-${i}`), `demo-mix-design-${Math.floor(i / 16) + 1}`)
  assert.throws(() => pool.acquire('overflow'), { code: 'Capacity' })
  assert.equal(pool.acquire('ws-0'), 'demo-mix-design-1', 'same lease never duplicates')
  pool.release('demo-mix-design-2', 'ws-16')
  assert.equal(pool.acquire('new-session'), 'demo-mix-design-2')
  assert.equal(pool.boxes.size, 3)
  assert.throws(() => new MixedSandboxPool('p', { sandboxLimit: 4 }))
  assert.throws(() => new MixedSandboxPool('p', { workspaceLimit: 17 }))
})


test('capture requires each workspace mutation identity and does not duplicate resource aliases', async () => {
  const runner = new DemoRunner({ state: '/tmp/mixed-capture-unit-only', executionMode: 'mixed', driver: { spec: { cli: '/not-executed' } } })
  runner.manifest = { steps: {
    create: { status: 'done', argv: ['sandbox', 'create'], invocationId: 'create-id', actionId: 'a' },
    alias: { status: 'done', argv: ['sandbox', 'create'], resourceReceipt: 'create' },
    ...Object.fromEntries(['mount', 'exec', 'commit', 'unmount'].map(call => [call, { status: 'done', argv: ['workspace', call], invocationId: `${call}-id`, actionId: 'a' }])),
  } }
  runner.activity = { flush: async () => {}, capture: async (_id, { expectedIds }) => {
    assert.equal(expectedIds.length, new Set(expectedIds).size)
    assert.deepEqual(new Set(expectedIds), new Set(['create-id', 'mount-id', 'exec-id', 'commit-id', 'unmount-id']))
    return { complete: true, count: expectedIds.length }
  } }
  assert.equal((await runner.verifyActivityCapture()).expectedMutations, 5)
  delete runner.manifest.steps.exec.invocationId
  await assert.rejects(runner.verifyActivityCapture(), /no invocation identity/)
})


test('each batch detaches before next same-branch mount and preserves the two-pair mutation chain', () => {
  const steps = projectHistorySteps('store', 'design', { executionMode: 'mixed', cycles: 1 })
  const byKey = new Map(steps.map(step => [step.key, step]))
  for (const lane of ['a', 'b']) {
    const batches = lane === 'a' ? 40 : 8
    for (let batch = 1; batch <= batches; batch++) {
      const session = `dense.001.${lane}.session.${String(batch).padStart(3, '0')}`
      const first = `dense.001.${lane}.write.${batch * 2 - 1}`, second = `dense.001.${lane}.write.${batch * 2}`
      assert.deepEqual(byKey.get(`${first}.exec`).dependsOn, [`${session}.mount`])
      assert.deepEqual(byKey.get(first).dependsOn, [`${first}.exec`])
      assert.deepEqual(byKey.get(`${second}.exec`).dependsOn, [first])
      assert.deepEqual(byKey.get(second).dependsOn, [`${second}.exec`])
      assert.deepEqual(byKey.get(`${session}.unmount`).dependsOn, [second])
      if (batch > 1) assert.ok(byKey.get(`${session}.mount`).dependsOn.includes(`dense.001.${lane}.session.${String(batch - 1).padStart(3, '0')}.unmount`))
    }
  }
})

test('old Mixed manifests cannot pass readiness or verification for the new workspace session recipe', async () => {
  const runner = new DemoRunner({ state: '/tmp/mixed-version-unit-only', executionMode: 'mixed', driver: {} })
  runner.manifest = { projects: { 'store/design': { seeded: true } }, steps: {}, contentVersion: 3, executionMode: 'mixed' }
  await assert.rejects(runner.setup(), /Mixed workspace sessions have changed/)
  await assert.rejects(runner.verify(), /older Mixed workspace sessions/)
})
