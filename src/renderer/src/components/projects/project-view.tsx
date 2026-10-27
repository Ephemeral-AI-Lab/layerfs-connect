// A demo project: one LayerFS project, named after the demo, and its sessions
// (the agents of its replay), on one page as dsh lays out a session. The
// header names the demo and its LayerFS project and picks the replay; one tab
// row shows that replay's Live view, Conversation and History, then the demo's Replays and Script. A replay resets the project first, so
// only the newest replay's Branches, Commits and Sandboxes are there.
import { ChevronLeft, Layers, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { KindBar } from '@/components/projects/projects-home'
import { Empty, Loading } from '@/components/projects/states'
import { DemoScript } from '@/components/runs/demo-script'
import { RunDot, RunStateBadge } from '@/components/runs/run-badges'
import { RUN_LABEL, duration, isLive, ownProject, runLabel } from '@/components/runs/run-format'
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
  { id: 'live', label: 'Live' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'history', label: 'History' },
]

/** Tab names in `#projects/<demo>/<tab>` hashes (old names too), and where each went. */
function openingTab(initial?: string): { tab?: ProjectTab; history?: HistoryInit } {
  switch (initial) {
    case 'live':
    case 'conversation':
    case 'history':
    case 'runs':
    case 'script':
      return { tab: initial }
    case 'replays':
      return { tab: 'runs' }
    case 'files':
    case 'blame':
      return { tab: 'history', history: { part: 'files' } }
    case 'map':
    case 'replay':
      return { tab: 'history', history: { view: 'map', autoplay: initial === 'replay' } }
    case 'trace':
      return { tab: 'conversation' }
    case 'work':
    case 'storage':
    case 'sandboxes':
      return { tab: 'live' }
    default:
      return {}
  }
}

/** What the page shows: optionally an earlier replay, and a session (agent). */
export interface ProjectPick {
  run?: string
  agent?: string
}

interface ProjectViewProps {
  /** The demo id: its LayerFS project has the same name. */
  demo: string
  /** The replay shown; the newest when absent. */
  runId?: string
  /** The session (agent) shown; the replay's root when absent. */
  agent?: string
  onPick: (pick: ProjectPick) => void
  /** Dev aid: a tab (old names map to new ones), the Branch Files and History open on. */
  initialTab?: string
  initialBranch?: string
  onBack: () => void
}

