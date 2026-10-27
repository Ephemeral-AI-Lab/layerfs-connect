// The History tab of a run: its LayerFS project's history and files. It
// reuses the project page's components, given the run's project.
import type { ProjectState, RunDetail } from '@shared/host-api'
import { FolderTree, GitBranch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Segmented, type SegmentedOption } from '@/components/motion'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, type HistoryView } from '@/components/projects/history-tab'
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

/** The run's project state, reread as the run goes on. */
export function useRunProject(run: RunDetail) {
  const tick = useProgressTick(run)
  const state = useHostQuery(() => host.project(run.project), [run.project, tick])
  const data = state.data?.project.name === run.project ? state.data : undefined
  return { state: data, error: state.error, reload: state.reload, tick }
}

function needsProject(run: RunDetail, p: ReturnType<typeof useRunProject>, body: (s: ProjectState) => React.ReactNode) {
  if (p.state) return body(p.state)
  if (p.error)
    return run.state === 'starting' ? (
      <Loading label={`Initializing ${run.project}`} />
    ) : (
      <LoadError error={p.error} what={run.project} onRetry={p.reload} />
    )
  return <Loading label={`Reading ${run.project}`} />
}

type HistoryPart = 'history' | 'files'

const PARTS: SegmentedOption<HistoryPart>[] = [
  { value: 'history', label: 'History', icon: GitBranch },
  { value: 'files', label: 'Files', icon: FolderTree },
]

/** Dev aid: where History opens (its Files, a Branch, the Map, replaying). */
export interface HistoryInit {
  part?: HistoryPart
  branch?: string
  view?: HistoryView
  autoplay?: boolean
  /** A Commit or Layer to open on, selected (the Trace's auto-checkpoints link here). */
  commit?: string
  layer?: string
}

/** History: the project's history (tree, lineage, Map), and its files. */
export function RunHistoryTab({ run, project, init }: { run: RunDetail; project: ReturnType<typeof useRunProject>; init?: HistoryInit }) {
  const [part, setPart] = useState<HistoryPart>(init?.part ?? 'history')
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-3 px-8 py-5">
        <Segmented role="tablist" aria-label="History" size="md" value={part} onChange={setPart} options={PARTS} />
        {needsProject(run, project, (s) => (
          <div key={part} className="hist-swap flex min-h-0 flex-1 flex-col">
            {part === 'history' ? (
              <HistoryTab
                key={s.project.name}
                project={s.project.name}
                runId={run.id}
                tick={project.tick}
                initialBranch={init?.branch}
                initialView={init?.view}
                autoplay={init?.autoplay}
                initialItem={init?.commit ? { kind: 'commit', id: init.commit } : init?.layer ? { kind: 'layer', id: init.layer } : undefined}
              />
            ) : (
              <FilesTab key={s.project.name} project={s.project.name} branches={s.branches} tick={project.tick} initialBranch={init?.branch} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
