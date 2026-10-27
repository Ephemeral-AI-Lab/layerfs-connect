// The History tab of a run: its LayerFS project's history and files. It
// reuses the project page's components, given the run's project.
import type { ProjectState, RunDetail } from '@shared/host-api'
import { useEffect, useRef, useState } from 'react'

import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, type HistoryView } from '@/components/projects/history-tab'
import { LoadError, Loading } from '@/components/projects/states'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

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

/** Dev aid: where History opens (its Files, a Branch, the Map, replaying). */
export interface HistoryInit {
  part?: HistoryPart
  branch?: string
  view?: HistoryView
  autoplay?: boolean
}

/** History: the project's history (tree, lineage, Map), and its files. */
export function RunHistoryTab({ run, project, init }: { run: RunDetail; project: ReturnType<typeof useRunProject>; init?: HistoryInit }) {
  const [part, setPart] = useState<HistoryPart>(init?.part ?? 'history')
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-8 py-6">
        <div role="tablist" aria-label="History" className="flex w-fit rounded-lg bg-muted p-0.5">
          {(['history', 'files'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={part === p}
              onClick={() => setPart(p)}
              className={cn(
                'rounded-md px-3 py-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                part === p ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p === 'history' ? 'History' : 'Files'}
            </button>
          ))}
        </div>
        {needsProject(run, project, (s) =>
          part === 'history' ? (
            <HistoryTab
              key={s.project.name}
              project={s.project.name}
              runId={run.id}
              tick={project.tick}
              initialBranch={init?.branch}
              initialView={init?.view}
              autoplay={init?.autoplay}
            />
          ) : (
            <FilesTab key={s.project.name} project={s.project.name} branches={s.branches} tick={project.tick} initialBranch={init?.branch} />
          ),
        )}
      </div>
    </div>
  )
}
