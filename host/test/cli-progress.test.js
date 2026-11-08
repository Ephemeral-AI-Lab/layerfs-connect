import assert from 'node:assert/strict'
import test from 'node:test'
import { progress } from '../cli/progress.js'
test('incremental UTF-8 progress preserves repeated phases and null totals', () => {
  const seen = [], input = Buffer.from(['check', 'snapshot', 'check', 'hash', 'upload'].map((phase) => JSON.stringify({progress:{phase,done:0,total:null,message:'字'}})).join('\n')+'\n')
  const parser = progress((p) => seen.push(p))
  for (let i=0;i<input.length;i++) parser.write(input.subarray(i,i+1))
  parser.end()
  assert.deepEqual(seen.map((p)=>p.phase), ['check','snapshot','check','hash','upload'])
  assert.ok(seen.every((p)=>p.total===null && p.message==='字'))
})
