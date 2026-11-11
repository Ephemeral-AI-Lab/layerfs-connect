import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execute } from '../cli/spawn.js'
import { parse, stringify } from '../cli/json.js'
import { outcome } from '../cli/outcome.js'
import { client } from '../cli/calls.js'
const temporary = (t) => { const home = mkdtempSync(join(tmpdir(), 'connect-cli-test-')); t.after(() => rmSync(home, { recursive: true, force: true })); return home }
test('unsafe i64 and binary values retain exact bytes', () => {
  const value = parse('{"n":9223372036854775807,"small":12,"bytes":{"base64":"AP8="}}')
  assert.equal(value.n, 9223372036854775807n)
  assert.equal(value.small, 12)
  assert.equal(JSON.parse(stringify(value)).n.decimal, '9223372036854775807')
  assert.equal(value.bytes.base64, 'AP8=')
})
test('outcomes distinguish refusal, incompatible and transport loss', () => {
  assert.deepEqual(outcome({ code: 0, result: { ok: true } }), { ok: true })
  assert.throws(() => outcome({ code: 125, refusal: { code: 'Busy', message: 'busy' } }), { code: 'Busy', transport: 'refusal' })
  assert.throws(() => outcome({ code: 2 }), { code: 'CliIncompatible', transport: 'usage-incompatible' })
  for (const value of [{ code: 125 }, { code: 0 }, { signal: 'SIGTERM' }, { code: 0, result: {}, malformed: true }]) assert.throws(() => outcome(value), { code: 'Unknown', transport: 'transport-unknown' })
})
test('missing home read never creates its directory', async (t) => {
  const root = temporary(t), home = join(root, 'missing')
  await assert.rejects(execute({ home, cli: process.execPath }, ['-e', 'process.exit(0)'], { read: true }), { code: 'Unavailable' })
  assert.equal(existsSync(home), false)
})
test('no PATH binary fallback', () => {
  assert.throws(() => execute({ cli: 'layerfs', home: '/tmp' }, []), { code: 'CliUnavailable' })
})
test('framed final requires complete process and prevents duplicate final output', async (t) => {
  const home = temporary(t); writeFileSync(join(home, 'layerfs.json'), '{}')
  const spec = { home, cli: process.execPath }
  const frames = []
  const result = await execute(spec, ['-e', `console.log(JSON.stringify({stream:'stdout',bytes:{base64:'AP8='}}));console.log(JSON.stringify({result:{exit_code:125,stdout:'duplicate'}}))`], { events: true, onFrame: (frame) => frames.push(frame) })
  assert.equal(result.exit_code, 125)
  assert.equal(frames.filter((frame) => frame.stream).length, 1)
  await assert.rejects(execute(spec, ['-e', `console.log('{"result":{}}');console.log('{"result":{}}')`], { events: true }), { code: 'Unknown' })
  await assert.rejects(execute(spec, ['-e', `console.log('{"stream":"stdout","bytes":"x"}')`], { events: true }), { code: 'Unknown' })
})

