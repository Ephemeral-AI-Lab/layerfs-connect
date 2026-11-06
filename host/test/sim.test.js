// The simulated LayerFS (host/sim) and the mode settings (config.js): the
// simulator takes the real package's arguments and answers with its shapes,
// the host's views read it as they read the real one, work in flight shows as
// an op, refusals carry the real codes, and the world survives a restart.
//   node --test host/test/sim.test.js
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.LAYERFS_SIM_SPEED = '0'
const sim = await import('../sim/index.js')
const { World } = await import('../sim/world.js')
const { defaultState, modeOf, resolveSpec } = await import('../config.js')
const { Machines } = await import('../machines.js')
const { Storage } = await import('../storage.js')
const { Projects } = await import('../projects.js')

const temp = () => mkdtempSync(join(tmpdir(), 'lfc-sim-'))
/** A sim client on a fresh home seeded from `preset`. */
function fresh(preset = 'mac') {
  const state = temp()
  const home = join(state, 'home-2')
  process.env.LAYERFS_SIM_PRESET = preset
  const lfs = sim.client({ home })
  return { lfs, spec: { mode: 'sim', state, home, runs: join(state, 'runs'), cli: null, daemon: null } }
}
const refusal = async (promise) => {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('expected a refusal')
}

test('the saved call table is the linked library\'s', async (t) => {
  let real
  try {
    real = await import('layerfs')
  } catch {
    return t.skip('the native LayerFS library is not built here')
  }
  assert.deepEqual(sim.table, real.table, 'run `node tools/sim-table.mjs` after upgrading LayerFS')
})

test('mode: unset is real, sim is sim, anything else is refused; each has its own state folder', () => {
  assert.equal(modeOf(undefined), 'real')
  assert.equal(modeOf(''), 'real')
  assert.equal(modeOf('sim'), 'sim')
  assert.throws(() => modeOf('fake'), /real or sim/)
  assert.notEqual(defaultState('sim'), defaultState('real'))
  const state = temp()
  const spec = resolveSpec(state, 'sim')
  assert.equal(spec.mode, 'sim')
  assert.equal(spec.cli, null)
  // a real home is never handed to the simulator
  const real = temp()
  mkdirSync(join(real, 'home-2'), { recursive: true })
  writeFileSync(join(real, 'home-2', 'layerfs.json'), '{}')
  assert.throws(() => resolveSpec(real, 'sim'), /real LayerFS home/)
})

test('arguments bind as the real package binds them: a page object is the options', async () => {
  const { lfs } = fresh()
  const page = await lfs.project.list({ page_size: 2, page_pos: 0 })
  assert.equal(page.items.length, 2)
  assert.equal(page.next_page_pos, 2)
  assert.equal((await lfs.project.list('shop')).items.length, 2)
  assert.equal((await refusal(lfs.project.list({ nope: 1 }))).code, 'InvalidInput')
  assert.equal((await refusal(lfs.branch.get('shop/api'))).code, 'InvalidInput')
})

test('Compute, Storage and Projects read the simulated home as they read a real one', async () => {
  const { lfs, spec } = fresh()
  const machines = await new Machines({ spec, client: lfs }).view()
  assert.deepEqual(machines.machines.map((m) => [m.name, m.state]), [['docker', 'running'], ['lima1', 'running'], ['lima2', 'stopped'], ['native', 'ready']])
  assert.equal(machines.sandboxes[0].workspaces, 1)
  assert.deepEqual(machines.postgresql.map((s) => s.name), ['team'])
  assert.ok(machines.platforms.some((p) => p.platform === 'lima' && p.ready))

  const storage = await new Storage({ spec, client: lfs, log: () => {} }).view()
  const shop = storage.stores.find((s) => s.name === 'shop')
  assert.equal(shop.state, 'in_use')
  assert.deepEqual(shop.projects, ['api', 'web'])
  assert.ok(shop.size.bytes > 0)
  assert.equal(shop.links[0].bucket, 'backups')

  const projects = new Projects({ spec, client: lfs, log: () => {} })
  const state = await projects.state('shop/api')
  assert.deepEqual(state.branches.map((b) => [b.name, b.commits]), [['feature-login', 3], ['fix-orders', 1], ['main', 0]])
  const commits = await projects.commits('shop/api', 'feature-login')
  assert.deepEqual(commits[0].changes, [{ path: '/test/login.test.js', kind: 'added' }])
  assert.deepEqual((await projects.listDir('shop/api', 'feature-login', '/src')).map((e) => e.name), ['auth.js', 'routes', 'server.js'])
  assert.match((await projects.file('shop/api', 'main', '/README.md')).text, /HTTP API/)
})

test('a push runs as the Store\'s op with progress, and lands the Store on the machine', async () => {
  const { lfs } = fresh()
  await lfs.machine.start('lima2')
  const phases = []
  let seen = null
  const push = lfs.store.push('lab', 'lima2', { on_progress: (p) => phases.push(p.phase) }).catch((e) => e)
  // lab is on lima1: a push needs it on native first
  assert.equal((await push).code, 'InvalidInput')
  await lfs.sandbox.close('api-dev')
  const done = lfs.store.push('shop', 'lima2', {
    on_progress: async (p) => {
      phases.push(p.phase)
      if (p.phase === 'send' && !seen) seen = (await lfs.store.list()).items.find((s) => s.name === 'shop')
    },
  })
  await done
  assert.deepEqual([...new Set(phases)], ['check', 'send', 'install', 'record'])
  assert.equal(seen.state, 'busy')
  assert.equal(seen.op.name, 'store.push')
  const after = await lfs.store.get('shop')
  assert.equal(after.machine, 'lima2')
  // a Store on a stopped machine is down, and its project calls are refused Unavailable
  await lfs.machine.stop('lima2')
  assert.equal((await lfs.store.status('shop')).state, 'down')
  assert.equal((await refusal(lfs.branch.list('shop/api'))).code, 'Unavailable')
})

