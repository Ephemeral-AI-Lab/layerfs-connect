import assert from 'node:assert/strict'
import test from 'node:test'
import { projectHistoryPlan, projectHistorySteps, baseProjectHistoryPlan, baseProjectHistorySteps } from '../tools/demo/recipe.mjs'

const tiers = [
  ['design', 9, 2400, 54, 500, 2933], ['billing', 10, 2664, 59, 555, 3255],
  ['sdk', 12, 3192, 69, 665, 3899], ['evaluation', 15, 3984, 84, 830, 4865],
  ['embeddings', 19, 5040, 104, 1050, 6153], ['compiler', 24, 6360, 129, 1325, 7763],
  ['gateway', 30, 7944, 159, 1655, 9695], ['website', 38, 10056, 199, 2095, 12271],
]

test('eight dense tiers meet exact nonuniform graph and command targets', () => {
  let total = 0, calls = 0
  for (const [index, [name, cycles, commits, branches, layers, commands]] of tiers.entries()) {
    const plan = projectHistoryPlan(name), steps = projectHistorySteps('store', name)
    assert.equal(plan, projectHistoryPlan(name), 'polling reuses lightweight deterministic metadata')
    assert.equal(plan.tier, index + 1); assert.equal(plan.cycles, cycles)
    assert.equal(plan.commits, commits); assert.equal(plan.branches.length, branches)
    assert.equal(plan.layers, layers); assert.equal(plan.commands, commands); assert.equal(steps.length, commands)
    assert.equal(plan.cliCalls, commands); assert.equal(plan.history.layers, layers)
    assert.equal(new Set(steps.map(step => step.key)).size, commands)
    const writes = steps.filter(step => step.argv[1] === 'write'), merges = steps.filter(step => step.argv[1] === 'merge')
    assert.equal(writes.length, plan.writes); assert.equal(merges.length, plan.merges)
    assert.equal(writes.length + merges.length, commits)
    assert.equal(steps.filter(step => step.argv[1] === 'publish').length, layers - 1)
    assert.equal(steps.filter(step => ['fork', 'merge'].includes(step.argv[1])).length, branches)
    assert.equal(new Set(plan.branches).size, branches)
    assert.equal(Object.keys(plan.expectedMain).length - Object.keys(baseProjectHistoryPlan(name).expectedMain).length, 14)
    assert.equal(new Set(writes.filter(step => step.key.startsWith('dense.')).map(step => step.argv[4])).size, 14)
    for (const step of writes.filter(step => step.key.startsWith('dense.'))) {
      assert.ok(Buffer.byteLength(step.input) < 2048)
      const parent = step.argv[4].slice(1, step.argv[4].lastIndexOf('/'))
      assert.ok(Object.keys(plan.definition.files).some(path => path.startsWith(`${parent}/`)), `imported parent exists for ${step.argv[4]}`)
    }
    for (const step of merges) assert.equal(step.expect.divergent, true)
    for (const step of steps.filter(step => step.argv[1] === 'publish')) assert.equal(step.expect.overwroteCount, 0)
    total += commits; calls += commands
  }
  assert.equal(total, 41640); assert.equal(calls, 50834)
})

test('dense dependency order makes both merges divergent and integrates stale maintenance', () => {
  const steps = projectHistorySteps('store', 'design'), cycle = steps.filter(step => step.key.startsWith('dense.001.'))
  assert.equal(cycle.length, 322)
  assert.deepEqual(cycle.slice(0, 3).map(step => step.argv[1]), ['fork', 'fork', 'fork'])
  const mergeIndices = cycle.flatMap((step, index) => step.argv[1] === 'merge' ? [index] : [])
  assert.equal(mergeIndices.length, 2)
  assert.equal(cycle[mergeIndices[1]].argv[4], 'main')
  assert.equal(cycle.slice(0, mergeIndices[0]).filter(step => step.argv[1] === 'write').length, 160)
  assert.equal(cycle.slice(mergeIndices[0], mergeIndices[1]).filter(step => step.argv[1] === 'publish').length, 27)
  assert.equal(cycle.slice(mergeIndices[1]).filter(step => step.argv[1] === 'publish').length, 28)
  assert.equal(cycle.filter(step => step.argv[1] === 'write' && step.argv[3].startsWith('accessibility-')).length, 49)
})

test('base recipe remains explicitly available and deterministic', () => {
  for (const [name] of tiers) {
    assert.deepEqual(projectHistorySteps('store', name, { density: 'base' }), baseProjectHistorySteps('store', name))
    assert.equal(projectHistoryPlan(name, { density: 'base' }).commits, 24)
    assert.equal(baseProjectHistorySteps('store', name).length, 35)
    assert.deepEqual(projectHistorySteps('store', name), projectHistorySteps('store', name))
  }
  assert.throws(() => projectHistoryPlan('design', { density: 'unknown' }), /Unknown project density/)
})
