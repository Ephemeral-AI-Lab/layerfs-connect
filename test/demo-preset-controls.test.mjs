import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { activityRecorder } from '../host/activity/recorder.js'
import { activityGeneration, activityLease } from '../host/activity/gate.js'
import { ActivityStore } from '../host/activity/store.js'
import { PresetManager } from '../host/demo-presets/manager.js'
import { createHostServer, listen, runtimeBusy } from '../host/server.js'
import { DemoRunner } from '../tools/demo/runner.mjs'
import { buildPreset } from '../tools/demo/build.mjs'
import { guardFixtureRequest } from '../host/demo-presets/admission.js'
import { MIXED_RECIPE_VERSION } from '../tools/demo/mixed-recipe.mjs'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'connect-preset-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const action = id => ({ id, label: id, name: 'demo.setup', origin: 'user' })
async function record(recorder, id) { recorder.record(action(id), 'action.received'); recorder.record(action(id), 'action.finished', { status: 200 }); await recorder.flush() }

test('clear physically removes old activity, fences old actions and isolates other homes', async t => {
  const dir = fixture(t), recorder = activityRecorder(join(dir, 'one')), other = activityRecorder(join(dir, 'two'))
  await record(recorder, 'old'); await record(other, 'protected')
  const files = readdirSync(recorder.store.dir)
  await recorder.clear()
  assert.deepEqual(readdirSync(recorder.store.dir), [])
  recorder.record(action('old'), 'action.finished', { status: 200 })
  await record(recorder, 'fresh')
  const page = await recorder.read()
  assert.deepEqual(page.items.map(item => item.id), ['fresh']); assert.equal(page.cleared, true)
  assert.equal((await other.read()).items[0].id, 'protected')
  assert.ok(files.every(file => !readdirSync(recorder.store.dir).includes(file)))
})

test('queued CLI leases block clearing without changing history or generation', async t => {
  const state = fixture(t), recorder = activityRecorder(state)
  await record(recorder, 'keep')
  const release = activityLease(state), previous = activityGeneration(state)
  await assert.rejects(recorder.clear(), { code: 'ConnectBusy' })
  assert.equal(activityGeneration(state), previous)
  assert.equal((await recorder.read()).items[0].id, 'keep')
  release(); await recorder.clear(); assert.equal((await recorder.read()).items.length, 0)
})

test('an independent live writer rotates its shard after another process clears history', async t => {
  const state = fixture(t), independent = new ActivityStore(state), recorder = activityRecorder(state)
  await independent.append({ v: 1, at: Date.now(), seq: 1, type: 'action.received', action: action('old') })
  const old = readdirSync(independent.dir)
  await recorder.clear()
  await independent.append({ v: 1, at: Date.now(), seq: 2, type: 'action.received', action: action('new') })
  assert.ok(old.every(file => !readdirSync(independent.dir).includes(file)))
  assert.deepEqual((await recorder.read()).items.map(item => item.id), ['new'])
})

test('an independent old writer cannot resurrect an action after clear', async t => {
  const state = fixture(t), recorder = activityRecorder(state)
  const module = new URL('../host/activity/recorder.js', import.meta.url).href
  const script = `import {activityRecorder} from ${JSON.stringify(module)};
    const recorder=activityRecorder(process.argv[1]); const action={id:'old-child',name:'test',origin:'user'};
    recorder.record(action,'action.received'); await recorder.flush(); console.log('ready');
    process.stdin.once('data',async()=>{recorder.record(action,'action.finished',{status:200});await recorder.flush();process.exit(0)});`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, state], { stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  const exit = new Promise((yes, no) => { child.once('error', no); child.once('exit', code => code === 0 ? yes() : no(new Error(`writer exited ${code}`))) })
  await new Promise(resolve => createInterface({ input: child.stdout }).once('line', resolve))
  assert.equal((await recorder.read()).items[0].id, 'old-child')
  await recorder.clear(); child.stdin.end('finish'); await exit
  assert.equal((await recorder.read()).items.length, 0)
  assert.deepEqual(readdirSync(recorder.store.dir), [])
})

