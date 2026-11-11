import test from 'node:test'
import assert from 'node:assert/strict'
import { presetScript } from '../tools/demo/build.mjs'
import { scriptPage } from '../tools/demo/script-page.mjs'
import { projectHistoryPlan, projectHistorySteps } from '../tools/demo/recipe.mjs'
import { DEFAULT_HISTORY_LIMITS } from '../tools/demo/history-scheduler.mjs'
const script = presetScript({ preset: 'studio', spec: { state: '/private/dense', home: '/private/dense/home-2', cli: '/pinned/layerfs' } })

test('dense project scripts page complete ordered commands without returning other projects or JS sources', () => {
  const target = 'demo-studio/design'
  let offset = 0; const seen = []
  do {
    const page = scriptPage(script, { kind: 'project', name: target, offset, limit: 100 })
    assert.ok(page.commands.length <= 100); assert.deepEqual(page.files, [])
    assert.ok(page.commands.every(step => step.phase !== 'reset' && step.argv[2] === target))
    seen.push(...page.commands); offset = page.next
  } while (offset !== null)
  assert.deepEqual(seen, script.commands.filter(step => step.phase !== 'reset' && step.argv[2] === target))
  assert.equal(seen.filter(step => step.phase === 'build' && ['file', 'branch'].includes(step.argv[0])).length, projectHistoryPlan('design').commands)
  assert.ok(seen.some(step => step.input?.includes('authored')))
})
test('full plan pages remain bounded and invalid pagination is refused', () => {
  const first = scriptPage(script)
  assert.ok(first.total > 50834); assert.equal(first.commands.length, 100); assert.equal(first.next, 100)
  assert.deepEqual(scriptPage(script, { offset: 100, limit: 100 }).commands, script.commands.slice(100, 200))
  assert.equal(first.configuration.historySchedule, 'parallel')
  assert.deepEqual(first.configuration.historyLimits, DEFAULT_HISTORY_LIMITS)
  for (const options of [{ offset: -1 }, { offset: 0.5 }, { limit: 1001 }, { limit: 0 }]) assert.throws(() => scriptPage(script, options), { code: 'InvalidInput' })
})
test('project command plans preserve parallel lanes, dependencies and exact commit receipt references', () => {
  const target = 'demo-studio/design'
  const history = script.commands.filter(step => step.phase === 'build' && step.key && step.argv[2] === target)
  const source = projectHistorySteps('demo-studio', 'design')
  assert.equal(history.length, source.length)
  const byKey = new Map(history.map(step => [step.key, step]))
  for (const [index, step] of history.entries()) {
    assert.deepEqual(step.argv, source[index].argv)
    assert.equal(step.input, source[index].input)
    assert.equal(step.lane, source[index].lane)
    assert.deepEqual(step.dependsOn, source[index].dependsOn)
    assert.ok(step.dependsOn.every(key => byKey.has(key)), `Missing dependency of ${step.key}`)
    if (step.commitFrom) {
      assert.equal(step.commitFrom, source[index].commitFrom)
      assert.equal(step.argv.at(-1), `<commit:${step.commitFrom}>`)
      assert.ok(byKey.has(step.commitFrom))
    }
  }
  assert.ok(history.some(step => step.commitFrom), 'Dense publications must name a receipt reference')
  const page = scriptPage(script, { kind: 'project', name: target, offset: 100, limit: 100 })
  assert.ok(page.commands.some(step => step.dependsOn?.length && step.lane))
})
