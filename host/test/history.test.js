import assert from 'node:assert/strict'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { Projects } from '../projects.js'
const layer = `32${'a'.repeat(64)}`
const c = (id, branch = 'work', parent = null) => ({ id, branch, parent, time: 1, message: id })
function fixture() {
  const calls = []
  const record = (name, answer) => async (...args) => { calls.push([name, ...args]); return typeof answer === 'function' ? answer(...args) : answer }
  const client = {
    branch: { list: record('branches', { items: [{ name: 'main', base: layer }, { name: 'work', head: 'c3', base: layer, forked_from: 'c0' }], next_page_pos: 100 }), commits: record('commits', { items: [c('c3', 'work', 'c2'), c('c2', 'work', 'c0')], has_more: true, at_commit: 'c3' }), get_commit: record('commit', c('c3', 'work', 'c2')), get: record('branch', { name: 'work', head: 'c3', forked_from: 'before', base: layer }) },
    commit: { list: record('commits', { items: [c('c3', 'work', 'c2'), c('c2', 'work', 'c0')], next_page_pos: 2 }), get: record('commit', c('c3', 'work', 'c2')), diff: record('diff', { items: [{ path: '/a', kind: 'modified' }], next_cursor: '/a' }) },
  }
  return { client, calls, projects: new Projects({ spec: { state: tmpdir() }, client }) }
}
test('History index reads one metadata page and never scans commits or diffs', async () => {
  const { projects, calls } = fixture()
  const result = await projects.history('store/app', new URLSearchParams('pos=100'))
  assert.equal(result.next, 100)
  assert.equal(result.branches[1].forkedFrom, 'c0')
  assert.deepEqual(calls.map(c => c[0]), ['branches'])
  assert.equal(calls[0][2].page_pos, 100)
})
test('checkpoint pages stop at fork and keep SDK continuation positions', async () => {
  const { projects, calls, client } = fixture()
  const first = await projects.history('store/app', new URLSearchParams('branch=work'))
  assert.equal(first.next, 'c0')
  assert.equal(first.items.length, 2)
  assert.equal(calls.some(c => c[0] === 'diff'), false)
  client.branch.commits = async () => ({ items: [], has_more: false })
  const end = await projects.history('store/app', new URLSearchParams('branch=work&pos=2&head=c3'))
  assert.deepEqual(end.items, [])
  assert.equal(end.next, null)
})
test('immutable pagination resumes from the last parent and validates index positions', async () => {
  const { projects } = fixture()
  await projects.history('store/app', new URLSearchParams('branch=work&at=old&head=c3'))
  for (const pos of ['-1', 'no', '1.5']) await assert.rejects(projects.history('store/app', new URLSearchParams({ pos })), { code: 'InvalidInput' })
})
test('only selected checkpoints request diffs; groups compare from their first parent', async () => {
  const { projects, calls } = fixture()
  const result = await projects.history('store/app', new URLSearchParams('branch=work&commit=c3&from=c1&cursor=/before'))
  assert.equal(result.nextChanges, '/a')
  assert.deepEqual(calls.find(c => c[0] === 'diff').slice(1), ['store/app', 'c1', 'c3', { paths_only: true, page_size: 100, cursor: '/before' }])
})
test('first checkpoints compare against their immutable base Layer', async () => {
  const { projects, client, calls } = fixture()
  client.branch.get_commit = async () => c('first', 'work', layer)
  const result = await projects.history('store/app', new URLSearchParams('branch=work&commit=first'))
  assert.equal(result.changes[0].path, '/a')
  assert.equal(calls.some(c => c[0] === 'diff'), true)
})
