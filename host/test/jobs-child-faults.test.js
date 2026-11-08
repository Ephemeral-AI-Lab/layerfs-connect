// SIMULATED fault injection: real child signals and manager restart, fake CLI state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { execute } from '../cli/spawn.js'
import { Storage } from '../storage.js'
import { DoctorManager } from '../doctor/manager.js'

const storageModule = new URL('../storage.js', import.meta.url).href
const spawnModule = new URL('../cli/spawn.js', import.meta.url).href
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'connect-child-fault-'))
  const cli = join(path, 'fake-cli.mjs')
  writeFileSync(join(path, 'layerfs.json'), '{}')
  writeFileSync(cli, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';import{join}from'node:path';
const phase=process.argv[2];
writeFileSync(join(process.env.LAYERFS_HOME,'observed.json'),JSON.stringify({state:phase==='install'?'unresolved':'idle',op:phase==='install'?{id:'fault-op',name:'store.push'}:null}));
process.stderr.write(JSON.stringify({progress:{phase,done:1,total:2}})+'\\n');
setTimeout(()=>{process.stdout.write('{}\\n')},60000);
`, { mode: 0o700 })
  return { path, spec: { cli, home: path, state: path, mode: 'real' } }
}
async function gone(pid) {
  const deadline = Date.now() + 3000
  while (true) {
    try { process.kill(pid, 0) } catch (e) { if (e.code === 'ESRCH') return; throw e }
    if (Date.now() > deadline) throw new Error('orphaned fake CLI did not exit')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
async function ended(storage, id) {
  const deadline = Date.now() + 5000
  while (!storage.job(id).ended) {
    if (Date.now() > deadline) throw new Error('job did not terminate after signal')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return storage.job(id)
}
for (const phase of ['send', 'install']) test(`SIMULATED SIGTERM during ${phase}: preserve custody and reconcile without replay`, { timeout: 10000 }, async () => {
  const { path, spec } = fixture()
  let child, launches = 0
  const lfs = { store: { push: (_store, _machine, options) => {
    launches++
    return execute(spec, [phase], { onSpawn: c => { child = c; options.on_spawn(c.pid) }, onProgress: p => { options.on_progress(p); child.kill('SIGTERM') } })
  }, status: async () => JSON.parse(readFileSync(join(path, 'observed.json'))) } }
  try {
    const manager = new Storage({ spec, client: lfs, log: () => {} })
    const job = manager.push('store', 'docker')
    const result = await ended(manager, job.id)
    assert.ok(result.pid)
    assert.equal(result.outcome, 'unknown')
    const observed = await manager.inspect(job.id)
    assert.equal(observed.observation.value.state, phase === 'install' ? 'unresolved' : 'idle')
    assert.equal(observed.outcome, phase === 'install' ? 'unknown' : 'interrupted')
    assert.equal(observed.observation.action, null)
    assert.equal(launches, 1)
  } finally { child?.kill('SIGKILL'); rmSync(path, { recursive: true, force: true }) }
})

test('SIMULATED host SIGKILL and Storage manager restart retain interrupted child identity, never launch again', { timeout: 10000 }, async () => {
  const { path, spec } = fixture()
  const worker = join(path, 'worker.mjs')
  writeFileSync(worker, `import{Storage}from ${JSON.stringify(storageModule)};import{execute}from ${JSON.stringify(spawnModule)};const spec=${JSON.stringify(spec)};const lfs={store:{push:(s,m,o)=>execute(spec,['send'],{onSpawn:c=>{o.on_spawn(c.pid);process.stdout.write(JSON.stringify({pid:c.pid})+'\\n')},onProgress:o.on_progress})}};new Storage({spec,client:lfs,log:()=>{}}).push('store','docker');`)
  const host = spawn(process.execPath, [worker], { stdio: ['ignore','pipe','ignore'] })
  let pid
  try {
    const [data] = await once(host.stdout, 'data', { signal: AbortSignal.timeout(5000) })
    pid = JSON.parse(data.toString()).pid
    host.kill('SIGKILL'); await once(host, 'close')
    process.kill(pid, 'SIGTERM')
    await gone(pid)
    let reads = 0, mutations = 0
    const restored = new Storage({ spec, client: { store: { status: async () => { reads++; return { state: 'idle' } }, push: async () => { mutations++; throw new Error('replay') } } }, log: () => {} })
    await restored.reconciled
    const [record] = restored.jobList()
    assert.equal(record.pid, pid)
    assert.equal(record.outcome, 'interrupted')
    assert.equal(record.observation.value.state, 'idle')
    assert.equal(reads, 1)
    assert.equal(mutations, 0)
  } finally { host.kill('SIGKILL'); if (pid) { try { process.kill(pid, 'SIGKILL') } catch {} }; rmSync(path, { recursive: true, force: true }) }
})

test('SIMULATED Doctor child termination yields interrupted with no report and restart never replays', { timeout: 10000 }, async () => {
  const { path, spec } = fixture()
  let child, launches = 0
  try {
    const manager = new DoctorManager({ spec, capabilities: async () => ({ identity: { simulated: true }, commands: ['doctor host'] }), run: (selected, _argv, options) => {
      launches++
      return execute(selected, ['doctor-kill'], { ...options, onSpawn: c => { child = c; options.onSpawn(c) }, onProgress: () => child.kill('SIGTERM') })
    } })
    const job = await manager.launch({ target: 'host', key: 'single-launch' })
    const deadline = Date.now() + 5000
    while (['running', 'queued'].includes(manager.get(job.id).state)) {
      if (Date.now() > deadline) throw new Error('Doctor child did not terminate')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(manager.get(job.id).state, 'interrupted')
    assert.equal(manager.get(job.id).report, undefined)
    const restored = new DoctorManager({ spec, run: async () => { launches++; throw new Error('replay') } })
    assert.equal(restored.get(job.id).state, 'interrupted')
    assert.equal(launches, 1)
  } finally { child?.kill('SIGKILL'); rmSync(path, { recursive: true, force: true }) }
})

test('SIMULATED framed exec child termination requires final frame and actual process exit', { timeout: 10000 }, async () => {
  const { path, spec } = fixture()
  let child
  try {
    await assert.rejects(execute(spec, ['send', '--events'], { events: true, onSpawn: c => { child = c }, onProgress: () => child.kill('SIGTERM') }), e => e.code === 'Unknown' && e.transport === 'transport-unknown')
    assert.equal(child.signalCode, 'SIGTERM')
  } finally { child?.kill('SIGKILL'); rmSync(path, { recursive: true, force: true }) }
})
