import { useEffect, useState } from 'react'
import { host } from '@/layerfs/client'
import { ChevronDown, ChevronRight, CircleAlert, GitBranch, Layers, Users } from 'lucide-react'
import { CopyValue } from './CopyValue'
import { clock } from './model'
import { useSandboxDetail } from './detail-context'
import { SandboxActivityRows } from './SandboxActivityRows'

export function SandboxWorkspaces() {
  const { s, time, selectedWorkspace, setSelectedWorkspace, workspaceTab, setWorkspaceTab,
    started, active, completed, mounted, shownWorkspaces, selected, selectedState, commands,
    selectedPath, workspacesKnown, dirty, workspaceLabel, actorName, actorLink } = useSandboxDetail()
  const [head, setHead] = useState<{ ws: string; value: string } | null>(null)
  useEffect(() => {
    if (!selected || !s.recorded) return
    let active = true
    host.workspaceStatus(selected.id).then(r => { if (active) setHead({ ws: selected.id, value: r.branch_head ?? 'Not reported' }) }, e => { if (active) setHead({ ws: selected.id, value: `Unavailable: ${e.message}` }) })
    return () => { active = false }
  }, [selected?.id, s])
  const showUsers = shownWorkspaces.some(w => w.users.length > 0)
  const currentTab = workspaceTab === 'commands' && commands.length > 0 ? 'commands' : 'details'
  return <>
    <div className="sd-section-heading"><h2>Workspaces</h2><span>{workspacesKnown ? `${mounted.length} mounted / 16 slots` : 'Workspace status unavailable'}</span></div>
    {!shownWorkspaces.length ? <p className="sd-empty">{s.recorded?.downReason ? `Workspace state unavailable: ${s.recorded.downReason}` : 'No workspaces are currently mounted in this sandbox.'}</p> :
      <div className="sd-workspace-table" data-users={showUsers}>
        <div className="sd-workspace-columns"><span>Name</span><span>Branch</span>{showUsers && <span>Used by</span>}<span>State</span></div>
        {shownWorkspaces.map(w => <button key={w.id} className="sd-workspace-row" aria-expanded={selectedWorkspace === w.id} onClick={() => { setSelectedWorkspace(id => id === w.id ? null : w.id); setWorkspaceTab('details') }}>
          <span>{selectedWorkspace === w.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<strong>{w.name}</strong></span>
          <span><GitBranch size={12} />{w.branch}</span>{showUsers && <span>{w.users.map(actorName).join(', ')}</span>}<span>{workspaceLabel(w.id)}</span>
        </button>)}
      </div>}
    {selected && selectedState && <section className="sd-workspace-inspect">
      <div className="sd-section-heading"><h2><Layers size={16} />{selected.name}</h2><CopyValue value={selected.id} label="Copy handle" /></div>
      <div className="sd-subtabs" aria-label="Workspace inspection">
        <button aria-pressed={currentTab === 'details'} onClick={() => setWorkspaceTab('details')}>Details</button>
        {commands.length > 0 && <button aria-pressed={currentTab === 'commands'} onClick={() => setWorkspaceTab('commands')}>Commands</button>}
      </div>
      {currentTab === 'details' && <>
        <dl className="sd-properties">
          <dt>Handle</dt><dd><code>{selected.id}</code></dd>
          <dt>Branch</dt><dd>{selected.branch}</dd>
          <dt>Mount path</dt><dd><code>{selectedPath}</code><CopyValue value={selectedPath} label="Copy path" /></dd>
          <dt>Sandbox</dt><dd>{s.name}</dd>
          <dt>Mounted</dt><dd>{selectedState.unmounted ? 'No' : selectedState.mounting ? 'Attaching' : 'Yes'}</dd>
          <dt>Filesystem route</dt><dd>{s.recorded?.route ?? 'Not reported'}</dd>
          <dt>Activity</dt><dd>{workspaceLabel(selected.id)}</dd>
          <dt>Base commit</dt><dd><code>{s.recorded ? selected.base ?? 'Not reported' : completed.filter(e => e.workspace === selected.id && e.method === 'workspace.commit' && e.outcome === 'ok').at(-1)?.result.split('\n')[0].split(' · ')[1] ?? `example-${selected.branch}-base`}</code></dd>
          <dt>Branch head</dt><dd>{s.recorded ? head?.ws === selected.id ? head.value : 'Reading…' : dirty(selected.id).startsWith('Conflict') ? 'Head moved · pending conflict resolution' : 'Matches the recorded base'}</dd>
          <dt>Base Layer</dt><dd><code>{selected.baseLayer ?? 'Not reported'}</code></dd>
          <dt>Head moved since mount</dt><dd>{selected.headMovedSinceMount == null ? 'Not reported' : selected.headMovedSinceMount ? 'Yes' : 'No'}</dd>
          <dt>Pending merge</dt><dd>{selected.pendingMerge == null ? 'Not reported' : selected.pendingMerge ? 'Yes' : 'No'}</dd>
          <dt>Changes</dt><dd>{selectedState.unmounted ? 'Overlay removed · committed history preserved' : dirty(selected.id)}</dd>
        </dl>
        {selected.users.length > 0 && <div className="sd-workspace-users"><h3><Users size={13} />Using this workspace</h3>{selected.users.map(id => <div key={id}>{actorLink(id)}<span>{active.find(e => e.actor === id)?.detail ?? (selectedState.unmounted ? 'Last linked user' : 'Between calls')}</span></div>)}</div>}
        {started.filter(e => e.workspace === selected.id && e.method === 'workspace.unmount').map(e => <div className="sd-notice" key={e.id}><CircleAlert size={14} /><div><strong>Unmount attempt · {clock(e.start)}</strong><p>{time < e.end ? 'Unmounting…' : e.result}</p></div></div>)}
      </>}
      {currentTab === 'commands' && <><p className="sd-muted-note">Commands recorded by Connect</p><SandboxActivityRows rows={commands} /></>}
    </section>}
  </>
}
