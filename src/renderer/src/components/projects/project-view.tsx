// A demo project, one page for the project and its runs (dsh's session
// layout): the header names the demo and picks the run; one tab row shows
// that run's Conversation, Trace, Work and History, then the demo's Runs and
// Script.
import { ChevronLeft, Play, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { KindBar } from '@/components/projects/projects-home'
import { Empty, Loading } from '@/components/projects/states'
import { DemoScript } from '@/components/runs/demo-script'
import { RunDot, RunStateBadge } from '@/components/runs/run-badges'
import { RUN_LABEL, duration, isLive, runLabel } from '@/components/runs/run-format'
import { RunList } from '@/components/runs/run-list'
import type { HistoryInit } from '@/components/runs/run-project-tabs'
import { RunPanel, type RunTab } from '@/components/runs/run-view'
import { useNow } from '@/components/runs/use-run'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ago } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { RunSummary } from '@shared/host-api'

export type ProjectTab = RunTab | 'runs' | 'script'

const RUN_TABS: { id: RunTab; label: string }[] = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'trace', label: 'Trace' },
  { id: 'work', label: 'Work' },
  { id: 'history', label: 'History' },
]

/** Old tab names in `#projects/<demo>/<tab>` hashes, and where each went. */
function openingTab(initial?: string): { tab: ProjectTab; history?: HistoryInit } {
  switch (initial) {
    case 'conversation':
    case 'trace':
    case 'work':
    case 'history':
    case 'runs':
    case 'script':
      return { tab: initial }
    case 'files':
    case 'blame':
      return { tab: 'history', history: { part: 'files' } }
    case 'map':
    case 'replay':
      return { tab: 'history', history: { view: 'map', autoplay: initial === 'replay' } }
    case 'storage':
    case 'sandboxes':
      return { tab: 'work' }
    default:
      return { tab: 'conversation' }
  }
}

interface ProjectViewProps {
  /** The demo id: a Connect project is one demo, its runs its sessions. */
  demo: string
  /** The run to show; the newest when absent. */
  runId?: string
  /** Dev aid: a tab (old names map to new ones), the Branch Files and History open on, the agent. */
  initialTab?: string
  initialBranch?: string
  initialAgent?: string
  onOpenRun: (runId: string) => void
  onBack: () => void
}

function RunPicker({ runs, value, onChange }: { runs: RunSummary[]; value: string; onChange: (id: string) => void }) {
  const run = runs.find((r) => r.id === value)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Run" className="w-60">
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

/** The run's state beside the title: its badge, and how far it got. */
function RunProgress({ run }: { run: RunSummary }) {
  const live = isLive(run.state)
  const now = useNow(live)
  return (
    <>
      <RunStateBadge state={run.state} />
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        {run.done}/{run.of} steps · {duration((run.ended ?? now) - run.started)}
        {live && run.phase ? ` · ${run.phase}` : ''}
      </span>
    </>
  )
}

export function ProjectView({ demo, runId, initialTab, initialBranch, initialAgent, onOpenRun, onBack }: ProjectViewProps) {
  const detail = useHostQuery(() => host.demo(demo), [demo])
  const { runs, error: runsError } = useRuns(demo)
  const [opening] = useState(() => openingTab(initialTab))
  const [tab, setTab] = useState<ProjectTab>(opening.tab)
  const { start, starting, error: refused, clearError } = useStartRun((run) => {
    setTab('conversation')
    onOpenRun(run.id)
  })

  // The run shown: the one asked for, else the newest.
  const run = runs?.find((r) => r.id === runId) ?? runs?.[0]
  const d = detail.data
  const history: HistoryInit = { ...opening.history, branch: initialBranch }

  const runButton = (
    <Button onClick={() => void start(demo)} disabled={starting !== null}>
      <Play /> {starting ? 'Starting…' : 'Run'}
    </Button>
  )
  const noRun = runs || runsError ? (
    <div className="mx-auto w-full max-w-[1000px] px-8 py-8">
      <Empty icon={Play} title={runsError ? 'Runs are not readable right now' : `${d?.title ?? demo} has not run yet`} action={runButton}>
        {runsError
          ? runsError.message
          : 'A run Inits a fresh LayerFS project from the demo’s fixture and plays its agents on it. Its conversation, trace, Branches, Sandboxes and history show here.'}
      </Empty>
    </div>
  ) : (
    <Loading label="Reading the runs" />
  )
  // The conversation has its own Stop / Run again bar; the header's Run shows elsewhere.
  const showRun = !(tab === 'conversation' && run)

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 px-8 pt-4">
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
              <h1 className="truncate text-xl font-semibold tracking-[-0.015em]">{d?.title ?? demo}</h1>
              {run && <RunProgress run={run} />}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-3">
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
          {runs && runs.length > 0 && run && <RunPicker runs={runs} value={run.id} onChange={onOpenRun} />}
          {showRun && runButton}
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
        <nav aria-label="Project" className="flex items-end gap-6 border-b">
          {RUN_TABS.map((t) => (
            <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </TabButton>
          ))}
          <span aria-hidden="true" className="mb-2.5 ml-auto h-4 w-px bg-border" />
          <TabButton active={tab === 'runs'} onClick={() => setTab('runs')} quiet>
            Runs{runs ? <span className="ml-1 text-faint">{runs.length}</span> : null}
          </TabButton>
          <TabButton active={tab === 'script'} onClick={() => setTab('script')} quiet>
            Script
          </TabButton>
        </nav>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'runs' ? (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl px-8 py-6">
              <RunList
                demo={demo}
                onOpenRun={(id) => {
                  setTab('conversation')
                  onOpenRun(id)
                }}
              />
            </div>
          </div>
        ) : tab === 'script' ? (
          <DemoScript demo={demo} />
        ) : run ? (
          <RunPanel
            key={run.id}
            runId={run.id}
            tab={tab}
            onTab={setTab}
            onOpenRun={onOpenRun}
            initialAgent={run.id === runId ? initialAgent : undefined}
            historyInit={history}
          />
        ) : (
          noRun
        )}
      </div>
    </div>
  )
}

function TabButton({ active, quiet, onClick, children }: { active: boolean; quiet?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 pt-1 pb-2.5 outline-none focus-visible:text-foreground',
        quiet ? 'text-[13px]' : 'text-sm',
        active
          ? 'border-primary font-medium text-primary'
          : cn('border-transparent hover:text-foreground', quiet ? 'text-faint' : 'text-muted-foreground'),
      )}
    >
      {children}
    </button>
  )
}
