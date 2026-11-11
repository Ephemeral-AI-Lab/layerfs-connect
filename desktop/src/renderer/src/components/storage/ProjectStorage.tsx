import type { ProjectState } from '@/layerfs/host-api'
import type { StoreFacts } from '@/components/layerfs/StoreFacts'
import { go } from '@/layerfs/go'
import { StorageHistory } from './StorageHistory'
import '@/components/storage/storage.css'

export function ProjectStorageContent({ state, store }: { state: ProjectState; store: StoreFacts }) {
  const project = state.project.key
  const pin = state.branches.find(b => b.name === 'main')?.head
  return <div className="storage-dashboard">
    <StorageHistory key={project} project={project} branches={state.branches} pin={pin} />
    <footer className="storage-scope-footer"><span>Store allocation includes every project and retained history.</span><button onClick={() => go.store(store.name)}>View Store usage →</button></footer>
  </div>
}
