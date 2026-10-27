// The Work and History tabs of a run: its LayerFS project's Branches,
// Sandboxes and Workspaces, and its history and files. They reuse the
// project page's components, given the run's project.
import type { ProjectState, ProjectSummary, RunDetail } from '@shared/host-api'
import { Box, GitBranch, GitMerge, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SandboxList } from '@/components/compute/sandbox-list'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, type HistoryView } from '@/components/projects/history-tab'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { isLive } from '@/components/runs/run-format'
import { Chip } from '@/components/storage/chips'
import { LocalDetail } from '@/components/storage/local-detail'
import { shortDigest } from '@/data/format'
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

/** The run project's Store, the disk and the LayerFS box. */
function StorageSection({ project }: { project: ProjectSummary }) {
  const q = useHostQuery(() => Promise.all([host.status(), host.projects()]), [])
  if (!q.data) return q.error ? <LoadError error={q.error} what="the storage" onRetry={q.reload} /> : <Loading label="Reading the storage" />
  const [status, projects] = q.data
  return <LocalDetail status={status} projects={projects} project={projects.find((p) => p.name === project.name) ?? project} />
}

const BRANCH_TONE = { open: 'info', merged: 'neutral', published: 'success' } as const

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && <span className="text-xs text-faint">{count}</span>}
        {hint && <span className="ml-auto text-xs text-faint">{hint}</span>}
      </header>
      {children}
    </section>
  )
}

/** Work: the run project's Branches, and its Sandboxes with their Workspaces. */
export function WorkTab({ run, project }: { run: RunDetail; project: ReturnType<typeof useRunProject> }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-8 py-7">
        {needsProject(run, project, (s) => (
          <>
            <Section title="Branches" count={s.branches.length} hint={s.project.name}>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {s.branches.map((b) => {
                  const Icon = b.state === 'merged' ? GitMerge : b.state === 'published' ? Upload : GitBranch
                  return (
                    <li key={b.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Icon aria-hidden="true" className={cn('size-4 shrink-0', b.name === 'main' ? 'text-primary' : 'text-faint')} />
                      <span className="min-w-0 truncate font-medium">{b.name}</span>
                      {b.parent && <span className="shrink-0 text-xs text-faint">from {b.parent}</span>}
                      <span className="flex-1" />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {b.commits} commit{b.commits === 1 ? '' : 's'}
                      </span>
                      {b.head && (
                        <code className="w-24 shrink-0 truncate text-right font-mono text-[11px] text-faint" title={b.head}>
                          {shortDigest(b.head)}
                        </code>
                      )}
                      <span className="w-20 shrink-0 text-right">
                        <Chip tone={BRANCH_TONE[b.state as keyof typeof BRANCH_TONE] ?? 'neutral'}>{b.state}</Chip>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Section>
            <Section title="Sandboxes and Workspaces" count={s.sandboxes.length}>
              {s.sandboxes.length > 0 ? (
                <div className="overflow-hidden rounded-xl border bg-card">
                  <SandboxList groups={[{ project: s.project.name, sandboxes: s.sandboxes }]} showProject={false} />
                </div>
              ) : (
                <Empty icon={Box} title="No Sandboxes open">
                  {isLive(run.state)
                    ? 'A Sandbox opens when an agent first mounts a Workspace.'
                    : 'This run’s Sandboxes have closed. Its Workspaces were unmounted with them.'}
                </Empty>
              )}
            </Section>
            <Section title="Storage">
              <StorageSection project={s.project} />
            </Section>
          </>
        ))}
      </div>
    </div>
  )
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
