// A project's state read again when a Workspace or Sandbox went away while it
// was read (projects.js, readState); any other refusal is not retried.
//   node --import ./host/resolve-layerfs.js --test host/test/state-read.test.js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readState } from '../projects.js'

const runtime = (answers) => {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    project: {
      get_state: async () => {
        const next = answers[Math.min(calls++, answers.length - 1)]
        if (next instanceof Error) throw next
        return next
      },
    },
  }
}
const absent = () => Object.assign(new Error('Failed: Rejected(Missing, "Workspace path absent")'), { code: 'Failed' })
const eof = () => new Error('Failed: OperationFailure { … cause: Channel(Io(Kind(UnexpectedEof))) }')

test('a Workspace or Sandbox gone mid-read: read again', async () => {
  const r = runtime([absent(), eof(), { kind: 'ok' }])
  assert.deepEqual(await readState(r, 'p'), { kind: 'ok' })
  assert.equal(r.calls, 3)
})

test('it keeps going: the fifth refusal is the answer', async () => {
  const r = runtime([absent()])
  await assert.rejects(readState(r, 'p'), /Workspace path absent/)
  assert.equal(r.calls, 5)
})

test('another refusal is not read again', async () => {
  const r = runtime([Object.assign(new Error('no such project'), { code: 'NoSuchProject' })])
  await assert.rejects(readState(r, 'p'), { code: 'NoSuchProject' })
  assert.equal(r.calls, 1)
})
