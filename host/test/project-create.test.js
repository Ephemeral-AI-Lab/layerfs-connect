// The host's Init bridge against an isolated runtime stand-in. No Docker,
// real LayerFS home, user source directory or persisted project is changed.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Projects } from '../projects.js'
import { createHostServer, listen } from '../server.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'connect-project-create-'))
  const jobs = new Map()
  const records = new Map()
  const calls = []
  const runtime = { project: {
    list: async () => [...records.values()],
    start_init: async (name, source) => {
      calls.push({ name, source })
      if (records.has(name)) throw Object.assign(new Error('Project already exists.'), { code: 'Exists' })
      const job = { id: randomUUID(), name, source, started: Date.now(), ended: null, step: 'scan', scanned: null, totals: null, imported: null, project: null, error: null }
      jobs.set(job.id, job)
      return { ...job }
    },
    get_init: async (id) => jobs.has(id) ? { ...jobs.get(id) } : null,
  } }
  const projects = new Projects({ spec: { state: dir, runs: join(dir, 'runs'), runtime: Promise.resolve(runtime) }, log: () => {} })
  const complete = (id, error) => {
    const job = jobs.get(id)
    Object.assign(job, { step: error ? 'failed' : 'done', ended: Date.now(), error: error ?? null })
    if (!error) {
      job.project = { name: job.name, source: job.source, volume: `fixture-${job.name}`, created: job.started }
      records.set(job.name, { ...job.project, initialized: true })
    }
  }
  t.after(async () => {
    for (const job of jobs.values()) if (!job.ended) complete(job.id, { code: 'Cancelled', message: 'Test ended.' })
    await projects.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { dir, jobs, records, calls, runtime, projects, complete }
}

test('empty project starts a real Init request; its generated source is removed only after completion', async (t) => {
  const f = fixture(t)
  const job = await f.projects.create({ name: 'new-project' })
  assert.equal(job.step, 'scan')
  assert.equal(job.source, null)
  assert.equal(job.project, null)
  const source = f.calls[0].source
  assert.ok(existsSync(source))
  assert.deepEqual(readdirSync(source), [])
  const completion = f.projects.creations.get(job.id)
  f.complete(job.id)
  const done = await f.projects.init(job.id)
  assert.equal(done.step, 'done')
  assert.deepEqual(done.project, { name: 'new-project', volume: 'fixture-new-project', source: null, created: job.started, initialized: true, demo: null, run: null, store: null, kind: null, shared: false, key: 'new-project' })
  await completion
  assert.equal(existsSync(source), false)
  assert.equal((await f.projects.list())[0].source, null)
  const reopened = new Projects({ spec: f.projects.spec, log: () => {} })
  assert.equal((await reopened.list())[0].source, null)
  await reopened.close()
})

test('folder import passes the exact folder and leaves its files intact on success and failure', async (t) => {
  const f = fixture(t)
  const source = mkdtempSync(join(f.dir, 'source-'))
  const file = join(source, 'hello.txt')
  writeFileSync(file, 'keep this original file')
  for (const error of [null, { code: 'InitFailed', message: 'Unable to import.' }]) {
    const job = await f.projects.create({ name: error ? 'failed-import' : 'imported', source })
    assert.equal(job.source, source)
    assert.equal(f.calls.at(-1).source, source)
    const completion = f.projects.creations.get(job.id)
    f.complete(job.id, error)
    await completion
    const result = await f.projects.init(job.id)
    assert.equal(result.step, error ? 'failed' : 'done')
    assert.deepEqual(result.error, error)
    assert.equal(readFileSync(file, 'utf8'), 'keep this original file')
  }
})

test('failed empty Init removes only its generated source and keeps the runtime error', async (t) => {
  const f = fixture(t)
  const job = await f.projects.create({ name: 'broken' })
  const completion = f.projects.creations.get(job.id)
  const source = f.calls[0].source
  const error = { code: 'DockerUnavailable', message: 'Docker is not running.' }
  f.complete(job.id, error)
  await completion
  assert.equal(existsSync(source), false)
  assert.deepEqual((await f.projects.init(job.id)).error, error)
  assert.deepEqual(await f.projects.list(), [])
})

test('invalid names and folders do not call Init', async (t) => {
  const f = fixture(t)
  const file = join(f.dir, 'file.txt')
  writeFileSync(file, 'not a directory')
  for (const input of [null, {}, { name: 'Bad Name' }, { name: '../escape' }, { name: 'ok', source: '' }, { name: 'ok', source: 'relative' }, { name: 'ok', source: '/bad\0path' }, { name: 'ok', source: file }, { name: 'ok', source: join(f.dir, 'missing') }]) {
    await assert.rejects(f.projects.create(input), { status: 400 })
  }
  assert.equal(f.calls.length, 0)
  assert.deepEqual(readdirSync(f.dir), ['file.txt'])
})

test('same-name concurrent requests and existing projects never overwrite or reset a project', async (t) => {
  const f = fixture(t)
  const existing = { name: 'existing', source: '/original', initialized: true, volume: 'original-volume' }
  f.records.set(existing.name, existing)
  await assert.rejects(f.projects.create({ name: existing.name }), { code: 'Exists' })
  assert.equal(f.records.get(existing.name), existing)
  assert.deepEqual(readdirSync(f.projects.emptySources), [])
  const results = await Promise.allSettled([f.projects.create({ name: 'same-name' }), f.projects.create({ name: 'same-name' })])
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1)
  assert.equal(results.find((x) => x.status === 'rejected').reason.status, 409)
  assert.equal(f.calls.filter((call) => call.name === 'same-name').length, 1)
  const job = results.find((x) => x.status === 'fulfilled').value
  f.complete(job.id)
  await f.projects.creations.get(job.id)
})

