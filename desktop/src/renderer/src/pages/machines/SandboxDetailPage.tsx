import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { HostSandboxDetail } from '@/components/sandbox/HostSandboxDetail'
import '@/components/sandbox/detail.css'

export function SandboxDetailPage() {
  const { name = '', sandbox = '' } = useParams()
  const navigate = useNavigate(), location = useLocation()
  const back = () => location.state?.fromMachine ? navigate(-1) : navigate(`/machines/${encodeURIComponent(name)}?view=sandboxes`)
  return <div className="sandbox-page" data-standalone-sandbox><HostSandboxDetail key={`${name}:${sandbox}`} name={sandbox} machine={name} navigation={{ backLabel: name, onBack: back }} /></div>
}
