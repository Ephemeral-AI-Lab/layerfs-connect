import {
  Activity,
  Box,
  ChevronLeft,
  Database as DatabaseGlyph,
  FileCode2,
  History,
  ListOrdered,
  Play,
  ScrollText,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SandboxList } from '@/components/compute/sandbox-list'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab } from '@/components/projects/history-tab'
import { KindBar } from '@/components/projects/projects-home'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { DemoScript } from '@/components/runs/demo-script'
import { RunDot, RunStateBadge } from '@/components/runs/run-badges'
import { RUN_LABEL, isLive, runLabel } from '@/components/runs/run-format'
import { RunList } from '@/components/runs/run-list'
import { RunView } from '@/components/runs/run-view'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { LocalDetail } from '@/components/storage/local-detail'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ago } from '@/data/format'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { ProjectState, RunSummary } from '@shared/host-api'

export type ProjectTab = 'live' | 'runs' | 'script' | 'files' | 'history' | 'storage' | 'sandboxes'

const TAB_IDS: ProjectTab[] = ['live', 'runs', 'script', 'files', 'history', 'storage', 'sandboxes']

interface ProjectViewProps {
  /** The demo id: a Connect project is one demo, its runs its sessions. */
  demo: string
  /** Dev aid: a tab, or 'map'/'replay' for History's Map. */
  initialTab?: string
  /** Dev aid: the Branch Files and History open on. */
  initialBranch?: string
  onOpenRun: (runId: string) => void
  onBack: () => void
}

/** A counter that moves (at most every 1.5 s) while the run makes progress, so its data tabs reread. */
function useRunTick(runId: string | undefined): number {
  const [tick, setTick] = useState(0)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useHostEvents((e) => {
    if (!runId) return
    const mine = e.type === 'run' ? e.run.id === runId : e.run === runId
    // A finished step or call may have committed, forked or mounted.
    const moved = mine && (e.type === 'run' || (e.type === 'step' && e.step.state !== 'running') || e.type === 'call')
    if (!moved || timer.current) return
    const wait = Math.max(0, last.current + 1500 - Date.now())
    timer.current = setTimeout(() => {
      timer.current = undefined
      last.current = Date.now()
      setTick((t) => t + 1)
    }, wait)
  })
  return tick
}

