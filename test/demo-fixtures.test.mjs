import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DemoRunner } from '../tools/demo/runner.mjs'
import { presetScript } from '../tools/demo/build.mjs'
import { presetOf, sourceFiles } from '../tools/demo/presets.mjs'
import { parseArgs } from '../tools/demo-fixtures.mjs'
import { DesktopDriver } from '../tools/demo/drivers.mjs'
import { withActivity } from '../host/activity/context.js'
import { DemoHistory } from './support/demo-history.mjs'
import { EnvironmentReset } from '../host/environment-reset.js'
import { baseProjectHistorySteps as projectHistorySteps } from '../tools/demo/recipe.mjs'

/** Unit-test stand-in only. Executable fixtures always use a real CLI. */
class Driver {
  constructor(state) {
    this.spec = { state, home: join(state, 'home-2'), daemon: '/matching/daemon' }
    this.mutations = []; this.created = 0; this.history = new DemoHistory()
    this.machine = new Map([['native', { name: 'native', state: 'ready' }], ['docker', { name: 'docker', state: 'stopped' }]])
    this.store = new Map(); this.project = new Map(); this.sandbox = new Map()
  }
  async discover() { return { identity: { commit: 'unit-test' } } }
  async invoke(argv, options = {}) {
    const [family, call, name, extra] = argv
    if (['file', 'branch', 'commit'].includes(family)) {
      if (!options.read) this.mutations.push(argv)
      return this.history.invoke(argv, options)
    }
    const missing = () => { throw Object.assign(new Error('not found'), { code: 'NotFound' }) }
    if (family === 'machine' && call === 'list' && !existsSync(join(this.spec.home, 'layerfs.json'))) writeFileSync(join(this.spec.home, 'layerfs.json'), JSON.stringify({ id: 'unit-test-home' }))
    if (family === 'machine' && call === 'platforms') return { platforms: ['native', 'docker', 'lima'].map(platform => ({ platform, ready: true, sqlite: 'worker' })) }
    if (call === 'get') { const value = this[family]?.get(name); return value ? structuredClone(value) : missing() }
    if (call === 'list') return { [family === 'machine' ? 'machines' : 'items']: [...this[family].values()].map(v => structuredClone(v)) }
    assert.equal(options.read, undefined)
    this.mutations.push(argv)
    if (call === 'create' && family !== 'sandbox') this[family].set(name, { name, created: ++this.created, state: family === 'machine' ? 'running' : 'idle', machine: 'native', projects: [] })
    else if (call === 'create' && family === 'sandbox') this.sandbox.set(extra, { name: extra, project: name, machine: argv[4], created: ++this.created, state: 'running', workspaces: [] })
    else if (call === 'start' || call === 'stop') this.machine.get(name).state = call === 'start' ? 'running' : 'stopped'
    else if (call === 'update') this.machine.get(name).daemon = argv.at(-1)
    else if (call === 'init') { this.history.init(name, extra); this.project.set(name, { project: name }); this.store.get(name.split('/')[0]).projects.push(name.split('/')[1]) }
    else if (call === 'push') this.store.get(name).machine = extra
    else if (call === 'remove' || call === 'disconnect') {
      if (family === 'store') { this.history.removeStore(name); for (const key of this.project.keys()) if (key.startsWith(`${name}/`)) this.project.delete(key) }
      this[family].delete(name)
    }
    else if (call === 'close') this.sandbox.delete(name)
    else if (call === 'mount') this.sandbox.get(name).workspaces.push({ name: argv.at(-1), branch: extra, ws: `${name}:${argv.at(-1)}` })
    else if (call === 'unmount') { const box = this.sandbox.get(name.split(':')[0]); box.workspaces = box.workspaces.filter(ws => ws.ws !== name) }
    return { kind: 'ok' }
  }
}
function setup(t, preset = 'studio', sandboxes = true) {
  const state = mkdtempSync(join(tmpdir(), 'connect-demo-test-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const driver = new Driver(state)
  return { state, driver, runner: new DemoRunner({ historyDensity: 'base', state, preset, sandboxes, driver, report() {} }) }
}

test('presets and plan describe real resources without creating state', t => {
  const f = setup(t)
  const plan = f.runner.plan()
  assert.equal(plan.machines.length, 4); assert.equal(plan.stores.length, 4); assert.equal(plan.projects, 8)
  assert.equal(plan.sandboxes, 0); assert.equal(plan.workspaces, 0)
  assert.equal(existsSync(f.runner.file), false)
  assert.equal(presetOf('starter').stores.length, 3)
  assert.throws(() => presetOf('../../wrong'), /Unknown preset/)
  assert.match(sourceFiles('website')['README.md'], /website|storefront/i)
})
test('setup is repeatable; reset reseeds data while retaining VMs; teardown restores borrowed worker', async t => {
  const f = setup(t)
  await f.runner.run('setup')
  assert.equal(f.driver.machine.size, 4); assert.equal(f.driver.store.size, 4); assert.equal(f.driver.project.size, 8); assert.equal(f.driver.sandbox.size, 0)
  const mutations = f.driver.mutations.length
  await f.runner.run('setup')
  assert.equal(f.driver.mutations.length, mutations)
  await f.runner.run('reset')
  assert.equal(f.driver.machine.size, 4); assert.equal(f.driver.project.size, 8)
  assert.equal(f.driver.mutations.filter(argv => argv[0] === 'machine' && argv[1] === 'create').length, 2)
  await f.runner.run('teardown')
  assert.equal(f.driver.machine.size, 2); assert.equal(f.driver.store.size, 0); assert.equal(f.driver.sandbox.size, 0)
  assert.equal(f.driver.machine.get('docker').state, 'stopped')
  assert.ok(existsSync(f.runner.file)); assert.ok(existsSync(join(f.state, 'logs', 'cli')))
  await f.runner.run('teardown')
  assert.equal(f.driver.machine.size, 2)
})
test('an existing ordinary home is never adopted or reset', async t => {
  const f = setup(t)
  mkdirSync(f.runner.home)
  writeFileSync(join(f.runner.home, 'layerfs.json'), '{"id":"personal-home"}')
  await assert.rejects(f.runner.run('setup'), /Refusing to adopt/)
  assert.equal(f.driver.mutations.length, 0)
  assert.equal(existsSync(f.runner.lock), false)
})
test('sandbox configuration persists across terminal invocations', async t => {
  const f = setup(t, 'native', false)
  await f.runner.run('setup')
  const next = new DemoRunner({ historyDensity: 'base', state: f.state, preset: 'native', driver: f.driver, report() {} })
  await next.run('setup')
  assert.equal(next.sandboxes, false)
  assert.equal(f.driver.sandbox.size, 0)
})
test('teardown retains a borrowed worker used by resources outside the manifest', async t => {
  const f = setup(t, 'starter', false)
  await f.runner.run('setup')
  f.driver.store.set('user-added', { name: 'user-added', machine: 'docker' })
  await f.runner.run('teardown')
  assert.equal(f.driver.machine.get('docker').state, 'running')
  assert.ok(f.driver.store.has('user-added'))
})
test('resource collisions are preserved even during teardown', async t => {
  const f = setup(t, 'native', false)
  f.driver.store.set('demo-studio', { name: 'demo-studio', created: 99, machine: 'native' })
  await assert.rejects(f.runner.run('setup'), /not confirmed/)
  await f.runner.run('teardown')
  assert.ok(f.driver.store.has('demo-studio'))
  assert.equal(f.driver.mutations.filter(argv => argv[1] === 'remove').length, 0)
})
test('an uncertain create is not replayed or treated as owned', async t => {
  const f = setup(t, 'native', false), invoke = f.driver.invoke.bind(f.driver)
  let attempts = 0
  f.driver.invoke = async (argv, options) => {
    if (argv[0] === 'store' && argv[1] === 'create') { attempts++; await invoke(argv, options); throw Object.assign(new Error('reply lost'), { code: 'Unknown', transport: 'transport-unknown' }) }
    return invoke(argv, options)
  }
  await assert.rejects(f.runner.run('setup'), /reply lost/)
  await assert.rejects(f.runner.run('setup'), /cannot replay/)
  await assert.rejects(f.runner.run('teardown'), /unconfirmed create/)
  assert.equal(attempts, 1)
  assert.ok(f.driver.store.has('demo-studio'))
})
test('a certain VM creation failure that reports vm_exists retains cleanup ownership', async t => {
  const f = setup(t), invoke = f.driver.invoke.bind(f.driver)
  f.driver.invoke = async (argv, options) => {
    const result = await invoke(argv, options)
    if (argv[0] === 'machine' && argv[1] === 'create') throw Object.assign(new Error('worker failed after VM creation'), { code: 'Failed', detail: { vm_exists: true } })
    return result
  }
  await assert.rejects(f.runner.run('setup'), /worker failed/)
  assert.ok(f.driver.machine.has('demo-build'))
  f.driver.invoke = invoke
  await f.runner.run('teardown')
  assert.equal(f.driver.machine.size, 2)
})
test('cleanup rejects a replaced home identity', async t => {
  const f = setup(t, 'native', false)
  await f.runner.run('setup')
  const count = f.driver.mutations.length
  writeFileSync(join(f.runner.home, 'layerfs.json'), '{"id":"replacement"}')
  await assert.rejects(f.runner.run('reset'), /identity changed/)
  assert.equal(f.driver.mutations.length, count)
})
test('a live operation lock prevents concurrent reset', async t => {
  const f = setup(t)
  writeFileSync(f.runner.lock, JSON.stringify({ pid: process.pid }))
  await assert.rejects(f.runner.run('setup'), /Another demo operation/)
  assert.ok(existsSync(f.runner.lock))
})
test('CLI options isolate state from the ordinary preview and reject unknown flags', () => {
  const parsed = parseArgs(['plan', '--preset', 'native', '--no-sandboxes'], { LFS_STATE: '/personal/preview', LAYERFS_CONNECT_STATE: '/personal/host' })
  assert.ok(parsed.state.endsWith('/.layerfs-connect-demo/native')); assert.equal(parsed.sandboxes, false)
  assert.throws(() => parseArgs(['setup', '--force']), /Unknown option/)
})
test('desktop operations use existing management routes and preserve preset action metadata', async () => {
  const driver = new DesktopDriver({}, () => {}), requests = []
  driver.request = async (...args) => { requests.push(args); return { ended: 1, result: { kind: 'ok' } } }
  await withActivity({ action: { id: 'preset-run' } }, async () => {
    await driver.invoke(['store', 'create', 'demo-studio'])
    await driver.invoke(['project', 'init', 'demo-studio/website', '/source'])
    await driver.invoke(['store', 'push', 'demo-studio', 'docker', '--progress'])
    await driver.invoke(['store', 'remove', 'demo-studio'])
  })
  assert.deepEqual(requests.map(r => r.slice(0, 2)), [['POST', '/api/stores'], ['POST', '/api/projects'], ['POST', '/api/stores/demo-studio/push'], ['DELETE', '/api/stores/demo-studio?confirm=demo-studio']])
})

test('cleanup verifies absence independently and stops rebuild when deletion lies', async t => {
  const f = setup(t, 'native', false)
  await f.runner.run('setup')
  const invoke = f.driver.invoke.bind(f.driver), originalCreates = f.driver.mutations.filter(a => a[0] === 'store' && a[1] === 'create').length
  f.driver.invoke = async (argv, options) => argv[0] === 'store' && argv[1] === 'remove' ? { kind: 'ok' } : invoke(argv, options)
  await assert.rejects(f.runner.run('reset'), /Cleanup verification failed/)
  assert.equal(f.runner.manifest.cleanupReceipt.verified, false)
  assert.ok(f.runner.manifest.cleanupReceipt.remaining.includes('store demo-studio'))
  assert.equal(f.driver.mutations.filter(a => a[0] === 'store' && a[1] === 'create').length, originalCreates)
  assert.equal(f.runner.manifest.resources.store['demo-studio'].owned, true)
  f.driver.invoke = invoke
  await f.runner.run('teardown')
  assert.equal(f.runner.manifest.cleanupReceipt.verified, true)
})

test('confirmation inventory changes abort reset before clearing history or removing data', async t => {
  const f = setup(t, 'native', false)
  await f.runner.run('setup')
  const plan = await f.runner.cleanupPlan(true), oldAction = f.runner.action.id
  f.driver.store.get('demo-studio').projects.push('user-created')
  await assert.rejects(f.runner.run('reset', { expectedCleanup: plan.signature }), /inventory changed/)
  assert.ok(f.driver.store.has('demo-studio'))
  assert.equal((await f.runner.activity.read({ actionId: oldAction })).items.length, 1)
})

test('cleanup reads every sandbox/workspace page and preserves foreign resources', async t => {
  const f = setup(t, 'native', true)
  await f.runner.run('setup')
  const sandbox = f.driver.sandbox.values().next().value
  sandbox.workspaces.push({ ws: `${sandbox.name}:extra`, name: 'extra' })
  f.driver.store.set('personal', { name: 'personal', machine: 'native', projects: ['important'] })
  const invoke = f.driver.invoke.bind(f.driver)
  f.driver.invoke = async (argv, options) => {
    const result = await invoke(argv, options)
    if (argv[0] === 'sandbox' && argv[1] === 'get') {
      const pos = Number(argv[argv.indexOf('--page-pos') + 1] || 0)
      return { ...result, workspaces: result.workspaces.slice(pos, pos + 1), next_page_pos: pos + 1 < result.workspaces.length ? pos + 1 : null }
    }
    return result
  }
  const result = await f.runner.run('teardown')
  assert.equal(result.cleanup.remove.workspaces.length, 3)
  assert.equal(f.driver.mutations.filter(a => a[0] === 'workspace' && a[1] === 'unmount').length, 3)
  assert.deepEqual(result.cleanup.preserved.store, ['personal'])
  assert.equal(result.cleanup.verified, true)
  assert.ok(f.driver.store.has('personal'))
})

test('unexpected resources appearing during cleanup prevent rebuild and remain untouched', async t => {
  const f = setup(t, 'native', false)
  await f.runner.run('setup')
  const invoke = f.driver.invoke.bind(f.driver)
  f.driver.invoke = async (argv, options) => {
    const result = await invoke(argv, options)
    if (argv[0] === 'store' && argv[1] === 'remove') f.driver.store.set('concurrent-data', { name: 'concurrent-data', machine: 'native' })
    return result
  }
  await assert.rejects(f.runner.run('reset'), /Unexpected: store concurrent-data/)
  assert.ok(f.driver.store.has('concurrent-data'))
  assert.equal(f.driver.store.has('demo-studio'), false)
})

test('general environment reset recursively deletes resources outside the fixture manifest', async t => {
  const f = setup(t, 'native', true)
  await f.runner.run('setup')
  f.driver.store.set('my-store', { name: 'my-store', machine: 'docker', projects: ['my-project'], kind: 'sqlite' })
  f.driver.store.set('remote-pg', { name: 'remote-pg', kind: 'postgresql', projects: ['remote-project'] })
  f.driver.machine.set('my-vm', { name: 'my-vm', state: 'running', created: 555 })
  f.driver.sandbox.set('my-sandbox', { name: 'my-sandbox', machine: 'my-vm', workspaces: [{ ws: 'my-sandbox:custom', name: 'custom' }], created: 556 })
  const reset = new EnvironmentReset({ spec: f.driver.spec, driver: f.driver })
  const plan = await reset.plan()
  assert.ok(plan.remove.stores.includes('my-store')); assert.ok(plan.remove.machines.includes('my-vm'))
  assert.deepEqual(plan.disconnect, ['remote-pg']); assert.deepEqual(plan.startMachines, ['docker'])
  const result = await reset.run({ expectedPlan: plan.signature, assertIdle: async () => {} })
  assert.equal(result.verified, true); assert.deepEqual(result.remaining, [])
  assert.equal(f.driver.store.size, 0); assert.equal(f.driver.sandbox.size, 0)
  assert.deepEqual([...f.driver.machine.keys()], ['native', 'docker']); assert.equal(f.driver.machine.get('docker').state, 'stopped')
  const steps = result.completed.map(a => a.slice(0, 2).join(' '))
  assert.ok(steps.indexOf('workspace unmount') < steps.indexOf('sandbox close'))
  assert.ok(steps.lastIndexOf('sandbox close') < steps.indexOf('store remove'))
  assert.ok(steps.lastIndexOf('store remove') < steps.indexOf('machine remove'))
  assert.equal((await f.runner.activity.read({ actionId: result.actionId })).items[0].name, 'environment.reset')
})

test('general reset refuses stale inventory and preserves old activity before destructive admission', async t => {
  const f = setup(t, 'native', false); await f.runner.run('setup')
  const reset = new EnvironmentReset({ spec: f.driver.spec, driver: f.driver }), plan = await reset.plan(), oldAction = f.runner.action.id
  f.driver.store.set('new-data', { name: 'new-data', machine: 'native', projects: [] })
  await assert.rejects(reset.run({ expectedPlan: plan.signature, assertIdle: async () => {} }), /changed since confirmation/)
  assert.ok(f.driver.store.has('new-data')); assert.ok(f.driver.store.has('demo-studio'))
  assert.equal((await f.runner.activity.read({ actionId: oldAction })).items.length, 1)
})

test('general reset cannot claim an empty environment when store removal leaves data', async t => {
  const f = setup(t, 'native', false); await f.runner.run('setup')
  const reset = new EnvironmentReset({ spec: f.driver.spec, driver: f.driver }), plan = await reset.plan(), invoke = f.driver.invoke.bind(f.driver)
  f.driver.invoke = async (argv, options) => argv[0] === 'store' && argv[1] === 'remove' ? { kind: 'ok' } : invoke(argv, options)
  await assert.rejects(reset.run({ expectedPlan: plan.signature, assertIdle: async () => {} }), /verification failed/)
  const receipt = JSON.parse(readFileSync(join(f.state, 'environment-reset.json'), 'utf8'))
  assert.equal(receipt.verified, false); assert.deepEqual(receipt.remaining, ['store demo-studio'])
})


test('CLI command plan matches actual build mutations and exact file-write inputs', async t => {
  const f = setup(t), calls = [], invoke = f.driver.invoke.bind(f.driver)
  f.driver.invoke = async (argv, options = {}) => { calls.push({ argv, input: options.input }); return invoke(argv, options) }
  const script = presetScript({ historyDensity: 'base', preset: 'studio', spec: f.driver.spec, sandboxes: true })
  assert.equal(script.dynamicReset, true)
  assert.match(script.commands[0].note, /inventory/)
  await f.runner.run('setup')
  const build = script.commands.filter(step => step.phase === 'build')
  // Independent project histories can interleave, including projects sharing
  // a Store. Preserve preparation order and each individual project's order.
  const positions = new Map()
  for (const argv of f.driver.mutations) {
    const lane = ['file', 'branch'].includes(argv[0]) ? argv[2] : argv[0] === 'machine' ? 'machines' : argv[2]?.split('/')[0]
    const position = positions.get(lane) ?? 0
    const found = build.findIndex((step, i) => i >= position && JSON.stringify(step.argv) === JSON.stringify(argv))
    assert.ok(found >= position, `Execution command missing or out of dependency order in preview: ${argv.join(' ')}`)
    positions.set(lane, found + 1)
  }
  for (const step of build.filter(step => step.input !== undefined)) {
    assert.ok(calls.some(call => JSON.stringify(call.argv) === JSON.stringify(step.argv) && call.input === step.input), `Exact stdin missing for ${step.argv.join(' ')}`)
  }
  const initializations = calls.filter(call => call.argv[0] === 'project' && call.argv[1] === 'init')
  assert.equal(initializations.length, 8)
  const firstHistory = calls.findIndex(call => call.argv[0] === 'branch' && call.argv[1] === 'fork')
  assert.ok(firstHistory > 0)
  for (const [index, call] of calls.entries()) {
    if (call.argv[0] === 'project' && call.argv[1] === 'init' || call.argv[0] === 'store' && call.argv[1] === 'push') {
      assert.ok(index < firstHistory, `${call.argv.join(' ')} must precede all project histories`)
    }
  }
  for (const call of initializations) {
    const [store, project] = call.argv[2].split('/')
    assert.equal(call.argv[3], join(f.state, 'demo-sources', store, project))
    assert.ok(existsSync(join(call.argv[3], 'README.md')))
  }
  assert.equal(calls.some(call => ['sandbox', 'workspace'].includes(call.argv[0])), false)
  assert.equal(script.configuration.daemon, '/matching/daemon')
})

test('Studio places every imported project before eight ordered histories start together', async t => {
  const f = setup(t, 'studio', false), invoke = f.driver.invoke.bind(f.driver)
  const projects = presetOf('studio').stores.flatMap(store => store.projects.map(name => `${store.name}/${name}`))
  const started = [], steps = new Map(), inFlight = new Set()
  let release, signalReady, peak = 0
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { signalReady = resolve })
  f.driver.invoke = async (argv, options = {}) => {
    if (!['branch', 'file'].includes(argv[0]) || options.read) return invoke(argv, options)
    const project = argv[2]
    assert.equal(inFlight.has(project), false, `Overlapping history mutations in ${project}`)
    inFlight.add(project); peak = Math.max(peak, inFlight.size)
    try {
      if (!steps.has(project)) {
        assert.equal(f.driver.project.size, 8, 'Every source import must finish before history starts')
        for (const store of presetOf('studio').stores) assert.equal(f.driver.store.get(store.name)?.machine, store.machine, `${store.name} must be on its final machine`)
        steps.set(project, []); started.push(project)
        if (started.length === 8) signalReady()
        await gate
      }
      steps.get(project).push([...argv])
      return await invoke(argv, options)
    } finally { inFlight.delete(project) }
  }
  const work = f.runner.run('setup')
  let timer, readinessError
  try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Eight histories did not reach the start barrier')), 2000) })]) }
  catch (error) { readinessError = error }
  finally { clearTimeout(timer); release() }
  await work
  if (readinessError) throw readinessError
  assert.equal(peak, 8)
  assert.deepEqual(started.sort(), projects.sort())
  for (const project of projects) {
    const [store, name] = project.split('/')
    assert.deepEqual(steps.get(project), projectHistorySteps(store, name).map(step => step.argv), `${project} CLI steps must preserve recipe order`)
    assert.equal(f.runner.manifest.projects[project].seeded, true)
  }
  assert.equal(existsSync(f.runner.lock), false)
})

test('Studio retains its operation lock until all admitted history calls drain after failure', async t => {
  const f = setup(t, 'studio', false), invoke = f.driver.invoke.bind(f.driver)
  const firstCalls = [], laterCalls = [], failure = Object.assign(new Error('First history fork failed'), { code: 'InvalidInput' })
  let allStarted, releaseSiblings, settled = false
  const ready = new Promise(resolve => { allStarted = resolve })
  const siblings = new Promise(resolve => { releaseSiblings = resolve })
  f.driver.invoke = async (argv, options = {}) => {
    if (!['branch', 'file'].includes(argv[0]) || options.read) return invoke(argv, options)
    if (argv[0] === 'branch' && argv[1] === 'fork' && argv[3] === 'release-0.1') {
      firstCalls.push(argv[2]); if (firstCalls.length === 8) allStarted()
      await ready
      if (argv[2] === 'demo-studio/website') throw failure
      await siblings
    } else laterCalls.push(argv)
    return invoke(argv, options)
  }
  const work = f.runner.run('setup').then(value => { settled = true; return value }, error => { settled = true; throw error })
  // Attach the rejection assertion now so an unexpectedly early failure is not unhandled.
  const rejected = assert.rejects(work, error => error === failure)
  let timer, readinessError
  try {
    await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Eight histories did not reach the failure barrier')), 2000) })])
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false)
    assert.equal(existsSync(f.runner.lock), true)
  } catch (error) { readinessError = error }
  finally { clearTimeout(timer); releaseSiblings() }
  await rejected
  if (readinessError) throw readinessError
  assert.equal(firstCalls.length, 8)
  const tasks = f.runner.manifest.presetOperation.progress.tasks
  assert.equal(tasks.filter(task => task.state === 'failed').length, 1)
  assert.equal(tasks.filter(task => task.state === 'stopped').length, 7)
  assert.equal(f.driver.concurrency, undefined, 'Load-only CLI capacity must be restored after draining')
  assert.equal(laterCalls.length, 0, 'Failure must prevent admission of subsequent history steps')
  assert.equal(existsSync(f.runner.lock), false)
  assert.equal(Object.values(f.runner.manifest.projects).some(project => project.seeded), false)
})