/** Empty-only unit adapter. Platform and provisioning proof uses the actual CLI. */
class EmptyDriver {
  constructor(spec, report = () => {}) { this.spec = { ...spec, cli: undefined }; this.report = report }
  async discover() {}
  async invoke(argv) {
    if (['store list', 'sandbox list'].some(prefix => argv.join(' ').startsWith(prefix))) return { items: [] }
    if (argv.join(' ') === 'machine platforms') return { platforms: [] }
    if (argv[0] === 'machine' && argv[1] === 'get') return { name: argv[2], state: 'ready' }
    if (argv.join(' ') === 'machine list') { mkdirSync(this.spec.home, { recursive: true }); writeFileSync(join(this.spec.home, 'layerfs.json'), '{"id":"empty-unit-home"}'); return { machines: [] } }
    throw new Error(`Unexpected call ${argv.join(' ')}`)
  }
}
function manager(t, originalBusy = () => []) {
  const root = fixture(t), state = join(root, 'original'); mkdirSync(state)
  const spec = { state, home: join(state, 'home-2'), cli: '/unit-only-cli' }
  return new PresetManager({ spec, root: join(root, 'presets'), entry: '/unused', originalBusy, driverFactory: (spec, report) => new EmptyDriver(spec, report) })
}
async function settled(manager) { await Promise.allSettled([...manager.tasks ?? []]); await new Promise(resolve => setImmediate(resolve)) }

test('preset admission deduplicates requests; reset clears history and records a fresh action', async t => {
  const m = manager(t), body = { requestId: 'first', sandboxes: false }
  const started = await m.start('empty', 'setup', body); await settled(m)
  assert.equal(started.state, 'completed'); assert.equal(m.active, 'empty')
  assert.equal((await m.start('empty', 'setup', body)).id, started.id)
  assert.equal((await m.route('GET', ['requests', body.requestId])).id, started.id)
  await assert.rejects(m.route('GET', ['requests', 'never-admitted']), { code: 'NotFound' })
  assert.equal(m.jobs.size, 1)
  await assert.rejects(m.start('empty', 'setup', { ...body, sandboxes: true }), { code: 'Conflict' })
  const recorder = activityRecorder(m.context('empty').state)
  const previousFiles = readdirSync(recorder.store.dir)
  const reset = await m.start('empty', 'reset', { requestId: 'reset', sandboxes: false, clearActivity: true, expectedRevision: m.definition('empty').revision }); await settled(m)
  assert.equal(reset.state, 'completed'); assert.equal(reset.historyCleared, true)
  assert.equal((await recorder.read({ actionId: started.actionId })).items.length, 0)
  assert.equal((await recorder.read({ actionId: reset.actionId })).items.length, 1)
  assert.ok(previousFiles.every(file => !readdirSync(recorder.store.dir).includes(file)))
})

test('stale reset confirmation, missing confirmation and busy original work preserve logs', async t => {
  const m = manager(t)
  await m.start('empty', 'setup', { requestId: 'setup', sandboxes: false }); await settled(m)
  const recorder = activityRecorder(m.context('empty').state), generation = activityGeneration(m.context('empty').state)
  await assert.rejects(m.start('empty', 'reset', { requestId: 'missing', sandboxes: false }), /Confirm/)
  await assert.rejects(m.start('empty', 'reset', { requestId: 'stale', sandboxes: false, clearActivity: true, expectedRevision: 'stale' }), { code: 'Conflict' })
  assert.equal(activityGeneration(m.context('empty').state), generation)
  assert.equal((await recorder.read()).items.length, 1)
  const busyManager = manager(t, () => ['chat execution'])
  await assert.rejects(busyManager.start('empty', 'setup', { requestId: 'busy', sandboxes: false }), /chat execution/)
  assert.equal(busyManager.jobs.size, 0)
})

test('reset preflight refusal preserves previous activity and is not replayed by reconciliation', async t => {
  const m = manager(t)
  await m.start('empty', 'setup', { requestId: 'setup', sandboxes: false }); await settled(m)
  const recorder = activityRecorder(m.context('empty').state)
  m.driverFactory = spec => ({ spec, discover: async () => { throw new Error('CLI prerequisite missing') } })
  const body = { requestId: 'failed', sandboxes: false, clearActivity: true, expectedRevision: m.definition('empty').revision }
  await assert.rejects(m.start('empty', 'reset', body), /prerequisite missing/); await settled(m)
  assert.equal((await recorder.read()).items.length, 1)
  await assert.rejects(m.start('empty', 'reset', body), /prerequisite missing/)
  assert.equal(m.latest('empty').actionId, null)
})