test('Stop admission remains available when four exec slots are occupied', async (t) => {
  const home = temporary(t), cli = join(home, 'fake-cli'), release = join(home, 'release')
  writeFileSync(cli, `#!${process.execPath}\nconst fs=require('node:fs');const p=${JSON.stringify(home)}+'/release';if(process.argv[3]==='exec-cancel'){fs.writeFileSync(p,'');console.log('{"outcome":"cancelled"}')}else{const t=setInterval(()=>{if(fs.existsSync(p)){clearInterval(t);console.log('{}')}},10);fs.writeFileSync(${JSON.stringify(home)}+'/ready-'+process.pid,'');setTimeout(()=>process.exit(1),4000).unref()}\n`)
  chmodSync(cli, 0o700)
  const pids = []
  const holds = Array.from({ length: 4 }, () => execute({ home, cli }, ['workspace', 'exec'], { timeout: 5000, onSpawn: child => { pids.push(child.pid) } }))
  // Install rejection handlers before waiting for fixture readiness. Failed
  // assertions must not leave detached children or unhandled CLI refusals.
  const settledHolds = Promise.allSettled(holds)
  let queued, queuedSpawned = false
  try {
    const deadline = Date.now() + 5000
    while (pids.length !== 4 || !pids.every(pid => existsSync(join(home, `ready-${pid}`)))) {
      assert.ok(Date.now() < deadline, 'all four exec fixtures must initialize within the existing hold bound')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    queued = execute({ home, cli }, ['workspace', 'exec'], { beforeSpawn: () => { throw Object.assign(new Error('stopped'), { code: 'QueuedStop' }) }, onSpawn: () => { queuedSpawned = true } }).catch(error => error.code)
    assert.equal((await execute({ home, cli }, ['workspace', 'exec-cancel'], { timeout: 2000 })).outcome, 'cancelled')
    const results = await settledHolds
    assert.ok(results.every(result => result.status === 'fulfilled'), 'all held exec calls settle normally after cancellation')
    assert.equal(await queued, 'QueuedStop')
    assert.equal(queuedSpawned, false)
  } finally {
    writeFileSync(release, '')
    await settledHolds
    await queued
  }
})

test('management sub-read failure retains the previous inventory with its error', async () => {
  const { Machines } = await import('../machines.js')
  let fail = false, platformReads = 0
  const lfs = {machine:{list:async()=>({machines:[]}),platforms:async()=>{platformReads++;return {platforms:[]}}},store:{list:async()=>{if(fail)throw Object.assign(new Error('lost'),{code:'Unavailable'});return {items:[{name:'saved',machine:'native',state:'idle',projects:[]}]}}},sandbox:{list:async()=>({items:[],next_page_pos:null})}}
  const machines = new Machines({spec:{},client:lfs})
  assert.equal((await machines.view()).stores[0].name,'saved')
  fail=true
  const stale=await machines.view()
  assert.equal(stale.stores[0].name,'saved')
  assert.equal(stale.readErrors.stores.error.code,'Unavailable')
  assert.equal(platformReads,1)
})

test('saved reads of one Store wait without occupying slots needed by other Stores', async (t) => {
  const home = temporary(t), cli = join(home, 'store-reader')
  writeFileSync(join(home, 'layerfs.json'), '{}')
  writeFileSync(cli, `#!${process.execPath}
const fs = require('node:fs'); const [store, mode] = process.argv.slice(2)
const lock = process.env.LAYERFS_HOME + '/' + store + '.reading'
if (mode === 'release') { fs.writeFileSync(lock + '.release', ''); console.log('{}'); return }
try { fs.writeFileSync(lock, '', {flag:'wx'}) } catch { console.error(JSON.stringify({code:'Failed',message:'overlapping Store read'})); process.exit(125) }
const finish = () => { fs.unlinkSync(lock); console.log('{}') }
if (mode === 'hold') { const timer = setInterval(() => { if(fs.existsSync(lock + '.release')) { clearInterval(timer); finish() } }, 10); setTimeout(() => process.exit(1), 4000).unref() } else finish()
`)
  chmodSync(cli, 0o700)
  const spec = { home, cli }
  let ready
  const started = new Promise(resolve => { ready = resolve })
  const first = execute(spec, ['studio', 'hold'], { read: true, storeRead: 'studio', onSpawn: ready })
  await started
  // The held child creates its lock before answering this independent probe.
  while (!existsSync(join(home, 'studio.reading'))) await new Promise(resolve => setTimeout(resolve, 10))
  const waiting = Array.from({ length: 5 }, () => execute(spec, ['studio', 'read'], { read: true, storeRead: 'studio' }))
  const all = Promise.all([first, ...waiting])
  // Another Store must get through even when >4 reads are waiting on studio.
  await execute(spec, ['other', 'read'], { read: true, storeRead: 'other', timeout: 2000 })
  await execute(spec, ['studio', 'release'], { timeout: 2000 })
  await all
  // A refusal must release admission for the next read too.
  await assert.rejects(execute(spec, ['studio', 'read'], { read: true, storeRead: 'studio', beforeSpawn() { throw new Error('blocked') } }), /blocked/)
  await execute(spec, ['studio', 'read'], { read: true, storeRead: 'studio' })
})

test('storage reports send JSON stdin and coalesce only identical snapshot populations', async t => {
  const home = temporary(t), cli = join(home, 'storage-report-cli')
  writeFileSync(join(home, 'layerfs.json'), '{}')
  const required = ['workspace.exec_cancel', 'branch.commits', 'branch.get_commit', 'store.stats', 'project.stats', 'file.revision'].map(name => { const [family, call] = name.split('.'); return { family, call, args: [], options: [] } })
  const help = { calls: [...required, { family: 'store', call: 'storage_report', args: [{ name: 'name', kind: 'name' }, { name: 'snapshots', kind: 'json' }], options: [{ name: 'max_objects', kind: 'int' }] }], commands: [], switches: [{ name: '--events', calls: ['workspace.exec'] }] }
  const identity = { commit: 'a'.repeat(40), dirty: true, features: [] }
  writeFileSync(cli, `#!${process.execPath}
const [family, method] = process.argv.slice(2)
if (family === '--version') console.log(${JSON.stringify(JSON.stringify(identity))})
else if (family === 'help') console.log(${JSON.stringify(JSON.stringify(help))})
else {
  let input = ''; process.stdin.on('data', bytes => input += bytes)
  process.stdin.on('end', () => setTimeout(() => console.log(JSON.stringify({snapshots:JSON.parse(input)})), 25))
}
`)
  chmodSync(cli, 0o700)
  const lfs = client({ home, cli })
  assert.equal(await lfs.supportsOption('store', 'storage_report', 'max_objects'), true)
  assert.equal(await lfs.supportsOption('store', 'storage_report', 'include_encoding'), false)
  assert.equal(await lfs.supportsOption('project', 'storage_report', 'include_encoding'), false)
  const a = [{ project: 'studio/site', branch: 'main', commit: 'a' }], b = [{ project: 'studio/site', branch: 'main', commit: 'b' }]
  const [one, two, same] = await Promise.all([lfs.store.storage_report('studio', a, { max_objects: 10 }), lfs.store.storage_report('studio', b, { max_objects: 10 }), lfs.store.storage_report('studio', a, { max_objects: 10 })])
  assert.deepEqual(one.snapshots, a)
  assert.deepEqual(two.snapshots, b)
  assert.deepEqual(same.snapshots, a)
  assert.strictEqual(one, same)
  await assert.rejects(lfs.machine.images('lima1'), { code: 'Unsupported' })
})

test('Sandbox image discovery is read-only and archive input maps to explicit CLI options', async t => {
  const home = temporary(t), cli = join(home, 'sandbox-images-cli')
  writeFileSync(join(home, 'layerfs.json'), '{}')
  const required = ['workspace.exec_cancel', 'branch.commits', 'branch.get_commit', 'store.stats', 'project.stats', 'file.revision'].map(name => { const [family, call] = name.split('.'); return { family, call, args: [], options: [] } })
  const help = { calls: [...required,
    { family: 'machine', call: 'images', args: [{ name: 'name', kind: 'name' }], options: [] },
    { family: 'sandbox', call: 'create', args: [{ name: 'project', kind: 'project' }, { name: 'name', kind: 'name' }, { name: 'machine', kind: 'name', optional: true }], options: [{ name: 'image', kind: 'json' }, { name: 'image_archive', kind: 'text' }, { name: 'on_progress', kind: 'function' }] }
  ], commands: [], switches: [{ name: '--events', calls: ['workspace.exec'] }] }
  const identity = { commit: 'b'.repeat(40), dirty: true, features: [] }
  writeFileSync(cli, `#!${process.execPath}
const argv = process.argv.slice(2)
if (argv[0] === '--version') console.log(${JSON.stringify(JSON.stringify(identity))})
else if (argv[0] === 'help') console.log(${JSON.stringify(JSON.stringify(help))})
else setTimeout(() => console.log(JSON.stringify({argv})), 20)
`)
  chmodSync(cli, 0o700)
  const lfs = client({ home, cli }), digest = 'sha256:' + 'a'.repeat(64)
  const [a, b] = await Promise.all([lfs.machine.images('lima1'), lfs.machine.images('lima1')])
  assert.strictEqual(a, b)
  assert.deepEqual(a.argv, ['machine', 'images', '--', 'lima1'])
  const made = await lfs.sandbox.create('store/app', 'one', 'lima1', { image: { archive: '/tmp/two images.tar', digest } })
  assert.deepEqual(made.argv, ['sandbox', 'create', '--image', digest, '--image-archive', '/tmp/two images.tar', '--progress', '--', 'store/app', 'one', 'lima1'])
  const defaultImage = await lfs.sandbox.create('store/app', 'two', 'lima1')
  assert.deepEqual(defaultImage.argv, ['sandbox', 'create', '--progress', '--', 'store/app', 'two', 'lima1'])
  await assert.rejects(lfs.sandbox.create('store/app', 'bad', 'lima1', { image: { archive: 'relative.tar' } }), { code: 'InvalidInput' })
  await assert.rejects(lfs.sandbox.create('store/app', 'bad', 'lima1', { image: { archive: '/tmp/image.tar', digest: 'sha256:abc' } }), { code: 'InvalidInput' })
})
