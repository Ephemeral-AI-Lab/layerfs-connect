// Compute's host side: the machines view (machines.js) over a stand-in
// LayerFS 2.0 client, and the home settings and status (config.js,
// projects.js) over stand-in runtime status payloads. No Docker, no VM, no
// provider CLI is run; the one real runtime opened here is a vm:microsandbox
// home with no project, whose status() asks no CLI.
//   node --import ./host/resolve-layerfs.js --test host/test/compute.test.js
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Machines, machineOf, storeOf } from '../machines.js'
import { deploymentEnv, hostProjects, hostStatus, isHostHome, missing, openRuntime, readSettings, resolveSpec, runtimeSettings, writeSettings } from '../config.js'
import { Projects, sandboxTag } from '../projects.js'

const IMAGE = 'sha256:afa1'
const spec = (over = {}) => ({ image: IMAGE, bundle: '/b/bundle', daemon: '/b/bundle/layerfs-daemon', docker: '/var/run/docker.sock', prefix: 'lfc-', placement: 'local', vm: {}, ssh: {}, ...over })

const localMac = (over = {}) => ({
  platform: 'macos',
  placement: 'local',
  missing: [],
  docker: { level: 'ok', version: '29.5.2' },
  worker: { name: 'lfc-worker', state: 'running', build: 'b1', expected: 'b1', answering: true },
  vm: null,
  disk: { home: 212e9, volumes: 43.7e9 },
  ...over,
})
const vmStatus = (vms, over = {}) => ({
  platform: 'macos',
  placement: 'vm:apple-container',
  missing: [],
  docker: { level: 'not-used', detail: 'this home is placed in vm:apple-container; its Stores and Sandboxes are inside each project\'s VM' },
  worker: null,
  vm: { provider: 'apple-container', placement: 'vm:apple-container', vms },
  disk: { home: 100, volumes: 5e9 },
  ...over,
})
const running = (project, over = {}) => ({
  project,
  name: `lfc-${project}-vm`,
  state: 'running',
  image: 'node:22-trixie-slim',
  home: '/h',
  store: `lfc-${project}-vm-store`,
  created: '2026-10-30T10:00:00Z',
  worker: { state: 'running', answering: true, build: 'b1', port: 50123 },
  disk: { free: 19e9 },
  ...over,
})

test('SandboxInfo tags: the placement provider, and how it runs', () => {
  assert.deepEqual(sandboxTag('local', IMAGE), { provider: 'docker', runtime: 'docker' })
  assert.deepEqual(sandboxTag('local', 'local'), { provider: 'docker', runtime: 'native' })
  assert.deepEqual(sandboxTag('vm:microsandbox', 'local'), { provider: 'vm:microsandbox', runtime: 'namespaces' })
  // layerfs#529: the record names its platform, and a native one's image is null
  assert.deepEqual(sandboxTag('local', IMAGE, 'docker'), { provider: 'docker', runtime: 'docker', platform: 'docker' })
  assert.deepEqual(sandboxTag('local', null, 'mac'), { provider: 'docker', runtime: 'native', platform: 'mac' })
  assert.deepEqual(sandboxTag('local', IMAGE, 'linux'), { provider: 'docker', runtime: 'namespaces', platform: 'linux' })
  assert.deepEqual(sandboxTag('vm:lima', IMAGE, 'lima'), { provider: 'vm:lima', runtime: 'namespaces', platform: 'lima' })
})

// ---------- machines (layerfs#533) ----------

