import { useNavigate, useParams } from 'react-router-dom'
import { LfsPage } from '@/components/shell/LfsPage'
import { useProjects } from '@/layerfs/use-projects'
import { StoragePage } from './StoragePage'
import { ProjectPage } from './project/ProjectPage'
import { useState } from 'react'
import { NewProjectDialog } from './NewProjectDialog'

/** /storage and /storage/:store: the Stores with their projects, or one Store's page. */
export function StorageRoute() {
  const { store, project } = useParams()
  const navigate = useNavigate()
  const catalog = useProjects()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  return (
    <LfsPage>
      {store && project ? <ProjectPage key={`${store}/${project}`} store={store} project={project} /> : (
      <StoragePage
        catalog={catalog}
        onAddProject={setAddingTo}
        focus={store ? `store:${store}` : undefined}
        onOpenStore={(name) => navigate(name ? `/storage/${encodeURIComponent(name)}` : '/storage')}
        onOpenProject={(key) => navigate(`/storage/${key.split('/').map(encodeURIComponent).join('/')}/files`)}
      />
      )}
      {addingTo && <NewProjectDialog key={addingTo} store={addingTo} onClose={() => setAddingTo(null)} onCreated={catalog.reload} />}
    </LfsPage>
  )
}
