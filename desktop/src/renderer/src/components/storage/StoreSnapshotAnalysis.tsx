import { useState } from 'react'
import { call } from '@/layerfs/client'
import { exactBytes } from '@/layerfs/exact-count'
import type { StoreStorageReport } from '@/layerfs/host-api'
import { LoadError, Loading } from '@/components/layerfs/States'
import { coordinate, maximum } from './measures'
import { CanonicalReportResult } from './SavedRevisionAnalysis'
export function StoreSnapshotAnalysis({ name, projects }: { name: string; projects: string[] }) {
  const choices = [...projects].sort()
  const [selected, setSelected] = useState(() => new Set(choices.slice(0, 20)))
  const [report, setReport] = useState<StoreStorageReport>()
  const [error, setError] = useState<Error>()
  const [busy, setBusy] = useState(false)
  const picked = choices.filter(project => selected.has(project))
  function choose(project: string, checked: boolean) {
    setSelected(previous => { const next = new Set(previous); if (checked) next.add(project); else next.delete(project); return next })
    setReport(undefined); setError(undefined)
  }
  async function analyze() {
    if (busy || picked.length === 0) return
    setBusy(true); setError(undefined)
    try {
      const result = await call<StoreStorageReport>('GET', `/api/stores/${encodeURIComponent(name)}/storage-report?${picked.map(project => `project=${encodeURIComponent(project)}`).join('&')}`)
      if (result.scope !== 'store' || result.name !== name) throw new Error('The analysis response does not match the requested Store. Retry the analysis.')
      setReport(result)
    }
    catch (e) { setError(e instanceof Error ? e : new Error(String(e))) }
    finally { setBusy(false) }
  }
  return <div className="storage-analysis-panel"><div className="real-storage-heading"><h3>Project snapshot analysis</h3><button disabled={busy || picked.length === 0} onClick={analyze}>{busy ? 'Analyzing…' : report ? 'Analyze again' : 'Analyze project snapshots'}</button></div>
    <p className="real-storage-note">Current main snapshots · selected projects only</p>
    <details className="real-measure-details"><summary>Choose projects ({picked.length} selected · up to 20)</summary><div className="real-project-choices">{choices.map(project => <label key={project}><input type="checkbox" checked={selected.has(project)} disabled={busy || (!selected.has(project) && picked.length >= 20)} onChange={e => choose(project, e.target.checked)} /><span>{project}</span></label>)}</div></details>
    {choices.length === 0 && <p className="real-storage-note">No projects in this Store.</p>}
    {!report && !busy && !error && <p className="real-storage-note">Analysis runs when requested, with a limit of 10,000 object visits and 64 MiB of visited canonical objects.</p>}
    {busy && <Loading label="Analyzing selected project snapshots" />}
    {error && <LoadError error={error} what="Store snapshot analysis" onRetry={analyze} />}
    {report && !busy && !error && <>
      <p className="real-storage-note">{report.selection.selected} selected main snapshots · {report.selection.excludedProjects} projects excluded · {report.complete ? 'Complete' : 'Incomplete'}</p>
      {report.complete && report.definition_version === 1 && <div className="storage-project-bars" aria-label="Canonical footprints within selected projects"><h4 className="text-xs font-medium">All canonical objects by project</h4>{report.projects.map(project => {
        const max = maximum(report.projects.map(p => p.referenced_canonical_bytes))
        return <div className="storage-project-bar-row" key={project.project}><div><span>{project.project}</span><strong>{exactBytes(project.referenced_canonical_bytes)}</strong></div><div className="storage-project-bar-track" role="img" aria-label={`${project.project}: ${exactBytes(project.exclusive_within_population_canonical_bytes)} exclusive; ${exactBytes(project.shared_within_population_canonical_bytes)} shared within selection`}><span className="storage-project-exclusive" style={{ width: `${(coordinate(project.exclusive_within_population_canonical_bytes, max) ?? 0) * 100}%` }} /><span className="storage-project-shared" style={{ width: `${(coordinate(project.shared_within_population_canonical_bytes, max) ?? 0) * 100}%` }} /></div></div>
      })}<p className="real-storage-note"><span className="storage-legend-dot" /> Exclusive <span className="storage-legend-dot storage-shared-dot" /> Shared · within selection</p><p className="real-storage-note">Shared bytes overlap across projects; these bars cannot be added to measure Store allocation.</p></div>}
      <CanonicalReportResult report={report} />
      <details className="real-measure-details"><summary>Canonical sharing within selected projects</summary><table className="real-measure-table"><thead><tr><th>Project</th><th>Canonical footprint</th><th>Exclusive within selection</th><th>Shared within selection</th></tr></thead><tbody>{report.projects.map(project => <tr key={project.project}><td>{project.project}</td><td>{exactBytes(project.referenced_canonical_bytes)}</td><td>{exactBytes(project.exclusive_within_population_canonical_bytes)}</td><td>{exactBytes(project.shared_within_population_canonical_bytes)}</td></tr>)}</tbody></table><p className="real-storage-note">Canonical object bytes within this selected set of snapshots. Main heads are captured individually when requested, not atomically. Retained history is outside this selection. Unselected projects and older history may share the same objects. These values do not attribute physical disk allocation.</p></details>
    </>}
  </div>
}
