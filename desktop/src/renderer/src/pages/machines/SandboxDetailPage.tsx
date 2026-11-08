import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Box } from 'lucide-react'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { useSimulation } from '@/components/layerfs/Simulation'
import { connectBridge } from '@/layerfs/bridge'
import { host } from '@/layerfs/client'
import { SIMULATIONS, simSandbox } from '@/layerfs/compute-sim'
import { useHostQuery } from '@/layerfs/use-host'
import { exampleSandbox } from '@/layerfs/simulation/sandbox'
import { machineSandboxSnapshot } from '@/layerfs/simulation/machine-snapshot'
import { HostSandboxDetail } from '@/components/sandbox/HostSandboxDetail'
import { SandboxDetailPreview } from '@/layerfs/simulation/SandboxDetailPreview'
import { Button } from '@/components/ui/button'
import '@/components/sandbox/detail.css'

/** Standalone resource route. A real host is deliberately not queried by this simulation page. */
export function SandboxDetailPage() {
  const { name = '', sandbox = '' } = useParams()
  const navigate = useNavigate(), location = useLocation()
  const picked = useSimulation()
  const sample = exampleSandbox(name,sandbox)
  const query = useHostQuery(async () => {
    if (!picked) return null
    if (sample) return sample
    if (!picked && connectBridge.mode !== 'sim') return null
    const simulation = picked ? SIMULATIONS[picked] : null
    const view = simulation ? simulation.view : await host.machines()
    if (!view.available) return null
    const machine = view.machines.find(m => m.name === name)
    const record = view.sandboxes.find(b => b.name === sandbox && b.machine === name)
    if (!machine || !record) return null
    const info = simulation ? simSandbox(simulation,sandbox) : await host.sandbox(sandbox)
    if (info.machine !== name) return null
    return machineSandboxSnapshot(machine,info)
  }, [name,sandbox,picked])
  const matching = query.data?.name === sandbox && query.data.machine.name === name ? query.data : null
  const back = () => location.state?.fromMachine ? navigate(-1) : navigate(`/machines/${encodeURIComponent(name)}?view=sandboxes`)
  if (!picked) return <div className="sandbox-page" data-standalone-sandbox><HostSandboxDetail key={`${name}:${sandbox}`} name={sandbox} machine={name} navigation={{ backLabel: name, onBack: back }} /></div>
  return <div className="sandbox-page" data-standalone-sandbox>
    {query.error ? <LoadError error={query.error} what="the simulated sandbox" onRetry={query.reload} />
      : query.loading && !matching ? <Loading label="Reading simulated sandbox…" />
      : matching ? <SandboxDetailPreview key={`${name}:${sandbox}:${picked ?? 'preview'}`} snapshot={matching} initialTime={matching.duration ? 9 : 0} navigation={{ backLabel: name, onBack: back }} />
      : <Empty icon={Box} title="No simulated sandbox found">{sandbox} is not recorded on {name} in this simulation.<Button variant="outline" size="sm" onClick={back}>Back to {name}</Button></Empty>}
  </div>
}
