// A project's name may be in several Stores (layerfs#506): projects.js finds
// a project by name and Store, keys it as the runtime does, reads a shared
// Store's project with { store }, and reads a PostgreSQL Store's project
// with its connection's URL. A stand-in runtime; no LayerFS.
//   node --test host/test/project-stores.test.js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keyOf, Projects, readState } from '../projects.js'

const LIST = [
  { name: 'shop', store: 'shop', kind: 'sqlite', volume: 'v-shop', initialized: true, shared: false },
  { name: 'todo', store: 'team', kind: 'sqlite', volume: 'v-team', initialized: true, shared: true },
  { name: 'todo', store: 'team-pg', kind: 'postgresql', volume: null, initialized: true, shared: true },
]

function projects() {
  const runtime = { project: { list: async () => LIST } }
  const p = new Projects({ spec: { home: '/h', prefix: 'lfc-', state: '/s' }, log: () => {} })
  p.runtime = async () => runtime
  return p
}

test('a project is found by name, and by name and Store when the name is in several', async () => {
  const p = projects()
  assert.equal((await p.record('shop')).store, 'shop')
  await assert.rejects(p.record('todo'), { status: 400, code: 'AmbiguousProject', message: /team, team-pg/ })
  assert.equal((await p.record('todo', 'team')).kind, 'sqlite')
  assert.equal((await p.record('todo', 'team-pg')).kind, 'postgresql')
  await assert.rejects(p.record('todo', 'other'), { status: 404, code: 'NoSuchProject' })
  await assert.rejects(p.record('todo', 'Bad Store'), { status: 400 })
})

test('keys and summaries: store/name in a shared Store, the name in its own', async () => {
  assert.deepEqual(LIST.map(keyOf), ['shop', 'team/todo', 'team-pg/todo'])
  const s = projects().summary(LIST[2], new Map())
  assert.deepEqual({ key: s.key, store: s.store, kind: s.kind, shared: s.shared }, { key: 'team-pg/todo', store: 'team-pg', kind: 'postgresql', shared: true })
})

test('get_state names the Store of a shared project, and only then', async () => {
  const seen = []
  const runtime = { project: { get_state: async (...args) => (seen.push(args), { kind: 'ok' }) } }
  await readState(runtime, 'todo', 'team')
  await readState(runtime, 'shop')
  assert.deepEqual(seen, [['todo', undefined, { store: 'team' }], ['shop']])
})

test('a PostgreSQL Store project needs the URL the host gives; without it the read is Unsupported', async () => {
  const p = projects()
  await assert.rejects(p.postgresqlUrl('team-pg'), { status: 501, code: 'Unsupported' })
  p.postgresql = async (store) => `postgresql://u@h/${store}`
  assert.equal(await p.postgresqlUrl('team-pg'), 'postgresql://u@h/team-pg')
})

test('at startup a running worker of another build is replaced, one of this build is kept', async () => {
  const run = async (worker) => {
    const starts = []
    const runtime = { status: async () => ({ worker }), worker: { start: async () => starts.push(worker.build) } }
    const p = new Projects({ spec: { home: '/h', prefix: 'lfc-', state: '/s', worker: true, image: 'sha256:x', bundle: '/b', daemon: '/b/layerfs-daemon' }, log: () => {} })
    p.runtime = async () => runtime
    p.status = async () => ({})
    await p.ensureWorker()
    return starts.length
  }
  assert.equal(await run({ name: 'lfc-worker', state: 'running', build: 'build-old', expected: 'build-new' }), 1)
  assert.equal(await run({ name: 'lfc-worker', state: 'running', build: 'build-new', expected: 'build-new' }), 0)
  assert.equal(await run({ name: 'lfc-worker', state: 'missing' }), 1)
})

test('a stuck Sandbox is stopped by the container name LayerFS gives it', async () => {
  const { sandboxContainer } = await import('../runs/run.js')
  const { projectRef } = await import('../config.js')
  assert.equal(sandboxContainer('lfc-', projectRef('r2-examples-clone/scenarios'), '6'), 'lfc-r2-examples-clone.scenarios-6')
  assert.equal(sandboxContainer('lfc-', projectRef('heavy-check'), '1'), 'lfc-heavy-check-1')
})

test('one state read per project at a time: polls while it runs share it, a later poll reads again', async () => {
  const p = projects()
  let reads = 0
  let finish
  const read = () => (reads++, new Promise((resolve) => (finish = resolve)))
  const a = p.oneRead(LIST[1], read)
  const b = p.oneRead(LIST[1], read)
  assert.equal(reads, 1)
  p.oneRead(LIST[2], () => (reads++, Promise.resolve('other Store')))
  assert.equal(reads, 2, 'a project of the same name in another Store reads on its own')
  finish('state')
  assert.deepEqual([await a, await b], ['state', 'state'])
  await p.oneRead(LIST[1], () => (reads++, Promise.resolve('again')))
  assert.equal(reads, 3)
})

