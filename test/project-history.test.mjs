import test from 'node:test'
import assert from 'node:assert/strict'
import { baseProjectHistorySteps as projectHistorySteps, baseProjectHistoryPlan as projectHistoryPlan, assertProjectStep } from '../tools/demo/recipe.mjs'

test('every project plans 22 real writes, two divergent merges and four safe publications', () => {
  for (const name of ['website', 'design', 'gateway', 'billing', 'compiler', 'sdk', 'embeddings', 'evaluation']) {
    const plan = projectHistoryPlan(name), steps = projectHistorySteps('demo', name)
    assert.equal(new Set(plan.branches).size, 9)
    assert.equal(steps.filter(step => step.argv[0] === 'file').length, 22)
    assert.equal(steps.filter(step => step.argv[1] === 'merge').length, 2)
    assert.equal(steps.filter(step => step.argv[1] === 'publish').length, 4)
    assert.equal(steps.some(step => ['workspace', 'sandbox'].includes(step.argv[0])), false)
    assert.equal(new Set(steps.map(step => step.key)).size, steps.length)
    assert.ok(steps.filter(step => step.input !== undefined).every(step => step.input.length > 0))
  }
})
test('step assertions reject no-op writes, fast-forward merges, and stale publication overwrite', () => {
  assert.throws(() => assertProjectStep({ key: 'write', expect: { kind: 'Committed' } }, { kind: 'UpToDate' }), /expected Committed/)
  assert.throws(() => assertProjectStep({ key: 'merge', expect: { kind: 'Merged', divergent: true } }, { kind: 'Merged', fast_forward: true }), /divergent merge/)
  assert.throws(() => assertProjectStep({ key: 'publish', expect: { kind: 'Added', overwroteCount: 0 } }, { kind: 'Added', overwrote_count: 1 }), /overwrote/)
})
