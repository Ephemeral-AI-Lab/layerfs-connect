import test from 'node:test'
import assert from 'node:assert/strict'
import { savedOrigin, comparisonBranch } from '../desktop/src/renderer/src/components/files/saved-query-model.ts'
test('unknown owner Branch remains null while cross-Branch comparison retains its explicit left context', () => {
  assert.equal(savedOrigin({ ref: { id: 'saved', branch: null } }).branch, null)
  assert.equal(savedOrigin({ ref: { id: 'saved' } }).branch, null)
  assert.equal(savedOrigin(null), null)
  assert.equal(savedOrigin({ ref: { id: 'saved', branch: 'feature' } }).branch, 'feature')
  assert.equal(comparisonBranch('source-branch', 'target-branch'), 'source-branch')
  assert.equal(comparisonBranch(undefined, 'target-branch'), 'target-branch')
})
