// The host on LayerFS 2.0 against a stand-in client shaped like the 2.0
// package (snake_case results, positionals in table order, pages with
// next_page_pos): projects.js, storage.js, machines.js, scope.js, the
// scenario converter and config.js's project keys.
//   node --test host/test/layerfs2.test.js
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { projectRef } from '../config.js'
import { Machines } from '../machines.js'
import { Projects } from '../projects.js'
import { Scope } from '../runs/scope.js'
import { Storage } from '../storage.js'
import { toV2, v2Blocked } from '../../tools/lib/layerfs2.mjs'

const LAYER = `32${'a'.repeat(64)}`
const C1 = `12${'1'.repeat(64)}`
const C2 = `12${'2'.repeat(64)}`

/** A stand-in 2.0 client recording its calls. */
function fake() {
  const calls = []
  const rec = (name, answer) => async (...args) => {
    calls.push([name, ...args])
    return typeof answer === 'function' ? answer(...args) : answer
  }
  const lfs = {
    calls,
    machine: { status: rec('machine.status', { state: 'stopped' }), list: rec('machine.list', { machines: [{ name: 'native', platform: 'native', state: 'ready' }, { name: 'lima1', platform: 'lima', state: 'stopped' }], can_create: [] }) },
    store: {
      list: rec('store.list', { items: [{ name: 's1', kind: 'sqlite', machine: 'native', projects: ['app'], backups: { b1: { file: 's1', last: { op: 'create', at: 1, bytes: 10 } } } }] }),
      status: rec('store.status', { state: 'idle', holders: [], file: { exists: true, bytes: 100, wal_bytes: 20 } }),
      create: rec('store.create', {}),
      move: rec('store.move', (store, machine, o) => (o.on_progress({ phase: 'send', done: 5, total: 10 }), { store, to: machine })),
      connect: rec('store.connect', {}),
    },
    backup: { connect: rec('backup.connect', {}), list: rec('backup.list', { items: [{ bucket: 'b1', file: 's1', store: 's1', state: 'store_changed', bytes: 10 }] }) },
    project: {
      list: rec('project.list', { items: [{ project: 's1/app', store: 's1', name: 'app', kind: 'sqlite', machine: 'native', created: 1 }], next_page_pos: null }),
      get: rec('project.get', { project: 's1/app', store: 's1', name: 'app', kind: 'sqlite', machine: 'native' }),
      remove: rec('project.remove', {}),
    },
    branch: {
      list: rec('branch.list', { items: [{ name: 'main', base: LAYER, head: null }, { name: 'work', base: LAYER, head: C2, forked_from: LAYER }], next_page_pos: null }),
      get: rec('branch.get', { name: 'work', base: LAYER, head: C2, forked_from: LAYER }),
    },
    commit: {
      list: rec('commit.list', { items: [{ id: C2, branch: 'work', parent: C1, via: 'fs', message: 'two', time: 2 }, { id: C1, branch: 'work', parent: null, via: 'fs', message: 'one', time: 1 }], next_page_pos: null }),
      diff: rec('commit.diff', { items: [{ path: '/n.txt', kind: 'Modified' }], next_page_pos: null, next_cursor: null }),
    },
    sandbox: { list: rec('sandbox.list', { items: [], next_page_pos: null }), create: rec('sandbox.create', (p, name, machine) => ({ name, project: p, machine })) },
  }
  return lfs
}

const spec = () => {
  const state = mkdtempSync(join(tmpdir(), 'lfc-2-'))
  return { state, home: join(state, 'home-2'), runs: join(state, 'runs'), cli: null }
}

test('a project key is <store>/<project>; a bare name is refused', () => {
  assert.deepEqual(projectRef('s1/app'), { store: 's1', name: 'app', key: 's1/app' })
  assert.throws(() => projectRef('app'), /write it as <store>\/<project>/)
})

test('projects: list, state and Commits read 2.0 calls with the key first', async () => {
  const lfs = fake()
  const s = spec()
  const p = new Projects({ spec: s, client: lfs, log: () => {} })
  assert.deepEqual((await p.list()).map((x) => x.key), ['s1/app'])
  const st = await p.state('s1/app')
  assert.deepEqual(st.branches.map((b) => [b.name, b.parent, b.commits]), [['main', null, 0], ['work', 'main', 2]])
  assert.equal(st.store.bytes, 120)
  assert.equal(st.storage, null)
  const commits = await p.commits('s1/app', 'work')
  assert.deepEqual(commits.map((c) => [c.message, c.changes?.length ?? null]), [['two', 1], ['one', null]])
  assert.deepEqual(lfs.calls.find((c) => c[0] === 'commit.diff').slice(1, 4), ['s1/app', C1, C2])
  assert.deepEqual(await p.commits('s1/app', 'main'), [])
  await p.createSandbox('s1/app', { name: 'sb' })
  assert.deepEqual(lfs.calls.find((c) => c[0] === 'sandbox.create').slice(1, 4), ['s1/app', 'sb', 'native'])
  rmSync(s.state, { recursive: true, force: true })
})

