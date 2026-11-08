import { FolderTree } from 'lucide-react'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { host } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { FilesTab } from './FilesTab'
import { useState } from 'react'
import { connectBridge } from '@/layerfs/bridge'
import { previewBranches } from './file-preview-data'

/** Shared LayerFS browser for Storage projects and a chat's linked project. */
export function ProjectFiles({ project, tick = 0, initialBranch }: { project: string; tick?: number; initialBranch?: string }) {
  const available = import.meta.env.DEV && connectBridge.mode === 'sim' && project === 'shop/api'
  const [preview, setPreview] = useState(true)
  if (available && preview) return <div className="fp-preview-shell"><div className="fp-preview-notice"><span><strong>File history preview</strong><span>Sample data · read-only</span></span><button type="button" onClick={() => setPreview(false)}>Browse host files <span aria-hidden="true">↗</span></button></div><FilesTab key={`preview:${project}`} project={project} branches={previewBranches} initialBranch={initialBranch} preview /></div>
  return <>{available && <div className="fp-preview-notice"><span>Browsing simulated host files</span><button type="button" onClick={() => setPreview(true)}>Preview file history <span aria-hidden="true">↗</span></button></div>}<HostProjectFiles key={project} project={project} tick={tick} initialBranch={initialBranch} /></>
}

function HostProjectFiles({ project, tick, initialBranch }: { project: string; tick: number; initialBranch?: string }) {
  const query = useHostQuery(() => host.project(project), [project, tick])
  if (query.error) return <LoadError error={query.error} what="this project's files" onRetry={query.reload} />
  if (!query.data) return <Loading label="Reading project files…" />
  if (!query.data.branches.length) return <Empty icon={FolderTree} title="No branches to browse">This LayerFS project has no available branches.</Empty>
  return <FilesTab key={project} project={project} branches={query.data.branches} tick={tick} initialBranch={initialBranch} />
}
