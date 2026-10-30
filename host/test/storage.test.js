// storage.js over a stand-in runtime (layerfs#506, #509): what a LayerFS
// build without the calls answers, Stores, connections and their keys,
// publish, push, pull, send, load and unlink through one link per SQLite
// Store (docs/ui/storage-links.md), and named PostgreSQL connections and
// import; the view: each link's sync state, sizes, checks, a connection's
// files, job samples, events, the engine fields (E1-E9) and their host
// fallbacks. No LayerFS, no MinIO, no PostgreSQL.
//   node --test host/test/storage.test.js
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Checks, JobSampler, Limiter, scrub } from '../storage-checks.js'
import { createHandler } from '../server.js'
import { reachAs, reachPostgresql, redactUrl, Storage } from '../storage.js'

const dirs = []
const opened = []
after(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }))
  opened.forEach((s) => s.close())
})

/** A stand-in stat: every Store's file is 1000 bytes, its WAL 24, and `work` is open (its -shm exists). */
const STAT = async (paths) => new Map(paths.filter((p) => !p.endsWith('-shm') || p.includes('store-work/')).map((p) => [p, p.endsWith('-wal') ? 24 : p.endsWith('-shm') ? 32 : 1000]))

function setup({ withCalls = true, worker = true, stat = STAT } = {}) {
  const state = mkdtempSync(join(tmpdir(), 'lfc-storage-'))
  dirs.push(state)
  const calls = []
  const remotes = []
  const stores = [
    { name: 'work', kind: 'sqlite', volume: 'lfc-store-work', projects: ['shop', 'api'], link: { remote: 'minio', file: 'work', linked: 1, last: { direction: 'push', at: 1, bytes: 10, sha256: 'ab', heads: null } } },
    { name: 'main-pg', kind: 'postgresql', connection: 'pg', schema: 'lfc_main_pg', projects: [{ name: 'ml' }] },
  ]
  const jobs = new Map()
  const job = () => {
    const id = `job-${jobs.size + 1}`
    jobs.set(id, { id, step: 'running', bytes: 0, total: 100 })
    return jobs.get(id)
  }
  const runtime = withCalls
    ? {
        store: {
          list: async () => stores,
          create: async (name) => (calls.push(['create', name]), stores.push({ name, kind: 'sqlite', projects: [] })),
          remove: async (name, o) => calls.push(['removeStore', name, o]),
          start_publish: async (s, o) => (calls.push(['publish', s, o]), job()),
          start_push: async (s, o) => (calls.push(['push', s, o]), job()),
          start_pull: async (s, o) => (calls.push(['pull', s, o]), job()),
          start_send: async (s, o) => (calls.push(['send', s, o]), job()),
          start_load: async (r, o) => (calls.push(['load', r, o]), job()),
          unlink: async (s, o) => (calls.push(['unlink', s, o]), { kind: 'Unlinked', store: s, remote: 'minio', file: s }),
          start_import_postgresql: async (s, o) => (calls.push(['import', s, o]), job()),
        },
        remote: {
          list: async () => remotes,
          add: async (r) => (calls.push(['add', r]), remotes.push(r)),
          remove: async (name, o) => (calls.push(['remove', name, o]), remotes.splice(remotes.findIndex((r) => r.name === name), 1)),
        },
        sync: { get: async (id) => jobs.get(id) },
        project: { list: async () => [] },
      }
    : { project: { list: async () => [] } }
  const storage = new Storage({ spec: { state, worker }, projects: { runtime: async () => runtime }, log: () => {}, stat })
  opened.push(storage)
  return { storage, calls, state, runtime, stores, remotes, jobs }
}

const MINIO = { name: 'minio', provider: 'minio', endpoint: 'http://localhost:9000', bucket: 'layerfs-stores', prefix: 'lfc', accessKey: 'ak', secretKey: 'sk' }

test('a LayerFS build without the calls answers available: false and refuses changes', async () => {
  const { storage } = setup({ withCalls: false })
  const view = await storage.view()
  assert.equal(view.stores.available, false)
  assert.equal(view.remotes.available, false)
  assert.equal(view.postgresql.available, false)
  assert.match(view.stores.reason, /#506/)
  await assert.rejects(storage.createStore({ name: 'work' }), { code: 'Unsupported', status: 501 })
  await assert.rejects(storage.addRemote(MINIO), { code: 'Unsupported', status: 501 })
})

test('the view lists Stores with their projects, kinds and one link', async () => {
  const { storage } = setup()
  const { stores } = await storage.view()
  assert.equal(stores.available, true)
  assert.deepEqual(stores.list[0].projects, ['shop', 'api'])
  const l = stores.list[0].link
  assert.deepEqual({ remote: l.remote, file: l.file, last: l.last }, { remote: 'minio', file: 'work', last: { direction: 'push', at: 1000, bytes: 10, sha256: 'ab', heads: null } })
  assert.equal('copies' in stores.list[0], false)
  const pg = stores.list[1]
  assert.deepEqual({ kind: pg.kind, connection: pg.connection, projects: pg.projects, link: pg.link }, { kind: 'postgresql', connection: 'pg', projects: ['ml'], link: null })
})

test('creating and removing a Store; removing needs the Store name as confirmation', async () => {
  const { storage, calls } = setup()
  await storage.createStore({ name: 'scratch' })
  assert.deepEqual(calls.at(-1), ['create', 'scratch'])
  await assert.rejects(storage.createStore({ name: 'Bad Name' }), { code: 'InvalidInput' })
  await assert.rejects(storage.removeStore('scratch', {}), { code: 'InvalidInput' })
  await storage.removeStore('scratch', { confirm: 'scratch' })
  assert.deepEqual(calls.at(-1), ['removeStore', 'scratch', { confirm: 'scratch' }])
})

test('adding a remote gives LayerFS no secret, keeps the keys owner-only, and rewrites loopback for the worker', async () => {
  const { storage, calls, state } = setup()
  const view = await storage.addRemote(MINIO)
  const [, added] = calls.find((c) => c[0] === 'add')
  assert.deepEqual(added, { name: 'minio', provider: 'minio', endpoint: 'http://host.docker.internal:9000', bucket: 'layerfs-stores', prefix: 'lfc' })
  assert.equal(JSON.stringify(added).includes('sk'), false)
  const file = join(state, 'storage.json')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).remotes.minio.secretKey, 'sk')
  const r = view.remotes.list[0]
  assert.deepEqual({ endpoint: r.endpoint, reachAs: r.reachAs, hasSecret: r.hasSecret, stores: r.stores }, { endpoint: 'http://localhost:9000', reachAs: 'http://host.docker.internal:9000', hasSecret: true, stores: ['work'] })
  await assert.rejects(storage.addRemote(MINIO), { code: 'NameTaken' })
})

