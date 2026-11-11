import assert from 'node:assert/strict'
import test from 'node:test'
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ActivityStore } from '../activity/store.js'
import { activityRoute } from '../activity/routes.js'

function fixture(t, options) {
  const state = mkdtempSync(join(tmpdir(), 'connect-activity-scaling-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const store = new ActivityStore(state, options)
  mkdirSync(store.dir, { recursive: true })
  return store
}
const action = { id: 'large-action', name: 'demo.setup', label: 'Build Studio', origin: 'user' }
const text = value => ({ text: value, bytes: Buffer.byteLength(value), truncated: false })
function events(index) {
  const id = `call-${String(index).padStart(6, '0')}`, project = index % 2 ? 'demo-services/billing' : 'demo-studio/website'
  const base = { v: 1, generation: 'initial', action, invocationId: id, at: index + 1 }
  return [
    { ...base, type: 'cli.queued', data: { argv: ['file', 'write', project, 'release', '/note.md'], stdin: text(`Input ${index}`), mode: 'real', ownerPid: process.pid } },
    { ...base, type: 'cli.started', data: { started: index + 1, pid: process.pid } },
    { ...base, type: 'cli.finished', data: { status: 'success', ended: index + 2, stdout: text(`captured-output-${index}`), stderr: text('') } },
  ]
}

test('50,000 commands use bounded metadata pages, lazy streams and incremental archive indexing', async t => {
  const store = fixture(t), file = join(store.dir, 'activity-2026-11-10-proof-protected-1.ndjson')
  const fd = openSync(file, 'w', 0o600)
  try {
    for (let start = 0; start < 50000; start += 250) {
      const batch = []
      for (let index = start; index < start + 250; index++) for (const event of events(index)) batch.push(JSON.stringify(event) + '\n')
      writeSync(fd, batch.join(''))
    }
  } finally { closeSync(fd) }
  const summary = await store.summaries()
  assert.equal(summary.items[0].invocationCount, 50000)
  assert.deepEqual(summary.items[0].invocations, [])
  assert.deepEqual(summary.items[0].projects, ['demo-services/billing', 'demo-studio/website'])
  const parsed = store.index.parsed
  assert.equal(parsed, 150000)
  const first = await store.invocationPage(action.id, { limit: 1000, project: 'demo-studio/website' })
  assert.equal(first.items.length, 100)
  assert.equal(first.total, 25000)
  assert.ok(first.next)
  assert.equal(first.items[0].stdin, undefined)
  assert.equal(first.items[0].stdout, undefined)
  assert.doesNotMatch(JSON.stringify(first), /captured-output/)
  const second = await store.invocationPage(action.id, { after: first.next, project: 'demo-studio/website' })
  assert.equal(second.items[0].id, 'call-000200')
  const selected = await store.invocation(action.id, 'call-049999')
  assert.equal(selected.stdin.text, 'Input 49999')
  assert.equal(selected.stdout.text, 'captured-output-49999')
  assert.equal(selected.stderr.text, '')
  assert.equal(store.index.parsed, parsed, 'Repeated reads must not parse the archive again')
  const ids = Array.from({ length: 50000 }, (_, index) => `call-${String(index).padStart(6, '0')}`)
  const capture = await store.capture(action.id, { expectedIds: ids, expectedInputIds: ids })
  assert.equal(capture.complete, true)
  assert.equal(capture.queued, 50000); assert.equal(capture.started, 50000); assert.equal(capture.finished, 50000)
  assert.equal(capture.outputCaptured, 50000); assert.equal(capture.failedCount, 0)
  appendFileSync(file, JSON.stringify({ v: 1, generation: 'initial', action, type: 'action.finished', at: 60000, data: { status: 200 } }) + '\n')
  await store.summaries()
  assert.equal(store.index.parsed, parsed + 1, 'Only the appended complete event should be parsed')
  const missing = await store.capture(action.id, { expectedIds: [...ids, 'missing-call'] })
  assert.equal(missing.complete, false); assert.deepEqual(missing.missingIds, ['missing-call'])
})

test('capture rejects missing lifecycle stages and reports truncated expected input/output', async t => {
  const store = fixture(t)
  const rows = events(0)
  rows[0].data.stdin.truncated = true
  for (const event of [rows[0], rows[2]]) await store.append(event)
  const capture = await store.capture(action.id, { expectedIds: ['call-000000'], expectedInputIds: ['call-000000'] })
  assert.equal(capture.complete, false)
  assert.equal(capture.started, 0); assert.equal(capture.incomplete, 1)
  assert.equal(capture.expectedTruncated, 1)
  assert.equal(capture.truncatedCount, 1)
  const duplicate = await store.capture(action.id, { expectedIds: ['call-000000', 'call-000000'] })
  assert.equal(duplicate.complete, false)
})

test('incremental readers wait for complete lines and incorporate another writer without replaying old records', async t => {
  const store = fixture(t), rows = events(0)
  await store.append(rows[0])
  await store.summaries()
  const parsed = store.index.parsed, file = (await store.files())[0].path
  const started = JSON.stringify({ ...rows[1], generation: 'initial' }) + '\n', split = Math.floor(started.length / 2)
  appendFileSync(file, started.slice(0, split))
  await store.summaries()
  assert.equal(store.index.parsed, parsed)
  appendFileSync(file, started.slice(split))
  const secondWriter = new ActivityStore(store.state)
  await secondWriter.append(rows[2])
  const capture = await store.capture(action.id, { expectedIds: ['call-000000'] })
  assert.equal(capture.complete, true)
  assert.equal(store.index.parsed, parsed + 2)
  assert.equal((await store.invocation(action.id, 'call-000000')).stdout.text, 'captured-output-0')
})

test('protected preset files survive ordinary retention until clear, with explicit archive capacity refusal', async t => {
  const store = fixture(t, { maxBytes: 500, fileBytes: 300, protectedBytes: 4000 })
  for (let index = 0; index < 8; index++) await store.append({ v: 1, action, at: index + 1, type: 'action.received', data: { label: 'preset evidence' } })
  for (let index = 0; index < 12; index++) await store.append({ v: 1, action: { ...action, id: `ordinary-${index}`, name: 'machine.list' }, at: index + 20, type: 'action.received', data: {} })
  const files = await store.files()
  assert.ok(files.filter(file => file.protected).reduce((sum, file) => sum + file.size, 0) > 500)
  assert.ok(files.filter(file => !file.protected).reduce((sum, file) => sum + file.size, 0) <= 500)
  store.now = () => Date.now() + 8 * 86400000
  await store.prune()
  assert.ok((await store.files()).every(file => file.protected))
  await assert.rejects(store.reserveInvocation('next-call', { protectedAction: true }), { code: 'ActivityCapacity' })
  assert.match(store.error, /capacity/)
  await store.clear()
  assert.equal((await store.files()).length, 0)
  assert.equal((await store.summaries()).items.length, 0)
})

test('pending activity bytes are bounded and queued preset admission reports pressure', async t => {
  const store = fixture(t, { maxPendingBytes: 600 })
  const queued = events(0)[0], first = store.append(queued)
  assert.throws(() => store.append(events(1)[0]), { code: 'ActivityBackpressure' })
  assert.ok(store.pendingBytes <= 600)
  await first
  assert.equal(store.pendingBytes, 0)
})

test('summary/page/detail routes preserve legacy reads and scope invocation IDs to their action', async t => {
  const store = fixture(t)
  for (const event of events(0)) await store.append(event)
  const recorder = { read: query => store.read(query), summaries: query => store.summaries(query), invocationPage: (...args) => store.invocationPage(...args), invocation: (...args) => store.invocation(...args) }
  const summary = await activityRoute(recorder, 'GET', [action.id], new URLSearchParams('summary=1'))
  assert.equal(summary.invocationCount, 1); assert.deepEqual(summary.invocations, [])
  const page = await activityRoute(recorder, 'GET', [action.id, 'invocations'], new URLSearchParams())
  assert.equal(page.items.length, 1); assert.equal(page.items[0].stdout, undefined)
  const detail = await activityRoute(recorder, 'GET', [action.id, 'invocations', 'call-000000'], new URLSearchParams())
  assert.equal(detail.stdout.text, 'captured-output-0')
  assert.equal(await store.invocation('another-action', 'call-000000'), null)
  const legacy = await activityRoute(recorder, 'GET', [action.id], new URLSearchParams())
  assert.equal(legacy.invocations[0].stdout.text, 'captured-output-0')
})
