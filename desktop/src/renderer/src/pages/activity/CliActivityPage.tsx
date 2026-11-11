import { ArrowLeft, ChevronRight, Download, MoreHorizontal, RotateCw, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LfsPage } from '@/components/shell/LfsPage'
import { PageHeader } from '@/components/layerfs/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { Button } from '@/components/ui/button'
import { activityApi, type ActivityState, type CliActivity } from '@/layerfs/activity-api'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { connectBridge } from '@/layerfs/bridge'
import { presetApi } from '@/layerfs/demo-presets-api'
import { PresetProgress } from '@/components/presets/PresetProgress'
import { useHostQuery, usePoll } from '@/layerfs/use-host'
import { ActionRow, actionStatus } from './ActionRow'
import { commandText, InvocationDetails, invocationFailed, invocationStatus } from './InvocationDetails'

function ActionDetails({ action, invocation }: { action: CliActivity; invocation: string | null }) {
  const [selected, setSelected] = useState<string | null>(invocation)
  const [project, setProject] = useState(''), [after, setAfter] = useState<string>()
  const [previous, setPrevious] = useState<(string | undefined)[]>([])
  useEffect(() => { setSelected(invocation) }, [invocation])
  const scope = `${action.id}:${project}:${after ?? ''}`
  const page = useHostQuery(async () => ({ ...await activityApi.invocations(action.id, { project: project || undefined, after, limit: 100 }), scope }), [scope, action.invocationCount])
  usePoll(page.reload, 3000, action.status === 'running')
  const rows = page.data?.scope === scope ? page.data.items : []
  const selectedId = selected ?? rows.find(item => item.status === 'running')?.id ?? rows[0]?.id
  const full = useHostQuery(async () => selectedId ? activityApi.invocation(action.id, selectedId) : null, [action.id, selectedId])
  const call = full.data?.id === selectedId ? full.data : null
  usePoll(full.reload, 3000, !!selectedId && (!call || call.status === 'running' || call.status === 'queued'))
  const count = action.invocationCount ?? action.invocations.length
  return <section className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-medium">{action.label}{action.target ? ` · ${action.target}` : ''}</h2><p className="mt-1 text-xs text-muted-foreground">{new Date(action.at).toLocaleString()} · {count.toLocaleString()} commands</p></div><span className={`text-sm ${action.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{actionStatus[action.status]}</span></div>
    {action.request?.error && <p role="alert" className="text-sm text-destructive">Request refused: {action.request.code ?? `HTTP ${action.request.status}`}.</p>}
    {!!action.projects?.length && <label className="flex flex-wrap items-center gap-2 text-xs">Project<select className="h-9 min-w-0 rounded-lg border bg-background px-3 text-sm" value={project} onChange={event => { setProject(event.target.value); setAfter(undefined); setPrevious([]); setSelected(null) }}><option value="">All projects</option>{action.projects.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
    {page.error && <LoadError error={page.error} what="commands" onRetry={page.reload} />}
    {page.data?.warning && <p role="alert" className="text-sm text-destructive">{page.data.warning}</p>}
    {!!rows.length && <><div className="max-h-64 overflow-y-auto border-y" aria-label="Commands">{rows.map(item => <button type="button" key={item.id} onClick={() => setSelected(item.id)} aria-pressed={selectedId === item.id} className={`flex w-full min-w-0 items-center gap-3 border-b px-3 py-3 text-left text-xs last:border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === item.id ? 'bg-muted/60' : 'hover:bg-muted/30'}`}><span className="min-w-0 flex-1 truncate font-mono">{commandText(item, true)}</span><span className={`shrink-0 ${invocationFailed(item) ? 'text-destructive' : 'text-muted-foreground'}`}>{invocationStatus[item.status]}{item.durationMs != null ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}</span><ChevronRight className="size-3 shrink-0 text-muted-foreground" /></button>)}</div><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>Showing {rows.length} of {page.data?.total.toLocaleString()} commands</span>{previous.length > 0 && <Button size="sm" variant="outline" onClick={() => { setAfter(previous.at(-1)); setPrevious(values => values.slice(0, -1)); setSelected(null) }}>Previous</Button>}{page.data?.next && <Button size="sm" variant="outline" onClick={() => { setPrevious(values => [...values, after]); setAfter(page.data!.next!); setSelected(null) }}>Next 100</Button>}</div></>}
    {!rows.length && !page.loading && !page.error && <p className="py-4 text-sm text-muted-foreground">{count ? 'No commands match this project.' : 'This action did not launch a LayerFS CLI process.'}</p>}
    {full.error && <LoadError error={full.error} what="command input and output" onRetry={full.reload} />}
    {selectedId && !call && full.loading && <Loading label="Loading selected command…" />}
    {call && <><div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(call, null, 2) + '\n'], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `cli-command-${call.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}><Download />Download selected command</Button></div><InvocationDetails key={call.id} invocation={call} /></>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Action details</summary><dl className="mt-3 space-y-2 break-all"><div>Action: <span className="font-mono">{action.name}</span></div><div>Action ID: <span className="font-mono">{action.id}</span></div>{action.page && <div>Page: {action.page}</div>}<div>Source: {action.origin === 'user' ? 'Desktop action' : 'Background'}</div><div>Only the selected command loads its captured input and output.</div></dl></details>
  </section>
}

export function CliActivityPage() {
  const [params, setParams] = useSearchParams()
  const environment = useHostQuery(activityApi.state, [])
  usePoll(environment.reload, 3000)
  const [confirmation, setConfirmation] = useState<ActivityState>()
  const [clearing, setClearing] = useState(false), [clearError, setClearError] = useState<string>()
  const actionId = params.get('action'), operationId = params.get('operation')
  const operation = useHostQuery(async () => operationId ? presetApi.job(operationId) : null, [operationId])
  usePoll(operation.reload, operationId ? 1500 : 30000)
  const relatedIds = [...new Set(operation.data?.actionIds ?? [operation.data?.actionId, operation.data?.rebuildActionId].filter((id): id is string => !!id))]
  const selectedId = actionId ?? relatedIds[relatedIds.length - 1]
  const detail = !!selectedId || !!operationId
  const [origin, setOrigin] = useState('user'), [status, setStatus] = useState('all')
  const [search, setSearch] = useState(''), [query, setQuery] = useState('')
  const [before, setBefore] = useState<string>()
  const live = useHostQuery(async () => {
    if (selectedId) { const item = await activityApi.summary(selectedId); return { items: item && !('cleared' in item) ? [item] : [], next: null, warning: null, cleared: !!item && 'cleared' in item } }
    if (operationId) return { items: [], next: null, warning: null, cleared: false }
    return { ...await activityApi.list({ origin, status, search: query, before }), cleared: false }
  }, [selectedId, operationId, origin, status, query, before])
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setBefore(undefined) }, 250); return () => clearTimeout(timer) }, [search])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = connectBridge.onStream(message => {
      if (message.kind !== 'event' || (message.event as { type?: string })?.type !== 'cli-activity' || timer) return
      timer = setTimeout(() => { timer = undefined; live.reload() }, 1500)
    })
    void connectBridge.subscribe()
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [live.reload])
  usePoll(live.reload, 5000)
  async function clearHistory() {
    if (!confirmation) return
    setClearing(true); setClearError(undefined)
    try {
      await activityApi.clear(confirmation)
      setConfirmation(undefined); setParams({}); setBefore(undefined); setSearch(''); setQuery(''); setStatus('all')
      live.reload(); environment.reload()
    } catch (e) { setClearError(e instanceof Error ? e.message : String(e)); environment.reload() }
    finally { setClearing(false) }
  }
  function download() {
    const blob = new Blob((live.data?.items ?? []).map(action => `${JSON.stringify(action)}\n`), { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'layerfs-cli-activity-summaries.ndjson'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function confirmClear() {
    setClearError(undefined)
    try { setConfirmation(await activityApi.state()) } catch (e) { setClearError(e instanceof Error ? e.message : String(e)) }
  }
  const control = 'h-9 min-w-0 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return <LfsPage><div className="min-h-0 flex-1 overflow-y-auto">
    <PageHeader title="CLI Activity" description="Actions, commands, and their output." actions={<><Button variant="ghost" size="sm" onClick={live.reload} disabled={live.loading}><RotateCw />Refresh</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Activity options"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-48"><DropdownMenuItem onSelect={download} disabled={!live.data?.items.length}><Download />Export shown summaries</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" disabled={clearing || !environment.data || environment.data.busy || !!environment.error} onSelect={() => void confirmClear()}><Trash2 />Clear history…</DropdownMenuItem></DropdownMenuContent></DropdownMenu></>} />
    <div className="mx-auto max-w-5xl space-y-5 px-5 pb-8">
      {detail ? <Link to="/activity" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All activity</Link> : <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="activity-search">Search CLI activity</label><input id="activity-search" className={`${control} grow`} placeholder="Search activity…" value={search} onChange={event => setSearch(event.target.value)} /><label className="sr-only" htmlFor="activity-status">Activity status</label><select id="activity-status" className={control} value={status} onChange={event => { setStatus(event.target.value); setBefore(undefined) }}><option value="all">All outcomes</option><option value="running">Running</option><option value="failed">Failed</option><option value="success">Completed</option><option value="no-cli">No CLI launched</option></select><label className="sr-only" htmlFor="activity-origin">Activity source</label><select id="activity-origin" className={control} value={origin} onChange={event => { setOrigin(event.target.value); setBefore(undefined) }}><option value="user">Desktop actions</option><option value="all">All activity</option><option value="background">Background calls</option></select></div>}
      {operation.data && <section className="space-y-4 rounded-xl border p-4"><PresetProgress job={operation.data} compact />{relatedIds.length > 1 && <nav className="flex flex-wrap gap-2" aria-label="Operation phases">{relatedIds.map((id, index) => <Button key={id} variant={selectedId === id ? 'secondary' : 'ghost'} size="sm" asChild><Link to={`/activity?operation=${encodeURIComponent(operationId!)}&action=${encodeURIComponent(id)}`}>{index === 0 ? 'Reset environment' : index === 1 ? 'Build preset' : `Phase ${index + 1}`}</Link></Button>)}</nav>}</section>}
      {operation.error && <p role="alert" className="text-sm text-destructive">{operation.error.message}</p>}
      {(clearError || environment.error) && <p role="alert" className="text-sm text-destructive">{clearError || environment.error?.message}</p>}
      {live.data?.warning && <p role="alert" className="text-sm text-destructive">{live.data.warning}</p>}
      {live.error && <LoadError error={live.error} what="CLI activity" onRetry={live.reload} />}
      {!live.data && live.loading && <Loading label="Loading CLI activity…" />}
      {live.data && !live.data.items.length && <Empty icon={Terminal} title={live.data.cleared ? 'Activity no longer available' : detail ? operation.data?.state === 'running' || operation.data?.state === 'queued' ? 'Waiting for commands' : 'No recorded activity' : query || status !== 'all' ? 'No matching activity' : 'No CLI activity yet'}>{detail ? live.data.cleared ? 'Previous CLI Activity was cleared in this environment. This action is no longer available.' : operation.data?.state === 'running' || operation.data?.state === 'queued' ? 'Commands appear here as the operation starts.' : 'This action may have expired from the retained logs.' : 'Commands appear here when you perform an action in the app.'}</Empty>}
      {detail ? live.data?.items.map(action => <ActionDetails key={action.id} action={action} invocation={params.get('invocation')} />) : <div>{live.data?.items.map(action => <ActionRow key={action.id} action={action} />)}</div>}
      {!detail && <div className="flex gap-2">{before && <Button variant="outline" size="sm" onClick={() => setBefore(undefined)}>Newest activity</Button>}{live.data?.next && <Button variant="outline" size="sm" onClick={() => setBefore(live.data!.next!)}>Older activity</Button>}</div>}
      {environment.data && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{environment.data.environment} · Activity details</summary><div className="mt-3 space-y-2"><p className="break-all font-mono">{environment.data.home}</p><p>Known credentials are redacted. Each stream is limited to 32 KiB. Ordinary history is retained for 7 days, up to 100 MB. Preset logs are protected until reset within a 1 GB archive budget; capacity failures are reported.</p>{environment.data.clearedAt && <p>History cleared {new Date(environment.data.clearedAt).toLocaleString()}.</p>}{environment.data.busy && <p>History can be cleared when active operations finish.</p>}</div></details>}
    </div>
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !clearing) setConfirmation(undefined) }}><DialogContent><DialogHeader><DialogTitle>Clear CLI Activity history?</DialogTitle><DialogDescription>Delete all recorded actions, CLI inputs, and outputs for this environment, including activity hidden by filters. Preset resources remain unchanged.</DialogDescription></DialogHeader><p className="break-all font-mono text-xs text-muted-foreground">{confirmation?.home}</p>{clearError && <p role="alert" className="text-sm text-destructive">{clearError}</p>}<DialogFooter><Button variant="outline" autoFocus disabled={clearing} onClick={() => setConfirmation(undefined)}>Cancel</Button><Button variant="destructive" disabled={clearing || confirmation?.busy || environment.data?.busy} onClick={() => void clearHistory()}>{clearing ? 'Clearing…' : 'Clear history'}</Button></DialogFooter></DialogContent></Dialog>
  </div></LfsPage>
}
