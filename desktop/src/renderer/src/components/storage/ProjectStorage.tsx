import { call } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { exactCount, exactBytes, type WireInteger } from '@/layerfs/exact-count'
import { shortId } from '@/layerfs/format'
import type { ProjectState } from '@/layerfs/host-api'
import type { StoreFacts } from '@/components/layerfs/StoreFacts'
import { StoreBreakdown } from '@/pages/storage/StoreBreakdown'
import { LoadError, Loading } from '@/components/layerfs/States'
import '@/components/storage/storage.css'
interface TreeStats { projectKey: string; at: { id: string; kind: string; branch?: string }; files: WireInteger; directories: WireInteger; symlinks: WireInteger; others: WireInteger; logical: WireInteger; complete: boolean; reason?: string }
export function ProjectStorageContent({ state, store }: { state: ProjectState; store: StoreFacts }) {
  const project = state.project.key
  const pin = state.branches.find(b => b.name === 'main')?.head
  const q = useHostQuery(() => call<TreeStats>('GET', `/api/projects/${encodeURIComponent(project)}/stats?branch=main${pin ? `&pin=${pin}` : ''}`), [project, pin])
  const s = q.data
  return <div className="space-y-4"><section className="rounded-xl border p-6"><h3 className="text-base font-medium">Project saved tree</h3>
    {q.error ? <LoadError error={q.error} what="project statistics" onRetry={q.reload} /> : !s ? <Loading label="Counting saved entries" /> : <>
      <p className="my-3 text-sm text-muted-foreground">main · {shortId(s.at.id)} · {s.complete ? 'Complete' : `Incomplete: ${s.reason ?? 'reason unavailable'}`}</p>
      <dl className="store-detail-facts">{[['Files', exactCount(s.files)], ['Directories', exactCount(s.directories)], ['Symlinks', exactCount(s.symlinks)], ['Other entries', exactCount(s.others)], ['Logical file bytes', exactBytes(s.logical)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="mt-3 text-sm text-muted-foreground">Root excluded. Hard links count per path; symlinks are not followed. These are this project’s saved-tree facts. Store allocation below includes every project and retained history.</p>
    </>}
  </section><StoreBreakdown name={store.name} postgresql={store.family === 'postgresql'} tick={pin} /></div>
}
