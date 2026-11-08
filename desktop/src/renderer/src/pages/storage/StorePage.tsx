import { DoctorAction } from '@/components/doctor/DoctorPanel'
// One Store workspace: projects, backup destinations and explicit Store details.
import { Archive, FolderPlus, HardDrive, Power, Search, Trash2, Unplug } from 'lucide-react'
import { useState } from 'react'
import { Crumbs } from '@/components/layerfs/Crumbs'
import { StoreIcon } from '@/components/layerfs/identity/StoreIcon'
import { Empty } from '@/components/layerfs/States'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProjectRows } from '@/layerfs/project-rows'
import { ago, bytes, when } from '@/layerfs/format'
import { clearingCall } from '@/layerfs/states'
import { go } from '@/layerfs/go'
import { JobActivity, JobSteps, OpPanel } from '@/pages/storage/JobProgress'
import { canAddProject, Location, type StoreActions, StoreMenu } from '@/pages/storage/StoreCard'
import { ProjectTile } from '@/pages/storage/StoreSection'
import { StoreBreakdown } from '@/pages/storage/StoreBreakdown'
import type { ProjectCatalog } from '@/layerfs/use-projects'
import type { MachineSandbox, StorageJob, StorageView, StoreRow } from '@/layerfs/host-api'

interface Props {
  name: string
  view: StorageView
  job: StorageJob | undefined
  jobs: StorageJob[]
  sandboxes: Map<string, MachineSandbox[]> | null
  catalog: ProjectCatalog
  actions: (store: StoreRow) => StoreActions
  onBack: () => void
  back?: { label: string; onBack: () => void }
  onOpenProject?: (key: string) => void
}