const GIB = 2 ** 30
/** A stand-in LayerFS 2.0 client: machine.list as 2.0 answers it, and every call it receives. */
function fake2({ machines, can = [], stores = [], sandboxes = [], down = {}, table = [] } = {}) {
  const calls = []
  const call = (name, answer) => async (...args) => {
    calls.push([name, ...args])
    return typeof answer === 'function' ? answer(...args) : answer
  }
  const lfs = {
    machine: {
      list: call('machine.list', () => ({ machines, can_create: can })),
      status: call('machine.status', (name) => {
        if (down[name]) throw Object.assign(new Error(down[name]), { code: 'Unavailable' })
        return { name, platform: 'lima', state: 'stopped', free_disk: 30 * GIB, tool_version: 'limactl 2.0.1', down_reason: null, stores: [] }
      }),
      create: call('machine.create', { name: 'dev' }),
      connect: call('machine.connect', { name: 'box' }),
      remove: call('machine.remove', { removed: true }),
      disconnect: call('machine.disconnect', { disconnected: true }),
      update: call('machine.update', { updated: true }),
    },
    store: { list: call('store.list', { items: stores }), move: call('store.move', { moved: true }) },
    sandbox: { list: call('sandbox.list', { items: sandboxes }) },
  }
  const homes = []
  const machinesOf = new Machines({ spec: { home: '/h' }, version: () => '2.0.0', load: async () => ({ client: ({ home }) => (homes.push(home), lfs), table }) })
  return { machines: machinesOf, calls, homes }
}
const NATIVE = { name: 'native', platform: 'native', backend: 'native', state: 'ready', stores: ['shop'], sandboxes: ['3'] }
const DOCKER = { name: 'docker', platform: 'docker', backend: 'docker', state: 'ready', stores: [], sandboxes: [], image: 'sha256:afa1' }
const DEV = { name: 'dev', platform: 'lima', backend: 'namespaces', state: 'stopped', cpus: 4, memory: 8 * GIB, disk: 40 * GIB, stores: ['team'], sandboxes: [] }
const BOX = { name: 'box', platform: 'ssh', backend: 'namespaces', state: 'down', stores: [], sandboxes: [], error: 'no route to host', ssh: { host: 'ec2-3-91', user: 'ubuntu', port: 22, root: '/layerfs/data' } }

test('machines: the view is machine.list with Stores, Sandboxes and each VM\'s status', async () => {
  const { machines, calls, homes } = fake2({
    machines: [NATIVE, DOCKER, DEV, BOX],
    can: [{ platform: 'microsandbox', ready: false, missing: ['tool:msb'], version: null }, { platform: 'lima', ready: true, missing: [], version: 'limactl 2.0.1' }],
    stores: [{ name: 'shop', machine: 'native', projects: ['shop/api', 'shop/web'], size: 3e9 }, { name: 'pg', kind: 'postgresql' }],
    sandboxes: [{ name: '3', machine: 'native', project: 'shop/api', workspaces: 2 }],
    down: { box: 'ssh: connect to host ec2-3-91 port 22: No route to host' },
  })
  const v = await machines.view()
  assert.equal(v.available, true)
  assert.deepEqual(homes, ['/h'])
  assert.deepEqual(v.machines.map((m) => [m.name, m.platform, m.state]), [['native', 'native', 'ready'], ['docker', 'docker', 'ready'], ['dev', 'lima', 'stopped'], ['box', 'ssh', 'down']])
  assert.equal(v.machines[2].memory, 8 * GIB)
  assert.deepEqual(v.machines[3].ssh, { host: 'ec2-3-91', user: 'ubuntu', port: 22, identity: null, root: '/layerfs/data' })
  assert.deepEqual(v.canCreate[0], { platform: 'microsandbox', ready: false, missing: ['tool:msb'], version: null })
  // a PostgreSQL Store is on no machine: Storage shows it, not Compute
  assert.deepEqual(v.stores, [{ name: 'shop', machine: 'native', projects: 2, size: 3e9 }])
  assert.deepEqual(v.sandboxes, [{ name: '3', machine: 'native', project: 'shop/api', workspaces: 2 }])
  // native is not asked; a VM that does not answer is down with LayerFS's words
  assert.deepEqual(calls.filter((c) => c[0] === 'machine.status').map((c) => c[1]), ['docker', 'dev', 'box'])
  assert.deepEqual(v.status.dev, { name: 'dev', state: 'stopped', freeDisk: 30 * GIB, toolVersion: 'limactl 2.0.1', down: null })
  assert.equal(v.status.box.state, 'down')
  assert.match(v.status.box.down, /No route to host/)
})

