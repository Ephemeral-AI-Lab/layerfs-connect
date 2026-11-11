import assert from 'node:assert/strict'
import test from 'node:test'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityStore } from '../activity/store.js'
import { activityRecorder } from '../activity/recorder.js'
import { withActivity } from '../activity/context.js'
import { execute } from '../cli/spawn.js'

test('twelve producers preserve every lifecycle record under sustained real append pressure', async t => {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-pressure-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const store = new ActivityStore(state)
  const action = { id: 'pressure', name: 'demo.setup', label: 'Pressure fixture', origin: 'user' }
  let rejected = 0, peak = 0
  await Promise.all(Array.from({ length: 12 }, async (_, worker) => {
    for (let index = 0; index < 400; index++) {
      const id = `${worker}-${index}`, base = { v: 1, action, invocationId: id, at: Date.now() }
      try {
        await store.reserveInvocation(id, { protectedAction: true })
        store.append({ ...base, type: 'cli.queued', data: { argv: ['file', 'write', 'demo-studio/website'], stdin: { text: 'x'.repeat(1200), bytes: 1200, truncated: false } } })
        store.append({ ...base, type: 'cli.started', data: { started: base.at, pid: process.pid } })
        store.append({ ...base, type: 'cli.finished', data: { status: 'success', ended: base.at + 1, stdout: { text: 'y'.repeat(1200), bytes: 1200, truncated: false }, stderr: { text: '', bytes: 0, truncated: false } } })
      } catch { rejected++ }
      peak = Math.max(peak, store.pendingBytes)
      await new Promise(resolve => setImmediate(resolve))
    }
  }))
  await store.pending
  assert.equal(rejected, 0, `Rejected producers=${rejected}; peak pending=${peak}; ${store.error}`)
  const capture = await store.capture(action.id)
  assert.equal(capture.count, 4800)
  assert.equal(capture.complete, true)
  assert.equal(capture.started, 4800); assert.equal(capture.finished, 4800)
  assert.equal(capture.outputCaptured, 4800)
  assert.ok(peak <= 8 * 1000 * 1000)
  const metrics = store.diagnostics()
  assert.ok(metrics.peakBufferedBytes <= metrics.capacityBytes)
  assert.equal(metrics.terminalDrops, 0)
  assert.equal(metrics.reservations, 0)
  assert.ok(metrics.batches < metrics.recordsWritten / 3, 'Records must be batched rather than written one by one')
})

