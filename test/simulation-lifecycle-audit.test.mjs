import test from 'node:test'
import assert from 'node:assert/strict'
import { auditLifecycleAdmission } from '../tools/simulation/lifecycle-audit.mjs'
const interval = (key, call, handle, start, end) => [
  { type: 'step.started', step: key, argv: ['workspace', call, handle], at: new Date(start).toISOString() },
  { type: 'step.completed', step: key, at: new Date(end).toISOString() },
]
test('adjacent lifecycle boundaries admit parallel normal calls and independent sandboxes', () => {
  const journal = [
    ...interval('mount-a', 'mount', 'one', 10, 20),
    ...interval('exec-a', 'exec', 'one:a', 20, 40),
    ...interval('exec-b', 'exec', 'one:b', 20, 35),
    ...interval('unmount-a', 'unmount', 'one:a', 40, 50),
    ...interval('mount-other', 'mount', 'two', 15, 45),
  ].reverse()
  assert.deepEqual(auditLifecycleAdmission(journal), { checkedSandboxCount: 2, checkedWorkspaceCalls: 5, lifecycleAdmissionVerified: true })
})
test('an exclusive mount overlapping a different workspace unmount fails', () => {
  assert.throws(() => auditLifecycleAdmission([...interval('mount', 'mount', 'one', 10, 30), ...interval('unmount', 'unmount', 'one:b', 20, 40)]), /lifecycle overlap/)
})
test('normal calls cannot run during lifecycle admission, while cancellation can bypass it', () => {
  assert.throws(() => auditLifecycleAdmission([...interval('mount', 'mount', 'one', 10, 30), ...interval('exec', 'exec', 'one:b', 20, 40)]), /lifecycle overlap/)
  assert.equal(auditLifecycleAdmission([...interval('mount', 'mount', 'one', 10, 30), ...interval('cancel', 'exec-cancel', 'one:b', 20, 40)]).checkedWorkspaceCalls, 1)
  assert.throws(() => auditLifecycleAdmission([interval('missing', 'commit', 'one:b', 10, 20)[0]]), /no confirmed completion/)
})
