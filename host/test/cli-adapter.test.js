import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execute, children } from '../cli/spawn.js'
import { client } from '../cli/calls.js'
import { discover } from '../cli/capabilities.js'
import { parse, stringify } from '../cli/json.js'
import { outcome } from '../cli/outcome.js'
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
test('simulator uses real CLI spawning, discovery and exact argv without shell', async (t) => {
  const spec = { mode: 'sim', home: temporary(t) }
  const help = await discover(spec)
  assert.equal(help.calls.length, 66)
  assert.equal(help.identity.simulated, true)
  const lfs = client(spec)
  assert.ok((await lfs.store.list()).items.length > 0)
  const source = temporary(t); writeFileSync(join(source, 'a.txt'), 'one\n')
  await lfs.store.create('owned')
  await lfs.project.init('owned/p', source)
  assert.equal((await lfs.project.get('owned/p')).name, 'p')
  await assert.rejects(lfs.sandbox.close('api-dev',{force:false}), { code:'MountsActive',transport:'refusal' })
  await assert.rejects(lfs.sandbox.close('api-dev',{force:'false'}), { code:'InvalidInput' })
  await lfs.sandbox.close('api-dev',{force:true})
  await assert.rejects(lfs.sandbox.get('api-dev'),{code:'NoSuchSandbox'})
  assert.equal(children.size, 0)
  await assert.rejects(lfs.store.get('missing'), { code: 'NotFound', transport: 'refusal' })
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
  const home = temporary(t), cli = join(home, 'fake-cli')
  writeFileSync(cli, `#!${process.execPath}\nconst fs=require('node:fs');const p=${JSON.stringify(home)}+'/release';if(process.argv[3]==='exec-cancel'){fs.writeFileSync(p,'');console.log('{"outcome":"cancelled"}')}else{const t=setInterval(()=>{if(fs.existsSync(p)){clearInterval(t);console.log('{}')}},10);setTimeout(()=>process.exit(1),4000).unref()}\n`)
  chmodSync(cli, 0o700)
  let count=0, ready
  const started=new Promise((resolve)=>{ready=resolve})
  const holds=Array.from({length:4},()=>execute({home,cli},['workspace','exec'],{timeout:5000,onSpawn:()=>{if(++count===4)ready()}}))
  await started
  let queuedSpawned = false
  const queued = execute({home,cli},['workspace','exec'],{beforeSpawn:()=>{throw Object.assign(new Error('stopped'),{code:'QueuedStop'})},onSpawn:()=>{queuedSpawned=true}}).catch((e)=>e.code)
  assert.equal((await execute({home,cli},['workspace','exec-cancel'],{timeout:2000})).outcome,'cancelled')
  await Promise.all(holds)
  assert.equal(await queued,'QueuedStop')
  assert.equal(queuedSpawned,false)
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
