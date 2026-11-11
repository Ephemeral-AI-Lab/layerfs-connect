import test from 'node:test'
import assert from 'node:assert/strict'
import { integer, maximum, coordinate, compositionMatches, encodingRatio, canonicalReuse } from '../src/renderer/src/components/storage/measures.ts'

const wire = n => ({ $layerfs: 'i64-v1', decimal: String(n) })
test('large byte totals stay exact while chart coordinates remain bounded', () => {
  const large = 9223372036854775807n
  assert.equal(integer(wire(large)), large)
  assert.equal(maximum([wire(large), 20]), large)
  assert.equal(coordinate(wire(large), large), 1)
  assert.equal(coordinate(wire(large / 2n), large), .499999)
  assert.equal(encodingRatio(wire(large), wire(large / 2n)), '2.00')
})
test('unknown and unsafe numbers never become fabricated zero measurements', () => {
  for (const value of [null, undefined, NaN, -1, Number.MAX_SAFE_INTEGER + 1, { $layerfs: 'i64-v1', decimal: 'NaN' }]) {
    assert.equal(integer(value), null)
    assert.equal(coordinate(value, 10n), null)
  }
  assert.equal(coordinate(0, 0n), 0)
  assert.equal(encodingRatio(0, 0), null)
})
test('only fully measured non-overlapping composition can be stacked', () => {
  assert.equal(compositionMatches([10, 20, 30, 0], 60), true)
  assert.equal(compositionMatches([wire(9007199254740993n), 7], wire(9007199254741000n)), true)
  assert.equal(compositionMatches([10, null, 30, 0], 40), false)
  assert.equal(compositionMatches([10, 20, 30, 0], 50), false)
  assert.equal(compositionMatches([0, 0, 0, 0], 0), true)
})

test('reuse ring measures selected canonical reuse and rejects missing or inconsistent populations', () => {
  assert.equal(canonicalReuse(100, 25), .75)
  assert.equal(canonicalReuse(100, 100), 0)
  assert.equal(canonicalReuse(wire(9223372036854775806n), wire(4611686018427387903n)), .5)
  for (const [referenced, unique] of [[0, 0], [null, 10], [100, null], [10, 11], [-1, 0]]) {
    assert.equal(canonicalReuse(referenced, unique), null)
  }
})
