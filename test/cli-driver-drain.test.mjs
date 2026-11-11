import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { CliDriver } from '../tools/demo/drivers.mjs'
import { children } from '../host/cli/spawn.js'
import { configureActivity } from '../host/activity/recorder.js'
import { withActivity } from '../host/activity/context.js'

for (const childFails of [false, true]) test(`invocation journal failure drains a ${childFails ? 'refused' : 'successful'} launched CLI child before rejection`, { timeout: 5000 }, async t => {
  const state = mkdtempSync(join(tmpdir(), 'cli-driver-drain-')), marker = join(state, 'child-settled')
  const recorder = configureActivity(state), driver = new CliDriver({ cli: process.execPath, state, home: state })
  const action = { id: `driver-drain-${childFails}`, name: 'demo.test', label: 'Driver drain regression', origin: 'user' }
  const script = `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'settled'); ${childFails ? "process.stderr.write(JSON.stringify({ code: 'Failed', message: 'stub refusal' }) + '\\n'); process.exitCode = 1" : "process.stdout.write(JSON.stringify({ kind: 'Committed', head: 'fixture-head' }) + '\\n')"} }, 150)`
  const journalError = Object.assign(new Error('cannot append invocation custody'), { code: 'ENOSPC', presetJournalFailure: true })
  let identity, childClosed = false, closedAtRejection
  const invocation = withActivity({ state, action }, () => driver.invoke(['-e', script], { onInvocation: value => { identity = value; throw journalError } }))
  // Attach rejection observation immediately; the launched child's own refusal
  // must also be consumed, rather than becoming an unhandled rejection.
  const rejected = invocation.catch(error => { closedAtRejection = childClosed; return error })
  // Logging admission is asynchronous. Observe the actual child after admission,
  // rather than assuming execute() spawned it before returning its identity.
  let child, closed
  t.after(async () => { await rejected; if (closed) await closed; await recorder.flush(); rmSync(state, { recursive: true, force: true }) })
  const deadline = Date.now() + 2000
  while (!(child = [...children.values()].find(entry => entry.home === state)?.child) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2))
  assert.ok(child, 'the queued CLI process is launched despite the journal callback failure')
  closed = once(child, 'close').then(() => { childClosed = true })
  assert.ok(identity?.id); assert.equal(identity.actionId, action.id)
  const error = await rejected
  assert.equal(error, journalError, 'the original custody error remains the reported failure')
  assert.equal(existsSync(marker), true, 'no rejection escapes while the mutation process still runs')
  assert.equal(closedAtRejection, true)
  assert.equal([...children.values()].some(entry => entry.home === state), false)
})
