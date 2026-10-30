import assert from 'node:assert/strict'
import test from 'node:test'
import { ApprovalService, permissionMode } from '../agents/permissions.js'

const command = { agent: 'root', toolCallId: 'call-1', command: 'printf ok > proof.txt', cwd: '/workspace' }
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture(mode = 'ask', review) {
  const records = new Map(['a', 'b'].map((id) => [id, { id, permissionMode: mode, approvals: [] }]))
  const changes = []
  const manager = {
    record: (id) => { assert.ok(records.has(id)); return records.get(id) },
    detail: (id) => records.get(id),
    changed: (id, persist) => changes.push({ id, persist }),
    models: {},
  }
  return { service: new ApprovalService(manager, review), record: records.get('a'), other: records.get('b'), changes }
}

test('approval belongs to one session and one immutable request, never to a matching command later', async () => {
  const { service, record } = fixture()
  const result = service.request('a', command)
  const request = record.approvals[0]
  assert.equal(request.command, command.command)
  assert.equal(request.status, 'pending')
  assert.throws(() => service.decide('b', request.id, 'approve'), { status: 409 })
  assert.throws(() => service.decide('a', request.id, 'allow'), { status: 400 })
  service.decide('a', request.id, 'approve')
  assert.equal((await result).approved, true)
  assert.equal(request.source, 'user')
  assert.throws(() => service.decide('a', request.id, 'approve'), { status: 409 })
  const repeated = service.request('a', command)
  assert.equal(record.approvals[1].status, 'pending')
  service.decide('a', record.approvals[1].id, 'reject')
  assert.equal((await repeated).approved, false)
})

test('human rejection during automatic review cannot be overwritten by a late model approval', async () => {
  let finishReview, reviewSignal
  const { service, record } = fixture('auto', ({ signal }) => {
    reviewSignal = signal
    return new Promise((resolve) => { finishReview = resolve })
  })
  const result = service.request('a', command)
  assert.equal(record.approvals[0].status, 'reviewing')
  service.decide('a', record.approvals[0].id, 'reject')
  assert.equal(reviewSignal.aborted, true)
  finishReview({ decision: 'approve', reason: 'Too late' })
  await tick()
  assert.equal((await result).approved, false)
  assert.equal(record.approvals[0].status, 'rejected')
  assert.equal(record.approvals[0].source, 'user')
})

test('downgrading from automatic review to ask invalidates in-flight review; full releases only current requests', async () => {
  let finishReview
  const { service, record, other } = fixture('auto', () => new Promise((resolve) => { finishReview = resolve }))
  const result = service.request('a', command)
  service.setMode('a', 'ask')
  finishReview({ decision: 'approve', reason: 'Stale policy' })
  await tick()
  assert.equal(record.approvals[0].status, 'pending')
  assert.equal(service.pending.size, 1)
  other.permissionMode = 'ask'
  const otherResult = service.request('b', command)
  service.setMode('a', 'full')
  assert.equal((await result).approved, true)
  assert.equal(record.approvals[0].source, 'user')
  assert.equal(other.approvals[0].status, 'pending')
  assert.equal((await service.request('a', command)).approved, true)
  assert.equal(record.approvals.length, 1)
  service.cancelSession('b')
  assert.equal((await otherResult).approved, false)
})

test('failed automatic review awaits a human, cancellation resolves it and stop denies later requests', async () => {
  const { service, record } = fixture('auto', async () => { throw new Error('Provider offline') })
  const controller = new AbortController()
  const result = service.request('a', command, controller.signal)
  await tick()
  assert.equal(record.approvals[0].status, 'pending')
  assert.match(record.approvals[0].reason, /Provider offline/)
  controller.abort()
  assert.equal((await result).approved, false)
  assert.equal(record.approvals[0].status, 'cancelled')
  assert.equal(service.pending.size, 0)
  service.cancelSession('a')
  service.setMode('a', 'full')
  assert.equal((await service.request('a', command)).approved, false)
  service.resume('a')
  assert.equal((await service.request('a', command)).approved, true)
})

test('full is the default and invalid permission modes leave session policy unchanged', () => {
  const { service, record } = fixture(permissionMode())
  assert.equal(permissionMode(), 'full')
  for (const mode of ['unknown', '', null]) assert.throws(() => service.setMode('a', mode), { status: 400 })
  assert.equal(record.permissionMode, 'full')
})
