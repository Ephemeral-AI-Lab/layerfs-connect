import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoadError, Loading } from '@/components/layerfs/States'
import { host } from '@/layerfs/client'
import type { ProjectState } from '@/layerfs/host-api'
import { useHostQuery } from '@/layerfs/use-host'
import { useProjectSandboxes } from '@/layerfs/use-project-sandboxes'
import { SandboxMap } from './SandboxMap'
import type { ChatDetail } from '@/layerfs/agent-api'
import { actorKey, sandboxLiveData, traceActor } from '@/layerfs/sandbox-live'
import { useSandboxLive, useSandboxClock } from '@/layerfs/use-sandbox-live'
import { NewSandbox } from './NewSandbox'
import { ProjectSandboxNavigation } from './ProjectSandboxNavigation'
import { HostSandboxDetail } from './HostSandboxDetail'
import { SandboxTiles } from './SandboxTiles'

type Context = { chat?: ChatDetail; childId?: string }
export function ProjectSandboxes({ project, state, ...context }: { project: string; state?: ProjectState } & Context) {
  return state ? <ResourceMap key={project} project={project} state={state} {...context} /> : <ReadProject key={project} project={project} {...context} />
}
function ReadProject({ project, ...context }: { project: string } & Context) {
  const q = useHostQuery(() => host.project(project), [project])
  if (q.error) return <LoadError error={q.error} what="this project's sandboxes" onRetry={q.reload} />
  if (!q.data) return <Loading label="Reading project sandboxes…" />
  return <ResourceMap project={project} state={q.data} {...context} />
}
function ResourceMap({ project, state, chat, childId }: { project: string; state: ProjectState } & Context) {
  const q = useProjectSandboxes(project, 5000)
  const navigate = useNavigate()
  const [detailOpen, setDetailOpen] = useState(false)
  const live = useSandboxLive(project, chat, !detailOpen)
  const opened = useRef(Date.now() / 1000).current
  const epoch = Math.min(opened, ...live.feeds.map(feed => feed.chat.created / 1000))
  const observed = q.data ?? state.sandboxes
  const data = useMemo(() => sandboxLiveData(observed, state.branches, live.feeds, epoch), [observed, state.branches, live.feeds, epoch])
  const playing = !live.error && data.events.some(event => event.end === Infinity)
  const time = useSandboxClock(playing && !detailOpen) - epoch
  const child = chat?.children.find(item => item.id === childId)
  const selectedActor = childId ? live.feeds.find(feed => feed.chat.id === chat?.id)?.value.actors?.find(actor => actor.childId === childId)?.id ?? (child ? traceActor(child) : undefined) : 'root'
  const focusActorId = chat && selectedActor ? actorKey(chat.id, selectedActor) : undefined
  const sandboxes = observed
  const branches = state.branches.filter(b => b.name !== 'main').map(b => b.name)
  return <ProjectSandboxNavigation onOpen={() => setDetailOpen(true)} onBack={() => setDetailOpen(false)}
    standaloneHref={name => { const machine = sandboxes.find(b => b.name === name)?.machine; return machine ? `/machines/${encodeURIComponent(machine)}/sandboxes/${encodeURIComponent(name)}` : undefined }}
    detail={(name, navigation) => <HostSandboxDetail name={name} project={project} navigation={navigation}
      controls={(sandbox, reload) => <SandboxTiles sandboxes={[sandbox]} branches={branches} reading={false} unavailable={false}
        onChanged={() => { reload(); q.reload() }} onBrowseFiles={branch => navigate(`/storage/${project.split('/').map(encodeURIComponent).join('/')}/files?${new URLSearchParams({ branch })}`)} />} />}
    map={open => <>
      {q.error && <div className="px-5 pt-3"><LoadError error={q.error} what="sandbox workspaces" onRetry={q.reload} /></div>}
      {live.error && <div role="alert" className="px-5 pt-3 text-sm text-destructive">Live activity unavailable: {live.error}</div>}
      <SandboxMap project={project} data={data} time={time} playing={playing && !detailOpen} focusActorId={focusActorId} chatActorId={chat ? actorKey(chat.id, 'root') : undefined} onOpenSandbox={open}
        controls={<div className="flex flex-wrap items-center gap-2"><button type="button" className="rounded-md px-3 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={q.reload} disabled={q.loading}>Refresh sandboxes</button>
          <NewSandbox project={project} state={state} taken={sandboxes.map(b => b.name)} onMade={q.reload} /></div>} />
    </>} />
}