function RunPicker({ runs, value, onChange }: { runs: RunSummary[]; value: string; onChange: (id: string) => void }) {
  const run = runs.find((r) => r.id === value)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Replay" className="w-48">
        <SelectValue>
          {run && (
            <span className="flex min-w-0 items-center gap-2">
              <RunDot state={run.state} />
              <span className="font-medium">{runLabel(run)}</span>
              <span className="truncate text-xs text-muted-foreground">{run.id === runs[0]?.id ? 'latest' : ago(run.started)}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {runs.map((r, i) => (
          <SelectItem key={r.id} value={r.id}>
            <RunDot state={r.state} />
            <span className="font-medium">{runLabel(r)}</span>
            {ownProject(r) && <span className="font-mono text-xs text-muted-foreground">{r.project}</span>}
            <span className="text-xs text-faint">
              {RUN_LABEL[r.state]} · {i === 0 ? 'latest' : ago(r.started)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The replay's state beside the title: its badge, and how far it got. */
function RunProgress({ run }: { run: RunSummary }) {
  const live = isLive(run.state)
  const now = useNow(live)
  return (
    <>
      <RunStateBadge state={run.state} />
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        {runLabel(run)} · {run.done}/{run.of} steps · {duration((run.ended ?? now) - run.started)}
        {live && run.phase ? ` · ${run.phase}` : ''}
      </span>
    </>
  )
}

export function ProjectView({ demo, runId, agent, onPick, initialTab, initialBranch, onBack }: ProjectViewProps) {
  const detail = useHostQuery(() => host.demo(demo), [demo])
  const { runs, error: runsError } = useRuns(demo)
  const [opening] = useState(() => openingTab(initialTab))
  const [chosen, setTab] = useState<ProjectTab | undefined>(opening.tab)
  const { start, starting, error: refused, clearError } = useStartRun(() => {
    setTab('live')
    onPick({})
  })

  // The replay shown: the one asked for, else the newest. The project holds the newest replay on it.
  const run = runs?.find((r) => r.id === runId) ?? runs?.[0]
  const holder = runs?.find((r) => r.project === demo)
  const replacedBy =
    run && holder && run.project === demo && run.id !== holder.id ? { label: runLabel(holder), onOpen: () => onPick({ agent }) } : undefined
  // A playing replay opens on Live, a finished one on its conversation.
  const tab: ProjectTab = chosen ?? (run && isLive(run.state) ? 'live' : 'conversation')

  // A session picked in the sidebar opens its conversation.
  const seenAgent = useRef(agent)
  useEffect(() => {
    if (agent && agent !== seenAgent.current) setTab('conversation')
    seenAgent.current = agent
  }, [agent, tab])

  const d = detail.data
  const history: HistoryInit = { ...opening.history, branch: initialBranch }
  const replaying = runs?.some((r) => r.project === demo && isLive(r.state)) ?? false

  const replayButton = (
    <Button
      onClick={() => void start(demo)}
      disabled={starting !== null || replaying}
      title={holder ? `Reset ${demo} (remove it, Init it again from the fixture) and replay the scenario` : `Init ${demo} from the fixture and replay the scenario`}
    >
      <RotateCcw /> {starting ? 'Starting…' : replaying ? 'Replaying' : 'Replay'}
    </Button>
  )
  const noRun =
    runs || runsError ? (
      <div className="mx-auto w-full max-w-[1000px] px-8 py-8">
        <Empty icon={RotateCcw} title={runsError ? 'Replays are not readable right now' : `${d?.title ?? demo} has not been replayed yet`} action={replayButton}>
          {runsError ? (
            runsError.message
          ) : (
            <>
              A replay Inits the LayerFS project <span className="font-mono text-foreground">{demo}</span> from the demo’s fixture and plays
              its agents on it; each agent is a session here. A later replay resets the project first.
            </>
          )}
        </Empty>
      </div>
    ) : (
      <Loading label="Reading the replays" />
    )

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
              <span
                title={`The LayerFS project ${run && ownProject(run) ? run.project : demo}`}
                className="flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground"
              >
                <Layers aria-hidden="true" className="size-3" />
                {run && ownProject(run) ? run.project : demo}
              </span>
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
                  {d.agents.length} session{d.agents.length === 1 ? '' : 's'} · {d.steps} steps
                </span>
              )}
              {d && <KindBar kinds={d.kinds} className="w-28 shrink-0" />}
              {detail.error && <span className="text-xs text-destructive">{detail.error.message}</span>}
            </div>
          </div>
          {runs && runs.length > 1 && run && <RunPicker runs={runs} value={run.id} onChange={(id) => onPick({ run: id, agent })} />}
          {replayButton}
        </div>
        {refused && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">Could not start a replay: {refused.message}</span>
            <button type="button" onClick={clearError} className="text-xs font-medium underline-offset-2 hover:underline">
              Dismiss
            </button>
          </div>
        )}
        <nav aria-label="Project" className="flex items-end gap-6 border-b">
          {RUN_TABS.map((t) => (
            <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.id === 'live' && run && isLive(run.state) && !replacedBy && (
                <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
              )}
              {t.label}
            </TabButton>
          ))}
          <span aria-hidden="true" className="mb-2.5 ml-auto h-4 w-px bg-border" />
          <TabButton active={tab === 'runs'} onClick={() => setTab('runs')} quiet>
            Replays{runs ? <span className="ml-1 text-faint">{runs.length}</span> : null}
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
                  onPick({ run: id })
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
            onOpenRun={() => {
              setTab('live')
              onPick({})
            }}
            agent={agent}
            onAgent={(name) => onPick({ run: runId, agent: name })}
            replacedBy={replacedBy}
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
