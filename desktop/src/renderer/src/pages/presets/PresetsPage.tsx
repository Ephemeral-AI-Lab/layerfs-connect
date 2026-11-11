import { LfsPage } from '@/components/shell/LfsPage'
import { PageHeader } from '@/components/layerfs/motion/page-header'
import { LoadError, Loading } from '@/components/layerfs/States'
import { PresetControls } from '@/components/presets/PresetControls'
import { presetApi } from '@/layerfs/demo-presets-api'
import { useHostQuery, usePoll } from '@/layerfs/use-host'

export function PresetsPage() {
  const live = useHostQuery(presetApi.list, [], 'demo-presets')
  const active = live.data?.busy || live.data?.items.some(item => item.job?.state === 'running' || item.job?.state === 'queued')
  usePoll(live.reload, active ? 2000 : 5000)
  return <LfsPage><div className="flex-1 overflow-y-auto"><PageHeader title="Presets" description="One project library across four machines. Inspect each project’s files, branches and CLI script." />
    <div className="presets-body">
      {live.error && <LoadError error={live.error} what="demo presets" onRetry={live.reload} />}
      {!live.data && live.loading && <Loading label="Loading presets..." />}
      {live.data && <PresetControls data={live.data} onRefresh={live.reload} />}
    </div>
  </div></LfsPage>
}
