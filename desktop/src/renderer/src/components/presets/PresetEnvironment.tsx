import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, LoaderCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { presetApi, reloadEnvironment } from '@/layerfs/demo-presets-api'
import { useHostQuery, usePoll } from '@/layerfs/use-host'
import { EnvironmentResetControls } from './EnvironmentResetControls'

export function PresetEnvironment() {
  const live = useHostQuery(presetApi.list, [], 'demo-presets')
  const active = live.data?.busy || live.data?.items.some(item => item.job?.state === 'running' || item.job?.state === 'queued')
  usePoll(live.reload, active ? 2000 : 5000)
  const [error, setError] = useState<string>(), [waiting, setWaiting] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const observed = useRef<string | null>(null)
  useEffect(() => {
    if (!live.data) return
    if (observed.current !== null && observed.current !== live.data.active) reloadEnvironment()
    observed.current = live.data.active
  }, [live.data?.active])
  if (!live.data) return null
  const current = live.data.items.find(item => item.id === live.data!.active)
  const job = live.data.active === 'original' ? live.data.original.job : current?.job
  const running = job?.state === 'running' || job?.state === 'queued'
  const name = live.data.active.charAt(0).toUpperCase() + live.data.active.slice(1)
  const home = live.data.active === 'original' ? live.data.original.home : current?.home
  const activity = job ? `/activity?operation=${encodeURIComponent(job.id)}${job.actionId ? `&action=${encodeURIComponent(job.actionId)}` : ''}` : '/activity'
  async function leave() {
    setWaiting(true); setError(undefined)
    try { await presetApi.activate('original'); reloadEnvironment() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setWaiting(false) }
  }
  return <div className="no-drag shrink-0 border-b px-5 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <DropdownMenu><DropdownMenuTrigger className="flex min-h-8 items-center gap-1.5 rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Viewing ${name} environment actions`}>Viewing {name}<ChevronDown className="size-3" /></DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-44"><DropdownMenuItem onSelect={() => setResetOpen(true)} disabled={waiting || live.data.busy} variant="destructive"><RotateCcw />Reset environment…</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      {live.data.active !== 'original' && <Button className="ml-auto" size="sm" variant="ghost" disabled={waiting || live.data.busy} onClick={() => void leave()}>Return to original</Button>}
    </div>
    {running && <div role="status" className="mt-1 flex flex-wrap items-center gap-2 pb-1 text-muted-foreground"><LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" /><span className="min-w-0 break-words">{job?.progress?.label ?? (job?.command === 'environment-reset' ? 'Resetting environment…' : 'Building preset…')}</span><Link to="/presets" className="underline underline-offset-4">View progress</Link><Link to={activity} className="underline underline-offset-4">CLI Activity</Link></div>}
    {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
    {home && <EnvironmentResetControls key={live.data.active} environment={live.data.active} home={home} busy={live.data.busy} onRefresh={live.reload} open={resetOpen} onOpenChange={setResetOpen} hideTrigger />}
  </div>
}