test('durable jobs reconcile host loss as interrupted without resubmission', async t => {
  const m = manager(t)
  m.jobs.set('interrupted', { id: 'interrupted', preset: 'native', state: 'running', requestId: 'old', actionId: 'retained' }); m.persist()
  const replacement = new PresetManager({ spec: m.spec, root: m.root, entry: '/unused' })
  assert.equal(replacement.jobs.get('interrupted').state, 'interrupted')
  assert.equal(replacement.jobs.get('interrupted').actionId, 'retained')
  assert.equal(replacement.active, 'original')
})

test('a failure after activity clearing leaves a fresh failed reset action', async t => {
  const m = manager(t)
  await m.start('empty', 'setup', { requestId: 'setup', sandboxes: false }); await settled(m)
  const old = m.latest('empty').actionId
  m.driverFactory = (spec, report) => {
    const driver = new EmptyDriver(spec, report)
    let discovery = 0
    driver.discover = async () => { if (++discovery > 1) throw new Error('CLI ended after admission') }
    return driver
  }
  const job = await m.start('empty', 'reset', { requestId: 'after-clear', sandboxes: false, clearActivity: true, expectedRevision: m.definition('empty').revision }); await settled(m)
  assert.equal(job.state, 'failed'); assert.equal(job.historyCleared, true)
  const recorder = activityRecorder(m.context('empty').state)
  assert.equal((await recorder.read({ actionId: old })).items.length, 0)
  assert.equal((await recorder.read({ actionId: job.actionId })).items[0].status, 'failed')
})

test('a failed physical clear publishes the fence and reports irreversible history loss', async t => {
  const state = fixture(t), recorder = activityRecorder(state)
  await record(recorder, 'old')
  const files = recorder.store.files
  recorder.store.files = async () => { throw new Error('injected directory failure') }
  await assert.rejects(recorder.clear(), e => e.activityCleared === true && /directory failure/.test(e.message))
  recorder.store.files = files
  await record(recorder, 'fresh')
  assert.deepEqual((await recorder.read()).items.map(item => item.id), ['fresh'])
})

test('host requests honor another process fixture lock and allow its correlated desktop calls', async t => {
  const state = fixture(t), lock = join(state, 'demo-fixtures.lock')
  // The parent is a live, different PID without launching unrelated work.
  writeFileSync(lock, JSON.stringify({ pid: process.ppid, actionId: 'fixture-action' }))
  assert.throws(() => guardFixtureRequest(state, 'POST', '/api/stores', 'other-action'), { code: 'ConnectBusy' })
  assert.doesNotThrow(() => guardFixtureRequest(state, 'GET', '/api/storage'))
  assert.doesNotThrow(() => guardFixtureRequest(state, 'POST', '/api/stores', 'fixture-action'))
  assert.doesNotThrow(() => guardFixtureRequest(state, 'GET', '/api/demo-runtime'))
  assert.doesNotThrow(() => guardFixtureRequest(state, 'GET', '/api/cli-activity/old'))
})

test('runtime admission sees jobs and agents between CLI processes', () => {
  const result = runtimeBusy({ projects: { inits: new Map([['job', {}]]) }, storage: { jobs: new Map([['move', {}]]) }, doctor: { jobs: new Map([['audit', { state: 'queued' }]]) }, agents: () => ({ records: new Map([['chat', { state: 'running' }]]) }), runs: () => ({ queue: ['launch'] }) })
  assert.equal(result.length, 5)
})

test('the authenticated gateway keeps preset APIs on the owner and resource views on the active home', async t => {
  const m = manager(t)
  const child = createHostServer({ token: 'child-token', projects: { status: () => ({ home: 'native-demo' }) } })
  const childUrl = await listen(child)
  m.context('native').endpoint = Promise.resolve({ url: childUrl, token: 'child-token' })
  m.active = 'native'
  const gateway = createHostServer({ token: 'owner-token', projects: { status: () => ({ home: 'original' }) }, presets: m })
  const gatewayUrl = await listen(gateway)
  t.after(async () => { m.endStreams(); await Promise.all([new Promise(done => gateway.close(done)), new Promise(done => child.close(done))]) })
  const request = async (path, token = 'owner-token') => fetch(gatewayUrl + path, { headers: { authorization: `Bearer ${token}` } })
  assert.equal((await request('/api/status', 'child-token')).status, 401)
  assert.deepEqual(await (await request('/api/status')).json(), { home: 'native-demo' })
  assert.equal((await (await request('/api/demo-presets')).json()).active, 'native')
  await m.activate('original')
  assert.deepEqual(await (await request('/api/status')).json(), { home: 'original' })
})