export function StorePage({ name, view, job, jobs, sandboxes, catalog, actions, onBack, back, onOpenProject }: Props) {
  const [search, setSearch] = useState('')
  const rows = useProjectRows(catalog)
  const s = view.stores.find(s => s.name === name)
  const crumbs = <Crumbs back={back ?? { label: 'Storage', onBack }} items={[{ label: 'Storage', onClick: onBack }, { label: name }]} />
  if (!s) return <div className="store-workspace">{crumbs}<Empty icon={HardDrive} title={`No Store named ${name}`}>It was removed or disconnected, or this home never had it.</Empty></div>
  const on = actions(s)
  const pg = s.kind === 'postgresql'
  const machine = view.machines.find(m => m.name === s.machine)
  const stopped = !pg && machine?.state === 'stopped'
  const using = sandboxes ? [...new Set(s.projects.flatMap(p => (sandboxes.get(`${s.name}/${p}`) ?? []).filter(b => b.state !== 'gone').flatMap(b => b.machine ? [b.machine] : [])))].sort() : null
  const query = search.trim().toLowerCase()
  const shown = s.projects.filter(p => p.toLowerCase().includes(query))
  return <div className="store-workspace">
    <div className="store-workspace-breadcrumb">{crumbs}<StoreMenu store={s} on={on} /></div>
    <header className="store-workspace-header">
      <StoreIcon family={s.kind} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="store-workspace-title"><h1 title={s.name}>{s.name}</h1><span>{pg ? 'PostgreSQL' : 'SQLite'}</span></div>
        <div className="store-workspace-location"><Location store={s} machine={machine} showState={false} />{pg && <span>Shared across machines</span>}</div>
      </div>
      {!pg && <span className="store-workspace-size">{s.size ? bytes(s.size.bytes) : 'Size unavailable'}</span>}
      <DoctorAction target="store.integrity" name={s.name} label="Check integrity" />
      {pg && <DoctorAction target="store.connection" name={s.name} label="Test connection" />}
      <Button size="sm" variant="outline" onClick={on.addProject} disabled={!canAddProject(s, on)}><FolderPlus /> Add project</Button>
    </header>

    {(s.down || s.state === 'unresolved' || stopped || (pg && s.postgresql?.reachable === false)) && <div role="alert" className="store-workspace-alert">
      <p>{s.down || (s.state === 'unresolved' ? `Inspect ${clearingCall('store', s.name, s.op).status} before continuing.` : stopped ? `${s.machine} is stopped.` : s.postgresql?.error || 'The database could not be reached.')}</p>
      {stopped && <Button size="xs" variant="outline" onClick={on.start}><Power /> Start {s.machine}</Button>}
    </div>}
    {job ? <JobSteps job={job} onRetry={on.retry && (() => on.retry!(job))} /> : s.state === 'busy' && s.op ? <OpPanel store={s} /> : null}

    <StoreBreakdown name={s.name} postgresql={pg} tick={job?.ended} />

    <section aria-label={`Projects in ${s.name}`} className="store-workspace-projects">
      <div className="store-section-heading"><h2>Projects <span>· {s.projects.length}</span></h2>
        <label className="store-project-search"><Search aria-hidden="true" className="size-4" /><Input aria-label={`Search projects in ${s.name}`} placeholder="Search projects" value={search} onChange={e => setSearch(e.target.value)} /></label>
      </div>
      {shown.length ? <ul className="store-project-grid">{shown.map(name => {
        const key = `${s.name}/${name}`
        return <li key={key}><ProjectTile project={{ key, name, row: rows.byKey.get(key) }} onOpen={onOpenProject} /></li>
      })}</ul> : <div className="store-workspace-empty"><p>{query ? `No projects match “${search.trim()}”.` : 'No projects yet.'}</p>
        {query ? <Button size="xs" variant="ghost" onClick={() => setSearch('')}>Clear search</Button> : <Button size="xs" variant="outline" disabled={!canAddProject(s, on)} onClick={on.addProject}><FolderPlus /> Add project</Button>}
      </div>}
    </section>

    {pg ? <section className="store-workspace-section" aria-label="Machines using this Store">
      <div className="store-section-heading"><h2>Machines using this Store</h2><span>Shared database</span></div>
      <p className="store-section-note">Machines with recorded sandboxes using these projects.</p>
      {using?.length ? <div className="store-machine-list">{using.map(name => <Button key={name} size="sm" variant="outline" onClick={() => go.machine(name)}><HardDrive /> {name}</Button>)}</div>
        : <p className="store-section-note">{using ? 'No sandbox machines recorded yet.' : 'Machine usage is unavailable.'}</p>}
    </section> : <section className="store-workspace-section" aria-label={`Backups of ${s.name}`}>
      <div className="store-section-heading"><h2>Backups <span>· {s.links.length}</span></h2><Button size="xs" variant="outline" onClick={on.backup} disabled={s.state === 'down' || s.state === 'busy'}><Archive /> Back up…</Button></div>
      <p className="store-section-note">A backup carries every project in this Store.</p>
      {s.links.length ? <ul className="store-backup-list">{s.links.map(link => {
        const file = view.buckets.find(b => b.name === link.bucket)?.files?.find(f => f.file === link.file && f.store === s.name)
        const at = file?.modified ?? link.last?.at
        const size = file?.bytes ?? link.last?.bytes
        return <li key={link.bucket}>
          <Archive aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <div className="store-backup-name"><span>{link.bucket} / {link.file}</span><small>{at ? `Last saved ${ago(at)}` : 'No backup time recorded'}{size != null ? ` · ${bytes(size)}` : ''}</small></div>
          <Button size="xs" variant="ghost" disabled={s.state === 'down' || s.state === 'busy'} onClick={() => on.backupTo(link)}>Back up now</Button>
          {file && <Button size="xs" variant="ghost" disabled={s.state === 'busy'} onClick={() => on.restore(link.bucket, link.file)}>Restore…</Button>}
        </li>
      })}</ul> : <p className="store-section-note">No backup destinations configured.</p>}
    </section>}

    <details className="store-workspace-disclosure"><summary>Recent operations <span>This session · {jobs.length}</span></summary>
      <div className="store-disclosure-body">{jobs.length ? <JobActivity jobs={jobs} /> : <p className="store-section-note">No push, pull, move, or backup operations in this session.</p>}</div>
    </details>
    <details className="store-workspace-disclosure"><summary>Store details</summary><div className="store-disclosure-body">
      <dl className="store-detail-facts"><div><dt>Type</dt><dd>{pg ? 'PostgreSQL' : 'SQLite'}</dd></div><div><dt>Location</dt><dd>{pg ? s.postgresql?.target ?? 'Unavailable' : s.machine === 'native' ? 'LayerFS Home' : s.machine ?? 'Unavailable'}</dd></div>
        {s.created != null && <div><dt>Created</dt><dd>{when(s.created)}</dd></div>}
        {!pg && <><div><dt>Database file</dt><dd>{s.size ? bytes(s.size.file) : 'Unavailable'}</dd></div><div><dt>Write-ahead log</dt><dd>{s.size ? bytes(s.size.wal) : 'Unavailable'}</dd></div></>}
      </dl>
      <div className="store-danger-zone"><div><h3>{pg ? 'Disconnect Store' : 'Remove Store'}</h3><p>{pg ? 'Remove this connection from LayerFS Home. The database stays.' : 'Remove this Store and all its projects. Existing backups stay in their buckets.'}</p></div>
        <Button size="sm" variant="outline" className="text-destructive" onClick={pg ? on.disconnect : on.remove}>{pg ? <Unplug /> : <Trash2 />}{pg ? 'Disconnect…' : 'Remove…'}</Button>
      </div>
    </div></details>
  </div>
}