test('bad remote input is refused before LayerFS is called', async () => {
  const { storage, calls } = setup()
  await assert.rejects(storage.addRemote({ ...MINIO, provider: 's3' }), { code: 'InvalidInput' })
  await assert.rejects(storage.addRemote({ ...MINIO, bucket: 'Bad_Bucket' }), { code: 'InvalidInput' })
  await assert.rejects(storage.addRemote({ ...MINIO, endpoint: 'http://localhost:9000/path' }), { code: 'InvalidInput' })
  await assert.rejects(storage.addRemote({ ...MINIO, secretKey: '' }), { code: 'InvalidInput' })
  assert.equal(calls.length, 0)
})

test('publish, push, pull, send, load and unlink go through one link; keys go per call; pull and unlink need the Store name', async () => {
  const { storage, calls } = setup()
  await storage.addRemote(MINIO)
  const keys = { accessKey: 'ak', secretKey: 'sk' }
  // push and pull take no target: the Store's link names it
  const job = await storage.push('work')
  assert.deepEqual(calls.at(-1), ['push', 'work', { credentials: keys }])
  assert.deepEqual({ kind: job.kind, store: job.store, target: job.target, file: job.file }, { kind: 'push', store: 'work', target: 'minio', file: 'work' })
  assert.equal((await storage.syncJob(job.id)).store, 'work')
  await assert.rejects(storage.push('work', { remote: 'minio' }), { code: 'InvalidInput' })
  await assert.rejects(storage.pull('work', {}), { code: 'InvalidInput' })
  await storage.pull('work', { confirm: 'work' })
  assert.deepEqual(calls.at(-1), ['pull', 'work', { credentials: keys, confirm: 'work' }])
  await assert.rejects(storage.pull('work', { remote: 'minio', confirm: 'work' }), { code: 'InvalidInput' })
  // a Store with no link, or none at all
  await assert.rejects(storage.push('main-pg'), { code: 'NotLinked', status: 409 })
  await assert.rejects(storage.pull('nope', { confirm: 'nope' }), { code: 'NoSuchStore', status: 404 })
  // publish: a file named after the Store unless one is given
  await storage.createStore({ name: 'scratch' })
  const published = await storage.publish('scratch', { remote: 'minio' })
  assert.deepEqual(calls.at(-1), ['publish', 'scratch', { remote: 'minio', file: 'scratch', credentials: keys }])
  assert.deepEqual({ kind: published.kind, target: published.target, file: published.file }, { kind: 'publish', target: 'minio', file: 'scratch' })
  await storage.publish('scratch', { remote: 'minio', file: 'scratch-v2' })
  assert.equal(calls.at(-1)[2].file, 'scratch-v2')
  await assert.rejects(storage.publish('scratch', { remote: 'minio', file: 'a/b' }), { code: 'InvalidInput' })
  await assert.rejects(storage.publish('scratch', { remote: 'other' }), { code: 'Conflict' })
  // send: a new, unlinked file, <store>-copy by default
  await storage.send('work', { remote: 'minio' })
  assert.deepEqual(calls.at(-1), ['send', 'work', { remote: 'minio', file: 'work-copy', credentials: keys }])
  // load: a new Store named after the file unless one is given
  const loaded = await storage.load('minio', { file: 'team' })
  assert.deepEqual(calls.at(-1), ['load', 'minio', { file: 'team', store: 'team', credentials: keys }])
  assert.deepEqual({ kind: loaded.kind, store: loaded.store, file: loaded.file }, { kind: 'load', store: 'team', file: 'team' })
  await storage.load('minio', { file: 'team', store: 'team-2' })
  assert.equal(calls.at(-1)[2].store, 'team-2')
  await assert.rejects(storage.load('minio', {}), { code: 'InvalidInput' })
  // unlink: confirmed by the Store's name; answers the view
  await assert.rejects(storage.unlink('work', {}), { code: 'InvalidInput' })
  const view = await storage.unlink('work', { confirm: 'work' })
  assert.deepEqual(calls.at(-1), ['unlink', 'work', { confirm: 'work' }])
  assert.equal(view.stores.available, true)
})

