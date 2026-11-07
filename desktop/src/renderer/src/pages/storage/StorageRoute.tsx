import { useNavigate, useParams } from 'react-router-dom'
import { LfsPage } from '@/components/shell/LfsPage'
import { useProjects } from '@/layerfs/use-projects'
import { StoragePage } from './StoragePage'

/** /storage and /storage/:store: the Stores with their projects, or one Store's page. */
export function StorageRoute() {
  const { store } = useParams()
  const navigate = useNavigate()
  const catalog = useProjects()
  return (
    <LfsPage>
      <StoragePage
        catalog={catalog}
        focus={store ? `store:${store}` : undefined}
        onOpenStore={(name) => navigate(name ? `/storage/${encodeURIComponent(name)}` : '/storage')}
        onOpenProject={(key) => navigate(`/storage/${encodeURIComponent(key.split('/')[0])}`)}
      />
    </LfsPage>
  )
}