test('progress comes from the runtime; unknown job is 404 and status reads do not restart Init', async (t) => {
  const f = fixture(t)
  const job = await f.projects.create({ name: 'progress' })
  Object.assign(f.jobs.get(job.id), { step: 'import', totals: { entries: 2, files: 1, bytes: 12 }, imported: { step: 'files', entries: 2, files: 1, bytes: 12 } })
  const progress = await f.projects.init(job.id)
  assert.equal(progress.step, 'import')
  assert.deepEqual(progress.totals, { entries: 2, files: 1, bytes: 12 })
  assert.equal(progress.imported.step, 'files')
  assert.equal(f.calls.length, 1)
  await assert.rejects(f.projects.init('missing'), { status: 404, code: 'NoSuchInit' })
})

test('HTTP project creation and status are authenticated and return errors without fake success', async (t) => {
  const f = fixture(t)
  const server = createHostServer({ token: 'project-create-test', projects: f.projects, log: () => {} })
  const url = await listen(server, 0)
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const headers = { authorization: 'Bearer project-create-test', 'content-type': 'application/json' }
  const post = (body) => fetch(`${url}/api/projects`, { method: 'POST', headers, body: JSON.stringify(body) })
  assert.equal((await fetch(`${url}/api/projects`, { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await post({ name: 'Not valid' })).status, 400)
  const res = await post({ name: 'http-created' })
  assert.equal(res.status, 200)
  const job = await res.json()
  assert.equal((await post({ name: 'http-created' })).status, 409)
  assert.equal((await fetch(`${url}/api/project-inits/${job.id}`)).status, 401)
  const completion = f.projects.creations.get(job.id)
  f.complete(job.id)
  await completion
  const done = await fetch(`${url}/api/project-inits/${job.id}`, { headers })
  assert.equal(done.status, 200)
  assert.equal((await done.json()).project.name, 'http-created')
  assert.equal((await fetch(`${url}/api/project-inits/missing`, { headers })).status, 404)
  assert.equal(f.calls.length, 1)
})
