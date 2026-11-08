import { FolderTree } from 'lucide-react'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import type { BranchInfo } from '@/layerfs/host-api'
import { useEffect, useState } from 'react'
import { previewBranches } from './file-preview-data'
import { connectBridge } from '@/layerfs/bridge'
import { FilesTab } from './FilesTab'

/** Shared LayerFS browser for Storage projects and a chat's linked project. */
export function ProjectFiles({ project, tick = 0, initialBranch }: { project: string; tick?: number; initialBranch?: string }) {
  const [sample, setSample] = useState(false)
  const available = import.meta.env.DEV && connectBridge.mode === 'sim' && project === 'shop/api'
  return <>{available && <div className="fp-preview-notice"><span>{sample ? 'Sample data · read-only' : 'Browsing simulated CLI files'}</span><button onClick={() => setSample(v => !v)}>{sample ? 'Browse CLI files' : 'Open labelled design preview'}</button></div>}{sample && available ? <FilesTab project={project} branches={previewBranches} initialBranch={initialBranch} preview /> : <HostProjectFiles key={project} project={project} tick={tick} initialBranch={initialBranch} />}</>
}

function HostProjectFiles({ project, tick, initialBranch }: { project: string; tick: number; initialBranch?: string }) {
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [pos, setPos] = useState(0)
  const query = useHostQuery(() => call<{ items: BranchInfo[]; next: number | null }>('GET', `/api/projects/${encodeURIComponent(project)}/branches?pos=${pos}`), [project, pos])
  useEffect(() => { if (query.data) setBranches(all => [...new Map([...(pos ? all : []), ...query.data!.items].map(b => [b.name, b])).values()]) }, [query.data, pos])
  if (query.error) return <LoadError error={query.error} what="this project's files" onRetry={query.reload} />
  if (!query.data) return <Loading label="Reading project files…" />
  if (!branches.length) return <Empty icon={FolderTree} title="No branches to browse">This LayerFS project has no available branches.</Empty>
  return <div className="flex min-h-0 flex-1 flex-col">{query.data.next != null && <button className="fp-context" onClick={() => setPos(query.data!.next!)}>Load more Branches</button>}<FilesTab key={project} project={project} branches={branches} tick={tick} initialBranch={initialBranch} /></div>
}
