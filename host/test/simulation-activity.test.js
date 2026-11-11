import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ActivityStore } from '../activity/store.js'
import { protectedActivity } from '../activity/context.js'

test('simulation invocation evidence survives ordinary activity retention', async t => {
  const state = mkdtempSync(join(tmpdir(), 'simulation-activity-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const store = new ActivityStore(state, { maxBytes: 500, fileBytes: 300, protectedBytes: 100000 })
  const action = { id: 'simulation-retained', name: 'simulation.run', origin: 'user' }
  assert.equal(protectedActivity(action.name), true)
  assert.equal(protectedActivity('simulation.stop'), true)
  assert.equal(protectedActivity('host.request'), false)
  for (let index = 0; index < 6; index++) {
    const invocationId = `step-${index}`
    for (const type of ['cli.queued', 'cli.started', 'cli.finished']) await store.append({ v: 1, at: Date.now(), action, invocationId, type, data: { status: 'success', argv: ['file', 'write', 'sim/project'], stdout: { text: 'confirmed', bytes: 9 }, stderr: { text: '', bytes: 0 } } })
  }
  for (let index = 0; index < 10; index++) await store.append({ v: 1, at: Date.now(), action: { id: `ordinary-${index}`, name: 'host.request' }, type: 'action.received', data: {} })
  store.now = () => Date.now() + 8 * 86400000
  await store.prune()
  const capture = await store.capture(action.id)
  assert.equal(capture.count, 6)
  assert.equal(capture.started, 6)
  assert.equal(capture.finished, 6)
  assert.equal(capture.complete, true)
  assert.ok((await store.files()).every(file => file.protected))
})
