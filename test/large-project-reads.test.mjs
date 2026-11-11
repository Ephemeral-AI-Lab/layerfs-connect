import assert from 'node:assert/strict'
import test from 'node:test'
import { Projects } from '../host/projects.js'
const id = n => `12${n.toString(16).padStart(64, '0')}`
const layer = `32${'a'.repeat(64)}`
test('large project shell remains available without scanning any branch history', async () => {
  let historyCalls = 0
  const listed = [{ name: 'main', base: layer }, ...Array.from({ length: 199 }, (_, n) => ({ name: `work-${n}`, head: id(n + 1), base: layer, forked_from: layer }))]
  const client = {
    project: { get: async () => ({ project: 'store/app', store: 'store', name: 'app' }) },
    store: { status: async () => ({ state: 'idle' }) },
    sandbox: { list: async () => ({ items: [], next_page_pos: null }) },
    branch: { list: async () => ({ items: listed, next_page_pos: null }), commits: async () => { historyCalls++; throw Object.assign(new Error('saved history page exceeds reply budget; reduce page_size'), { code: 'Capacity' }) } },
  }
  const state = await new Projects({ spec: { state: '/tmp' }, client }).state('store/app')
  assert.equal(state.branches.length, 200)
  assert.equal(state.branches[1].head, id(1))
  assert.equal(historyCalls, 0)
  assert.equal(state.commits, null, 'unscanned history is unknown, not a zero or partial total')
  assert.equal(state.branches[1].commits, null)
})
test('history pages fit the reply budget and resume immutable parents despite newer writes', async () => {
  let head = 100
  const calls = []
  const projects = new Projects({ spec: { state: '/tmp' }, client: { branch: { commits: async (_key, branch, options) => {
    calls.push(options)
    if (options.page_size > 20) throw Object.assign(new Error('saved history page exceeds reply budget; reduce page_size'), { code: 'Capacity' })
    const at = options.at_commit ? Number.parseInt(options.at_commit.slice(2),16) : head
    const items = Array.from({ length: Math.min(options.page_size, at) }, (_, n) => ({ id: id(at-n), parent: at-n>1 ? id(at-n-1) : null, branch }))
    return { items, at_commit: { id: id(at) }, has_more: at>items.length }
  } } } })
  const first = await projects.history('store/app', new URLSearchParams('branch=main'))
  head = 150
  const next = await projects.history('store/app', new URLSearchParams({ branch: 'main', at: first.next }))
  assert.equal(first.items.length, 20)
  assert.equal(next.items[0].id, id(80))
  assert.equal(new Set([...first.items,...next.items].map(x=>x.id)).size, 40)
  assert.equal(calls[1].at_commit, first.next)
})