test('an R2 remote gives LayerFS its account and jurisdiction, never the keys; a bad account or jurisdiction is refused first', async () => {
  const { storage, calls } = setup()
  const R2 = { name: 'cloud', provider: 'r2', account: '0123456789abcdef0123456789abcdef', bucket: 'layerfs-stores', prefix: 'team', accessKey: 'ak', secretKey: 'sk' }
  await assert.rejects(storage.addRemote({ ...R2, account: 'not-an-account' }), { code: 'InvalidInput' })
  await assert.rejects(storage.addRemote({ ...R2, jurisdiction: 'us' }), { code: 'InvalidInput' })
  assert.equal(calls.length, 0)
  await storage.addRemote({ ...R2, jurisdiction: 'eu' })
  const [, added] = calls.find((c) => c[0] === 'add')
  assert.deepEqual(added, { name: 'cloud', provider: 'r2', account: '0123456789abcdef0123456789abcdef', jurisdiction: 'eu', bucket: 'layerfs-stores', prefix: 'team' })
  await storage.send('work', { remote: 'cloud', file: 'work-eu' })
  assert.deepEqual(calls.at(-1), ['send', 'work', { remote: 'cloud', file: 'work-eu', credentials: { accessKey: 'ak', secretKey: 'sk' } }])
})

test('removing a remote forgets its keys', async () => {
  const { storage, state } = setup()
  await storage.addRemote(MINIO)
  await storage.removeRemote('minio')
  assert.deepEqual(JSON.parse(readFileSync(join(state, 'storage.json'), 'utf8')).remotes, {})
})

test('PostgreSQL: named connections hide their passwords; import makes a new Store in a schema of its own', async () => {
  const { storage, calls } = setup()
  await assert.rejects(storage.importPostgresql('work', { connection: 'pg' }), { code: 'Conflict' })
  await assert.rejects(storage.addPostgresql({ name: 'pg', url: 'mysql://x' }), { code: 'InvalidInput' })
  await assert.rejects(storage.addPostgresql({ name: 'pg', url: 'postgresql://u@h/db', synchronousCommit: 'sometimes' }), { code: 'InvalidInput' })
  await storage.addPostgresql({ name: 'pg', url: 'postgresql://u:secret@localhost:5432/db', synchronousCommit: 'on' })
  const view = await storage.addPostgresql({ name: 'cloud', url: 'postgresql://u:pw@db.example.com/db' })
  assert.equal(view.postgresql.connections.length, 2)
  assert.equal(JSON.stringify(view).includes('secret'), false)
  assert.deepEqual(view.postgresql.connections.find((c) => c.name === 'pg').stores, ['main-pg'])
  await assert.rejects(storage.addPostgresql({ name: 'pg', url: 'postgresql://u@h/db' }), { code: 'NameTaken' })
  const job = await storage.importPostgresql('work', { connection: 'pg' })
  assert.deepEqual(calls.at(-1), ['import', 'work', { name: 'work-pg', connection: 'pg', url: 'postgresql://u:secret@host.docker.internal:5432/db', schema: 'lfc_work_pg', synchronousCommit: 'on' }])
  assert.equal(job.target, 'pg/lfc_work_pg')
  await storage.removePostgresql('cloud')
  assert.equal((await storage.view()).postgresql.connections.length, 1)
})

test('a storage.json with the earlier single connection still reads, as the connection "main"', async () => {
  const { storage, state } = setup()
  writeFileSync(join(state, 'storage.json'), JSON.stringify({ remotes: {}, postgresql: { url: 'postgresql://u:pw@h/db', schemaPrefix: 'lfc_', synchronousCommit: 'off' } }))
  assert.deepEqual((await storage.view()).postgresql.connections.map((c) => c.name), ['main'])
})

test('routes: Stores, links, connections, PostgreSQL and sync jobs reach storage.js', async () => {
  const seen = []
  const fake = new Proxy({}, { get: (_, name) => (...args) => (seen.push([name, ...args]), { ok: name }) })
  const handler = createHandler({ token: 't', projects: {}, storage: fake, log: () => {} })
  const ask = (method, path, body) =>
    new Promise((resolve) => {
      const req = Object.assign((async function* () {
        if (body) yield Buffer.from(JSON.stringify(body))
      })(), { method, url: path, headers: { authorization: 'Bearer t', host: 'x' } })
      const res = { writeHead: (status) => (res.status = status), end: (text) => resolve({ status: res.status, body: JSON.parse(text) }) }
      handler(req, res)
    })
  assert.equal((await ask('GET', '/api/storage')).body.ok, 'view')
  await ask('POST', '/api/stores', { name: 'work' })
  await ask('DELETE', '/api/stores/work?confirm=work')
  await ask('POST', '/api/stores/work/publish', { remote: 'minio', file: 'work' })
  await ask('POST', '/api/stores/work/push', {})
  await ask('POST', '/api/stores/work/pull', { confirm: 'work' })
  await ask('POST', '/api/stores/work/send', { remote: 'minio', file: 'work-copy' })
  await ask('POST', '/api/stores/work/unlink', { confirm: 'work' })
  await ask('POST', '/api/stores/work/import-postgresql', { connection: 'pg' })
  await ask('POST', '/api/remotes', MINIO)
  await ask('DELETE', '/api/remotes/minio')
  await ask('GET', '/api/remotes/minio/files')
  await ask('POST', '/api/remotes/minio/load', { file: 'team', store: 'team' })
  assert.equal((await ask('POST', '/api/remotes/minio/clone', { store: 'copy' })).status, 404)
  await ask('POST', '/api/postgresql', { name: 'pg', url: 'postgresql://x' })
  await ask('DELETE', '/api/postgresql/pg')
  await ask('GET', '/api/sync-jobs/job-1')
  assert.deepEqual(
    seen.map((s) => s[0]),
    ['view', 'createStore', 'removeStore', 'publish', 'push', 'pull', 'send', 'unlink', 'importPostgresql', 'addRemote', 'removeRemote', 'files', 'load', 'addPostgresql', 'removePostgresql', 'syncJob'],
  )
  assert.deepEqual(seen[2], ['removeStore', 'work', { confirm: 'work' }])
  assert.deepEqual(seen[3], ['publish', 'work', { remote: 'minio', file: 'work' }])
  assert.deepEqual(seen[12], ['load', 'minio', { file: 'team', store: 'team' }])
})

