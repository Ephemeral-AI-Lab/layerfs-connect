// The History and Timeline tabs of a project: its LayerFS history and files,
// and its fork map over time. A run's tabs read the project the run plays
// on; a project with no session reads it by key (its Init made `main`).
import type { ProjectState, RunDetail } from '@shared/host-api'
import { FolderTree, GitBranch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Segmented, type SegmentedOption } from '@/components/motion'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, TimelineTab } from '@/components/projects/history-tab'
import '@/components/projects/history/history.css'
import { LoadError, Loading } from '@/components/projects/states'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'

/** A counter that moves at most every 1.5 s while the run makes progress, so the project rereads. */
function useProgressTick(run: RunDetail): number {
  const [tick, setTick] = useState(0)
  const last = useRef(0)
  const first = useRef(true)
  useEffect(() => {
    // The first read is the query's own; later progress rereads.
    if (first.current) {
      first.current = false
      return
    }
    const wait = Math.max(0, last.current + 1500 - Date.now())
    const t = setTimeout(() => {
      last.current = Date.now()
      setTick((n) => n + 1)
    }, wait)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.done, run.state])
  return tick
}

/** A project's state as read for its tabs; `tick` moves when it should be reread. */
export interface ProjectRead {
  state: ProjectState | undefined
  error: Error | undefined
  reload: () => void
  tick: number
}

/** The key the host and its routes know a project by: `store/name` in a shared Store (layerfs#506). */
export const projectKey = (s: ProjectState) => s.project.key ?? s.project.name

/** The state of the project `project` (a project key), with or without a session on it. */
export function useProjectRead(project: string, tick = 0): ProjectRead {
  const state = useHostQuery(() => host.project(project), [project, tick], `project:${project}`)
  const data = state.data && projectKey(state.data) === project ? state.data : undefined
  return { state: data, error: state.error, reload: state.reload, tick }
}

/** The run's project state, reread as the run goes on. */
export function useRunProject(run: RunDetail): ProjectRead {
  return useProjectRead(run.project, useProgressTick(run))
}

/** Where a project's tabs read it: its key, and whether a session is still Initing it. */
export interface ProjectSource {
  project: string
  /** The run that made it: its trace names each Commit's agent. */
  runId?: string
  starting?: boolean
}

function needsProject(source: ProjectSource, p: ProjectRead, body: (s: ProjectState) => React.ReactNode) {
  if (p.state) return body(p.state)
  if (p.error)
    return source.starting ? (
      <Loading label={`Initializing ${source.project}`} />
    ) : (
      <LoadError error={p.error} what={source.project} onRetry={p.reload} />
    )
  return <Loading label={`Reading ${source.project}`} />
}

const sourceOf = (run: RunDetail): ProjectSource => ({ project: run.project, runId: run.id, starting: run.state === 'starting' })

type HistoryPart = 'history' | 'files'

const PARTS: SegmentedOption<HistoryPart>[] = [
  { value: 'history', label: 'History', icon: GitBranch },
  { value: 'files', label: 'Files', icon: FolderTree },
]

/** Where History opens (its Files, a Branch), and whether Timeline opens replaying (a dev aid). */
export interface HistoryInit {
  part?: HistoryPart
  branch?: string
  autoplay?: boolean
  /** A Commit or Layer to open on, selected (the Trace's auto-checkpoints link here). */
  commit?: string
  layer?: string
}

/** History: the project's history (tree, lineage, Map), and its files. From Init on: genesis `main` at L0 needs no session. */
export function HistoryPane({ source, project, init }: { source: ProjectSource; project: ProjectRead; init?: HistoryInit }) {
  const [part, setPart] = useState<HistoryPart>(init?.part ?? 'history')
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-3 px-8 py-5">
        <Segmented role="tablist" aria-label="History" size="md" value={part} onChange={setPart} options={PARTS} />
        {needsProject(source, project, (s) => (
          <div key={part} className="hist-swap flex min-h-0 flex-1 flex-col">
            {part === 'history' ? (
              <HistoryTab
                key={projectKey(s)}
                project={projectKey(s)}
                runId={source.runId}
                tick={project.tick}
                initialBranch={init?.branch}
                initialItem={init?.commit ? { kind: 'commit', id: init.commit } : init?.layer ? { kind: 'layer', id: init.layer } : undefined}
              />
            ) : (
              <FilesTab key={projectKey(s)} project={projectKey(s)} branches={s.branches} tick={project.tick} initialBranch={init?.branch} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Timeline: the project's fork map over time; a Branch opens in History. */
export function TimelinePane({
  source,
  project,
  init,
  onOpenBranch,
}: {
  source: ProjectSource
  project: ProjectRead
  init?: HistoryInit
  onOpenBranch?: (name: string) => void
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-3 px-8 py-5">
        {needsProject(source, project, (s) => (
          <div className="hist-swap flex min-h-0 flex-1 flex-col">
            <TimelineTab key={projectKey(s)} project={projectKey(s)} runId={source.runId} tick={project.tick} autoplay={init?.autoplay} onOpenBranch={onOpenBranch} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A run's History tab. */
export function RunHistoryTab({ run, project, init }: { run: RunDetail; project: ProjectRead; init?: HistoryInit }) {
  return <HistoryPane source={sourceOf(run)} project={project} init={init} />
}

/** A run's Timeline tab. */
export function RunTimelineTab({ run, project, init, onOpenBranch }: { run: RunDetail; project: ProjectRead; init?: HistoryInit; onOpenBranch?: (name: string) => void }) {
  return <TimelinePane source={sourceOf(run)} project={project} init={init} onOpenBranch={onOpenBranch} />
}
