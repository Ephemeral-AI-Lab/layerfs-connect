import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invocationLane } from '../host/cli/concurrency.js'
import { execute } from '../host/cli/spawn.js'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'cli-load-lane-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return { home, cli: process.execPath }
}

test('higher load capacity is isolated by home and action; ordinary calls/cancel retain their lanes', () => {
  const call = ['file', 'write']
  const normal = invocationLane('binary', { home: '/a' }, call)
  assert.equal(normal.limit, 4)
  const first = invocationLane('binary', { home: '/a' }, call, { concurrency: 8, concurrencyGroup: 'job-1' })
  assert.equal(first.limit, 8); assert.notEqual(first.key, normal.key)
  assert.notEqual(first.key, invocationLane('binary', { home: '/b' }, call, { concurrency: 8, concurrencyGroup: 'job-1' }).key)
  assert.notEqual(first.key, invocationLane('binary', { home: '/a' }, call, { concurrency: 8, concurrencyGroup: 'job-2' }).key)
  assert.deepEqual(invocationLane('binary', { home: '/a' }, ['workspace', 'exec-cancel'], { concurrency: 8 }), { key: 'binary:cancel', limit: 4 })
  assert.equal(invocationLane('binary', { home: '/a' }, call, { concurrency: 16, concurrencyGroup: 'job' }).limit, 16)
  for (const options of [{ concurrency: 17, concurrencyGroup: 'job' }, { concurrency: 8 }, { concurrency: 0, concurrencyGroup: 'job' }]) {
    assert.throws(() => invocationLane('binary', { home: '/a' }, call, options), { code: 'InvalidInput' })
  }
})

for (const [label, options, limit] of [['ordinary', {}, 4], ['preset load', { concurrency: 8, concurrencyGroup: 'load-job' }, 8], ['expanded preset load', { concurrency: 16, concurrencyGroup: 'wide-load-job' }, 16]]) {
  test(`${label} CLI processes obey the actual ${limit}-process capacity`, async t => {
    const spec = fixture(t); let active = 0, peak = 0
    const count = Math.max(12, limit + 4)
    const values = await Promise.all(Array.from({ length: count }, (_, index) => execute(spec, ['-e', `setTimeout(()=>console.log(JSON.stringify({index:${index}})),100)`], {
      ...options,
      onSpawn(child) { peak = Math.max(peak, ++active); child.once('close', () => active--) },
    })))
    assert.equal(peak, limit); assert.equal(active, 0)
    assert.deepEqual(values.map(v => v.index).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i))
  })
}