test('reachAs and redactUrl', () => {
  assert.equal(reachAs('http://127.0.0.1:9000', true), 'http://host.docker.internal:9000')
  assert.equal(reachAs('http://localhost:9000', false), 'http://localhost:9000')
  assert.equal(reachAs('https://minio.example.com', true), 'https://minio.example.com')
  assert.equal(redactUrl('postgresql://u:pw@h:5432/db'), 'postgresql://u:***@h:5432/db')
})

test('reachPostgresql: a server container on the bridge is reached at its own address', async () => {
  const containers = {
    pg: { ports: '127.0.0.1:55432->5432/tcp', bridge: '172.17.0.7' },
    other: { ports: '0.0.0.0:9000->9000/tcp', bridge: '172.17.0.9' },
    'lfc-worker': { ports: '127.0.0.1:7070->7070/tcp', bridge: '172.17.0.8' },
  }
  const docker = async (args) => {
    if (args[0] === 'ps') return Object.entries(containers).map(([id, c]) => `${id}\t${c.ports}`).join('\n')
    const c = containers[args[1]]
    return JSON.stringify([{ NetworkSettings: { Networks: c?.bridge ? { bridge: { IPAddress: c.bridge } } : {} } }])
  }
  const url = 'postgresql://u:pw@localhost:55432/db?sslmode=disable'
  assert.equal(await reachPostgresql(url, 'lfc-worker', docker), 'postgresql://u:pw@172.17.0.7:5432/db?sslmode=disable')
  // no worker, not loopback, no such container: as reachAs
  assert.equal(await reachPostgresql(url, false, docker), url)
  assert.equal(await reachPostgresql('postgresql://u:pw@db.example.com:5432/db', 'lfc-worker', docker), 'postgresql://u:pw@db.example.com:5432/db')
  assert.equal(await reachPostgresql('postgresql://u:pw@localhost:6000/db', 'lfc-worker', docker), 'postgresql://u:pw@host.docker.internal:6000/db')
  // a worker off the bridge, or a failing docker: host.docker.internal
  delete containers['lfc-worker'].bridge
  assert.equal(await reachPostgresql(url, 'lfc-worker', docker), 'postgresql://u:pw@host.docker.internal:55432/db?sslmode=disable')
  assert.equal(await reachPostgresql(url, 'lfc-worker', async () => { throw new Error('no docker') }), 'postgresql://u:pw@host.docker.internal:55432/db?sslmode=disable')
})

// ---------- the view on links (docs/ui/storage-links.md §3-§5) ----------

const KEYS = { accessKey: 'AKIAEXAMPLE', secretKey: 'super-secret-key' }
const PG_URL = 'postgresql://lfc:pg-password@localhost:5432/layerfs'

/**
 * A runtime with every engine ask (E1-E9) when `engine` is true, else the
 * calls of the plain #506 build. `heads` is each linked file's HEAD; the
 * connection minio holds work, team-examples (team's link) and old.
 */
async function redesign({ engine = true, worker = true } = {}) {
  const t = setup({ worker })
  const { storage, runtime, stores } = t
  stores.length = 0
  const link = (file, sha256, heads, direction = 'push') => ({ remote: 'minio', file, linked: 5, last: { direction, at: 10, bytes: 980, sha256, ...(engine ? { heads } : {}) } })
  stores.push(
    { name: 'work', kind: 'sqlite', volume: 'lfc-store-work', created: 1793295238968, projects: ['shop'], link: link('work', 'sha-work', 'h-work-old'), ...(engine ? { heads: 'h-work-new', bytes: { file: 988, wal: 12 }, open: false } : {}) },
    { name: 'team', kind: 'sqlite', volume: 'lfc-store-team', projects: ['api'], link: link('team-examples', 'sha-team', 'h-team', 'pull'), ...(engine ? { heads: 'h-team', bytes: null, open: null } : {}) },
    { name: 'solo', kind: 'sqlite', volume: 'lfc-store-solo', legacy: true, projects: ['solo'], link: null, ...(engine ? { heads: 'h-solo', bytes: { file: 50, wal: 0 }, open: true } : {}) },
    { name: 'work-pg', kind: 'postgresql', connection: 'pg', schema: 'lfc_work_pg', synchronousCommit: 'off', projects: ['shop'], link: null, ...(engine ? { importedFrom: { store: 'work', at: 1793295400000, bytes: 980 } } : {}) },
  )
  const heads = { work: { present: true, bytes: 980, sha256: 'sha-work', heads: 'h-work-old', modified: '2026-10-30T10:00:00Z' }, team: { present: true, bytes: 990, sha256: 'sha-team-other', heads: 'h-team-other', modified: 1700000000000 } }
  t.checked = []
  t.listed = []
  if (engine) {
    runtime.store.check = async (store, o) => {
      t.checked.push([store, o])
      if (!heads[store]) return { present: false }
      return heads[store]
    }
    runtime.postgresql = { status: async (o) => ((t.pgAsked = o), { serverVersion: '17.2', schemas: { lfc_work_pg: 296_000_000 } }) }
    runtime.remote.providers = async () => ['minio', 'r2', 's3']
    runtime.remote.list_stores = async (remote) => (
      t.listed.push(remote),
      [
        { file: 'work', bytes: 980, modified: 1, sha256: 'sha-work', linkedBy: 'work' },
        { file: 'team-examples', bytes: 990, modified: 2, sha256: 'sha-team-other', linkedBy: 'team' },
        { file: 'old', bytes: 1900, modified: null, sha256: null, linkedBy: null },
      ]
    )
  }
  await storage.addRemote(MINIO_KEYS)
  await storage.addPostgresql({ name: 'pg', url: PG_URL })
  return t
}
const MINIO_KEYS = { ...MINIO, ...KEYS }