test('CLI command plan shows detected cleanup targets in actual recursive execution order', async t => {
  const f = setup(t, 'native', true)
  await f.runner.run('setup')
  const reset = new EnvironmentReset({ spec: f.driver.spec, driver: f.driver }), resetPlan = await reset.plan()
  const script = presetScript({ historyDensity: 'base', preset: 'native', spec: f.driver.spec, resetPlan })
  assert.equal(script.dynamicReset, false)
  const expected = script.commands.filter(step => step.phase === 'reset')
  const result = await reset.run({ expectedPlan: resetPlan.signature, assertIdle: async () => {} })
  let position = 0
  for (const argv of result.completed) {
    const found = expected.findIndex((step, i) => i >= position && JSON.stringify(step.argv) === JSON.stringify(argv))
    assert.ok(found >= position, `Cleanup command missing or out of order: ${argv.join(' ')}`)
    position = found + 1
  }
  assert.ok(expected.some(step => step.argv[0] === 'workspace' && step.argv.includes('--discard')))
})


test('a Failed project import remains inspection-required and is never replayed by setup', async t => {
  const f = setup(t, 'native', false), invoke = f.driver.invoke.bind(f.driver)
  let imports = 0
  f.driver.invoke = async (argv, options) => {
    if (argv[0] === 'project' && argv[1] === 'init') {
      imports++
      throw Object.assign(new Error('engine import outcome may be unknown'), { code: 'Failed' })
    }
    return invoke(argv, options)
  }
  await assert.rejects(f.runner.run('setup'), /outcome may be unknown/)
  assert.equal(f.runner.manifest.steps['project.init:demo-studio/website'].status, 'uncertain')
  await assert.rejects(f.runner.run('setup'), /interrupted\/uncertain outcome/)
  assert.equal(imports, 1)
})
