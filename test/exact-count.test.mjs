import test from 'node:test'
import assert from 'node:assert/strict'
import { exactCount, exactBytes, safeEncodingRatio } from '../desktop/src/renderer/src/layerfs/exact-count.ts'
const big = { $layerfs: 'i64-v1', decimal: '9007199254740993' }
test('statistics preserve exact large wire integers without React object rendering or Number coercion', () => {
  assert.equal(exactCount(big), '9,007,199,254,740,993')
  assert.equal(exactBytes(big), '9,007,199,254,740,993 B')
  assert.equal(safeEncodingRatio(big, 2), null)
  assert.equal(safeEncodingRatio(10, 2), '5.00')
  assert.equal(safeEncodingRatio(10, 0), null)
  assert.equal(exactCount({ $layerfs: 'other', decimal: '123' }), 'Unavailable')
})