test('machines: an older LayerFS has none; the view says so and every action is refused', async () => {
  const machines = new Machines({ spec: { home: '/h' }, version: () => '1.1.0', load: async () => null })
  assert.deepEqual(await machines.view(), { available: false, layerfs: '1.1.0', reason: 'This LayerFS has no machines: they come with LayerFS 2.0.' })
  for (const action of [() => machines.create({ name: 'dev', platform: 'lima' }), () => machines.connect({ name: 'b', host: 'h' }), () => machines.remove('dev'), () => machines.update('docker', {}), () => machines.moveStore('shop', 'dev')]) {
    await assert.rejects(action(), (e) => e.code === 'Unsupported' && /LayerFS 2\.0.*1\.1\.0/.test(e.message))
  }
})

test('machines: create, connect, remove or disconnect, update and move pass on what LayerFS takes', async () => {
  const { machines, calls } = fake2({ machines: [NATIVE, DOCKER, DEV, BOX] })
  await machines.create({ name: 'dev2', platform: 'lima', cpus: 4, memory: '8G', disk: '', image: 'sha256:afa1', nested: true })
  await machines.create({ name: 'fc', platform: 'firecracker', host: 'dev' })
  await machines.connect({ name: 'box2', platform: 'ssh', host: 'ec2-3-91', user: 'ubuntu', port: 2222, identity: '~/.ssh/id', root: '/layerfs/data' })
  await machines.remove('dev')
  await machines.remove('box')
  await machines.update('docker', { image: 'sha256:b', docker: '/var/run/docker.sock', bogus: 1 })
  await machines.moveStore('shop', 'dev')
  assert.deepEqual(calls.filter((c) => c[0] !== 'machine.list'), [
    ['machine.create', 'dev2', 'lima', { cpus: 4, memory: '8G', image: 'sha256:afa1', nested: true }],
    ['machine.create', 'fc', 'firecracker', { host: 'dev' }],
    ['machine.connect', 'box2', 'ec2-3-91', { user: 'ubuntu', port: 2222, identity: '~/.ssh/id', root: '/layerfs/data' }],
    ['machine.remove', 'dev'],
    ['machine.disconnect', 'box'],
    ['machine.update', 'docker', { image: 'sha256:b', docker: '/var/run/docker.sock' }],
    ['store.move', 'shop', 'dev'],
  ])
  await assert.rejects(machines.remove('native'), { code: 'InvalidInput' })
  await assert.rejects(machines.remove('nope'), { code: 'NotFound' })
  await assert.rejects(machines.create({ name: 'x', platform: 'ssh' }), { code: 'InvalidInput' })
  // layerfs#533's table has no os_image: refused here rather than sent
  await assert.rejects(machines.create({ name: 'x', platform: 'lima', os_image: 'ubuntu-24.04' }), { code: 'Unsupported' })
  const later = fake2({ machines: [NATIVE], table: [{ family: 'machine', call: 'create', options: [{ name: 'os_image' }] }] })
  await later.machines.create({ name: 'x', platform: 'lima', os_image: 'ubuntu-24.04' })
  assert.deepEqual(later.calls.at(-1), ['machine.create', 'x', 'lima', { os_image: 'ubuntu-24.04' }])
})

test('machines: entries LayerFS leaves short get their defaults', () => {
  assert.deepEqual(machineOf({ name: 'm', platform: 'apple-container' }), { name: 'm', platform: 'apple-container', backend: 'namespaces', state: 'stopped', cpus: null, memory: null, disk: null, stores: [], sandboxes: [] })
  assert.equal(machineOf({ name: 'docker', platform: 'docker' }).state, 'ready')
  assert.equal(storeOf({ name: 'pg', kind: 'postgresql' }), null)
  assert.deepEqual(storeOf({ name: 's', machine: 'dev', projects: 3, bytes: 10 }), { name: 's', machine: 'dev', projects: 3, size: 10 })
})