test('refusals carry the real codes', async () => {
  const { lfs } = fresh()
  assert.equal((await refusal(lfs.machine.stop('native'))).code, 'Unsupported')
  const inUse = await refusal(lfs.store.remove('shop'))
  assert.equal(inUse.code, 'InUse')
  assert.deepEqual(inUse.detail.related, [{ kind: 'sandbox', name: 'api-dev' }])
  assert.equal((await refusal(lfs.store.create('shop'))).code, 'Exists')
  assert.equal((await refusal(lfs.project.get('shop/nope'))).code, 'NoSuchProject')
  assert.equal((await refusal(lfs.sandbox.get('nope'))).code, 'NoSuchSandbox')
  assert.equal((await refusal(lfs.commit.list('shop/api', 'main'))).code, 'NoSuchBranch')
  assert.equal((await refusal(lfs.file.write('shop/api', 'main', '/x', 'y'))).code, 'ReadOnly')
  assert.equal((await refusal(lfs.workspace.exec('api-dev:feature-login', 'ls'))).code, 'Unsupported')
  // a sqlite project's Sandboxes run on its Store's machine, which must be running
  assert.equal((await refusal(lfs.sandbox.create('lab/notes', 'n1', 'native'))).code, 'Unsupported')
  const trouble = fresh('trouble').lfs
  assert.equal((await refusal(trouble.machine.start('lima2'))).code, 'Unavailable')
  assert.equal((await refusal(trouble.sandbox.get('api-stuck'))).code, 'Unresolved')
  assert.equal((await sim.doctor({ home: join(trouble.home) })).ok, false)
})

test('files, Commits, merge and publish behave as on real LayerFS', async () => {
  const { lfs } = fresh()
  const P = 'shop/web'
  await lfs.branch.fork(P, 'try', 'main')
  assert.equal((await refusal(lfs.branch.fork(P, 'try', 'main'))).code, 'NameTaken')
  const w1 = await lfs.file.write(P, 'try', '/notes.txt', 'one\n', { message: 'add notes' })
  assert.equal(w1.kind, 'Committed')
  assert.equal(w1.commit.parent, null)
  const w2 = await lfs.file.edit(P, 'try', '/notes.txt', { old: 'one', new: 'two' })
  assert.equal(w2.commit.parent, w1.head)
  assert.equal(w2.commit.message, 'Apply filesystem changes')
  assert.equal((await refusal(lfs.file.edit(P, 'try', '/notes.txt', { old: 'zzz', new: 'y' }))).code, 'NoMatch')
  assert.equal((await refusal(lfs.file.write(P, 'try', '/no/such/dir/x', 'y'))).code, 'NoSuchPath')
  assert.equal((await lfs.file.read(P, 'try', '/notes.txt')).text, 'two\n')
  assert.deepEqual((await lfs.commit.list(P, 'try')).items.map((c) => c.message), ['Apply filesystem changes', 'add notes'])
  assert.deepEqual((await lfs.branch.diff(P, 'main', 'try')).items.map((i) => [i.path, i.kind]), [['/notes.txt', 'Added']])
  assert.deepEqual((await lfs.file.glob(P, 'try', '/', '**/*.js')).items, ['/src/main.js', '/src/view.js'])
  assert.equal((await lfs.file.grep(P, 'try', '/', 'Welcome')).items[0].path, '/src/view.js')
  const merged = await lfs.branch.merge(P, 'both', 'try', 'redesign')
  assert.equal(merged.kind, 'Merged')
  assert.match((await lfs.file.read(P, 'both', '/src/view.js')).text, /Welcome back/)
  assert.equal((await lfs.file.read(P, 'both', '/notes.txt')).text, 'two\n')
  const published = await lfs.branch.publish(P, 'both')
  assert.equal(published.kind, 'Added')
  assert.equal((await lfs.file.read(P, 'main', '/notes.txt')).text, 'two\n')
  await lfs.file.write(P, 'try', '/bin', Buffer.from([0, 1, 2]))
  assert.equal((await refusal(lfs.file.read(P, 'try', '/bin'))).code, 'Binary')
})

test('project.init imports a host folder; the world survives a restart', async () => {
  const { lfs, spec } = fresh('empty')
  const src = temp()
  mkdirSync(join(src, 'lib'))
  writeFileSync(join(src, 'lib', 'a.js'), 'export const a = 1\n')
  await lfs.store.create('mine')
  const made = await lfs.project.init('mine/app', src)
  assert.equal(made.project, 'mine/app')
  assert.ok(made.layer.startsWith('32'))
  sim.close()
  assert.ok(existsSync(join(spec.home, 'sim-world.json')))
  const reopened = World.open(spec.home)
  assert.deepEqual(Object.keys(reopened.data.projects), ['mine/app'])
  assert.equal(JSON.parse(readFileSync(join(spec.home, 'sim-world.json'), 'utf8')).preset, 'empty')
  // reset replaces the world with a preset's
  const info = sim.reset(spec.home, 'mac')
  assert.equal(info.preset, 'mac')
  assert.ok((await lfs.project.list()).items.some((p) => p.project === 'shop/api'))
})