test('storage: references only, Stores by machine, and jobs fed by on_progress', async () => {
  const lfs = fake()
  const s = spec()
  const st = new Storage({ spec: s, client: lfs, log: () => {} })
  await assert.rejects(st.connectBucket({ name: 'b2', url: 'http://u:p@host/b', key: 'file:/k' }), /must not hold a user or password/)
  await assert.rejects(st.connectBucket({ name: 'b2', url: 'http://host/b', key: 'plain-secret' }), /must be a reference/)
  await assert.rejects(st.connectPostgresql({ name: 'pg', url: 'postgresql://u@h/db', password: 'hunter2' }), /must be a reference/)
  await st.connectBucket({ name: 'b2', url: 'http://host/b', key: 'env:LAYERFS_BUCKET_B2' })
  const view = await st.view()
  assert.deepEqual(view.stores[0].size, { bytes: 120, file: 100, wal: 20 })
  assert.deepEqual(view.buckets.map((b) => b.name), ['b1', 'b2'])
  await st.listBucket('b1')
  assert.equal((await st.view()).buckets[0].files[0].state, 'store_changed')
  const job = st.move('s1', 'lima1')
  assert.equal(job.kind, 'move')
  await new Promise((r) => setTimeout(r, 10))
  const done = st.job(job.id)
  assert.deepEqual([done.phase, done.done, done.total, !!done.ended], ['send', 5, 10, true])
  rmSync(s.state, { recursive: true, force: true })
})

test('machines: Compute’s Move to starts the host’s job', async () => {
  const moved = []
  const m = new Machines({ spec: spec(), client: fake(), calls: [], move: (store, machine) => (moved.push([store, machine]), { id: 'j' }) })
  await m.moveStore('s1', 'lima1')
  assert.deepEqual(moved, [['s1', 'lima1']])
  assert.equal((await m.view()).machines.length, 2)
})

test('scope: 2.0 arguments move into the run’s folder, namespace, Sandboxes and machine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lfc-scope2-'))
  const scope = Scope.create(dir, { run: 'tour_1', project: 's1/app', trunk: 'tour_1.main', machine: 'lima1' })
  assert.deepEqual(scope.args('file.write', { project: 's1/app', branch: 'main', path: '/a.txt' }), { project: 's1/app', branch: 'tour_1.main', path: '/tour_1/a.txt' })
  assert.deepEqual(scope.args('branch.fork', { project: 's1/app', name: 'x', from_branch: 'main' }), { project: 's1/app', name: 'tour_1.x', from_branch: 'tour_1.main' })
  const made = scope.args('sandbox.create', { project: 's1/app', name: 'sb1', machine: 'native' })
  assert.deepEqual(made, { project: 's1/app', name: 'tour_1.sb1', machine: 'lima1' })
  assert.equal(scope.args('workspace.exec', { ws: 'sb1:/w/1', command: 'ls' }).ws, 'tour_1.sb1:/w/1')
  assert.equal(scope.args('workspace.exec', { ws: 'tour_1.sb1:/w/1', command: 'ls' }).command, 'cd tour_1 || exit 97\nls')
  rmSync(dir, { recursive: true, force: true })
})

test('the converter writes 2.0 commands and marks what cannot play', () => {
  const s = { agents: { root: [{ bash: { command: 'layerfs branch fork f\nlayerfs sandbox create | tee s.json\nlayerfs workspace mount "$(jq -r .sandbox s.json)" f\nlayerfs fs edit f /a --old x --new y\nlayerfs branch merge f g r' }, expect: ['fs.edit:Committed'] }] } }
  const v = toV2(s)
  const cmd = v.agents.root[0].bash.command
  assert.match(cmd, /layerfs branch fork "\$LAYERFS_CONNECT_PROJECT" f main/)
  assert.match(cmd, /layerfs sandbox create "\$LAYERFS_CONNECT_PROJECT" sb1 "\$LAYERFS_CONNECT_MACHINE"/)
  assert.match(cmd, /jq -r \.name s\.json/)
  assert.match(cmd, /layerfs file edit "\$LAYERFS_CONNECT_PROJECT" f \/a/)
  assert.match(cmd, /layerfs branch merge "\$LAYERFS_CONNECT_PROJECT" r f g/)
  assert.deepEqual(v.agents.root[0].expect, ['file.edit:Committed'])
  assert.deepEqual(toV2(v), v)
  assert.match(v2Blocked({ agents: { root: [{ bash: { command: 'x', run_in_background: true } }] } }), /background/)
})

test('storage: MinIO and R2 by their parts; keys go to an owner-only file, LayerFS gets its reference', async () => {
  const lfs = fake()
  const s = spec()
  const st = new Storage({ spec: s, client: lfs, log: () => {} })
  await st.connectBucket({ name: 'm', provider: 'minio', endpoint: 'http://127.0.0.1:9000/', bucket: 'lfc', prefix: '/live/', accessKey: 'AK', secretKey: 'SK' })
  const [, name, url, opts] = lfs.calls.find((c) => c[0] === 'backup.connect')
  assert.deepEqual([name, url], ['m', 'http://127.0.0.1:9000/lfc/live'])
  assert.match(opts.key, /^file:\//)
  const file = opts.key.slice(5)
  assert.equal(readFileSync(file, 'utf8'), 'access_key=AK\nsecret_key=SK\n')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.ok(!JSON.stringify(lfs.calls).includes('SK'))
  await st.connectBucket({ name: 'r', provider: 'r2', account: 'a'.repeat(32), jurisdiction: 'eu', bucket: 'b', key: 'env:LAYERFS_BUCKET_R' })
  assert.equal(lfs.calls.filter((c) => c[0] === 'backup.connect')[1][2], `r2://${'a'.repeat(32)}/b?jurisdiction=eu`)
  await assert.rejects(st.connectBucket({ name: 'x', provider: 'r2', account: 'nope', bucket: 'b', key: 'env:LAYERFS_X' }), /32 lowercase hex/)
  rmSync(s.state, { recursive: true, force: true })
})
