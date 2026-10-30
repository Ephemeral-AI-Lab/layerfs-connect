// Connect's Storage routes end to end (layerfs#506) on a real LayerFS build:
// the HTTP calls the Storage page makes, through host/server.js, storage.js
// and projects.js, to @layerfs/runtime and its worker.
//   - a Store holds two projects; a second, empty Store sits beside it
//   - a MinIO remote: push the Store, clone it into a new Store, pull it back
//   - a PostgreSQL connection: import the Store into a new PostgreSQL Store
//   - every Store and remote removed, no container or volume left
//
//   node host/test/verify/storage_real.mjs <layerfs api/ folder> <bundle> <image digest>
//
// It starts its own MinIO and PostgreSQL, a private Connect state folder and
// LayerFS home, and its own container prefix, so the user's Connect, worker
// and Stores are never touched. One attempt per step; nothing is retried.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolveSpec } from '../../config.js'
import { Projects } from '../../projects.js'
import { createHandler } from '../../server.js'
import { Storage } from '../../storage.js'

const [api, bundle, image] = process.argv.slice(2)
assert.ok(api && bundle && /^sha256:[0-9a-f]{64}$/.test(image ?? ''), 'usage: <layerfs api/ folder> <bundle> <image digest>')

const docker = (args) => spawnSync('docker', args, { encoding: 'utf8' })
const must = (args) => {
  const r = docker(args)
  assert.equal(r.status, 0, `docker ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const MINIO = 'cgr.dev/chainguard/minio@sha256:4692462f35d97d7e82c30371d82f057703c5d9489bcae726010594c812f2d285'
const POSTGRES = 'postgres:17-bookworm'

const prefix = `lfce${Date.now().toString(36)}-`
const root = mkdtempSync(join(tmpdir(), 'lfc-storage-real-'))
const step = (text) => console.log(`STEP ${text}`)

/** MinIO and PostgreSQL on this machine's loopback, as a user would run them. */
function services() {
  const access = `lfc${Date.now().toString(36)}`
  const secret = `s${Math.random().toString(36).slice(2)}${Date.now()}`
  must(['run', '-d', '--pull', 'never', '--name', `${prefix}minio`, '-p', '127.0.0.1::9000', '-e', `MINIO_ROOT_USER=${access}`, '-e', `MINIO_ROOT_PASSWORD=${secret}`, MINIO, 'server', '/data'])
  must(['run', '-d', '--pull', 'never', '--name', `${prefix}pg`, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=lfcpg', '-e', 'POSTGRES_USER=lfc', '-e', 'POSTGRES_DB=layerfs', POSTGRES])
  const port = (name, inner) => Number(/:(\d+)$/m.exec(must(['port', name, inner]))[1])
  // bounded readiness waits, not retries of a product request
  for (let i = 0; docker(['exec', `${prefix}minio`, 'mc', 'alias', 'set', 'local', 'http://127.0.0.1:9000', access, secret]).status !== 0; i++) {
    assert.ok(i < 60, 'MinIO not ready in 30 s')
    spawnSync('sleep', ['0.5'])
  }
  must(['exec', `${prefix}minio`, 'mc', 'mb', 'local/layerfs-stores'])
  for (let i = 0; docker(['exec', `${prefix}pg`, 'pg_isready', '-U', 'lfc', '-d', 'layerfs']).status !== 0; i++) {
    assert.ok(i < 60, 'PostgreSQL not ready in 30 s')
    spawnSync('sleep', ['0.5'])
  }
  spawnSync('sleep', ['1'])
  return {
    // what a user types: localhost; storage.js rewrites it for the worker
    minio: { endpoint: `http://localhost:${port(`${prefix}minio`, '9000/tcp')}`, accessKey: access, secretKey: secret },
    url: `postgresql://lfc:lfcpg@localhost:${port(`${prefix}pg`, '5432/tcp')}/layerfs?sslmode=disable`,
  }
}

function folder(name, files) {
  const dir = join(root, `src-${name}`)
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  return dir
}

