/** Explicitly simulated diagnostic evidence, never a live resource verdict. */
export function doctorReport(words) {
  const [kind, second, third] = words
  const operation = ['store', 'backup'].includes(kind) ? second : 'diagnose'
  const name = ['store', 'backup'].includes(kind) ? third : kind === 'host' ? 'local' : second
  const scenario = name?.includes('blocked') ? 'blocked' : name?.includes('incomplete') || name?.includes('truncated') ? 'unknown' : name?.includes('failed') ? 'fail' : 'pass'
  const check = { id: 'simulated.connection', code: 'simulated.connection', outcome: scenario, severity: scenario === 'fail' ? 'error' : null, entity: { kind, name }, message: 'Simulated diagnosis; no live resource was checked.', evidence: { simulated: true }, fix: null, blocked_by: [], observed_ms: Date.now(), duration_ms: 1 }
  return { ok: scenario !== 'fail', complete: !['unknown','blocked'].includes(scenario), target: { kind, name }, operation, mode: kind === 'store' && operation === 'integrity' ? words.includes('--quick') ? 'quick' : 'full' : words.includes('--write-test') ? 'write-test' : 'observation', home: process.env.LAYERFS_HOME, checks: name?.includes('truncated') ? [check, { ...check, message: 'Second retained check with repeated id.' }] : [check], findings: scenario === 'fail' ? [{ ...check, check_id: check.id }] : [], truncated: !!name?.includes('truncated'), counts: { pass: scenario === 'pass' ? 1 : 0, fail: scenario === 'fail' ? 1 : 0, unknown: scenario === 'unknown' ? 1 : 0 }, observed_at_ms: Date.now(), duration_ms: 1, simulated: true }
}
