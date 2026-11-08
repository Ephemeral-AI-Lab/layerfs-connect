import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoadError, Loading } from '@/components/layerfs/States'
import { host } from '@/layerfs/client'
import type { ProjectState } from '@/layerfs/host-api'
import { useHostQuery } from '@/layerfs/use-host'
import { useProjectSandboxes } from '@/layerfs/use-project-sandboxes'
import { SandboxMap, type SandboxMapData } from './SandboxMap'
import { NewSandbox } from './NewSandbox'
import { ProjectSandboxNavigation } from './ProjectSandboxNavigation'
import { HostSandboxDetail } from './HostSandboxDetail'
import { SandboxTiles } from './SandboxTiles'

export function ProjectSandboxes({ project, state }: { project: string; state?: ProjectState }) {
  return state ? <ResourceMap key={project} project={project} state={state} /> : <ReadProject key={project} project={project} />
}
function ReadProject({ project }: { project: string }) {
  const q = useHostQuery(() => host.project(project), [project])
  if (q.error) return <LoadError error={q.error} what="this project's sandboxes" onRetry={q.reload} />
  if (!q.data) return <Loading label="Reading project sandboxes…" />
  return <ResourceMap project={project} state={q.data} />
}
function ResourceMap({ project, state }: { project: string; state: ProjectState }) {
  const q = useProjectSandboxes(project, 5000)
  const navigate = useNavigate()
  const data = useMemo<SandboxMapData>(() => {
    const sandboxes = q.data ?? state.sandboxes
    return {
      actors: [], events: [], links: {},
      branches: state.branches.map(b => ({ name: b.name })),
      sandboxes: sandboxes.map(b => ({ name: b.name, machine: b.machine, backend: b.backend, state: b.state, refusal: b.refusal ? `${b.refusal.code}: ${b.refusal.message}` : undefined, unread: b.unread || (!q.data && !!q.error) })),
      workspaces: sandboxes.flatMap(b => b.workspaces.map(w => ({ id: w.ws, name: w.name ?? w.path, path: w.path, branch: w.branch, sandbox: b.name, users: [] }))),
    }
  }, [q.data, q.error, state])
  const sandboxes = q.data ?? state.sandboxes
  const branches = state.branches.filter(b => b.name !== 'main').map(b => b.name)
  return <ProjectSandboxNavigation
    standaloneHref={name => { const machine = sandboxes.find(b => b.name === name)?.machine; return machine ? `/machines/${encodeURIComponent(machine)}/sandboxes/${encodeURIComponent(name)}` : undefined }}
    detail={(name, navigation) => <HostSandboxDetail name={name} project={project} navigation={navigation}
      controls={(sandbox, reload) => <SandboxTiles sandboxes={[sandbox]} branches={branches} reading={false} unavailable={false}
        onChanged={() => { reload(); q.reload() }} onBrowseFiles={branch => navigate(`/storage/${project.split('/').map(encodeURIComponent).join('/')}/files?${new URLSearchParams({ branch })}`)} />} />}
    map={open => <>
      {q.error && <div className="px-5 pt-3"><LoadError error={q.error} what="sandbox workspaces" onRetry={q.reload} /></div>}
      <SandboxMap project={project} data={data} onOpenSandbox={open}
        controls={<div className="flex flex-wrap items-center gap-2"><button type="button" className="rounded-md px-3 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={q.reload} disabled={q.loading}>Refresh sandboxes</button>
          <NewSandbox project={project} state={state} taken={sandboxes.map(b => b.name)} onMade={q.reload} /></div>} />
    </>} />
}
