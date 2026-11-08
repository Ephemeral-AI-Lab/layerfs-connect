import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DoctorManager } from '../doctor/manager.js'
import { validateReport } from '../doctor/report.js'
const report = (target = 'host', name = 'local', mode = 'observation') => ({ ok: false, complete: false, target: { kind: target, name }, operation: target === 'store' ? 'integrity' : 'diagnose', mode, checks: [{ id: 'repeat', outcome: 'blocked' }, { id: 'repeat', outcome: 'fail' }], findings: [{ severity: 'error' }], counts: { total: 123 }, truncated: true })
function setup(t, run) {
 const state = mkdtempSync(join(tmpdir(), 'connect-doctor-'))
 t.after(() => rmSync(state, { recursive: true, force: true }))
 const options = { spec: { state, home: join(state, 'home') }, run, capabilities: async () => ({ identity: { commit: 'pinned' }, commands: [{ name: 'doctor host' }, { name: 'doctor store integrity' }] }) }
 return { manager: new DoctorManager(options), options }
}
async function untilDone(manager, id) { for (let i = 0; i < 100; i++) { if (!['queued', 'running'].includes(manager.get(id).state)) return manager.get(id); await new Promise(resolve => setTimeout(resolve, 5)) } throw new Error('diagnosis did not finish') }
test('exit0 reports retain failed/incomplete/truncated/repeated checks and launch deduplicates', { timeout: 3000 }, async t => {
 let calls = 0
 const { manager } = setup(t, async () => { calls++; return report() })
 const [job, duplicate] = await Promise.all([manager.launch({ target: 'host', key: 'once' }), manager.launch({ target: 'host', key: 'once' })])
 assert.equal(duplicate.id, job.id)
 const done = await untilDone(manager, job.id)
 assert.equal(done.state, 'completed'); assert.equal(done.report.complete, false); assert.equal(done.report.checks.length, 2); assert.equal(calls, 1)
 assert.throws(() => validateReport({ ok: true, findings: [] }, { target: 'host' }), /no valid/)
})
test('restart interrupts without replay; per-store audit admission and options are strict', { timeout: 3000 }, async t => {
 const finish = Promise.withResolvers()
 const { manager, options } = setup(t, async () => finish.promise)
 const job = await manager.launch({ target: 'store.integrity', name: 's', key: 'one' })
 await assert.rejects(manager.launch({ target: 'store.integrity', name: 's', key: 'two' }), { status: 409 })
 await assert.rejects(manager.launch({ target: 'host', key: 'invalid', quick: false }), { status: 400 })
 const reloaded = new DoctorManager(options)
 assert.equal(reloaded.get(job.id).state, 'interrupted')
 finish.resolve(report('store', 's', 'full'))
 await untilDone(manager, job.id)
})
test('transport failures, refusal and incompatibility remain separate', { timeout: 3000 }, async t => {
 for (const [transport, code, state] of [['transport-unknown', 'Unknown', 'interrupted'], ['refusal', 'NoSuchStore', 'failed'], ['usage-incompatible', 'CliIncompatible', 'unavailable']]) {
  const { manager } = setup(t, async () => { throw Object.assign(new Error('failure'), { code, transport }) })
  const job = await manager.launch({ target: 'host', key: code })
  assert.equal((await untilDone(manager, job.id)).state, state)
 }
})
