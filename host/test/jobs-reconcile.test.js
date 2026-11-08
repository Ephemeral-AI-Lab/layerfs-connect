import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobStore } from '../jobs/store.js'
import { inspectJob } from '../jobs/reconcile.js'

test('restart retains active records as interrupted without replay', () => {
  const path = mkdtempSync(join(tmpdir(), 'connect-jobs-'))
  try {
    const first = new JobStore(path)
    first.jobs.set('a', { id: 'a', phase: 'send', ended: null, pid: 123 })
    first.save()
    const record = new JobStore(path).jobs.get('a')
    assert.equal(record.outcome, 'interrupted')
    assert.equal(record.error.code, 'Interrupted')
    assert.equal(record.pid, 123)
  } finally { rmSync(path, { recursive: true, force: true }) }
})
test('idle certain failure permits retry; interrupted does not', async () => {
  const lfs = { store: { status: async () => ({ state: 'idle' }) } }
  assert.equal((await inspectJob(lfs, { kind: 'push', outcome: 'failed' })).action, 'retry')
  assert.equal((await inspectJob(lfs, { kind: 'push', outcome: 'interrupted' })).action, null)
})
test('unresolved recovery requires matching operation identity and running target', async () => {
  const op = { id: 'same', name: 'store.push' }
  const lfs = { store: { status: async () => ({ state: 'unresolved', op }) }, machine: { status: async () => ({ state: 'running' }) } }
  const job = { kind: 'push', target: 'docker', outcome: 'unknown', observation: { value: { op } } }
  assert.equal((await inspectJob(lfs, job)).action, 'resolve')
  assert.equal((await inspectJob(lfs, { ...job, observation: null })).action, null)
  assert.equal((await inspectJob(lfs, { ...job, observation: { value: { op: { ...op, name: 'store.pull' } } } })).action, null)
  lfs.machine.status = async () => ({ state: 'stopped' })
  assert.equal((await inspectJob(lfs, job)).action, null)
})
