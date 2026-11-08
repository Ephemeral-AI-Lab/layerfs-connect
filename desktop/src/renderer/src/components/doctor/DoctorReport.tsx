import type { TargetedReport } from '@/layerfs/doctor-api'
export function DoctorReport({ report }: { report: TargetedReport }) {
  const errors = report.ok === false || report.findings.some(f => f.severity === 'error') || report.checks.some(c => c.outcome === 'fail' && c.severity === 'error')
  const verdict = errors ? report.complete ? 'Issues found' : 'Issues found — some checks remain unverified' : !report.complete ? 'Incomplete — no issues found in completed checks' : report.findings.length ? 'Completed with warnings' : 'Completed — no issues found within the stated scope and mode'
  const checks = report.checks.map((check, index) => ({ check, index })).sort((a, b) => Number(['pass', 'skipped'].includes(a.check.outcome)) - Number(['pass', 'skipped'].includes(b.check.outcome)))
  return <div className="space-y-3">
    <p role="status" className="font-medium">{verdict}</p>
    <p className="text-xs text-muted-foreground">{report.mode} · observed {new Date(report.observed_at_ms).toLocaleString()} · {report.duration_ms} ms</p>
    <p className="text-sm">Findings: {report.findings.length} · Coverage: {report.complete ? 'complete' : 'incomplete'}{report.truncated ? ' · retained rows truncated' : ''}</p>
    <p className="break-all text-xs text-muted-foreground">Reported counts: {JSON.stringify(report.counts)}</p>
    {report.findings.length > 0 && <div className="divide-y rounded-md border" aria-label="Retained findings">{report.findings.map((finding, index) => <div key={index} className="space-y-1 p-3 text-sm"><p>{finding.severity} · {finding.message ?? 'See associated check'}</p>{finding.entity != null && <p className="text-xs text-muted-foreground">{JSON.stringify(finding.entity)}</p>}{finding.fix && <p className="select-all text-xs">Suggested action (advisory): {finding.fix}</p>}</div>)}</div>}
    <div className="divide-y rounded-md border">{checks.map(({ check, index }) => <details key={`${check.id}:${index}`} className="p-3">
      <summary className="cursor-pointer text-sm">{check.outcome}{check.severity ? ` / ${check.severity}` : ''} · {check.message}</summary>
      <div className="mt-2 space-y-2 break-words text-xs text-muted-foreground"><code>{check.code}</code>
        {check.blocked_by != null && <p>Dependencies: {JSON.stringify(check.blocked_by)}</p>}
        {check.evidence != null && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(check.evidence, null, 2)}</pre>}
        {check.fix && <p>Suggested action (advisory): <code className="select-all">{check.fix}</code></p>}
      </div>
    </details>)}</div>
  </div>
}