test('view: every field from the engine (E1-E9) after a check; one link per Store; a connection lists its files', async () => {
  const { storage } = await redesign()
  const before = await storage.view()
  // after a restart, a checkable link reads checking until its first check
  assert.equal(before.stores.list.find((s) => s.name === 'work').link.sync, 'checking')
  const view = await storage.check({})
  const work = view.stores.list.find((s) => s.name === 'work')
  assert.deepEqual(work.size, { bytes: 1000, file: 988, wal: 12, at: work.size.at })
  assert.equal(work.bytes, 1000)
  assert.equal(work.open, false)
  assert.equal(work.legacy, false)
  assert.equal(work.created, 1793295238968)
  const l = work.link
  assert.deepEqual(
    { remote: l.remote, provider: l.provider, file: l.file, linked: l.linked, local: l.local, remoteSide: l.remoteSide, sync: l.sync, lastKnown: l.lastKnown, object: l.object, heads: l.last.heads },
    { remote: 'minio', provider: 'minio', file: 'work', linked: 5000, local: 'changed', remoteSide: 'same', sync: 'ahead', lastKnown: null, object: 'localhost:9000/layerfs-stores/lfc/work/store.sqlite', heads: 'h-work-old' },
  )
  assert.equal(l.check.modified, Date.parse('2026-10-30T10:00:00Z'))
  assert.deepEqual(work.sync, { state: 'ahead' })
  assert.deepEqual(work.imports, ['work-pg'])
  assert.equal(work.job, null)
  // team: E1 null falls back to the stat; its linked file changed remotely
  const team = view.stores.list.find((s) => s.name === 'team')
  assert.deepEqual({ bytes: team.size.bytes, open: team.open, file: team.link.file, sync: team.sync.state }, { bytes: 1024, open: false, file: 'team-examples', sync: 'behind' })
  const solo = view.stores.list.find((s) => s.name === 'solo')
  assert.deepEqual({ sync: solo.sync.state, legacy: solo.legacy, open: solo.open, link: solo.link }, { sync: 'local_only', legacy: true, open: true, link: null })
  const pg = view.stores.list.find((s) => s.name === 'work-pg')
  assert.deepEqual({ sync: pg.sync.state, size: pg.size?.bytes, from: pg.importedFrom, sc: pg.synchronousCommit, link: pg.link }, { sync: 'live', size: 296_000_000, from: { store: 'work', at: 1793295400000, bytes: 980 }, sc: 'off', link: null })
  const remote = view.remotes.list[0]
  assert.deepEqual(
    { location: remote.location, stores: remote.stores, bytes: remote.bytes, health: remote.health.state },
    { location: 'localhost:9000/layerfs-stores/lfc', stores: ['work', 'team'], bytes: 980 + 990 + 1900, health: 'ok' },
  )
  assert.deepEqual(
    Object.fromEntries(remote.files.map((f) => [f.file, f.linkedBy])),
    { work: 'work', 'team-examples': 'team', old: null },
  )
  assert.equal('copies' in remote, false)
  const conn = view.postgresql.connections[0]
  assert.deepEqual({ host: conn.host, database: conn.database, bytes: conn.bytes, state: conn.health.state, version: conn.health.serverVersion, stores: conn.stores }, { host: 'localhost:5432', database: 'layerfs', bytes: 296_000_000, state: 'ok', version: '17.2', stores: ['work-pg'] })
  assert.equal(typeof conn.health.latencyMs, 'number')
  assert.deepEqual(view.supports, { size: true, heads: true, check: true, progress: false, postgresqlStatus: true, listCopies: true })
  assert.deepEqual(view.providers.filter((p) => p.available).map((p) => p.id), ['minio', 'r2', 's3'])
  assert.deepEqual(view.providers.map((p) => p.id), ['minio', 'r2', 's3', 'gcs', 'google-drive', 'folder'])
  assert.deepEqual(view.totals, {
    sqlite: { stores: 3, bytes: 1000 + 1024 + 50, unknown: 0 },
    postgresql: { stores: 1, connections: 1, bytes: 296_000_000, unknown: 0 },
    linked: { stores: 2, bytes: 980 + 990, unknown: 0 },
    sync: { ahead: 1, behind: 1, local_only: 1, live: 1 },
  })
  assert.equal(typeof view.checkedAt, 'number')
  assert.equal(view.checking, 0)
  // keys went per call; neither secret reaches the view
  assert.equal(JSON.stringify(view).includes(KEYS.secretKey), false)
  assert.equal(JSON.stringify(view).includes('pg-password'), false)
  // a connection's files, listed now
  const files = await storage.files('minio')
  assert.deepEqual(files.map((f) => [f.file, f.bytes, f.linkedBy]).sort(), [['old', 1900, null], ['team-examples', 990, 'team'], ['work', 980, 'work']])
  await assert.rejects(storage.files('nope'), { code: 'NoSuchRemote' })
})