function RunPicker({ runs, value, onChange }: { runs: RunSummary[]; value: string; onChange: (id: string) => void }) {
  const run = runs.find((r) => r.id === value)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Run" className="w-64">
        <SelectValue>
          {run && (
            <span className="flex min-w-0 items-center gap-2">
              <RunDot state={run.state} />
              <span className="font-medium">{runLabel(run)}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{run.project}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {runs.map((r, i) => (
          <SelectItem key={r.id} value={r.id}>
            <RunDot state={r.state} />
            <span className="font-medium">{runLabel(r)}</span>
            <span className="font-mono text-xs text-muted-foreground">{r.project}</span>
            <span className="text-xs text-faint">
              {RUN_LABEL[r.state]} · {i === 0 ? 'latest' : ago(r.started)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StorageTab({ state }: { state: ProjectState }) {
  const q = useHostQuery(() => Promise.all([host.status(), host.projects()]), [])
  if (!q.data) return q.error ? <LoadError error={q.error} what="the storage" onRetry={q.reload} /> : <Loading label="Reading the storage" />
  const [status, projects] = q.data
  return <LocalDetail status={status} projects={projects} project={projects.find((p) => p.name === state.project.name) ?? state.project} />
}

export function ProjectView({ demo, initialTab, initialBranch, onOpenRun, onBack }: ProjectViewProps) {
  const detail = useHostQuery(() => host.demo(demo), [demo])
  const { runs, error: runsError } = useRuns(demo)
  const [picked, setPicked] = useState<string>()
  const opening = (): ProjectTab =>
    initialTab === 'map' || initialTab === 'replay' ? 'history' : (TAB_IDS.find((t) => t === initialTab) ?? 'live')
  const [tab, setTab] = useState<ProjectTab>(opening)
  const [seen, setSeen] = useState(demo)
  if (seen !== demo) {
    setSeen(demo)
    setPicked(undefined)
    setTab('live')
  }
  const { start, starting, error: refused, clearError } = useStartRun((run) => {
    setPicked(run.id)
    onOpenRun(run.id)
  })

  // The run shown: the one picked, else the latest.
  const run = runs?.find((r) => r.id === picked) ?? runs?.[0]
  const tick = useRunTick(run && isLive(run.state) ? run.id : undefined)
  const dataTab = tab === 'files' || tab === 'history' || tab === 'storage' || tab === 'sandboxes'
  const state = useHostQuery(
    async () => (run && dataTab ? host.project(run.project) : undefined),
    [run?.project, dataTab && run ? 'on' : 'off', tick],
  )
  const projectState = state.data?.project.name === run?.project ? state.data : undefined

  const d = detail.data
  const sandboxes = projectState?.sandboxes ?? []
  const TABS: { id: ProjectTab; label: string; icon: typeof Activity; count?: number }[] = [
    { id: 'live', label: 'Live', icon: Activity },
    { id: 'runs', label: 'Runs', icon: ListOrdered, count: runs?.length },
    { id: 'script', label: 'Script', icon: ScrollText },
    { id: 'files', label: 'Files', icon: FileCode2 },
    { id: 'history', label: 'History', icon: History },
    { id: 'storage', label: 'Storage', icon: DatabaseGlyph },
    { id: 'sandboxes', label: 'Sandboxes', icon: Box, count: projectState ? sandboxes.length : undefined },
  ]

  const runButton = (
    <Button onClick={() => void start(demo)} disabled={starting !== null}>
      <Play /> {starting ? 'Starting…' : 'Run'}
    </Button>
  )
  const noRun = (
    <Empty icon={Play} title={runsError ? 'Runs are not readable right now' : `${d?.title ?? demo} has not run yet`} action={runButton}>
      {runsError
        ? runsError.message
        : 'A run Inits a fresh LayerFS project from the demo’s fixture and plays its agents on it. Its files, history, storage and Sandboxes show here.'}
    </Empty>
  )
  // The data tabs wait for the selected run's project.
  const needsProject = (body: (s: ProjectState) => React.ReactNode) => {
    if (!run) return runs ? noRun : runsError ? noRun : <Loading label="Reading the runs" />
    if (projectState) return body(projectState)
    if (state.error)
      return run.state === 'starting' ? (
        <Loading label={`Initializing ${run.project}`} />
      ) : (
        <LoadError error={state.error} what={run.project} onRetry={state.reload} />
      )
    return <Loading label={`Reading ${run.project}`} />
  }

  return (
    <div className="h-svh overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-8 pt-5 pb-8">
        <header className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 flex w-fit items-center gap-1 rounded text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" /> Projects
          </button>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="truncate text-2xl font-semibold tracking-[-0.015em]">{d?.title ?? demo}</h1>
                {run && <RunStateBadge state={run.state} />}
              </div>
              <div className="mt-1.5 flex min-w-0 items-center gap-3">
                {d && d.tags.length > 0 && (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {d.tags.map((t) => (
                      <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {d && (
                  <span className="truncate text-xs text-muted-foreground">
                    {d.agents.length} agent{d.agents.length === 1 ? '' : 's'} · {d.steps} steps
                  </span>
                )}
                {d && <KindBar kinds={d.kinds} className="w-28 shrink-0" />}
                {detail.error && <span className="text-xs text-destructive">{detail.error.message}</span>}
              </div>
            </div>
            {runs && runs.length > 0 && run && <RunPicker runs={runs} value={run.id} onChange={setPicked} />}
            {runButton}
          </div>
          {refused && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">Could not start a run: {refused.message}</span>
              <button type="button" onClick={clearError} className="text-xs font-medium underline-offset-2 hover:underline">
                Dismiss
              </button>
            </div>
          )}
        </header>

        <nav aria-label="Project" className="-mb-1 flex gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 pt-1 pb-2.5 text-sm font-medium outline-none transition-colors focus-visible:text-foreground',
                t.id === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="size-4" />
              {t.label}
              {t.count !== undefined && <span className="text-xs font-normal text-faint">{t.count}</span>}
            </button>
          ))}
          {run && dataTab && (
            <span className="mb-2 ml-auto self-end truncate font-mono text-xs text-faint" title="The LayerFS project this run made">
              {run.project}
            </span>
          )}
        </nav>

        {tab === 'live' &&
          (run ? (
            <div className="h-[calc(100svh-12.5rem)] min-h-[30rem] overflow-hidden rounded-2xl border bg-background [&>div]:h-full">
              <RunView key={run.id} runId={run.id} />
            </div>
          ) : runs || runsError ? (
            noRun
          ) : (
            <Loading label="Reading the runs" />
          ))}
        {tab === 'runs' && <RunList demo={demo} onOpenRun={(id) => {
              setPicked(id)
              onOpenRun(id)
            }} />}
        {tab === 'script' && <DemoScript demo={demo} />}
        {tab === 'files' &&
          needsProject((s) => (
            <FilesTab key={s.project.name} project={s.project.name} branches={s.branches} tick={tick} initialBranch={initialBranch} />
          ))}
        {tab === 'history' &&
          needsProject((s) => (
            <HistoryTab
              key={s.project.name}
              project={s.project.name}
              runId={run?.id}
              tick={tick}
              initialBranch={initialBranch}
              initialView={initialTab === 'map' || initialTab === 'replay' ? 'map' : 'lineage'}
              autoplay={initialTab === 'replay'}
            />
          ))}
        {tab === 'storage' && needsProject((s) => <StorageTab state={s} />)}
        {tab === 'sandboxes' &&
          needsProject((s) =>
            s.sandboxes.length > 0 ? (
              <section className="rounded-xl border bg-card">
                <header className="flex items-center gap-3 border-b px-5 pt-4 pb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">Sandboxes for {s.project.name}</h3>
                    <p className="text-xs text-muted-foreground">On Docker, this machine. Each opens to its mounted Workspaces.</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={state.reload}>
                    Refresh
                  </Button>
                </header>
                <SandboxList groups={[{ project: s.project.name, sandboxes: s.sandboxes }]} showProject={false} />
              </section>
            ) : (
              <Empty icon={Box} title={`No Sandboxes for ${s.project.name}`}>
                {isLive(run?.state ?? 'passed')
                  ? 'The run starts one when an agent first mounts a Workspace.'
                  : 'This run’s Sandboxes have closed. A run starts one when an agent first mounts a Workspace.'}
              </Empty>
            ),
          )}
      </div>
    </div>
  )
}
