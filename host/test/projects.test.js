// projects.js live, against a throwaway project this file makes in
// Connect's home (an Init of fixtures/demo-workspace with the Branch
// feature-home) and removes at the end. It needs the home's settings and,
// on macOS, its running worker.
//   node --import ./host/resolve-layerfs.js --test host/test/projects.test.js
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { after, before, test } from 'node:test'
import { LayerFS } from '@layerfs/agent'
import { APP, openRuntime, resolveSpec, withProjectEnv } from '../config.js'
import { Projects } from '../projects.js'

const NAME = `connect-test-${process.pid}`
const spec = resolveSpec()
const projects = new Projects({ spec, log: () => {} })
let runtime

before(async () => {
  runtime = await openRuntime(spec)
  let job = await runtime.project.start_init(NAME, join(APP, 'fixtures', 'demo-workspace'), {})
  while (!job.ended) {
    await pause(250)
    job = await runtime.project.get_init(job.id)
  }
  assert.equal(job.step, 'done', job.error?.message)
  const lf = await withProjectEnv(spec, job.project, () => LayerFS.open(NAME))
  try {
    await lf.branch.fork('feature-home')
  } finally {
    await lf.close()
  }
})
after(async () => {
  await projects.close()
  await runtime.project.remove(NAME, { confirm: NAME, stopSandboxes: true })
  await runtime.close()
})

test('status: platform, Docker, the worker and Connect settings', async () => {
  const s = await projects.status()
  assert.ok(['linux', 'macos', 'windows'].includes(s.platform))
  assert.ok(Array.isArray(s.missing))
  assert.equal(s.docker.level, 'ok')
  if (spec.worker) {
    assert.equal(s.worker.name, `${spec.prefix}worker`)
    assert.equal(s.worker.state, 'running')
  } else assert.equal(s.worker, null)
  assert.equal(s.settings.home, spec.home)
  assert.equal(s.settings.containerPrefix, spec.prefix)
})

test('list: the test project is initialized, with its volume', async () => {
  const p = (await projects.list()).find((x) => x.name === NAME)
  assert.ok(p, `${NAME} is listed`)
  assert.equal(p.initialized, true)
  assert.ok(p.volume.startsWith(`${spec.prefix}${NAME}-store-`))
  assert.equal(typeof p.created, 'number')
  assert.equal(p.demo, null)
})

test('state: main and feature-home, the Init Layer, the Sandboxes', async () => {
  const st = await projects.state(NAME)
  assert.equal(st.project.name, NAME)
  const main = st.branches.find((b) => b.name === 'main')
  const feature = st.branches.find((b) => b.name === 'feature-home')
  assert.ok(main && feature)
  assert.equal(main.parent, null)
  assert.equal(main.head, st.layers[0].id)
  assert.equal(feature.parent, 'main')
  assert.equal(feature.forkedFrom, st.layers.at(-1).id)
  assert.equal(feature.state, 'open')
  assert.equal(typeof feature.commits, 'number')
  assert.equal(st.layers.at(-1).message, 'Init')
  assert.ok(Array.isArray(st.sandboxes))
  for (const s of st.sandboxes) assert.ok(s.id && s.state && Array.isArray(s.workspaces))
  // the Store's totals; main's head Layer is a full snapshot
  assert.ok(st.storage)
  assert.ok(st.storage.logical > 0 && st.storage.canonical > 0)
  assert.equal(typeof st.storage.main, 'number')
  assert.ok(st.storage.init && st.storage.init.files > 0)
  assert.equal(st.storage.commits.length, st.commits)
  for (const c of st.storage.commits) assert.equal(typeof c.stored, 'number')
})

test('commits: newest first, as CommitInfo; main has none (its history is Layers)', async () => {
  const commits = await projects.commits(NAME, 'feature-home', '50')
  assert.ok(Array.isArray(commits))
  for (const c of commits) {
    assert.match(c.id, /^[0-9a-f]+$/)
    assert.equal(c.branch, 'feature-home')
    assert.equal(typeof c.message, 'string')
  }
  for (let i = 1; i < commits.length; i++) assert.ok((commits[i - 1].at ?? 0) >= (commits[i].at ?? 0))
  assert.deepEqual(await projects.commits(NAME, 'main'), [])
  await assert.rejects(projects.commits(NAME, 'feature-home', '0'), { status: 400 })
  await assert.rejects(projects.commits(NAME, 'no-such-branch'), { code: 'NoSuchBranch' })
})

test('state and Commit reads see every Branch, past get_state\'s 64 and one list_branches page', async () => {
  const lf = await withProjectEnv(spec, await projects.record(NAME), () => LayerFS.open(NAME))
  const extra = Array.from({ length: 100 }, (_, i) => `wide-${String(i).padStart(3, '0')}`)
  try {
    for (const name of extra) await lf.branch.fork(name, 'feature-home')
  } finally {
    await lf.close()
  }
  const st = await projects.state(NAME)
  const names = new Set(st.branches.map((b) => b.name))
  for (const name of ['main', 'feature-home', ...extra]) assert.ok(names.has(name), `${name} listed`)
  assert.equal(st.branches.length, names.size)
  const last = st.branches.find((b) => b.name === extra.at(-1))
  assert.equal(last.parent, 'main')
  assert.equal(last.forkedFrom, st.branches.find((b) => b.name === 'feature-home').forkedFrom)
  assert.deepEqual(await projects.commits(NAME, extra.at(-1)), [])
})

test('listDir: the root folder with kinds and file sizes', async () => {
  const entries = await projects.listDir(NAME, 'feature-home', '/')
  const pkg = entries.find((e) => e.name === 'package.json')
  assert.deepEqual({ ...pkg, mode: undefined }, { name: 'package.json', path: '/package.json', kind: 'file', size: 158, mode: undefined })
  assert.equal(entries.find((e) => e.name === 'app')?.kind, 'dir')
  await assert.rejects(projects.listDir(NAME, 'feature-home', 'relative'), { status: 400 })
  await assert.rejects(projects.listDir(NAME, 'feature-home', '/no-such-dir'), { code: 'NoSuchPath' })
})

test('file: /package.json whole; a folder is refused', async () => {
  const f = await projects.file(NAME, 'feature-home', '/package.json')
  assert.equal(f.path, '/package.json')
  assert.equal(f.binary, false)
  assert.equal(f.size, 158)
  assert.equal(Buffer.byteLength(f.text), 158)
  assert.equal(JSON.parse(f.text).name, 'website')
  await assert.rejects(projects.file(NAME, 'feature-home', '/app'), { code: 'IsDirectory' })
})

test('unknown projects are 404; bad names 400; remove refuses them before any change', async () => {
  await assert.rejects(projects.state('no-such-project-x'), { status: 404, code: 'NoSuchProject' })
  await assert.rejects(projects.state('Bad Name'), { status: 400 })
  await assert.rejects(projects.remove('no-such-project-x'), { status: 404 })
})

test('one client per project, kept open between reads', async () => {
  await projects.file(NAME, 'feature-home', '/README.md')
  const held = projects.clients.get(NAME)
  assert.ok(held)
  await projects.listDir(NAME, 'feature-home', '/app')
  assert.equal(projects.clients.get(NAME), held)
  assert.equal(held.users, 0)
  assert.ok(held.timer)
})
