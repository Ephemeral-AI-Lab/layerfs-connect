import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ProjectFiles } from '@/components/files/ProjectFiles'
import { ProjectHistory } from '@/components/history/ProjectHistory'
import { ProjectSandboxes } from '@/components/sandbox/ProjectSandboxes'
import { ProjectStorageContent } from '@/components/storage/ProjectStorage'
import { LoadError, Loading } from '@/components/layerfs/States'
import { storeFacts, useStorageView } from '@/components/layerfs/StoreFacts'
import { host } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { PROJECT_TABS, ProjectTabs, type ProjectTab } from './ProjectTabs'

export function ProjectPage({ store, project }: { store: string; project: string }) {
  const { '*': section } = useParams()
  const [params] = useSearchParams()
  const key = `${store}/${project}`
  const base = `/storage/${encodeURIComponent(store)}/${encodeURIComponent(project)}`
  const details = section === 'storage' || section === 'sandboxes'
  const query = useHostQuery(() => details ? host.project(key) : Promise.resolve(null), [key, details])
  const storage = useStorageView()
  const [revision, setRevision] = useState(0)
  if (!section) return <Navigate to={`${base}/files${params.size ? `?${params}` : ''}`} replace />
  const tab = (section === 'history/diff' ? 'history' : section) as ProjectTab
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="shrink-0 px-5 pt-4">
      <div className="drag flex min-h-9 min-w-0 items-center gap-3 pl-[var(--chrome-lead)]">
        <nav aria-label="Project breadcrumbs" className="no-drag flex min-w-0 flex-1 items-center gap-2 text-13">
          <Link to="/storage" className="text-muted-foreground hover:text-foreground">Storage</Link><span className="text-muted-foreground">/</span>
          <Link to={`/storage/${encodeURIComponent(store)}`} className="truncate text-muted-foreground hover:text-foreground">{store}</Link><span className="text-muted-foreground">/</span>
          <h1 className="truncate text-14 font-medium" title={key}>{project}</h1>
        </nav>
        <button type="button" className="no-drag rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { query.reload(); setRevision(n => n + 1) }} disabled={query.loading} aria-label="Refresh project"><RefreshCw className={`size-3.5 ${query.loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <ProjectTabs base={base} current={tab} />
    </header>
    {!PROJECT_TABS.includes(tab) ? <div className="p-5"><p>This project page does not exist.</p><Link to={`${base}/files`} className="underline">Open project files</Link></div> :
      details && query.error && !query.data ? <div className="p-5"><LoadError error={query.error} what="this project" onRetry={query.reload} /></div> :
      details && !query.data ? <Loading label="Reading project…" /> : <>
        {query.error && <div role="alert" className="px-5 pt-3 text-sm text-destructive">{query.error.message}</div>}
        {tab === 'files' && <div className="@container/files flex min-h-0 flex-1 flex-col p-5"><ProjectFiles project={key} tick={revision} initialBranch={params.get('branch') ?? undefined} /></div>}
        {tab === 'history' && <ProjectHistory project={key} tick={revision} />}
        {tab === 'sandboxes' && query.data && <ProjectSandboxes project={key} state={query.data} />}
        {tab === 'storage' && query.data && <div className="min-h-0 flex-1 overflow-auto p-5"><ProjectStorageContent state={query.data} store={storeFacts(query.data.project, storage)} /></div>}
      </>}
  </div>
}
