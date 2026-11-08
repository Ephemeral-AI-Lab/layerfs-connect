/** Targeted reports require scope and coverage, never the legacy findings shape. */
export function validateReport(report, request) {
  const [family, operation = 'diagnose'] = request.target.split('.')
  const mode = request.target === 'store.integrity' ? (request.quick ? 'quick' : 'full') : request.write_test ? 'write-test' : 'observation'
  if (!report || typeof report.ok !== 'boolean' || typeof report.truncated !== 'boolean' || !report.counts || typeof report.counts !== 'object' || !Array.isArray(report.checks) || !Array.isArray(report.findings) || typeof report.complete !== 'boolean' || report.target?.kind !== family || report.target?.name !== (request.name ?? 'local') || report.mode !== mode || report.operation !== operation) {
    throw Object.assign(new Error('Interrupted — no valid targeted Doctor report.'), { code: 'InvalidReport' })
  }
  return report
}
