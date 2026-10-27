// A demo project and its sessions. The project page is the demo's LayerFS
// project: its Live view, History and Storage, read from the newest session
// (each session is one replay, which starts the project again from the
// demo's fixture), then the list of Sessions and the demo's Script. A session
// page is one replay: its conversation, agent by agent.
import { ChevronLeft, Layers, Plus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Empty, Loading } from '@/components/projects/states'
import { DemoScript } from '@/components/runs/demo-script'
import { RunStateBadge } from '@/components/runs/run-badges'
import { duration, isLive, ownProject, plural, runLabel } from '@/components/runs/run-format'
import { RunList } from '@/components/runs/run-list'
import type { HistoryInit } from '@/components/runs/run-project-tabs'
import { RunPanel } from '@/components/runs/run-view'
import { useNow } from '@/components/runs/use-run'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { Button } from '@/components/ui/button'
import { ago, bytes } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { RunSummary } from '@shared/host-api'

type ProjectTab = 'live' | 'history' | 'storage' | 'sessions' | 'script'

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'history', label: 'History' },
  { id: 'storage', label: 'Storage' },
]

/** Tab names in `#projects/<demo>/<tab>` hashes (old names too), and where each went. */
function openingTab(initial?: string): { tab?: ProjectTab; history?: HistoryInit } {
  switch (initial) {
    case 'live':
    case 'history':
    case 'storage':
    case 'sessions':
    case 'script':
      return { tab: initial }
    case 'runs':
    case 'replays':
      return { tab: 'sessions' }
    case 'files':
    case 'blame':
      return { tab: 'history', history: { part: 'files' } }
    case 'map':
    case 'replay':
      return { tab: 'history', history: { view: 'map', autoplay: initial === 'replay' } }
    case 'work':
    case 'sandboxes':
      return { tab: 'storage' }
    case 'conversation':
    case 'trace':
      return { tab: 'live' }
    default:
      return {}
  }
}

/** What the page shows: a session (run) and one of its agents, or the project itself. */
export interface ProjectPick {
  run?: string
  agent?: string
}

interface ProjectViewProps {
  /** The demo id: its LayerFS project has the same name. */
  demo: string
  /** The session shown; the project page when absent. */
  runId?: string
  /** The session's agent shown; its root when absent. */
  agent?: string
  onPick: (pick: ProjectPick) => void
  /** Dev aid: a tab (old names map to new ones), the Branch Files and History open on. */
  initialTab?: string
  initialBranch?: string
  onBack: () => void
}

export function ProjectView({ demo, runId, agent, onPick, initialTab, initialBranch, onBack }: ProjectViewProps) {
  const detail = useHostQuery(() => host.demo(demo), [demo])
  const { runs, error: runsError } = useRuns(demo)
  const { start, starting, error: refused, clearError } = useStartRun((run) => onPick({ run: run.id }))
  const title = detail.data?.title ?? demo
  const playing = runs?.find((r) => isLive(r.state))
  const newSession = (
    <Button
      onClick={() => void start(demo)}
      disabled={starting !== null || !!playing}
      title={playing ? `${runLabel(playing)} is playing` : `Start ${demo} again from the demo's fixture and play the scenario as a new session`}
    >
      <Plus /> {starting ? 'Starting…' : 'New session'}
    </Button>
  )
  const refusal = refused && (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive ring-1 ring-destructive/25 ring-inset"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">Could not start a session: {refused.message}</span>
      <button type="button" onClick={clearError} className="text-xs font-medium underline-offset-2 hover:underline">
        Dismiss
      </button>
    </div>
  )

  const session = runId ? runs?.find((r) => r.id === runId) : undefined
  if (runId)
    return session ? (
      <SessionPage
        run={session}
        title={title}
        agent={agent}
        onAgent={(name) => onPick({ run: session.id, agent: name })}
        onProject={() => onPick({})}
        action={newSession}
        refusal={refusal}
      />
    ) : (
      <Loading label={runs ? `No session ${runId}` : 'Reading the sessions'} className="h-svh" />
    )

  return (
    <ProjectPage
      demo={demo}
      title={title}
      runs={runs}
      runsError={runsError}
      onPick={onPick}
      onBack={onBack}
      initialTab={initialTab}
      initialBranch={initialBranch}
      action={newSession}
      refusal={refusal}
    />
  )
}

interface PageParts {
  title: string
  action: React.ReactNode
  refusal: React.ReactNode
}

interface ProjectPageProps extends PageParts {
  demo: string
  runs: RunSummary[] | undefined
  runsError: Error | undefined
  onPick: (pick: ProjectPick) => void
  onBack: () => void
  initialTab?: string
  initialBranch?: string
}

