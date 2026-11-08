import { DoctorAction } from '@/components/doctor/DoctorPanel'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { LoadError, Loading } from '@/components/layerfs/States'
import { connectBridge } from '@/layerfs/bridge'
import { host } from '@/layerfs/client'
import type { SandboxInfo } from '@/layerfs/host-api'
import { useHostQuery } from '@/layerfs/use-host'
import { sandboxSnapshot } from '@/layerfs/sandbox-snapshot'
import { SandboxDetail } from './SandboxDetail'
import type { SandboxDetailProps } from './types'

export function HostSandboxDetail({ name, project, machine, navigation, controls }: {
  name: string; project?: string; machine?: string; navigation: SandboxDetailProps['navigation']
  controls?: (sandbox: SandboxInfo, reload: () => void) => ReactNode
}) {
  const query = useHostQuery(async () => {
    const info = await host.sandbox(name)
    if (project && info.project !== project) throw new Error(`Sandbox ${name} does not belong to ${project}.`)
    if (machine && info.machine !== machine) throw new Error(`Sandbox ${name} does not belong to machine ${machine}.`)
    return info
  }, [name, project, machine])
  const machines = useHostQuery(() => host.machines(), [], 'sandbox-detail:machines')
  const [observedAt, setObservedAt] = useState(Date.now)
  useEffect(() => { if (query.data) setObservedAt(Date.now()) }, [query.data])
  const info = query.data
  if (!info) return <>
    <button type="button" className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" onClick={navigation.onBack}><ArrowLeft size={13} />{navigation.backLabel}</button>
    {query.error ? <LoadError error={query.error} what="this sandbox" onRetry={query.reload} /> : <Loading label="Reading sandbox…" />}
  </>
  const parent = machines.data?.available ? machines.data.machines.find(m => m.name === info.machine) : undefined
  return <>
    {query.error && <div role="alert" className="mb-3 text-sm text-destructive">{query.error.message}</div>}
    {info.refusal && <div role="alert" className="mb-3 text-sm text-destructive">{info.refusal.code}: {info.refusal.message}</div>}
    <SandboxDetail simulation={connectBridge.mode === 'sim'} key={name} snapshot={sandboxSnapshot(info, project, parent)} time={0} playing={false} observedAt={observedAt}
      navigation={navigation} onRefresh={() => { query.reload(); machines.reload() }}
      controls={<><DoctorAction target="sandbox" name={name} />{controls?.(info, query.reload)}</>} notice={connectBridge.mode === 'sim' ? 'Simulated CLI observation; no native resources are started.' : 'Current LayerFS resource state.'} />
  </>
}
