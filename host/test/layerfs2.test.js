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
import { workspacesOf } from '../layerfs.js'
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
      get: rec('store.get', (name) => ({ name, kind: 'sqlite', machine: name === 'far' ? 'lima1' : 'native' })),
      push: rec('store.push', (store, machine, o) => (o.on_progress({ phase: 'send', done: 5, total: 10 }), { store, machine })),
      pull: rec('store.pull', (store, o) => (o.on_progress({ phase: 'send', done: 3, total: 4 }), { store, machine: 'native' })),
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
      commits: rec('branch.commits', { items: [{ id: C2, branch: 'work', parent: C1, via: 'fs', message: 'two', time: 2 }, { id: C1, branch: 'work', parent: null, via: 'fs', message: 'one', time: 1 }], has_more: false }),
      get: rec('branch.get', { name: 'work', base: LAYER, head: C2, forked_from: LAYER }),
    },
    commit: {
      list: rec('commit.list', { items: [{ id: C2, branch: 'work', parent: C1, via: 'fs', message: 'two', time: 2, logical: 1000, new_canonical: 40, new_stored: 10, new_metadata: 4 }, { id: C1, branch: 'work', parent: null, via: 'fs', message: 'one', time: 1, logical: 900, new_canonical: 60, new_stored: 15, new_metadata: 6 }], next_page_pos: null }),
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
  assert.deepEqual(st.branches.map((b) => [b.name, b.parent, b.commits]), [['main', null, 0], ['work', 'main', null]])
  assert.equal(st.store.bytes, 120)
  // Project state never invents Store totals from a bounded Commit page.
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
  const job = st.push('s1', 'lima1')
  assert.equal(job.kind, 'push')
  await new Promise((r) => setTimeout(r, 10))
  const done = st.job(job.id)
  assert.deepEqual([done.phase, done.done, done.total, !!done.ended, done.error], ['send', 5, 10, true, null])
  rmSync(s.state, { recursive: true, force: true })
})

test('storage: a move between machines is a pull, then a push, in one job with two halves (U5)', async () => {
  const lfs = fake()
  const s = spec()
  const st = new Storage({ spec: s, client: lfs, log: () => {} })
  const halves = []
  st.on('event', (e) => e.type === 'storage-job' && e.job.half && halves.at(-1) !== e.job.half && halves.push(e.job.half))
  const job = st.move('far', 'lima2')
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(halves, ['pull', 'push'])
  assert.deepEqual(lfs.calls.filter((c) => c[0] === 'store.pull' || c[0] === 'store.push').map((c) => [c[0], c[1], typeof c[2] === 'string' ? c[2] : null]), [['store.pull', 'far', null], ['store.push', 'far', 'lima2']])
  assert.equal(st.job(job.id).error, null)
  // the push half refused: the Store stays on native and the job says so
  lfs.store.push = async () => { throw Object.assign(new Error('store push, check: machine lima2 is not running; start it with `layerfs machine start lima2`'), { code: 'Unavailable', detail: { phase: 'check' } }) }
  const failed = st.move('far', 'lima2')
  await new Promise((r) => setTimeout(r, 10))
  const error = st.job(failed.id).error
  assert.deepEqual([error.code, error.phase, error.note], ['Unavailable', 'check', 'pulled'])
  assert.match(error.message, /layerfs machine start lima2/)
  rmSync(s.state, { recursive: true, force: true })
})

test('storage: place picks push from native, pull to native, else a move; PostgreSQL never moves', async () => {
  const lfs = fake()
  const s = spec()
  const st = new Storage({ spec: s, client: lfs, log: () => {} })
  assert.equal((await st.place('s1', 'lima1')).kind, 'push')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal((await st.place('far', 'native')).kind, 'pull')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal((await st.place('far', 'lima2')).kind, 'move')
  await new Promise((r) => setTimeout(r, 5))
  await assert.rejects(st.place('s1', 'native'), /on native already/)
  lfs.store.get = async (name) => ({ name, kind: 'postgresql', machine: null })
  await assert.rejects(st.place('pg', 'lima1'), /never pushed or pulled/)
  rmSync(s.state, { recursive: true, force: true })
})