/** The project: Live, History and Storage from its newest session, then Sessions and Script. */
function ProjectPage({ demo, title, runs, runsError, onPick, onBack, initialTab, initialBranch, action, refusal }: ProjectPageProps) {
  const [opening] = useState(() => openingTab(initialTab))
  const [tab, setTab] = useState<ProjectTab>(opening.tab ?? 'live')
  // The project holds its newest session's state; sessions from before one project per demo played elsewhere.
  const current = runs?.find((r) => r.project === demo)
  const state = useHostQuery(() => host.project(demo), [demo, current?.id, current?.state])
  const s = state.data?.project.name === demo ? state.data : undefined
  const history: HistoryInit = { ...opening.history, branch: initialBranch }

  const facts = s
    ? [
        s.last ? `last Commit ${ago(s.last.at)} on ${s.last.branch}` : 'no Commits yet',
        `${s.branches.length} Branch${s.branches.length === 1 ? '' : 'es'}`,
        plural(s.commits, 'Commit'),
        `Store ${bytes(s.store.bytes)}`,
      ]
    : []

  const body =
    tab === 'sessions' ? (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-8 py-6">
          <RunList demo={demo} onOpenRun={(id) => onPick({ run: id })} />
        </div>
      </div>
    ) : tab === 'script' ? (
      <DemoScript demo={demo} />
    ) : current ? (
      <RunPanel
        key={current.id}
        runId={current.id}
        tab={tab}
        onOpenRun={(id) => onPick({ run: id })}
        onAgent={(name) => onPick({ run: current.id, agent: name })}
        historyInit={history}
      />
    ) : runs || runsError ? (
      <div className="mx-auto w-full max-w-[1000px] px-8 py-8">
        <Empty icon={Layers} title={runsError ? 'Sessions are not readable right now' : `${title} has no sessions yet`} action={action}>
          {runsError ? (
            runsError.message
          ) : (
            <>
              A session Inits the LayerFS project <span className="font-mono text-foreground">{demo}</span> from the demo’s fixture and plays
              its scripted agents on it. Its Live view, History and Storage show here.
            </>
          )}
        </Empty>
      </div>
    ) : (
      <Loading label="Reading the sessions" />
    )

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 px-8 pt-4">
        <BackLink onClick={onBack}>Projects</BackLink>
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-xl font-semibold tracking-[-0.015em]">{title}</h1>
              <ProjectChip name={demo} />
              {current && isLive(current.state) && (
                <button type="button" onClick={() => onPick({ run: current.id })} className="flex items-center gap-2 text-xs text-primary hover:underline">
                  <RunStateBadge state={current.state} /> {runLabel(current)} playing
                </button>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {s ? facts.join(' · ') : state.error && current ? state.error.message : 'Local SQLite Store · Docker Sandboxes'}
            </p>
          </div>
          {action}
        </div>
        {refusal}
        <nav aria-label="Project" className="flex items-end gap-6 border-b">
          {PROJECT_TABS.map((t) => (
            <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.id === 'live' && current && isLive(current.state) && (
                <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
              )}
              {t.label}
            </TabButton>
          ))}
          <span aria-hidden="true" className="mb-2.5 ml-auto h-4 w-px bg-border" />
          <TabButton active={tab === 'sessions'} onClick={() => setTab('sessions')} quiet>
            Sessions{runs ? <span className="ml-1 text-faint">{runs.length}</span> : null}
          </TabButton>
          <TabButton active={tab === 'script'} onClick={() => setTab('script')} quiet>
            Script
          </TabButton>
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  )
}

interface SessionPageProps extends PageParts {
  run: RunSummary
  agent?: string
  onAgent: (name: string) => void
  onProject: () => void
}

/** One session (replay): its conversation, agent by agent. */
function SessionPage({ run, title, agent, onAgent, onProject, action, refusal }: SessionPageProps) {
  const live = isLive(run.state)
  const now = useNow(live)
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-2.5 border-b px-8 pt-4 pb-3">
        <BackLink onClick={onProject}>{title}</BackLink>
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h1 className="truncate text-xl font-semibold tracking-[-0.015em]">{runLabel(run)}</h1>
            <RunStateBadge state={run.state} />
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {plural(run.done, 'step')} · {duration((run.ended ?? now) - run.started)} · started {ago(run.started, now)}
              {live && run.phase ? ` · ${run.phase}` : ''}
            </span>
            {ownProject(run) && <ProjectChip name={run.project} />}
          </div>
          {action}
        </div>
        {refusal}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <RunPanel key={run.id} runId={run.id} tab="conversation" agent={agent} onAgent={onAgent} />
      </div>
    </div>
  )
}

function ProjectChip({ name }: { name: string }) {
  return (
    <span
      title={`The LayerFS project ${name}`}
      className="flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground"
    >
      <Layers aria-hidden="true" className="size-3" />
      {name}
    </span>
  )
}

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 flex w-fit items-center gap-1 rounded text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-4" /> {children}
    </button>
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