test('the machines routes: GET the view, POST create or connect, DELETE, update and a Store move', async (t) => {
  const { createHostServer, listen } = await import('../server.js')
  const seen = []
  const machines = new Proxy({}, { get: (_, name) => async (...args) => (seen.push([name, ...args]), { ok: name }) })
  const server = createHostServer({ token: 't', projects: {}, machines, log: () => {} })
  const url = await listen(server, 0)
  t.after(() => server.close())
  const ask = async (method, path, body) => {
    const res = await fetch(url + path, { method, headers: { authorization: 'Bearer t', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  assert.deepEqual((await ask('GET', '/api/machines')).body, { ok: 'view' })
  await ask('POST', '/api/machines', { name: 'dev', platform: 'lima' })
  await ask('POST', '/api/machines', { name: 'box', platform: 'ssh', host: 'h' })
  await ask('DELETE', '/api/machines/dev')
  await ask('POST', '/api/machines/docker/update', { image: 'x' })
  await ask('POST', '/api/machines/dev/stores', { store: 'shop' })
  assert.deepEqual(seen, [['view'], ['create', { name: 'dev', platform: 'lima' }], ['connect', { name: 'box', platform: 'ssh', host: 'h' }], ['remove', 'dev'], ['update', 'docker', { image: 'x' }], ['moveStore', 'shop', 'dev']])
})

// ---------- settings ----------

const ENV = ['LAYERFS_CONNECT_PLACEMENT', 'LAYERFS_CONNECT_VM_CPUS', 'LAYERFS_CONNECT_VM_MEMORY', 'LAYERFS_CONNECT_SSH_HOST', 'LAYERFS_CONNECT_SSH_PORT', 'LAYERFS_SSH_HOST', 'LAYERFS_PLACEMENT']
function withEnv(values, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, values)
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}
const stateDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'connect-compute-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('settings: a host home (sandbox native) keeps its Stores on this disk and opens no runtime', async (t) => {
  const dir = stateDir(t)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sandbox: 'native', bundle: '/b/macos', containerPrefix: 'lfp-' }))
  const s = withEnv({}, () => resolveSpec(dir))
  assert.equal(isHostHome(s), true)
  assert.equal(s.worker, false)
  assert.equal(s.localDir, join(dir, 'local'))
  assert.deepEqual(missing(s), [])
  const env = deploymentEnv(s, { name: 'site', volume: null })
  assert.deepEqual(env, {
    PROJECT: 'site', HOME: join(dir, 'home'), SANDBOX: 'native', NATIVE: '/b/macos/layerfs.node', DAEMON: '/b/macos/layerfs-daemon',
    LOCAL_DIR: join(dir, 'local'), STORE_PATH: join(dir, 'stores', 'site', 'store.sqlite'), IMAGE: '', IMAGE_ARCHIVE: '', CONTAINER_PREFIX: 'lfp-',
  })
  // its projects are its Store files; the runtime is refused rather than opened (on macOS it would hand clients its Docker worker)
  mkdirSync(join(dir, 'stores', 'site'), { recursive: true })
  writeFileSync(join(dir, 'stores', 'site', 'store.sqlite'), '')
  mkdirSync(join(dir, 'stores', 'half'), { recursive: true })
  assert.deepEqual(hostProjects(s).map((p) => p.name), ['site'])
  await assert.rejects(openRuntime(s), (e) => e.code === 'Unsupported')
  // the platforms the SDK allows such a home: mac on macOS, docker and linux on Linux
  const status = hostStatus(s)
  const allowed = status.platforms.filter((p) => p.allowed).map((p) => p.id)
  assert.deepEqual(allowed, process.platform === 'darwin' ? ['mac'] : process.platform === 'linux' ? ['docker', 'linux'] : [])
  assert.equal(status.platforms.length, 8)
})

