// A project's name may be in several Stores (layerfs#506): projects.js finds
// a project by name and Store, keys it as the runtime does, reads a shared
// Store's project with { store }, reads a PostgreSQL Store's project
// with its connection's URL, and reads each Sandbox on its own. A stand-in runtime; no LayerFS.
//   node --import ./host/resolve-layerfs.js --test host/test/project-stores.test.js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keyOf, Projects } from '../projects.js'

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


test('a project key opens its project: a name, or store/name in a shared Store', async () => {
  const p = projects()
  const opened = []
  p.open = async (target) => (opened.push(typeof target === 'string' ? await p.recordOf(target) : target), { layerfs: { close: async () => {} } })
  await p.use('shop', async () => {})
  await p.use(LIST[1], async () => {})
  assert.deepEqual(opened.map(keyOf), ['shop', 'team/todo'])
  assert.equal((await p.recordOf('team-pg/todo')).kind, 'postgresql')
  await assert.rejects(p.recordOf('todo'), { code: 'AmbiguousProject' })
  await p.forget('shop')
  await p.forget('team/todo')
})

test('removal: project.delete names the Store of a shared project and a PostgreSQL URL; an older build uses project.remove', async () => {
  const seen = []
  const p = projects()
  const runtime = await p.runtime()
  runtime.project.delete = async (...args) => seen.push(['delete', ...args])
  p.postgresql = async (store) => `postgresql://u@h/${store}`
  await p.remove('shop')
  await p.remove('todo', 'team')
  await p.remove('todo', 'team-pg')
  delete runtime.project.delete
  runtime.project.remove = async (...args) => seen.push(['remove', ...args])
  await p.remove('shop')
  assert.deepEqual(seen, [
    ['delete', 'shop', { confirm: 'shop', stopSandboxes: false }],
    ['delete', 'todo', { confirm: 'todo', stopSandboxes: false, store: 'team' }],
    ['delete', 'todo', { confirm: 'todo', stopSandboxes: false, store: 'team-pg', url: 'postgresql://u@h/team-pg' }],
    ['remove', 'shop', { confirm: 'shop', stopSandboxes: false }],
  ])
})

test('create into an existing Store passes { store } to Init; without one, Init is called as before', async () => {
  const calls = []
  const p = projects()
  const runtime = await p.runtime()
  runtime.project.start_init = async (...args) => (calls.push(args), { id: `job-${calls.length}`, name: args[0], source: args[1], ended: 1, step: 'done' })
  runtime.project.get_init = async () => null
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const source = mkdtempSync(join(tmpdir(), 'connect-store-init-'))
  try {
    await p.create({ name: 'docs', source, store: 'team' })
    await p.create({ name: 'docs', source })
    await assert.rejects(p.create({ name: 'docs', source, store: 'Bad Store' }), { status: 400 })
    await p.close()
    assert.deepEqual(calls, [['docs', source, { store: 'team' }], ['docs', source]])
  } finally {
    rmSync(source, { recursive: true, force: true })
  }
})

/** Projects whose client lists Sandboxes 1 to 4 and answers list_workspaces from `answer(sandbox)`. */
function withSandboxes(answer) {
  const p = projects()
  const runtime = { project: { list: async () => LIST }, sandbox: {} }
  p.runtime = async () => runtime
  const container = (sandbox, running) => ({ project: 'shop', store: null, sandbox, name: `lfc-shop-${sandbox}`, state: running ? 'running' : 'exited', running, image: 'img' })
  runtime.sandbox.list = async () => [container('1', true), container('2', true), container('3', false), container('5', true)]
  const asked = []
  const layerfs = {
    project: { list_sandboxes: async () => ({ items: ['1', '2', '3', '4'].map((sandbox) => ({ sandbox, name: `s${sandbox}`, image: 'img' })) }) },
    sandbox: { list_workspaces: (sandbox) => (asked.push(sandbox), answer(sandbox)) },
  }
  p.use = async (_record, fn) => fn({ layerfs, backend: {} })
  return { p, asked }
}

test('Sandboxes: each read on its own; a silent daemon shows busy, a refusal unreachable, and neither fails the read', async () => {
  const { p, asked } = withSandboxes((sandbox) =>
    sandbox === '1'
      ? Promise.resolve({ items: [{ path: '/w/a', branch: 'main', mounted: true }, { path: '/w/b', branch: 'x', mounted: false }] })
      : new Promise(() => {}),
  )
  const t0 = Date.now()
  const all = await p.sandboxes('shop')
  assert.ok(Date.now() - t0 < 6_000, 'one silent daemon costs at most its own limit')
  assert.deepEqual(asked, ['1', '2'], 'a stopped container and a Sandbox with no container are not asked')
  const by = Object.fromEntries(all.map((s) => [s.id, s]))
  assert.deepEqual(by['1'].workspaces, [{ ws: '1:/w/a', branch: 'main', path: '/w/a' }])
  assert.equal(by['2'].reach, 'busy')
  assert.deepEqual(by['2'].workspaces, [])
  assert.equal(by['3'].state, 'exited')
  assert.equal(by['4'].state, 'gone')
  assert.equal(by['5'].name, 'lfc-shop-5', 'a container no record lists is still shown')
  // the busy one rests: the next read answers at once without asking it again
  const again = await p.sandboxes('shop')
  assert.deepEqual(asked, ['1', '2', '1'])
  assert.equal(again.find((s) => s.id === '2').reach, 'busy')
})

test('Sandboxes: a refused daemon is unreachable; one closed meanwhile is gone', async () => {
  const refusal = (code) => Object.assign(new Error(`${code} here`), { code })
  const { p } = withSandboxes((sandbox) => Promise.reject(refusal(sandbox === '1' ? 'ConnectionRefused' : 'NoSuchSandbox')))
  const by = Object.fromEntries((await p.sandboxes('shop')).map((s) => [s.id, s]))
  assert.equal(by['1'].reach, 'unreachable')
  assert.match(by['1'].detail, /ConnectionRefused/)
  assert.equal(by['2'].state, 'gone')
  assert.equal(by['2'].reach, undefined)
})