test('running presets keep page reads live while rejecting conflicting changes', async t => {
  const m = manager(t)
  let finish
  const hold = new Promise(resolve => { finish = resolve })
  m.driverFactory = (spec, report) => {
    const driver = new EmptyDriver(spec, report), invoke = driver.invoke.bind(driver)
    driver.invoke = async argv => { if (argv.join(' ') === 'machine platforms') await hold; return invoke(argv) }
    return driver
  }
  const child = createHostServer({ token: 'child', projects: { status: () => ({ home: 'live-preset' }) }, machines: { view: () => ({ machines: [{ name: 'native', state: 'ready' }] }) }, storage: { view: () => ({ stores: [] }) } })
  const childUrl = await listen(child)
  const gateway = createHostServer({ token: 'owner', projects: {}, presets: m })
  const url = await listen(gateway)
  t.after(async () => { finish(); await settled(m); m.endStreams(); await Promise.all([new Promise(done => gateway.close(done)), new Promise(done => child.close(done))]) })
  await m.start('empty', 'setup', { requestId: 'live-reads', sandboxes: false })
  m.context('empty').endpoint = Promise.resolve({ url: childUrl, token: 'child' })
  const headers = { authorization: 'Bearer owner' }
  for (const path of ['/api/status', '/api/machines', '/api/storage']) {
    const res = await fetch(url + path, { headers }); assert.equal(res.status, 200, path); await res.json()
  }
  const mutation = await fetch(url + '/api/stores', { method: 'POST', headers })
  assert.equal(mutation.status, 409)
  assert.equal(m.latest('empty').state, 'running')
})

test('a preset observer serves reads and cannot perform mutations even with its own token', async t => {
  let mutations = 0
  const server = createHostServer({ token: 'observer', readOnly: true, projects: { status: () => ({ readable: true }), create: () => { mutations++; return {} } } })
  const url = await listen(server)
  t.after(() => new Promise(done => server.close(done)))
  const headers = { authorization: 'Bearer observer' }
  assert.deepEqual(await (await fetch(url + '/api/status', { headers })).json(), { readable: true })
  assert.equal((await fetch(url + '/api/projects', { method: 'POST', headers })).status, 409)
  assert.equal(mutations, 0)
})

test('switching environments detaches the live event stream before publishing more progress', async t => {
  // Isolate an unhandled ServerResponse error: it must not kill a real preview.
  const module = new URL('../host/server.js', import.meta.url).href
  const script = `
    import {EventEmitter} from 'node:events';
    import {createHostServer,listen} from ${JSON.stringify(module)};
    import {PresetManager} from ${JSON.stringify(new URL('../host/demo-presets/manager.js', import.meta.url).href)};
    import {activityRecorder} from ${JSON.stringify(new URL('../host/activity/recorder.js', import.meta.url).href)};
    const presets=new EventEmitter(); presets.mutations=0; presets.forward=async()=>false;
    presets.route=async()=>{presets.emit('environment');presets.emit('event',{type:'demo-preset',phase:'Starting'});return {accepted:true}};
    const server=createHostServer({token:'fixture',presets,projects:{status:()=>({alive:true})}});
    const url=await listen(server);const headers={authorization:'Bearer fixture'};
    const stream=await fetch(url+'/api/events?token=fixture');const reader=stream.body.getReader();await reader.read();
    const result=await fetch(url+'/api/demo-presets/native/run',{method:'POST',headers});
    if(!result.ok)throw new Error('Preset admission failed');await result.json();
    await new Promise(resolve=>setImmediate(resolve));
    const status=await fetch(url+'/api/status',{headers});if(!(await status.json()).alive)throw new Error('Host did not survive');
    if(presets.listenerCount('event')!==0)throw new Error('Ended stream still observes progress');
    await reader.cancel();await new Promise(resolve=>server.close(resolve));
    const state=${JSON.stringify(fixture(t))};
    const manager=new PresetManager({spec:{state,home:state+'/home-2'},root:state+'/presets',entry:'/unused'});
    manager.active='empty';manager.jobs.set('running',{state:'running',preset:'empty'});
    const running=createHostServer({token:'fixture',presets:manager,projects:{status:()=>({alive:true})}});
    const runningUrl=await listen(running);
    const progress=await fetch(runningUrl+'/api/events?token=fixture');const progressReader=progress.body.getReader();await progressReader.read();
    manager.endStreams();manager.emit('event',{type:'demo-preset',phase:'Next progress'});
    const recorder=activityRecorder(manager.context('empty').state);
    recorder.record({id:'new-action',name:'test',origin:'user'},'action.received');await recorder.flush();
    if(manager.listenerCount('event')!==0||recorder.listenerCount('event')!==0)throw new Error('Progress observers survived stream closure');
    manager.active='original';manager.jobs.clear();
    const healthy=await fetch(runningUrl+'/api/status',{headers});if(!(await healthy.json()).alive)throw new Error('Progress stream killed the host');
    await progressReader.cancel();await new Promise(resolve=>running.close(resolve));console.log('survived');
  `
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 10000 })
  assert.match(result.stdout, /survived/)
})