test('settings: a namespaces home needs its image archive; a Linux home passes localDir and imageArchive on', (t) => {
  const dir = stateDir(t)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sandbox: 'namespaces', bundle: '/b/linux' }))
  const s = withEnv({}, () => resolveSpec(dir))
  assert.deepEqual(missing(s), ['imageArchive'])
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ bundle: '/b/linux', image: IMAGE, localDir: '/l', imageArchive: '/a.tar' }))
  const docker = withEnv({}, () => resolveSpec(dir))
  assert.equal(isHostHome(docker), false)
  assert.equal(runtimeSettings(docker).localDir, '/l')
  assert.equal(runtimeSettings(docker).imageArchive, '/a.tar')
  const env = deploymentEnv(docker, { name: 'site', volume: 'v' })
  assert.equal(env.LOCAL_DIR, '/l')
  assert.equal(env.IMAGE_ARCHIVE, '/a.tar')
})

test('settings: by default the runtime gets placement local and no vm or ssh, whatever LAYERFS_PLACEMENT says', (t) => {
  const dir = stateDir(t)
  const s = withEnv({ LAYERFS_PLACEMENT: 'vm:microsandbox' }, () => resolveSpec(dir))
  assert.equal(s.placement, 'local')
  const opened = runtimeSettings(s)
  assert.equal(opened.placement, 'local')
  assert.equal('vm' in opened, false)
  assert.equal('ssh' in opened, false)
  assert.equal(s.worker, process.platform !== 'linux')
})

test('settings: placement, vm and ssh from settings.json, else LAYERFS_CONNECT_*', (t) => {
  const dir = stateDir(t)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ placement: 'vm:ssh', vm: { memory: '4G' }, ssh: { host: 'ec2.example', identityFile: '/k/deploy' } }))
  const s = withEnv({ LAYERFS_CONNECT_VM_CPUS: '4', LAYERFS_CONNECT_VM_MEMORY: '8G', LAYERFS_CONNECT_SSH_HOST: 'other', LAYERFS_CONNECT_SSH_PORT: '2222' }, () => resolveSpec(dir))
  assert.equal(s.placement, 'vm:ssh')
  assert.equal(s.worker, false)
  assert.deepEqual(s.vm, { cpus: 4, memory: '4G' })
  assert.deepEqual(s.ssh, { host: 'ec2.example', port: 2222, identityFile: '/k/deploy' })
  const opened = runtimeSettings(s)
  assert.equal(opened.placement, 'vm:ssh')
  assert.deepEqual(opened.vm, { cpus: 4, memory: '4G' })
  assert.deepEqual(opened.ssh, { host: 'ec2.example', port: 2222, identityFile: '/k/deploy' })
  const fromEnv = withEnv({ LAYERFS_CONNECT_PLACEMENT: 'vm:microsandbox' }, () => resolveSpec(stateDir(t)))
  assert.equal(fromEnv.placement, 'vm:microsandbox')
})

test('settings: saving the Settings page keeps the vm and ssh objects', (t) => {
  const dir = stateDir(t)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ image: 'a', vm: { cpus: 4 }, ssh: { host: 'h' } }))
  writeSettings(dir, { image: 'b' })
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), { image: 'b', vm: { cpus: 4 }, ssh: { host: 'h' } })
  writeSettings(dir, { ssh: null, placement: 'vm:apple-container' })
  assert.deepEqual(readSettings(dir), { image: 'b', placement: 'vm:apple-container', vm: { cpus: 4 } })
})

