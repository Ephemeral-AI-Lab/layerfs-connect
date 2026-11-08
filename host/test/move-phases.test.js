import test from 'node:test'
import assert from 'node:assert/strict'
import { failureOutcome, transferSummary } from '../jobs/move.js'
for (const code of ['Failed', 'Unknown']) for (const phase of ['check', 'snapshot', 'send', 'verify', 'install', 'record', 'retire']) {
  test(`${code} at push ${phase} preserves authority`, () => {
    const outcome = failureOutcome({ code }, phase)
    assert.equal(outcome, code === 'Unknown' || ['install', 'record'].includes(phase) ? 'unknown' : 'failed')
    const summary = transferSummary({ kind: 'move', half: 'push', target: 'docker', phase, outcome, error: { code } })
    if (outcome === 'unknown') assert.equal(summary, 'Outcome unknown · Inspect')
    else if (phase === 'retire') assert.equal(summary, 'Moved to docker; old copy on Home not removed')
    else assert.equal(summary, 'Pulled to Home; push failed (certain)')
  })
}
