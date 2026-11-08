import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LfsPage } from '@/components/shell/LfsPage'
import { ComputePage } from './MachinesPage'

/** /machines and /machines/:name: the board, or one machine's page. */
export function MachinesRoute() {
  const { name } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const savedScroll = Number(sessionStorage.getItem(`connect.machine-return:${location.pathname}${location.search}`) ?? 0)
  return (
    <LfsPage>
      <ComputePage
        restoreScroll={savedScroll}
        focus={name ? `machine:${name}` : undefined}
        onOpenMachine={(machine) => navigate(machine ? `/machines/${encodeURIComponent(machine)}` : '/machines')}
        onOpenProject={(key) => navigate(`/storage/${encodeURIComponent(key.split('/')[0])}`)}
      />
    </LfsPage>
  )
}
