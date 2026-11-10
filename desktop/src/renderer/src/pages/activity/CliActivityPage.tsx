import { ArrowLeft, ChevronRight, Download, RotateCw, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LfsPage } from '@/components/shell/LfsPage'
import { PageHeader } from '@/components/layerfs/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { Button } from '@/components/ui/button'
import { activityApi, type CliActivity } from '@/layerfs/activity-api'
import { connectBridge } from '@/layerfs/bridge'
import { useHostQuery, usePoll } from '@/layerfs/use-host'
import { ActionRow, actionStatus } from './ActionRow'
import { commandText, InvocationDetails, invocationFailed, invocationStatus } from './InvocationDetails'

function ActionDetails({ action }: { action: CliActivity }) {
  const [selected, setSelected] = useState<string>()
  const call = action.invocations.find(item => item.id === selected) ?? action.invocations.find(item => item.status === 'running') ?? action.invocations[0]
  return <section className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-medium">{action.label}{action.target ? ` · ${action.target}` : ''}</h2><p className="mt-1 text-xs text-muted-foreground">{new Date(action.at).toLocaleString()} · {action.invocations.length} command{action.invocations.length === 1 ? '' : 's'}</p></div><span className={`text-sm ${action.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{actionStatus[action.status]}</span></div>
    {action.request?.error && <p role="alert" className="text-sm text-destructive">Request refused: {action.request.code ?? `HTTP ${action.request.status}`}.</p>}
    {!!action.invocations.length && <><div className="max-h-64 overflow-y-auto border-y" aria-label="Commands">{action.invocations.map(item => <button type="button" key={item.id} onClick={() => setSelected(item.id)} aria-pressed={call?.id === item.id} className={`flex w-full min-w-0 items-center gap-3 border-b px-3 py-3 text-left text-xs last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${call?.id === item.id ? 'bg-muted/60' : 'hover:bg-muted/30'}`}><span className="min-w-0 flex-1 truncate font-mono">{commandText(item, true)}</span><span className={`shrink-0 ${invocationFailed(item) ? 'text-destructive' : 'text-muted-foreground'}`}>{invocationStatus[item.status]}{item.durationMs != null ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}</span><ChevronRight className="size-3 shrink-0 text-muted-foreground" /></button>)}</div>{call && <InvocationDetails key={call.id} invocation={call} />}</>}
    {!action.invocations.length && <p className="py-4 text-sm text-muted-foreground">This action did not launch a LayerFS CLI process.</p>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Action details</summary><dl className="mt-3 space-y-2 break-all"><div>Action: <span className="font-mono">{action.name}</span></div><div>Action ID: <span className="font-mono">{action.id}</span></div>{action.page && <div>Page: {action.page}</div>}<div>Source: {action.origin === 'user' ? 'Desktop action' : 'Background'}</div></dl></details>
  </section>
}

export function CliActivityPage() {
  const [params] = useSearchParams()
  const actionId = params.get('action')
  const selectedId = actionId
  const detail = !!selectedId
  const [origin, setOrigin] = useState('user'), [status, setStatus] = useState('all')
  const [search, setSearch] = useState(''), [query, setQuery] = useState('')
  const [before, setBefore] = useState<string>()
  const live = useHostQuery(async () => {
    if (selectedId) { const item = await activityApi.get(selectedId); return { items: item && !('cleared' in item) ? [item] : [], next: null, warning: null, cleared: !!item && 'cleared' in item } }
    return { ...await activityApi.list({ origin, status, search: query, before }), cleared: false }
  }, [selectedId, origin, status, query, before])
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setBefore(undefined) }, 250); return () => clearTimeout(timer) }, [search])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = connectBridge.onStream(message => {
      if (message.kind !== 'event' || (message.event as { type?: string })?.type !== 'cli-activity' || timer) return
      timer = setTimeout(() => { timer = undefined; live.reload() }, 500)
    })
    void connectBridge.subscribe()
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [live.reload])
  usePoll(live.reload, 5000)
  function download() {
    const blob = new Blob((live.data?.items ?? []).map(action => `${JSON.stringify(action)}\n`), { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'layerfs-cli-activity.ndjson'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const control = 'h-9 min-w-0 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return <LfsPage><div className="min-h-0 flex-1 overflow-y-auto">
    <PageHeader title="CLI Activity" description="Actions, commands, and their output." actions={<><Button variant="ghost" size="sm" onClick={live.reload} disabled={live.loading}><RotateCw />Refresh</Button><Button variant="ghost" size="sm" onClick={download} disabled={!live.data?.items.length}><Download />Export shown</Button></>} />
    <div className="mx-auto max-w-5xl space-y-5 px-5 pb-8">
      {detail ? <Link to="/activity" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All activity</Link> : <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="activity-search">Search CLI activity</label><input id="activity-search" className={`${control} grow`} placeholder="Search activity…" value={search} onChange={event => setSearch(event.target.value)} /><label className="sr-only" htmlFor="activity-status">Activity status</label><select id="activity-status" className={control} value={status} onChange={event => { setStatus(event.target.value); setBefore(undefined) }}><option value="all">All outcomes</option><option value="running">Running</option><option value="failed">Failed</option><option value="success">Completed</option><option value="no-cli">No CLI launched</option></select><label className="sr-only" htmlFor="activity-origin">Activity source</label><select id="activity-origin" className={control} value={origin} onChange={event => { setOrigin(event.target.value); setBefore(undefined) }}><option value="user">Desktop actions</option><option value="all">All activity</option><option value="background">Background calls</option></select></div>}
      {live.data?.warning && <p role="alert" className="text-sm text-destructive">{live.data.warning}</p>}
      {live.error && <LoadError error={live.error} what="CLI activity" onRetry={live.reload} />}
      {!live.data && live.loading && <Loading label="Loading CLI activity…" />}
      {live.data && !live.data.items.length && <Empty icon={Terminal} title={live.data.cleared ? 'Activity no longer available' : detail ? 'No recorded activity' : query || status !== 'all' ? 'No matching activity' : 'No CLI activity yet'}>{detail ? live.data.cleared ? 'Previous CLI Activity was cleared in this environment. This action is no longer available.' : 'This action may have expired from the retained logs.' : 'Commands appear here when you perform an action in the app.'}</Empty>}
      {detail ? live.data?.items.map(action => <ActionDetails key={action.id} action={action} />) : <div>{live.data?.items.map(action => <ActionRow key={action.id} action={action} />)}</div>}
      {!detail && <div className="flex gap-2">{before && <Button variant="outline" size="sm" onClick={() => setBefore(undefined)}>Newest activity</Button>}{live.data?.next && <Button variant="outline" size="sm" onClick={() => setBefore(live.data!.next!)}>Older activity</Button>}</div>}
    </div>
  </div></LfsPage>
}