test('settings: what each placement misses', () => {
  const full = spec()
  assert.deepEqual(missing(full, 'local'), [])
  assert.deepEqual(missing({ ...full, image: null }, 'local'), ['image'])
  assert.deepEqual(missing({ ...full, image: null }, 'vm:microsandbox'), [])
  assert.deepEqual(missing({ ...full, bundle: null }, 'vm:microsandbox'), ['bundle'])
  withEnv({}, () => assert.deepEqual(missing(full, 'vm:ssh'), ['host']))
  withEnv({ LAYERFS_SSH_HOST: 'box' }, () => assert.deepEqual(missing(full, 'vm:ssh'), []))
  assert.deepEqual(missing({ ...full, ssh: { host: 'h' } }, 'vm:ssh'), [])
})

test('deploymentEnv on a VM home is the runtime platform\'s, with the project', () => {
  const opened = { settings: { home: '/h' }, platform: { deploymentEnv: (settings, project) => ({ HOME: '/layerfs/home', SANDBOX: 'native', SANDBOX_BACKEND: 'namespaces', WORKER_ENDPOINT: `${settings.home}/worker/${project.name}.json` }) } }
  const env = deploymentEnv({ ...spec({ placement: 'vm:microsandbox' }), home: '/h', opened }, { name: 'shop', volume: null })
  assert.deepEqual(env, { PROJECT: 'shop', HOME: '/layerfs/home', SANDBOX: 'native', SANDBOX_BACKEND: 'namespaces', WORKER_ENDPOINT: '/h/worker/shop.json', STORE: '' })
  const local = deploymentEnv({ ...spec(), home: '/h' }, { name: 'shop', volume: 'lfc-shop-store-k2' })
  assert.equal(local.VOLUME, 'lfc-shop-store-k2')
  assert.equal(local.DOCKER, '/var/run/docker.sock')
})

// ---------- Projects.status and sandboxes over a stand-in runtime ----------

function fakeProjects(t, { status, list = [], hostSandboxes = true, sandboxList = [], vmSettings = null, placement = 'local' }) {
  const dir = stateDir(t)
  const calls = []
  const runtime = {
    settings: vmSettings ? { vm: vmSettings } : {},
    platform: hostSandboxes ? {} : { hostSandboxes: false },
    status: async () => status,
    project: { list: async () => list },
    sandbox: {
      list: async () => {
        calls.push('sandbox.list')
        if (!hostSandboxes) throw Object.assign(new Error('sandbox.list reads host Docker'), { code: 'Unsupported' })
        return sandboxList
      },
    },
    vm: { status: async () => status.vm },
    worker: { start: async (project) => calls.push(`start ${project}`) },
  }
  const logs = []
  const s = { ...spec({ placement }), state: dir, home: join(dir, 'home'), runs: join(dir, 'runs'), worker: placement === 'local', runtime: Promise.resolve(runtime) }
  const projects = new Projects({ spec: s, log: (line) => logs.push(line) })
  return { projects, calls, logs }
}

test('Projects.status: placement, sweep and worker facts of a local home; no Compute report', async (t) => {
  const status = { ...localMac(), sweep: { state: 'done', at: 'x', reclaimed: {}, failed: [] } }
  const { projects } = fakeProjects(t, { status, list: [{ name: 'shop', volume: 'v' }, { name: 'todo', store: 'team', shared: true }] })
  const s = await projects.status()
  assert.equal(s.placement, 'local')
  assert.deepEqual(s.sweep, status.sweep)
  assert.deepEqual(s.worker, { name: 'lfc-worker', state: 'running', build: 'b1', error: null, answering: true, expected: 'b1' })
  // Compute reads machines (GET /api/machines), not the status
  assert.equal('compute' in s, false)
})