async function main(svc) {
  const { LayerFSRuntime } = await import(pathToFileURL(join(api, 'runtime', 'src', 'index.js')).href)
  const spec = resolveSpec(join(root, 'state'))
  Object.assign(spec, { image, bundle, daemon: join(bundle, 'layerfs-daemon'), prefix, worker: process.platform !== 'linux' })
  chmodSync(spec.home, 0o700)
  spec.runtime = LayerFSRuntime.open({ home: spec.home, image, bundle, daemon: spec.daemon, containerPrefix: prefix, sweep: false, stateDir: join(spec.home, '.runtime') })
  const log = (line) => console.log(`  ${line}`)
  const projects = new Projects({ spec, log })
  const storage = new Storage({ spec, projects, log })
  const token = 'storage-real'
  const server = createServer(createHandler({ token, projects, storage, log }))
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const text = await res.text()
    const value = text ? JSON.parse(text) : null
    if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${res.status} ${text}`), { status: res.status, body: value })
    return value
  }
  /** Follows a job by its route until it ends; it must end done. */
  const ended = async (path, job) => {
    for (let i = 0; i < 1200; i++) {
      const now = await call('GET', `${path}/${job.id}`)
      if (now.ended) {
        assert.equal(now.step, 'done', `${path} ${job.id}: ${now.error}`)
        return now
      }
      await new Promise((next) => setTimeout(next, 100))
    }
    throw new Error(`${path} ${job.id} did not end in 120 s`)
  }
  const view = () => call('GET', '/api/storage')
  const store = async (name) => (await view()).stores.list.find((s) => s.name === name)

  try {
    if (spec.worker) {
      step('start the worker')
      await projects.startWorker()
    }
    step('the view offers Stores, remotes and PostgreSQL')
    const first = await view()
    assert.deepEqual([first.stores.available, first.remotes.available, first.postgresql.available], [true, true, true], JSON.stringify(first))

    step('a Store holds two projects, beside an empty Store')
    await call('POST', '/api/stores', { name: 'team' })
    await call('POST', '/api/stores', { name: 'scratch' })
    await ended('/api/inits', await call('POST', '/api/projects', { name: 'shop', store: 'team', folder: folder('shop', { 'src/cart.js': 'export const cart = []\n' }) }))
    await ended('/api/inits', await call('POST', '/api/projects', { name: 'docs', store: 'team' }))
    const listed = await call('GET', '/api/projects')
    assert.deepEqual(listed.filter((p) => p.store === 'team').map((p) => p.name).sort(), ['docs', 'shop'])
    assert.deepEqual((await store('team')).projects.sort(), ['docs', 'shop'])
    assert.deepEqual((await store('scratch')).projects, [])

    step('a MinIO remote: push the Store, clone it into a new Store')
    const added = await call('POST', '/api/remotes', { name: 'minio', provider: 'minio', endpoint: svc.minio.endpoint, bucket: 'layerfs-stores', prefix: 'lfc', accessKey: svc.minio.accessKey, secretKey: svc.minio.secretKey })
    const remote = added.remotes.list.find((r) => r.name === 'minio')
    assert.equal(remote.hasSecret, true)
    console.log(`  the worker reaches MinIO as ${remote.reachAs}`)
    const pushed = await ended('/api/sync-jobs', await call('POST', '/api/stores/team/push', { remote: 'minio' }))
    console.log(`  pushed ${pushed.total ?? '?'} bytes`)
    const team = await store('team')
    assert.equal(team.copies.find((c) => c.remote === 'minio')?.pushed?.sha256?.length, 64, JSON.stringify(team.copies))
    assert.deepEqual((await view()).remotes.list[0].stores, ['team'])
    await ended('/api/sync-jobs', await call('POST', '/api/remotes/minio/clone', { store: 'copy', from: 'team' }))
    const copy = await store('copy')
    assert.deepEqual(copy.projects.sort(), ['docs', 'shop'])
    console.log(`  copy: ${copy.kind}, remote ${copy.remote ?? 'none'}`)

    step('pull needs the Store name, then replaces the Store from the remote')
    await assert.rejects(call('POST', '/api/stores/team/pull', { remote: 'minio' }), { status: 400 })
    await ended('/api/sync-jobs', await call('POST', '/api/stores/team/pull', { remote: 'minio', confirm: 'team' }))
    assert.ok((await store('team')).copies.find((c) => c.remote === 'minio')?.pulled, 'the pull is recorded')

    step('a PostgreSQL connection: import the Store into a new PostgreSQL Store')
    await call('POST', '/api/postgresql', { name: 'pg', url: svc.url, synchronousCommit: 'local' })
    await ended('/api/sync-jobs', await call('POST', '/api/stores/team/import-postgresql', { connection: 'pg' }))
    const pg = await store('team-pg')
    assert.deepEqual({ kind: pg.kind, connection: pg.connection, schema: pg.schema, projects: pg.projects.sort() }, { kind: 'postgresql', connection: 'pg', schema: 'lfc_team_pg', projects: ['docs', 'shop'] })
    const conn = (await view()).postgresql.connections.find((c) => c.name === 'pg')
    assert.deepEqual(conn.stores, ['team-pg'])
    assert.equal(JSON.stringify(await view()).includes('lfcpg'), false, 'no password in the view')

    step('remove every Store (by its name), the remote and the connection')
    for (const name of ['team-pg', 'copy', 'scratch', 'team']) await call('DELETE', `/api/stores/${name}?confirm=${name}`)
    await call('DELETE', '/api/remotes/minio')
    await call('DELETE', '/api/postgresql/pg')
    const last = await view()
    assert.deepEqual([last.stores.list.length, last.remotes.list.length, last.postgresql.connections.length], [0, 0, 0], JSON.stringify(last))
    console.log('MAIN ok')
  } finally {
    server.close()
    await (await spec.runtime).close?.()
  }
}

let status = 1
try {
  const svc = services()
  await main(svc)
  status = 0
} catch (error) {
  console.error(error)
} finally {
  const left = must(['ps', '-aq', '--filter', `name=^${prefix}`]).split('\n').filter(Boolean)
  if (left.length) docker(['rm', '-f', '-v', ...left])
  const volumes = must(['volume', 'ls', '-q', '--filter', `name=^${prefix}`]).split('\n').filter(Boolean)
  if (volumes.length) docker(['volume', 'rm', ...volumes])
  console.log(`cleanup: removed ${left.length} containers, ${volumes.length} volumes`)
  rmSync(root, { recursive: true, force: true })
}
process.exit(status)