test('machines: Compute’s “put a Store here” starts the host’s job', async () => {
  const moved = []
  const m = new Machines({ spec: spec(), client: fake(), calls: [], place: (store, machine) => (moved.push([store, machine]), { id: 'j' }) })
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
  const real = `tour_1.sb1.${scope.tag}`
  assert.deepEqual(made, { project: 's1/app', name: real, machine: 'lima1' })
  assert.equal(scope.args('workspace.exec', { ws: 'sb1:/w/1', command: 'ls' }).ws, `${real}:/w/1`)
  assert.equal(scope.args('workspace.exec', { ws: `${real}:/w/1`, command: 'ls' }).ws, `${real}:/w/1`)
  assert.match(scope.args('workspace.exec', { ws: `${real}:/w/1`, command: 'ls' }).command, /\ncd tour_1 \|\| exit 97\nls$/)
  // the same run name in another project gets Sandbox names of its own: they are unique in the home
  const dir2 = mkdtempSync(join(tmpdir(), 'lfc-scope2-'))
  const other = Scope.create(dir2, { run: 'tour_1', project: 's2/web', trunk: 'tour_1.main' })
  assert.notEqual(other.realSandbox('sb1'), real)
  assert.match(other.realSandbox('sb1'), /^tour_1\.sb1\.[a-z0-9]+$/)
  // a scope made before tags keeps <run>.<name>
  const old = new Scope(dir2, 'tour_2', 's2/web')
  assert.equal(old.realSandbox('sb9'), 'tour_2.sb9')
  rmSync(dir, { recursive: true, force: true })
  rmSync(dir2, { recursive: true, force: true })
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

test('states come from the SDK: no machine, Store or Sandbox state is guessed (#537 U4)', async () => {
  const lfs = fake()
  lfs.machine.list = async () => ({ machines: [{ name: 'native', platform: 'native', backend: 'native', state: 'ready', supports: { sqlite: true, postgresql_sandbox: true, reason: null } }, { name: 'box', platform: 'lima', backend: 'namespaces', state: 'unresolved', supports: { sqlite: true, postgresql_sandbox: true, reason: null } }, { name: 'gone', platform: 'lima' }] })
  lfs.machine.status = async (name) => ({ name, state: 'unresolved', op: { id: 'o1', name: 'machine.create', phase: 'boot', started: 5, uncertain: true } })
  lfs.store.list = async () => ({ items: [{ name: 's1', kind: 'sqlite', machine: 'box', projects: [], state: 'busy', op: { id: 'o2', name: 'store.push', phase: 'send', started: 6, uncertain: false } }] })
  lfs.sandbox.list = async () => ({ items: [{ name: 'a1', project: 's1/app', machine: 'box', state: 'closing', backend: 'namespaces', route: 'fuse', op: { id: 'o3', name: 'sandbox.close', phase: 'stop', started: 7, uncertain: false } }], next_page_pos: null })
  const view = await new Machines({ spec: spec(), client: lfs, calls: [] }).view()
  assert.deepEqual(view.machines.map((m) => m.state), ['ready', 'unresolved', 'unknown'])
  assert.equal(view.machines[1].supports.postgresql_sandbox, true)
  assert.equal(view.status.box.op.name, 'machine.create')
  assert.equal(view.status.box.op.uncertain, true)
  assert.deepEqual([view.stores[0].state, view.stores[0].op.phase], ['busy', 'send'])
  assert.deepEqual([view.sandboxes[0].state, view.sandboxes[0].op.name, view.sandboxes[0].route], ['closing', 'sandbox.close', 'fuse'])
  const st = await new Storage({ spec: spec(), client: lfs, log: () => {} }).view()
  assert.deepEqual([st.stores[0].state, st.stores[0].op.name], ['busy', 'store.push'])
})

test('a PostgreSQL Store row says where its database is, without a password, and whether its server answered', async () => {
  const lfs = fake()
  lfs.store.list = async () => ({ items: [{ name: 'pg', kind: 'postgresql', url: 'postgresql://app:secret@db.internal:5432/layerfs?sslmode=require', password: 'env:LAYERFS_PG', projects: ['api'], state: 'idle' }, { name: 'off', kind: 'postgresql', url: 'postgresql://db2/x', projects: [], state: 'idle' }, { name: 's1', kind: 'sqlite', machine: 'native', projects: [], state: 'idle' }] })
  lfs.store.status = async (name) => (name === 'pg' ? { state: 'idle', holders: [], server: { reachable: true, server_version: '16.4', latency_ms: 3 } } : name === 'off' ? { state: 'idle', holders: [], server: { reachable: false, error: { code: 'Unavailable', message: 'connection refused' } } } : { state: 'idle', holders: [], file: { exists: true, bytes: 1, wal_bytes: 0 } })
  const st = await new Storage({ spec: spec(), client: lfs, log: () => {} }).view()
  assert.deepEqual(st.stores[0].postgresql, { target: 'app@db.internal:5432/layerfs', reachable: true, version: '16.4', latencyMs: 3, error: null })
  assert.deepEqual(st.stores[1].postgresql, { target: 'db2/x', reachable: false, version: null, latencyMs: null, error: 'connection refused' })
  assert.equal(st.stores[2].postgresql, null)
  assert.doesNotMatch(JSON.stringify(st), /secret|LAYERFS_PG/)
})

test('a busy Store: the project page gets its records, state, op and the refusal, not an error', async () => {
  const lfs = fake()
  const busy = Object.assign(new Error('store s1 is busy: store.push (send) holds it'), { code: 'Busy', detail: { entity: { kind: 'store', name: 's1' }, phase: 'send', op: 'o2' } })
  lfs.branch.list = async () => { throw busy }
  lfs.store.status = async () => ({ state: 'busy', holders: [], op: { id: 'o2', name: 'store.push', phase: 'send', started: 6, uncertain: false }, file: { exists: true, bytes: 10, wal_bytes: 0 } })
  lfs.sandbox.list = async () => ({ items: [{ name: 'a1', project: 's1/app', machine: 'native', state: 'running' }], next_page_pos: null })
  const p = new Projects({ spec: spec(), client: lfs, log: () => {} })
  const st = await p.state('s1/app')
  assert.deepEqual([st.project.storeState, st.project.storeOp.name, st.project.refusal.code, st.project.refusal.detail.phase], ['busy', 'store.push', 'Busy', 'send'])
  assert.deepEqual(st.branches, [])
  assert.deepEqual(st.sandboxes.map((s) => [s.name, s.state]), [['a1', 'running']])
  // any other refusal still fails the read
  lfs.branch.list = async () => { throw Object.assign(new Error('no such project'), { code: 'NotFound' }) }
  await assert.rejects(p.state('s1/app'), /no such project/)
})

test('Sandbox lists remain recorded; details read actual state and preserved Workspace fields on demand', async () => {
  const lfs = fake()
  let gets = 0
  lfs.sandbox.list = async () => ({ items: [{ name: 'a1', state: 'running' }], next_page_pos: null })
  lfs.sandbox.get = async () => { gets++; return { id: 'runtime-1', created: 123, state: 'lost', down_reason: 'worker unavailable', workspaces: [], next_page_pos: null } }
  const p = new Projects({ spec: spec(), client: lfs, log: () => {} })
  const [record] = await p.sandboxes('s1/app')
  assert.equal(record.state, 'running')
  assert.equal(record.unread, true)
  assert.equal(gets, 0)
  const detail = await p.sandbox('a1')
  assert.equal(detail.state, 'lost')
  assert.equal(detail.downReason, 'worker unavailable')
  assert.equal(detail.runtimeId, 'runtime-1')
  assert.equal(detail.created, 123)
  assert.equal(gets, 1)
  lfs.sandbox.get = async () => ({ workspaces: [{ ws: 'a1:named', name: 'named', directory: '/w/1', branch: 'fix', base: C1, base_layer: LAYER, head_moved_since_mount: true, dirty: { inodes: 2, entries: 3 }, pending_merge: true, activity: 'Uncertain' }], next_page_pos: null })
  const ws = (await p.sandbox('a1')).workspaces[0]
  assert.equal(ws.base, C1)
  assert.equal(ws.baseLayer, LAYER)
  assert.deepEqual(ws.dirty, { inodes: 2, entries: 3 })
  assert.equal(ws.pendingMerge, true)
  assert.equal(ws.activity, 'Uncertain')
})

test('platforms, start and stop: the SDK answers; create sends only the options the platform declares; ssh and Firecracker are off', async () => {
  const lfs = fake()
  const calls = []
  lfs.machine.platforms = async () => ({ host: 'macos', platforms: [
    { platform: 'lima', how: 'created', backend: 'namespaces', kernel: 'fuse', sqlite: 'worker', postgresql: { store_calls: 'in_process', sandbox: true, reason: null }, ready: true, missing: [], version: 'limactl 2.2.1', options: [{ name: 'cpus', kind: 'int' }, { name: 'nested', kind: 'bool' }], description: 'a Lima VM' },
    { platform: 'firecracker', how: 'created', ready: true, missing: [], options: [{ name: 'cpus', kind: 'int' }, { name: 'host', kind: 'name' }] },
    { platform: 'ssh', how: 'connected', ready: true, missing: [], options: [{ name: 'user', kind: 'text' }, { name: 'known_hosts', kind: 'text' }] },
  ] })
  lfs.machine.start = async (name) => (calls.push(['start', name]), { name, state: 'running' })
  lfs.machine.stop = async (name) => { throw Object.assign(new Error(`machine ${name} runs Sandboxes a1`), { code: 'InUse', detail: { related: [{ kind: 'sandbox', name: 'a1' }] } }) }
  lfs.machine.create = async (name, platform, o) => (calls.push(['create', name, platform, o]), { name })
  lfs.machine.connect = async (name, host, o) => (calls.push(['connect', name, host, o]), { name })
  const m = new Machines({ spec: spec(), client: lfs })
  const view = await m.view()
  // ssh and Firecracker rows are left out, and so is lima's `nested` (only Firecracker used it)
  assert.deepEqual(view.platforms.map((p) => [p.platform, p.ready, p.options.map((o) => o.name)]), [['lima', true, ['cpus']]])
  assert.equal('canCreate' in view, false)
  assert.equal((await m.start('box')).state, 'running')
  await assert.rejects(m.stop('box'), (e) => e.code === 'InUse' && e.detail.related[0].name === 'a1')
  await m.create({ name: 'box', platform: 'lima', cpus: 4 })
  await assert.rejects(m.create({ name: 'box2', platform: 'lima', disk: '40G' }), /lima takes no disk/)
  await assert.rejects(m.create({ name: 'box3', platform: 'lima', nested: true }), /lima takes no nested/)
  await assert.rejects(m.create({ name: 'fc1', platform: 'firecracker' }), (e) => e.code === 'Unsupported')
  await assert.rejects(m.create({ name: 'gpu', platform: 'ssh', host: 'gpu.lan' }), (e) => e.code === 'Unsupported')
  assert.equal(typeof m.connect, 'undefined')
  assert.deepEqual(calls.slice(1), [['create', 'box', 'lima', { cpus: 4 }]])
})

test('Workspaces: main is never mounted; a new Branch is forked from main first; a name is passed on (D14, #537 §7)', async () => {
  const lfs = fake()
  const calls = []
  lfs.sandbox.get = async (name) => ({ name, project: 's1/app', workspaces: [], next_page_pos: null })
  lfs.branch.fork = async (...a) => (calls.push(['fork', ...a]), { kind: 'Forked' })
  lfs.workspace = { mount: async (...a) => (calls.push(['mount', ...a]), { ws: `${a[0]}:${a[2]?.name ?? '/w/1'}`, name: a[2]?.name ?? null, path: '/w/1', branch: a[1] }), unmount: async (...a) => (calls.push(['unmount', ...a]), {}) }
  const p = new Projects({ spec: spec(), client: lfs, log: () => {} })
  await assert.rejects(p.mount('a1', { branch: 'main' }), /Only side Branches are mounted/)
  assert.equal((await p.mount('a1', { branch: 'task-42', fork: true, name: 'build' })).ws, 'a1:build')
  await p.mount('a1', { branch: 'work' })
  await p.unmount('a1:build', { discard: true })
  assert.deepEqual(calls, [['fork', 's1/app', 'task-42', 'main'], ['mount', 'a1', 'task-42', { name: 'build' }], ['mount', 'a1', 'work', {}], ['unmount', 'a1:build', { discard: true }]])
})

test('a chat mounts its own Branch as a named Workspace', async () => {
  const { workspaceName } = await import('../agents/workspaces.js')
  assert.equal(workspaceName('chat-AbC_1'), 'chat-abc_1')
  assert.equal(workspaceName('chat-' + 'x'.repeat(80)).length, 63)
})

test('a PostgreSQL project’s Sandbox goes on the machine named, not only native or docker (#537 §8.6)', async () => {
  const lfs = fake()
  lfs.project.get = async () => ({ project: 'pg/app', store: 'pg', name: 'app', kind: 'postgresql', machine: null })
  const p = new Projects({ spec: spec(), client: lfs, log: () => {} })
  await p.createSandbox('pg/app', { name: 'sb', machine: 'lima1' })
  await p.createSandbox('pg/app', { name: 'sb2' })
  assert.deepEqual(lfs.calls.filter((c) => c[0] === 'sandbox.create').map((c) => c[3]), ['lima1', 'native'])
})

test('doctor: the home’s findings pass through with their fix; ok is false on an error (#537 §8.7)', async () => {
  const s = spec()
  const st = new Storage({ spec: s, client: fake(), log: () => {}, doctor: async () => ({ ok: false, findings: [{ severity: 'error', entity: { kind: 'store', name: 'app' }, message: 'push intent uncertain', fix: 'layerfs store pull app' }, { severity: 'warning', entity: { kind: 'lease', name: '4242' }, message: 'stale lease', fix: '' }] }) })
  const r = await st.doctor()
  assert.equal(r.ok, false)
  assert.deepEqual(r.findings.map((f) => [f.severity, f.entity?.name, f.fix]), [['error', 'app', 'layerfs store pull app'], ['warning', '4242', null]])
  rmSync(s.state, { recursive: true, force: true })
})

test('Compute’s Store rows carry their projects’ names, for the links to project pages (#537 §7)', async () => {
  const { storeOf } = await import('../machines.js')
  assert.deepEqual(storeOf({ name: 'app', machine: 'lima1', projects: ['web', 'api'], state: 'idle' }).names, ['web', 'api'])
  assert.deepEqual(storeOf({ name: 'app', machine: 'lima1', projects: 2 }).names, [])
})

test('a machine’s page gets the PostgreSQL Stores its Sandboxes can reach and each Sandbox’s image', async () => {
  const lfs = fake()
  lfs.machine.list = async () => ({ machines: [{ name: 'native', platform: 'native', backend: 'native', state: 'ready' }] })
  lfs.store.list = async () => ({ items: [{ name: 's1', kind: 'sqlite', machine: 'native', projects: ['api'], state: 'idle' }, { name: 'pg', kind: 'postgresql', machine: null, projects: ['app', 'crm'], state: 'idle' }] })
  lfs.sandbox.list = async () => ({ items: [{ name: 'a1', project: 's1/api', machine: 'native', state: 'running', image: 'sha256:abc' }, { name: 'a2', project: 'pg/app', machine: 'native', state: 'running' }], next_page_pos: null })
  const view = await new Machines({ spec: spec(), client: lfs, calls: [] }).view()
  assert.deepEqual(view.stores.map((s) => s.name), ['s1'])
  assert.deepEqual(view.postgresql, [{ name: 'pg', projects: 2, names: ['app', 'crm'], state: 'idle', op: null }])
  assert.deepEqual(view.sandboxes.map((b) => b.image), ['sha256:abc', null])
})

test('a job reads the Storage view again on each new phase and half, not on each byte step (#537 §8.9)', async () => {
  const s = spec()
  const st = new Storage({ spec: s, client: fake(), log: () => {} })
  let views = 0
  st.on('event', (e) => e.type === 'storage' && views++)
  let finish
  st.start('move', 's1', 'lima1', null, (on_progress, step) => {
    step('pull')
    on_progress({ phase: 'send', done: 1, total: 3 })
    on_progress({ phase: 'send', done: 2, total: 3 })
    on_progress({ phase: 'verify' })
    step('push')
    return new Promise((r) => (finish = r))
  })
  // start, half pull, send, verify, half push
  assert.equal(views, 5)
  finish()
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(views, 6)
  rmSync(s.state, { recursive: true, force: true })
})

test('a pull names the machine the Store came from (the job row reads "<store> ← <machine>")', async () => {
  const s = spec()
  const st = new Storage({ spec: s, client: fake(), log: () => {} })
  assert.equal((await st.pull('far')).from, 'lima1')
  await new Promise((r) => setTimeout(r, 5))
  rmSync(s.state, { recursive: true, force: true })
})

test('Compute polling leaves unobserved Workspace counts unknown without sandbox.get', async () => {
  const lfs = fake()
  lfs.sandbox.list = async () => ({ items: [{ name: 'a1', project: 's1/app', machine: 'box', state: 'running' }, { name: 'a2', project: 's1/app', machine: 'box', state: 'running' }], next_page_pos: null })
  lfs.sandbox.get = async (name) => {
    if (name === 'a2') throw Object.assign(new Error('machine box is down'), { code: 'Unavailable' })
    return { name, workspaces: [{ directory: '/w/1', branch: 'fix', name: 'fix', ws: 'a1:fix' }], next_page_pos: null }
  }
  const view = await new Machines({ spec: spec(), client: lfs, calls: [] }).view()
  assert.deepEqual(view.sandboxes.map((b) => [b.name, b.workspaces]), [['a1', null], ['a2', null]])
})

test('on-demand Sandbox reads coalesce and remember Busy without poll fan-out', async () => {
  const lfs = fake()
  let gets = 0
  let rejectRead
  lfs.sandbox.get = () => (gets++, new Promise((_, reject) => { rejectRead = reject }))
  const first = workspacesOf(lfs, 'stuck').catch((e) => e.code)
  const second = workspacesOf(lfs, 'stuck').catch((e) => e.code)
  assert.equal(gets, 1)
  rejectRead(Object.assign(new Error('admitted no connection'), { code: 'Busy' }))
  assert.deepEqual(await Promise.all([first, second]), ['Busy', 'Busy'])
  assert.equal(await workspacesOf(lfs, 'stuck').catch((e) => e.code), 'Busy')
  assert.equal(gets, 1)
})

test('a down Store: the project page makes no Store call, and gets the down reason (U3)', async () => {
  const lfs = fake()
  let branchCalls = 0
  lfs.branch.list = async () => (branchCalls++, { items: [], next_page_pos: null })
  lfs.store.status = async () => ({ state: 'down', down_reason: 'machine lima1 is not running', holders: [], op: null, file: null })
  const st = await new Projects({ spec: spec(), client: lfs, log: () => {} }).state('s1/app')
  assert.equal(branchCalls, 0)
  assert.deepEqual([st.project.storeState, st.project.storeDown, st.project.refusal], ['down', 'machine lima1 is not running', null])
  assert.deepEqual(st.branches, [])
})

test('stopped machines retain provider diagnostics without changing their SDK state', async () => {
  const s = spec()
  try {
    const lfs = fake()
    lfs.machine.list = async () => ({ machines: [{ name: 'docker', platform: 'docker', state: 'stopped' }] })
    lfs.machine.status = async name => ({ name, state: 'stopped', down_reason: 'Docker Engine socket does not answer', tool_version: null, free_disk: null })
    const view = await new Machines({ spec: s, client: lfs }).view()
    assert.equal(view.machines[0].state, 'stopped')
    assert.equal(view.status.docker.down, 'Docker Engine socket does not answer')
  } finally { rmSync(s.state, { recursive: true, force: true }) }
})