test('Projects.status of a VM home: docker not-used with its detail, no worker', async (t) => {
  const status = vmStatus([running('shop')], { placement: 'vm:microsandbox', vm: { provider: 'microsandbox', placement: 'vm:microsandbox', vms: [running('shop')] } })
  const { projects } = fakeProjects(t, { status, list: [{ name: 'shop' }], hostSandboxes: false, placement: 'vm:microsandbox', vmSettings: { image: 'node:22-trixie-slim', cpus: 2, memory: '2G', storeSize: '20G' } })
  const s = await projects.status()
  assert.equal(s.placement, 'vm:microsandbox')
  assert.equal(s.docker.level, 'not-used')
  assert.match(s.docker.detail, /vm:apple-container|each project's VM/)
  assert.equal(s.worker, null)
})

test('Projects.sandboxes on a VM home: no host listing asked, records are running namespaces Sandboxes', async (t) => {
  const { projects, calls } = fakeProjects(t, { status: vmStatus([]), hostSandboxes: false, placement: 'vm:apple-container' })
  const record = { name: 'shop', volume: null }
  projects.record = async () => record
  projects.use = async (_record, fn) => fn({
    layerfs: {
      project: { list_sandboxes: async () => ({ items: [{ sandbox: '1', name: 'lfc-shop-1', image: 'local', workspaces: 1 }] }) },
      sandbox: { list_workspaces: async () => ({ items: [{ path: '/workspaces/1', branch: 'main', mounted: true }] }) },
    },
  })
  const boxes = await projects.sandboxes('shop')
  assert.deepEqual(boxes, [{ id: '1', name: 'lfc-shop-1', state: 'running', image: 'local', provider: 'vm:apple-container', runtime: 'namespaces', workspaces: [{ ws: '1:/workspaces/1', branch: 'main', path: '/workspaces/1' }] }])
  assert.deepEqual(calls, [])
})

test('Projects.sandboxes on a local home: containers tag docker, a record with no container is gone', async (t) => {
  const container = { name: 'lfc-shop-1', project: 'shop', sandbox: 1, state: 'running', running: true, image: IMAGE }
  const { projects } = fakeProjects(t, { status: localMac(), sandboxList: [container] })
  projects.record = async () => ({ name: 'shop', volume: 'v' })
  projects.use = async (_record, fn) => fn({
    layerfs: {
      project: { list_sandboxes: async () => ({ items: [{ sandbox: '1', name: 'lfc-shop-1', image: IMAGE }, { sandbox: '2', name: 'lfc-shop-2', image: IMAGE }] }) },
      sandbox: { list_workspaces: async () => ({ items: [] }) },
    },
  })
  const boxes = await projects.sandboxes('shop')
  assert.deepEqual(boxes.map((b) => [b.id, b.state, b.provider, b.runtime]), [['1', 'running', 'docker', 'docker'], ['2', 'gone', 'docker', 'docker']])
})

test('Projects.startWorker on a VM home starts each project\'s VM whose worker does not answer, or the one named', async (t) => {
  const status = vmStatus([running('shop'), running('blog', { state: 'stopped', worker: { state: 'stopped' } })])
  const { projects, calls } = fakeProjects(t, { status, hostSandboxes: false, placement: 'vm:apple-container' })
  await projects.startWorker()
  assert.deepEqual(calls, ['start blog'])
  await projects.startWorker('shop')
  assert.deepEqual(calls, ['start blog', 'start shop'])
  await assert.rejects(projects.startWorker('Bad Name'), { status: 400 })
})

test('the real runtime on a vm:microsandbox home with no project: Connect\'s settings open it and status maps', async (t) => {
  const { LayerFSRuntime } = await import('@layerfs/runtime')
  const dir = stateDir(t)
  const s = withEnv({}, () => ({ ...resolveSpec(dir), placement: 'vm:microsandbox', vm: { cpus: 3 } }))
  s.worker = false
  const runtime = await LayerFSRuntime.open({ ...runtimeSettings(s), sweep: false })
  t.after(() => runtime.close())
  s.runtime = Promise.resolve(runtime)
  const projects = new Projects({ spec: s, log: () => {} })
  const status = await projects.status()
  assert.equal(status.placement, 'vm:microsandbox')
  assert.equal(status.docker.level, 'not-used')
  assert.equal(status.worker, null)
  assert.deepEqual(status.missing, s.bundle ? [] : ['bundle'])
})