test('view: a build without the engine asks uses the host fallbacks (§10.4)', async () => {
  const { storage } = await redesign({ engine: false })
  const view = await storage.check({})
  assert.deepEqual(view.supports, { size: false, heads: false, check: false, progress: false, postgresqlStatus: false, listCopies: false })
  const work = view.stores.list.find((s) => s.name === 'work')
  // the host's stat: 1000 + 24, open from the -shm
  assert.deepEqual({ bytes: work.size.bytes, file: work.size.file, wal: work.size.wal, open: work.open }, { bytes: 1024, file: 1000, wal: 24, open: true })
  const l = work.link
  assert.deepEqual({ local: l.local, remoteSide: l.remoteSide, sync: l.sync, check: l.check }, { local: 'unknown', remoteSide: 'unknown', sync: 'unknown', check: null })
  assert.match(l.reason, /can't tell whether work changed/)
  assert.equal(view.remotes.list[0].health.state, 'unknown')
  assert.equal(view.remotes.list[0].files, null)
  const pg = view.stores.list.find((s) => s.name === 'work-pg')
  assert.deepEqual({ size: pg.size, from: pg.importedFrom }, { size: null, from: null })
  assert.equal(view.postgresql.connections[0].health.state, 'unknown')
  assert.deepEqual(view.providers.filter((p) => p.available).map((p) => p.id), ['minio', 'r2'])
  assert.deepEqual(view.totals.postgresql, { stores: 1, connections: 1, bytes: 0, unknown: 1 })
})

test('view: providers as LayerFS answers them, objects with available and reason (E8)', async () => {
  const { storage, runtime } = await redesign()
  storage.providerIds = null
  runtime.remote.providers = async () => [{ id: 'minio', available: true }, { id: 'r2', available: true }, { id: 's3', available: false, reason: 'S3 needs layerfs#600' }, { id: 'ftp', available: true }]
  const view = await storage.view()
  assert.deepEqual(view.providers.filter((p) => p.available).map((p) => p.id), ['minio', 'r2'])
  assert.equal(view.providers.find((p) => p.id === 's3').reason, 'S3 needs layerfs#600')
  assert.equal(view.providers.find((p) => p.id === 'gcs').reason, 'Not in this LayerFS build yet')
})

test('view: Docker not answering leaves SQLite sizes unknown, never a guess', async () => {
  const { storage } = setup({ stat: async () => null })
  const view = await storage.view()
  assert.deepEqual({ size: view.stores.list[0].size, bytes: view.stores.list[0].bytes, open: view.stores.list[0].open }, { size: null, bytes: null, open: null })
  assert.equal(view.totals.sqlite.unknown, 1)
})

test('a failed check reads unreachable and keeps the last known state; its message is scrubbed of secrets', async () => {
  const t = await redesign()
  const { storage, runtime } = t
  await storage.check({ store: 'work' })
  runtime.store.check = async () => {
    throw Object.assign(new Error(`connection refused (key ${KEYS.secretKey})`), { code: 'Unavailable' })
  }
  storage.checks.floorMs = 0
  const view = await storage.check({ store: 'work' })
  const l = view.stores.list.find((s) => s.name === 'work').link
  assert.deepEqual({ sync: l.sync, lastKnown: l.lastKnown, remoteSide: l.remoteSide, failed: l.failedCheck.error.code }, { sync: 'unreachable', lastKnown: 'ahead', remoteSide: 'unknown', failed: 'Unavailable' })
  assert.equal(l.check.sha256, 'sha-work')
  assert.equal(JSON.stringify(view).includes(KEYS.secretKey), false)
  assert.equal(view.remotes.list[0].health.state, 'unreachable')
  // a link to a connection Connect has no keys for is not checked: unknown, with that reason
  const saved = JSON.parse(readFileSync(join(t.state, 'storage.json'), 'utf8'))
  delete saved.remotes.minio
  writeFileSync(join(t.state, 'storage.json'), JSON.stringify(saved))
  const noKeys = (await storage.view()).stores.list.find((s) => s.name === 'team').link
  assert.equal(noKeys.sync, 'unknown')
  assert.match(noKeys.reason, /no keys for minio/)
})

test('check: one body narrows it; a Store with a running job is skipped; never more than 4 at once', async () => {
  const t = await redesign()
  const { storage } = t
  await storage.check({ remote: 'minio', store: 'team' })
  assert.deepEqual(t.checked.map(([s]) => s), ['team'])
  assert.deepEqual(t.checked[0][1], { credentials: KEYS })
  await storage.check({ connection: 'pg' })
  assert.deepEqual(t.pgAsked, { url: 'postgresql://lfc:pg-password@host.docker.internal:5432/layerfs', schemas: ['lfc_work_pg'] })
  // a running push on work: its link is not checked
  await storage.push('work')
  t.checked.length = 0
  storage.checks.floorMs = 0
  await storage.check({})
  assert.deepEqual(t.checked.map(([s]) => s), ['team'])
  const work = (await storage.view()).stores.list.find((s) => s.name === 'work')
  assert.deepEqual({ link: work.link.sync, store: work.sync.state }, { link: 'transferring', store: 'transferring' })
  // the limiter
  const limiter = new Limiter(4)
  let active = 0
  let most = 0
  await Promise.all(
    Array.from({ length: 12 }, () =>
      limiter.run(async () => {
        most = Math.max(most, ++active)
        await new Promise((r) => setTimeout(r, 5))
        active--
      }),
    ),
  )
  assert.equal(most, 4)
})

test('a second check while one runs joins it: one HEAD per copy', async () => {
  const checks = new Checks({ floorMs: 0 })
  let calls = 0
  let release
  const gate = new Promise((r) => (release = r))
  const task = () => ({ kind: 'copy', store: 'work', remote: 'm', call: async () => (calls++, await gate, { present: true, sha256: 'a' }) })
  const first = checks.run([task()])
  const second = checks.run([task()])
  assert.equal(checks.checking, 1)
  assert.equal(checks.copy('work', 'm').inFlight, true)
  release()
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(checks.copy('work', 'm').check.sha256, 'a')
  assert.equal(scrub('key abc123 here', ['abc123']), 'key *** here')
})

test('push with force passes force; a refusal code passes through on the job; result and provider are kept', async () => {
  const { storage, calls, jobs } = await redesign()
  const job = await storage.push('work', { force: true })
  assert.deepEqual(calls.at(-1), ['push', 'work', { credentials: KEYS, force: true }])
  assert.deepEqual(
    { force: job.force, provider: job.provider, file: job.file, from: job.from, cancellable: job.cancellable, step: job.step },
    { force: true, provider: 'minio', file: 'work', from: null, cancellable: false, step: 'running' },
  )
  await assert.rejects(storage.push('work', { force: 'yes' }), { code: 'InvalidInput' })
  Object.assign(jobs.get(job.id), { step: 'failed', error: { code: 'Conflict', message: 'minio / work changed' }, ended: Date.now() })
  await storage.sampler.tick()
  const ended = await storage.syncJob(job.id)
  assert.deepEqual({ step: ended.step, error: ended.error, result: ended.result }, { step: 'failed', error: { code: 'Conflict', message: 'minio / work changed' }, result: null })
  const ok = await storage.pull('team', { confirm: 'team' })
  assert.equal(ok.file, 'team-examples')
  Object.assign(jobs.get(ok.id), { step: 'done', bytes: 990, result: { transfer: { bytes: 990, sha256: 'sha-team-other' } }, ended: Date.now() })
  await storage.sampler.tick()
  assert.deepEqual((await storage.syncJob(ok.id)).result, { bytes: 990, sha256: 'sha-team-other' })
})

test('jobs: samples go out as sync events with phase, rate and ETA (E4); their end checks the link and sends storage', async () => {
  const t = await redesign()
  const { storage, jobs } = t
  const events = []
  storage.on('event', (e) => events.push(e))
  let now = 1_000_000
  storage.sampler.now = () => now
  const job = await storage.push('work')
  const raw = jobs.get(job.id)
  const step = async (ms, fields) => {
    now += ms
    Object.assign(raw, fields)
    await storage.sampler.tick()
  }
  await step(500, { phase: 'upload', bytes: 0, total: 10_000_000 })
  await step(1000, { bytes: 2_000_000 })
  await step(1500, { bytes: 5_000_000 })
  const syncs = events.filter((e) => e.type === 'sync')
  const last = syncs.at(-1).job
  assert.deepEqual({ phase: last.phase, bytes: last.bytes, total: last.total }, { phase: 'upload', bytes: 5_000_000, total: 10_000_000 })
  assert.equal(last.rate, 2_000_000)
  assert.equal(last.eta, 3)
  assert.equal((await storage.view()).supports.progress, true)
  t.checked.length = 0
  await step(500, { step: 'done', phase: 'record', bytes: 10_000_000, result: { transfer: { bytes: 10_000_000, sha256: 'sha-new' } }, ended: now })
  const end = events.filter((e) => e.type === 'sync').at(-1).job
  assert.deepEqual({ step: end.step, rate: end.rate, eta: end.eta }, { step: 'done', rate: null, eta: null })
  // the host checks the link it moved and lists the connection again, then says the view changed
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(t.checked.map(([s, o]) => [s, o]), [['work', { credentials: KEYS }]])
  assert.deepEqual(t.listed, ['minio'])
  assert.equal(events.at(-1).type, 'storage')
})

test('an import that ends well is logged: importedFrom without E6; the job names the new Store', async () => {
  const { storage, jobs, stores } = await redesign({ engine: false })
  const job = await storage.importPostgresql('team', { connection: 'pg', name: 'team-pg' })
  assert.deepEqual({ kind: job.kind, store: job.store, target: job.target, from: job.from, provider: job.provider }, { kind: 'import', store: 'team', target: 'pg/lfc_team_pg', from: 'team-pg', provider: 'postgresql' })
  // an import reads its Store and leaves the link alone: the Store keeps its state, the job is on it
  const during = (await storage.view()).stores.list.find((s) => s.name === 'team')
  assert.deepEqual({ sync: during.sync.state, job: during.job }, { sync: 'unknown', job: job.id })
  Object.assign(jobs.get(job.id), { step: 'done', bytes: 1024, ended: 1234 })
  await storage.sampler.tick()
  await new Promise((r) => setTimeout(r, 20))
  stores.push({ name: 'team-pg', kind: 'postgresql', connection: 'pg', schema: 'lfc_team_pg', projects: ['api'] })
  const view = await storage.view()
  assert.deepEqual(view.stores.list.find((s) => s.name === 'team-pg').importedFrom, { store: 'team', at: 1234, bytes: 1024 })
  assert.deepEqual(view.stores.list.find((s) => s.name === 'team').imports, ['team-pg'])
})

test('a job LayerFS no longer knows ends as Unknown; ended jobs leave after 10 minutes', async () => {
  let now = 0
  const ended = []
  const sampler = new JobSampler({ get: async () => null, now: () => now, onEnd: (j) => ended.push(j) })
  sampler.track({ id: 'j', step: 'running' }, { kind: 'push', store: 'work', target: 'm' })
  await sampler.tick()
  sampler.stop()
  assert.deepEqual({ step: ended[0].step, code: ended[0].error.code }, { step: 'failed', code: 'Unknown' })
  now += 10 * 60_000 + 1
  assert.deepEqual(sampler.list(), [])
})

test('the project list joins storeSync, storeProviders and connection (ProjectSummary)', async () => {
  const { storage } = await redesign()
  await storage.check({})
  const join = await storage.projectJoin()
  assert.deepEqual(join.get('work'), { storeSync: 'ahead', storeProviders: ['minio'], connection: null })
  assert.deepEqual(join.get('work-pg'), { storeSync: 'live', storeProviders: [], connection: 'pg' })
  const { Projects } = await import('../projects.js')
  const projects = new Projects({ spec: { state: '/nowhere', runs: '/nowhere' }, log: () => {} })
  projects.runtime = async () => ({ project: { list: async () => [{ name: 'shop', store: 'work', shared: true }, { name: 'shop', store: 'work-pg', kind: 'postgresql', shared: true }, { name: 'lone' }] } })
  projects.storeJoin = () => storage.projectJoin()
  const list = await projects.list()
  assert.deepEqual(list.map((p) => [p.storeSync, p.storeProviders, p.connection]), [['ahead', ['minio'], null], ['live', [], 'pg'], [null, [], null]])
  // without a join (an older build), the fields are left out
  projects.storeJoin = undefined
  assert.equal('storeSync' in (await projects.list())[0], false)
})

test('routes: POST /api/storage/check and push force reach storage.js; events carry sync and storage', async () => {
  const seen = []
  const { EventEmitter } = await import('node:events')
  const fake = new EventEmitter()
  fake.check = async (body) => (seen.push(['check', body]), { ok: 'check' })
  fake.push = async (store, body) => (seen.push(['push', store, body]), { ok: 'push' })
  const handler = createHandler({ token: 't', projects: {}, storage: fake, log: () => {}, heartbeatMs: 10_000 })
  const ask = (method, path, body) =>
    new Promise((resolve) => {
      const req = Object.assign((async function* () {
        if (body) yield Buffer.from(JSON.stringify(body))
      })(), { method, url: path, headers: { authorization: 'Bearer t', host: 'x' } })
      const res = { writeHead: (status) => (res.status = status), end: (text) => resolve({ status: res.status, body: JSON.parse(text) }) }
      handler(req, res)
    })
  assert.equal((await ask('POST', '/api/storage/check', { remote: 'r2-team' })).body.ok, 'check')
  await ask('POST', '/api/storage/check')
  await ask('POST', '/api/stores/work/push', { force: true })
  assert.deepEqual(seen, [['check', { remote: 'r2-team' }], ['check', {}], ['push', 'work', { force: true }]])
  // the event stream
  const written = []
  const { EventEmitter: E } = await import('node:events')
  const req = new E()
  const res = Object.assign(new E(), { writeHead: () => {}, write: (text) => written.push(text), end: () => {} })
  handler(Object.assign(req, { method: 'GET', url: '/api/events?token=t', headers: { host: 'x' } }), res)
  fake.emit('event', { type: 'sync', job: { id: 'j' } })
  fake.emit('event', { type: 'storage' })
  req.emit('close')
  fake.emit('event', { type: 'storage' })
  assert.deepEqual(written.filter((w) => w.startsWith('data:')), [`data: ${JSON.stringify({ type: 'sync', job: { id: 'j' } })}\n\n`, `data: ${JSON.stringify({ type: 'storage' })}\n\n`])
  assert.equal(fake.listenerCount('event'), 0)
})

test('a call the JS runtime has but its binding lacks (UnknownMethod) turns the feature off, not the remote unreachable', async () => {
  const t = await redesign()
  const { storage, runtime } = t
  const missing = async () => {
    throw Object.assign(new Error('UnknownMethod: no backend operation'), { code: 'UnknownMethod' })
  }
  runtime.store.check = missing
  runtime.postgresql.status = missing
  runtime.remote.list_stores = missing
  const view = await storage.check({})
  assert.deepEqual([view.supports.check, view.supports.postgresqlStatus, view.supports.listCopies], [false, false, false])
  assert.equal(view.remotes.list[0].health.state, 'unknown')
  assert.equal(view.postgresql.connections[0].health.state, 'unknown')
  const l = view.stores.list.find((s) => s.name === 'work').link
  // work changed locally and its file can't be checked: unknown, never a guess (§4), the reason names the remote side
  assert.deepEqual({ check: l.check, failed: l.failedCheck, sync: l.sync }, { check: null, failed: null, sync: 'unknown' })
  assert.match(l.reason, /can't check minio \/ work/)
  assert.equal(view.checkedAt, null)
})