test('cleanup plans expose actual resources and teardown has a verified durable receipt', async t => {
  const m = manager(t)
  await m.start('empty', 'setup', { requestId: 'setup-plan', sandboxes: false }); await settled(m)
  const plan = await m.route('GET', ['empty', 'teardown-plan'])
  assert.deepEqual(plan.remove, { stores: [], sandboxes: [], machines: [], workspaces: [] })
  const recorder = activityRecorder(m.context('empty').state), old = m.latest('empty').actionId
  const job = await m.route('POST', ['empty', 'teardown'], { requestId: 'remove', sandboxes: false, expectedRevision: plan.revision, expectedCleanup: plan.signature }); await settled(m)
  assert.equal(job.state, 'completed'); assert.equal(job.cleanup.verified, true)
  assert.equal(job.command, 'teardown')
  assert.equal((await recorder.read({ actionId: old })).items.length, 1)
})

test('Clear history is authenticated, environment-scoped, fenced and refuses active work', async t => {
  const m = manager(t), original = activityRecorder(m.spec.state)
  await record(original, 'ordinary-history')
  await m.start('empty', 'setup', { requestId: 'clear-setup', sandboxes: false }); await settled(m)
  const demo = activityRecorder(m.context('empty').state)
  const server = createHostServer({ token: 'clear-token', projects: { status: () => ({}) }, presets: m, activity: original })
  const url = await listen(server); t.after(() => new Promise(resolve => server.close(resolve)))
  const request = (path, body, token = 'clear-token') => fetch(`${url}/api/cli-activity/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  let info = await (await request('state')).json()
  assert.equal(info.environment, 'empty'); assert.equal(info.busy, false)
  const body = { confirm: true, home: info.home, generation: info.generation }
  assert.equal((await request('clear', body, 'wrong')).status, 401)
  assert.equal((await request('clear', { ...body, home: m.spec.home })).status, 409)
  const release = activityLease(m.context('empty').state)
  assert.equal((await (await request('state')).json()).busy, true)
  assert.equal((await request('clear', body)).status, 409)
  release()
  assert.equal((await request('clear', body)).status, 200)
  assert.equal((await demo.read()).items.length, 0)
  assert.equal((await original.read()).items[0].id, 'ordinary-history')
  info = await (await request('state')).json()
  assert.ok(info.clearedAt > 0); assert.notEqual(info.generation, body.generation)
  assert.equal((await request('clear', body)).status, 409)
  await record(demo, 'after-clear')
  assert.equal((await demo.read()).items[0].id, 'after-clear')
  m.jobs.set('active', { id: 'active', preset: 'empty', state: 'running' })
  assert.equal((await request('clear', { confirm: true, home: info.home, generation: info.generation })).status, 409)
})

test('general reset works for the original home without a fixture manifest', async t => {
  const m = manager(t)
  mkdirSync(m.spec.home, { recursive: true }); writeFileSync(join(m.spec.home, 'layerfs.json'), '{"id":"empty-unit-home"}')
  const original = activityRecorder(m.spec.state); await record(original, 'before-general-reset')
  const plan = await m.environmentPlan('original')
  const job = await m.resetEnvironment('original', { requestId: 'original-reset', expectedPlan: plan.signature, confirm: true, rebuild: false, sandboxes: false }); await settled(m)
  assert.equal(job.state, 'completed'); assert.equal(job.cleanup.verified, true); assert.equal(job.historyCleared, true)
  assert.equal((await original.read({ actionId: 'before-general-reset' })).items.length, 0)
  assert.equal((await original.read({ actionId: job.actionId })).items.length, 1)
  assert.equal(m.list().original.job.id, job.id)
})

test('general reset keeps its receipt when optional preset rebuild completes', async t => {
  const m = manager(t)
  await m.start('empty', 'setup', { requestId: 'initial-empty', sandboxes: false }); await settled(m)
  const plan = await m.environmentPlan('empty')
  const input = { requestId: 'general-rebuild', expectedPlan: plan.signature, confirm: true, rebuild: true, sandboxes: false }
  const job = await m.resetEnvironment('empty', input); await settled(m)
  assert.equal(job.state, 'completed'); assert.equal(job.cleanup.verified, true); assert.equal(job.presetVerified, true)
  assert.ok(job.rebuildActionId); assert.notEqual(job.rebuildActionId, job.actionId)
  assert.equal(m.definition('empty').job.id, job.id)
  assert.equal((await m.resetEnvironment('empty', input)).id, job.id)
})


test('first Build safely initializes private home, resets it and reports persisted real progress', async t => {
  const m = manager(t), updates = []
  m.on('event', event => { const job = m.jobs.get(event.jobId); if (job?.progress) updates.push({ ...job.progress }) })
  const plan = await m.route('GET', ['empty', 'build-plan-no-sandboxes'])
  assert.equal(m.definition('empty').initialized, true)
  const job = await m.resetEnvironment('empty', { requestId: 'fresh-build', expectedPlan: plan.signature, confirm: true, rebuild: true, sandboxes: false })
  await settled(m)
  assert.equal(job.state, 'completed'); assert.equal(job.cleanup.verified, true); assert.equal(job.presetVerified, true)
  assert.deepEqual(job.actionIds, [job.actionId, job.rebuildActionId])
  assert.ok(updates.some(p => p.stage === 'resetting'))
  assert.ok(updates.some(p => p.stage === 'building'))
  assert.deepEqual(job.progress, { stage: 'verifying', completed: 0, total: 0, label: 'Preset verified' })
  assert.ok(updates.every(p => p.total === null || p.completed <= p.total))
  const resetProgress = updates.filter(p => p.stage === 'resetting' && p.total !== null)
  assert.ok(resetProgress.every((p, i) => i === 0 || p.completed / p.total >= resetProgress[i - 1].completed / resetProgress[i - 1].total))
  const persisted = JSON.parse(readFileSync(m.file, 'utf8')).find(row => row.id === job.id)
  assert.deepEqual(persisted.progress, job.progress)
})

test('Build preparation refuses a populated home without its preset manifest', async t => {
  const m = manager(t), context = m.context('empty')
  mkdirSync(context.spec.home, { recursive: true }); writeFileSync(join(context.spec.home, 'layerfs.json'), '{"id":"foreign-home"}')
  await assert.rejects(m.route('GET', ['empty', 'build-plan']), /Refusing to adopt/)
  assert.equal(existsSync(join(context.state, 'demo-fixtures.json')), false)
  assert.equal(JSON.parse(readFileSync(join(context.spec.home, 'layerfs.json'), 'utf8')).id, 'foreign-home')
})

test('View script returns actual shared build source and options without initializing the home', async t => {
  const m = manager(t)
  const script = await m.route('GET', ['native', 'script-no-sandboxes'])
  assert.match(script.command, /demo-fixtures.mjs build/); assert.match(script.command, /--no-sandboxes/)
  assert.equal(script.configuration.sandboxes, false)
  const source = script.files.find(file => file.path === 'tools/demo/build.mjs')
  assert.equal(source.source, readFileSync(new URL('../tools/demo/build.mjs', import.meta.url), 'utf8'))
  assert.ok(script.files.some(file => file.path === 'host/environment-reset.js'))
  assert.equal(existsSync(m.context('native').state), false)
  assert.equal(m.definition('native').projectGroups[0].projects.length, 2)
  assert.deepEqual(m.definition('studio').machineDefinitions.find(machine => machine.name === 'demo-build'), { name: 'demo-build', platform: 'lima', cpus: 2, memory: '4G', disk: '20G' })
})

test('Build rechecks prerequisites before clearing history or beginning reset', async t => {
  const m = manager(t)
  const plan = await m.buildPlan('empty', false)
  const recorder = activityRecorder(m.context('empty').state)
  await record(recorder, 'keep-on-preflight-failure')
  const originalFactory = m.driverFactory
  m.driverFactory = (spec, report) => {
    const driver = originalFactory(spec, report), invoke = driver.invoke.bind(driver)
    driver.invoke = argv => argv.join(' ') === 'machine platforms' ? Promise.reject(new Error('Platform check failed')) : invoke(argv)
    return driver
  }
  await assert.rejects(m.resetEnvironment('empty', { requestId: 'failed-build', expectedPlan: plan.signature, confirm: true, rebuild: true, sandboxes: false }), /Platform check failed/)
  await settled(m)
  const job = m.latest('empty')
  assert.equal(job.state, 'failed'); assert.equal(job.historyCleared, false)
  assert.equal(job.progress.stage, 'checking')
  assert.equal((await recorder.read({ actionId: 'keep-on-preflight-failure' })).items.length, 1)
})


test('Build holds one fixture lock across verified cleanup and setup', async t => {
  const m = manager(t), plan = await m.buildPlan('empty', false), context = m.context('empty')
  let betweenPhases = false, duringSetup = false
  const result = await buildPreset({ spec: context.spec, preset: 'empty', driver: new EmptyDriver(context.spec), sandboxes: false, expectedPlan: plan.signature, assertIdle: async () => {},
    onCleanup: async receipt => {
      betweenPhases = true; assert.equal(receipt.verified, true)
      const lease = JSON.parse(readFileSync(join(context.state, 'demo-fixtures.lock'), 'utf8'))
      assert.equal(lease.actionId, receipt.actionId)
      const competitor = new DemoRunner({ state: context.state, preset: 'empty', driver: new EmptyDriver(context.spec), sandboxes: false, report: () => {} })
      await assert.rejects(competitor.run('setup'), /Another demo operation is running/)
    },
    onBuildReady: action => {
      duringSetup = true
      const lease = JSON.parse(readFileSync(join(context.state, 'demo-fixtures.lock'), 'utf8'))
      assert.equal(lease.actionId, action.id)
    },
  })
  assert.equal(betweenPhases, true); assert.equal(duringSetup, true); assert.equal(result.presetVerified, true)
  assert.equal(existsSync(join(context.state, 'demo-fixtures.lock')), false)
})

test('Build refuses a replaced home identity before clearing activity or resources', async t => {
  const m = manager(t)
  const plan = await m.buildPlan('empty', false), context = m.context('empty'), recorder = activityRecorder(context.state)
  await record(recorder, 'preserve-replaced-home-history')
  writeFileSync(join(context.spec.home, 'layerfs.json'), '{"id":"replacement-home"}')
  await assert.rejects(m.resetEnvironment('empty', { requestId: 'replaced-home-build', expectedPlan: plan.signature, confirm: true, rebuild: true, sandboxes: false }), /home identity changed/)
  await settled(m)
  assert.equal(m.latest('empty').historyCleared, false)
  assert.equal((await recorder.read({ actionId: 'preserve-replaced-home-history' })).items.length, 1)
})

test('Build failure after cleanup retains its verified cleanup receipt and releases the lock', async t => {
  const m = manager(t), plan = await m.buildPlan('empty', false), context = m.context('empty')
  let cleanup
  await assert.rejects(buildPreset({ spec: context.spec, preset: 'empty', driver: new EmptyDriver(context.spec), sandboxes: false, expectedPlan: plan.signature, assertIdle: async () => {},
    onCleanup: receipt => { cleanup = receipt },
    onBuildReady: () => { throw new Error('Setup could not continue') },
  }), /Setup could not continue/)
  assert.equal(cleanup.verified, true)
  const receipt = JSON.parse(readFileSync(join(context.state, 'environment-reset.json'), 'utf8'))
  assert.equal(receipt.verified, true); assert.equal(receipt.error, undefined)
  assert.equal(existsSync(join(context.state, 'demo-fixtures.lock')), false)
})


test('first Build initializes the home through a mutation before prerequisite read calls', async t => {
  const m = manager(t), calls = []
  m.driverFactory = (spec, report) => {
    const driver = new EmptyDriver(spec, report), invoke = driver.invoke.bind(driver)
    driver.invoke = async (argv, options = {}) => {
      calls.push({ argv, read: options.read === true })
      if (options.read && !existsSync(join(spec.home, 'layerfs.json'))) throw new Error('LayerFS home is not initialized; reads will not create it')
      return invoke(argv)
    }
    return driver
  }
  const plan = await m.buildPlan('empty', false)
  assert.equal(plan.homeId, 'empty-unit-home')
  assert.deepEqual(calls[0], { argv: ['machine', 'list'], read: false })
  assert.deepEqual(calls[1], { argv: ['machine', 'platforms'], read: true })
  assert.equal(m.definition('empty').initialized, true)
})

test('Mixed preview pages bind the execution mode and expose real workspace commands without initializing', async t => {
  const m = manager(t)
  const query = new URLSearchParams({ executionMode: 'mixed', offset: '0', limit: '100', kind: 'project', name: 'demo-studio/design' })
  const first = await m.route('GET', ['studio', 'script'], undefined, query)
  assert.equal(first.configuration.executionMode, 'mixed')
  assert.match(first.command, /--execution-mode mixed/)
  assert.ok(first.commands.some(step => step.argv[0] === 'sandbox' && step.argv[1] === 'create'))
  assert.ok(first.commands.some(step => step.argv[0] === 'workspace' && step.argv[1] === 'exec'))
  query.set('executionMode', 'filesystem'); query.set('snapshot', first.snapshot)
  await assert.rejects(m.route('GET', ['studio', 'script'], undefined, query), { code: 'Conflict' })
  assert.equal(existsSync(m.context('studio').state), false)
})

test('Mixed build cannot consume a Filesystem reset signature', async t => {
  const m = manager(t), plan = await m.buildPlan('empty', false), context = m.context('empty')
  await assert.rejects(buildPreset({ spec: context.spec, preset: 'empty', driver: new EmptyDriver(context.spec), sandboxes: false, executionMode: 'mixed', expectedPlan: plan.signature }), { code: 'Conflict' })
  assert.equal(existsSync(join(context.state, 'environment-reset.json')), false)
})

test('Invalid execution mode is rejected before preparing or starting an operation', async t => {
  const m = manager(t)
  await assert.rejects(m.buildPlan('studio', false, 'invalid'), { code: 'InvalidInput' })
  await assert.rejects(m.route('GET', ['studio', 'script'], undefined, new URLSearchParams({ executionMode: 'invalid' })), { code: 'InvalidInput' })
  assert.equal(existsSync(m.context('studio').state), false)
})

test('A verified Filesystem library does not become Ready when Mixed is selected', async t => {
  const m = manager(t)
  await m.start('empty', 'setup', { requestId: 'mode-ready', sandboxes: false }); await settled(m)
  assert.equal(m.definition('empty').contentReady, true)
  assert.equal(m.definition('empty', 'mixed').contentReady, false)
  assert.equal(m.definition('empty', 'mixed').settings.executionMode, 'filesystem')
})

test('Mixed readiness requires the current mount-session recipe without invalidating Filesystem', async t => {
  const m = manager(t)
  await m.start('empty', 'setup', { requestId: 'session-version-ready', sandboxes: false }); await settled(m)
  const file = join(m.context('empty').state, 'demo-fixtures.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(m.definition('empty').contentReady, true)
  manifest.executionMode = 'mixed'
  writeFileSync(file, JSON.stringify(manifest))
  assert.equal(m.definition('empty', 'mixed').contentReady, false)
  manifest.mixedRecipeVersion = MIXED_RECIPE_VERSION
  writeFileSync(file, JSON.stringify(manifest))
  assert.equal(m.definition('empty', 'mixed').contentReady, true)
})
