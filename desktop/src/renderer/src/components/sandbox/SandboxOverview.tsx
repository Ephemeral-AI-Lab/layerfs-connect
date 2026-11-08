import { ArrowRight, Layers } from 'lucide-react'
import { useSandboxDetail } from './detail-context'

export function SandboxOverview() {
  const { s, observed, simulation, openTab, mounted, workspacesKnown, closed, creating } = useSandboxDetail()
  return <>
    <div className="sd-section-heading"><h2>Overview</h2><span>{simulation ? 'Simulated observation' : `Observed ${new Date(observed).toLocaleTimeString()}`}</span></div>
    {closed && <div className="sd-notice"><div><strong>This sandbox is closed</strong><p>Committed branch history remains available.</p></div></div>}
    {creating && <div className="sd-notice"><div><strong>Creating sandbox</strong><p>Workspace mounts appear after creation completes.</p></div></div>}
    {s.recorded?.downReason && <div className="sd-notice" role="status"><div><strong>Workspace observation unavailable</strong><p>{s.recorded.downReason}</p></div></div>}
    <div className="sd-facts-grid">
      <section><h2>Sandbox information</h2><dl className="sd-properties">
        <dt>Project</dt><dd>{s.project}</dd>
        <dt>Backend</dt><dd>{s.backend ?? 'Not reported'}</dd>
        <dt>Image</dt><dd><code>{s.image ?? 'Not reported'}</code></dd>
        <dt>Runtime ID</dt><dd><code>{s.runtimeId ?? 'Not reported'}</code></dd>
        <dt>Filesystem route</dt><dd>{s.recorded?.route ?? 'Not reported'}</dd>
      </dl></section>
      <section><h2>Workspaces</h2><button className="sd-summary-link" onClick={() => openTab('workspaces')}>
        <Layers size={15} /><span><strong>{workspacesKnown ? `${mounted.length} mounted workspaces` : 'Workspace status unavailable'}</strong><small>View branches and mount details</small></span><ArrowRight size={13} />
      </button></section>
    </div>
  </>
}