test('normal work cannot consume the reserved cancellation slot and terminal output survives maximum escaping', async t => {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-cancel-headroom-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const store = new ActivityStore(state), action = { id: 'control', name: 'demo.setup', label: 'Control fixture', origin: 'user' }
  for (let index = 0; index < 14; index++) await store.reserveInvocation(`normal-${index}`, { protectedAction: true })
  let normalAdmitted = false
  const waiting = store.reserveInvocation('waiting', { protectedAction: true }).then(() => { normalAdmitted = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(normalAdmitted, false)
  await store.reserveInvocation('cancel', { protectedAction: true, control: true })
  const base = { v: 1, action, invocationId: 'cancel', at: Date.now() }
  await store.append({ ...base, type: 'cli.started', data: { started: base.at, pid: process.pid } })
  const escaped = { text: '\u0000'.repeat(32768), bytes: 32768, truncated: false }
  await store.append({ ...base, type: 'cli.finished', data: { status: 'success', ended: base.at + 1, stdout: escaped, stderr: escaped } })
  assert.equal(normalAdmitted, false)
  for (let index = 0; index < 14; index++) await store.append({ ...base, invocationId: `normal-${index}`, type: 'cli.finished', data: { status: 'success', ended: base.at + 1, stdout: { text: '', bytes: 0, truncated: false }, stderr: { text: '', bytes: 0, truncated: false } } })
  await waiting
  await store.append({ ...base, invocationId: 'waiting', type: 'cli.finished', data: { status: 'success', ended: base.at + 1, stdout: { text: '', bytes: 0, truncated: false }, stderr: { text: '', bytes: 0, truncated: false } } })
  const selected = await store.invocation(action.id, 'cancel')
  assert.equal(selected.stdout.text.length, 32768); assert.equal(selected.stderr.text.length, 32768)
  const metrics = store.diagnostics()
  assert.equal(metrics.terminalDrops, 0); assert.equal(metrics.reservations, 0)
  assert.ok(metrics.peakBufferedBytes <= 8 * 1000 * 1000)
  assert.ok(metrics.writableWaits > 0)
})

test('a pending batch fences cross-writer reset and late old-generation records never return', async t => {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-batch-fence-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const writer = new ActivityStore(state), resetter = new ActivityStore(state)
  const action = { id: 'old', name: 'demo.setup', label: 'Old action', origin: 'user' }
  const saved = writer.append({ v: 1, action, type: 'action.received', at: 1, data: {} }, 'initial')
  await assert.rejects(resetter.clear(), { code: 'ConnectBusy' })
  await saved
  const generation = await resetter.clear()
  await writer.append({ v: 1, action, type: 'action.finished', at: 2, data: {} }, 'initial')
  await writer.append({ v: 1, action: { ...action, id: 'new' }, type: 'action.received', at: 3, data: {} }, generation)
  const page = await writer.summaries()
  assert.deepEqual(page.items.map(item => item.id), ['new'])
  assert.equal(writer.diagnostics().pendingBytes, 0)
})

test('actual workspace exec-cancel invocation uses cancellation headroom rather than waiting behind normal reservations', async t => {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-exec-cancel-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const cli = join(state, 'layerfs'), recorder = activityRecorder(state), store = recorder.store
  writeFileSync(cli, `#!${process.execPath}\nconsole.log('{}')\n`); chmodSync(cli, 0o700)
  writeFileSync(join(state, 'layerfs.json'), '{}')
  for (let index = 0; index < 14; index++) await store.reserveInvocation(`normal-${index}`)
  const action = { id: 'actual-cancel', name: 'demo.setup', label: 'Cancel fixture', origin: 'user' }
  let didSpawn
  const spawned = new Promise(resolve => { didSpawn = resolve })
  const pending = withActivity({ state, action }, () => execute({ state, home: state, cli }, ['workspace', 'exec-cancel', 'example:work'], { onSpawn: didSpawn }))
  let timer, timedOut
  try { await Promise.race([spawned, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('exec-cancel waited behind normal terminal reservations')), 2000) })]) }
  catch (error) { timedOut = error }
  finally { clearTimeout(timer); for (let index = 0; index < 14; index++) store.releaseReservation(`normal-${index}`); store.wakeAdmissions() }
  await pending; await recorder.flush()
  if (timedOut) throw timedOut
  const page = await recorder.read({ actionId: action.id })
  assert.equal(page.items[0].invocations[0].status, 'success')
  assert.equal(store.diagnostics().reservations, 0)
  assert.equal(store.diagnostics().terminalDrops, 0)
})

test('an impossible queue size rejects reservation rather than waiting forever', async t => {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-impossible-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const store = new ActivityStore(state, { maxPendingBytes: 600 })
  await assert.rejects(store.reserveInvocation('cannot-fit'), { code: 'ActivityCapacity' })
  assert.equal(store.waiters.length, 0)
})

test('protected invocation refuses a queued-record I/O failure before spawning', async t => {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-protected-io-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const cli = join(state, 'layerfs'), attempted = join(state, 'attempted')
  writeFileSync(cli, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(attempted)},'spawned');console.log('{}')\n`); chmodSync(cli, 0o700)
  writeFileSync(join(state, 'layerfs.json'), '{}'); writeFileSync(join(state, 'logs'), 'not a directory')
  await assert.rejects(withActivity({ state, action: { id: 'io-failure', name: 'demo.setup', label: 'Protected I/O fixture', origin: 'user' } }, () => execute({ state, home: state, cli }, ['machine', 'list'])), { code: 'ActivityUnavailable' })
  assert.equal(existsSync(attempted), false)
})
