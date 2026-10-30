// A demo project and its sessions. The project page is the demo's LayerFS
// project: its Live view, Timeline, History, Storage and Sandboxes, read from the newest session
// (each session is one replay, which starts the project again from the
// demo's fixture), or from the project itself before any session (its Init
// made `main` at the genesis Layer, so only Live waits for one), and the list of Sessions. A session page is one replay:
// its conversation, agent by agent. Both carry the small replay control,
// whose menu opens the scenario.
import { Activity, Clock, MessagesSquare, Sparkles, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { LfsProject } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion/count-up'
import { PageHeader } from '@/components/motion/page-header'
import { Tab, TabBar } from '@/components/motion/tabs'
import { viewTransition } from '@/components/motion/view-transition'
import { Empty, Loading } from '@/components/projects/states'
import { DemoScript } from '@/components/runs/demo-script'
import { RunStateBadge, SessionHint } from '@/components/runs/run-badges'
import { duration, isLive, modelLabel, runLabel } from '@/components/runs/run-format'
import { ReplayControl } from '@/components/runs/replay-control'
import { RunList } from '@/components/runs/run-list'
import { ProjectSandboxes, ProjectStorage } from '@/components/projects/project-storage'
import { type HistoryInit, HistoryPane, TimelinePane, useProjectRead } from '@/components/runs/run-project-tabs'
import { Composer } from '@/components/runs/composer'
import { RunPanel } from '@/components/runs/run-view'
import { type HistoryTarget, TraceView } from '@/components/runs/trace-view'
import { useNow } from '@/components/runs/use-run'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { ago } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery, useProjects } from '@/host/use-host'
import { projectLabel, type RunSummary } from '@shared/host-api'

type ProjectTab = 'live' | 'timeline' | 'history' | 'storage' | 'sandboxes' | 'sessions' | 'script'

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'history', label: 'History' },
  { id: 'storage', label: 'Storage' },
  { id: 'sandboxes', label: 'Sandboxes' },
]

/** Tab names in `#projects/<demo>/<tab>` hashes (old names too), and where each went. */
function openingTab(initial?: string): { tab?: ProjectTab; history?: HistoryInit } {
  switch (initial) {
    case 'live':
    case 'timeline':
    case 'history':
    case 'storage':
    case 'sandboxes':
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
      return { tab: 'timeline', history: { autoplay: initial === 'replay' } }
    case 'work':
      return { tab: 'sandboxes' }
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
  /** A new live session on the project, not started yet. */
  draft?: boolean
}

interface ProjectViewProps {
  /** The demo id: its LayerFS project has the same name. */
  demo: string
  /** The session shown; the project page when absent. */
  runId?: string
  /** A new conversation on the project, not started yet: it starts with its first message. */
  draft?: boolean
  /** The session's agent shown; its root when absent. */
  agent?: string
  onPick: (pick: ProjectPick) => void
  /** Dev aid: a tab (old names map to new ones), the Branch Files and History open on. */
  initialTab?: string
  initialBranch?: string
  onBack: () => void
}

export function ProjectView({ demo, runId, draft, agent, onPick, initialTab, initialBranch }: ProjectViewProps) {
  const detail = useHostQuery(() => host.demo(demo), [demo])
  const { runs, error: runsError } = useRuns(demo)
  const { start, starting, error: refused, clearError } = useStartRun((run) => onPick({ run: run.id }))
  const title = detail.data?.title ?? projectLabel(demo)
  const [opening] = useState(() => openingTab(initialTab))
  const [tab, setTab] = useState<ProjectTab>(opening.tab ?? 'live')
  // a Trace auto-checkpoint opened: the project's History, on its Commit (or Layer, or Branch)
  const [historyAt, setHistoryAt] = useState<HistoryTarget>()
  const replay = (
    <ReplayControl
      runs={runs}
      onReplay={() => void start(demo)}
      starting={starting !== null}
      onOpenRun={(id) => onPick({ run: id })}
      onViewScenario={() => {
        setTab('script')
        onPick({})
      }}
    />
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

  if (draft && !runId) return <DraftSession project={demo} title={title} onProject={() => onPick({})} onOpenRun={(r) => onPick({ run: r.id })} />

  const session = runId ? runs?.find((r) => r.id === runId) : undefined
  if (runId)
    return session ? (
      <SessionPage
        run={session}
        project={demo}
        onOpenRun={(r) => onPick({ run: r.id })}
        title={title}
        agent={agent}
        onAgent={(name) => onPick({ run: session.id, agent: name })}
        onProject={() => onPick({})}
        onOpenHistory={(at) => {
          setHistoryAt(at)
          setTab('history')
          onPick({})
        }}
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
      tab={tab}
      onTab={(t) => viewTransition(() => setTab(t), 'tab')}
      historyInit={historyAt ? { part: 'history', ...historyAt } : { ...opening.history, branch: initialBranch }}
      action={detail.data ? replay : undefined}
      refusal={refusal}
      scenario={detail.loading ? null : !!detail.data}
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
  tab: ProjectTab
  onTab: (tab: ProjectTab) => void
  historyInit: HistoryInit
  /** The project plays a scenario of its own: true, false, or null while that is read. */
  scenario: boolean | null
}

/** The project: Live, History, Storage and Sandboxes from its newest session, then Sessions and Script. */
function ProjectPage({ demo, title, runs, runsError, onPick, tab, onTab: setTab, historyInit, action, refusal, scenario }: ProjectPageProps) {
  // A Branch picked on the Timeline opens History on it.
  const [openBranch, setOpenBranch] = useState<string>()
  const history = openBranch ? { ...historyInit, part: undefined, branch: openBranch } : historyInit
  // The project shows its newest session; sessions from before one project per demo played elsewhere.
  const current = runs?.find((r) => r.project === demo)

  const playing = current && isLive(current.state)

  const body =
    tab === 'sessions' ? (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-8 py-6">
          <RunList
            demo={demo}
            onOpenRun={(id) => onPick({ run: id })}
            // a project with no scenario of its own (it has no detail): New session is a live session on it
            onNewSession={scenario === false ? () => onPick({ draft: true }) : undefined}
          />
        </div>
      </div>
    ) : tab === 'script' ? (
      <DemoScript demo={demo} />
    ) : current ? (
      <RunPanel
        key={current.id}
        runId={current.id}
        tab={tab}
        onAgent={(name) => onPick({ run: current.id, agent: name })}
        onOpenSession={(run, name) => onPick({ run, agent: name })}
        historyInit={history}
        onOpenBranch={(name) => {
          setOpenBranch(name)
          setTab('history')
        }}
        sessions={runs?.filter((r) => r.project === demo)}
      />
    ) : runs || runsError ? (
      // no session yet: the project itself, as its Init left it (genesis `main` at L0) and Commits since
      tab === 'history' ? (
        <ProjectHistory project={demo} init={history} />
      ) : tab === 'timeline' ? (
        <ProjectTimeline
          project={demo}
          init={history}
          onOpenBranch={(name) => {
            setOpenBranch(name)
            setTab('history')
          }}
        />
      ) : tab === 'storage' ? (
        <ProjectStorage project={demo} />
      ) : tab === 'sandboxes' ? (
        <ProjectSandboxes project={demo} />
      ) : (
        <div className="mx-auto w-full max-w-[1000px] px-8 py-8">
          <Empty icon={LfsProject} title={runsError ? 'Sessions are not readable right now' : `${title} has no sessions yet`} action={action}>
            {runsError ? (
              runsError.message
            ) : (
              <>
                Live shows a session as it plays on <span className="font-mono text-foreground">{demo}</span>. Its History, Timeline, Storage and
                Sandboxes already show the project as it is.
              </>
            )}
          </Empty>
        </div>
      )
    ) : (
      <Loading label="Reading the sessions" />
    )

  return (
    <div className="flex h-svh min-h-0 flex-col">
      {/* The tabs are the page's first row; the sidebar names the project. */}
      <header data-live={playing || undefined} className="page-header relative z-20 shrink-0 px-8 pt-3">
        <div className="mx-auto flex w-full flex-col gap-2">
      <TabBar aria-label="Project">
        {PROJECT_TABS.map((t) => (
          <Tab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.id === 'live' && playing && <span aria-hidden="true" className="pulse-ring mr-2 inline-block size-1.5 rounded-full bg-primary text-primary" />}
            {t.label}
          </Tab>
        ))}
        <span aria-hidden="true" className="mb-2.5 ml-auto h-4 w-px bg-border" />
        <Tab active={tab === 'sessions'} onClick={() => setTab('sessions')} quiet>
          Sessions
          {runs ? (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground tabular-nums ring-1 ring-foreground/[0.05] ring-inset">
              <CountUp value={runs.length} />
            </span>
          ) : null}
        </Tab>
        {tab === 'script' && (
          <Tab active onClick={() => setTab('script')} quiet className="animate-in fade-in slide-in-from-left-1">
            Scenario
          </Tab>
        )}
        {action && <div className="mb-1.5 flex shrink-0 items-center gap-2 self-center">{action}</div>}
      </TabBar>
          {refusal}
        </div>
        {playing && <span aria-hidden="true" className="live-line" />}
      </header>
      <div className="vt-panel flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  )
}

/** History of a project no session has played on. */
function ProjectHistory({ project, init }: { project: string; init: HistoryInit }) {
  return <HistoryPane source={{ project }} project={useProjectRead(project)} init={init} />
}

/** Timeline of a project no session has played on. */
function ProjectTimeline({ project, init, onOpenBranch }: { project: string; init: HistoryInit; onOpenBranch: (name: string) => void }) {
  return <TimelinePane source={{ project }} project={useProjectRead(project)} init={init} onOpenBranch={onOpenBranch} />
}

interface SessionPageProps {
  title: string
  /** The project the page is under: where the composer's messages and scenarios go. */
  project: string
  onOpenRun: (run: RunSummary) => void
  run: RunSummary
  agent?: string
  onAgent: (name: string) => void
  onProject: () => void
  onOpenHistory: (at: HistoryTarget) => void
}

/** One session (replay): its conversation, agent by agent, under a one-row breadcrumb header. */
function SessionPage({ run, project, onOpenRun, title, agent, onAgent, onProject, onOpenHistory }: SessionPageProps) {
  const live = isLive(run.state)
  const now = useNow(live)
  const [view, setView] = useState<'conversation' | 'trace'>('conversation')
  const tabs = (
    <>
      <Tab active={view === 'conversation'} onClick={() => viewTransition(() => setView('conversation'), 'tab')}>
        <MessagesSquare aria-hidden="true" className="mr-1.5 size-3.5 opacity-80" />
        Conversation
      </Tab>
      <Tab active={view === 'trace'} onClick={() => viewTransition(() => setView('trace'), 'tab')}>
        <Activity aria-hidden="true" className="mr-1.5 size-3.5 opacity-80" />
        Trace
      </Tab>
    </>
  )
  const lead = (
    <>
      <SessionHint run={run} now={now}>
      <button
        type="button"
        onClick={onProject}
        className="group/crumb -ml-1 flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1.5 pl-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="surface flex size-6 shrink-0 items-center justify-center rounded-md transition-[transform,border-color] duration-(--dur-base) ease-out-expo group-hover/crumb:-translate-x-0.5 group-hover/crumb:border-primary/30">
          <LfsProject aria-hidden="true" className="size-3.5" />
        </span>
        <span className="truncate font-medium">{title}</span>
      </button>
      </SessionHint>
      {/* the page is the session's: named for screen readers, shown on hover over the project crumb */}
      <h1 className="sr-only">{runLabel(run)}</h1>
    </>
  )
  const meta = (
    <>
      {live && <RunStateBadge state={run.state} />}
      {run.kind === 'live' && run.model && (
        <>
          <span className="flex min-w-0 items-center gap-1" title={`Model: ${run.model}${run.thinkingLevel ? ` · thinking ${run.thinkingLevel}` : ''}`}>
            <Sparkles aria-hidden="true" className="size-3.5 text-faint" />
            <span className="truncate">{modelLabel(run.model).text}</span>
          </span>
          <span aria-hidden="true" className="text-faint">·</span>
        </>
      )}
      {run.kind !== 'live' && (
        <>
          <span className="rounded px-1 text-[10px] font-medium tracking-wide text-faint uppercase ring-1 ring-border ring-inset" title={`A replay of the ${run.demo} scenario`}>
            replay · {run.demo}
          </span>
          <span aria-hidden="true" className="text-faint">·</span>
        </>
      )}
      {/* a live session has no end; how long it has run says little */}
      {run.kind !== 'live' && (
        <>
          <span className="flex items-center gap-1">
            <Clock aria-hidden="true" className="size-3.5 text-faint" />
            {duration((run.ended ?? now) - run.started)}
          </span>
          <span aria-hidden="true" className="text-faint">·</span>
        </>
      )}
      <span>started {ago(run.started, now)}</span>
    </>
  )
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <div className="vt-panel flex min-h-0 flex-1 flex-col">
        <RunPanel
          key={run.id}
          runId={run.id}
          tab="conversation"
          agent={agent}
          onAgent={onAgent}
          lead={lead}
          tabs={tabs}
          pane={view === 'trace' ? (shown: string) => <TraceView runId={run.id} agent={shown} live={live || run.state === 'idle'} started={run.started} onOpenHistory={onOpenHistory} /> : undefined}
          meta={meta}
          composer={(aside) => <Composer project={project} run={run} onOpenRun={onOpenRun} aside={aside} />}
        />
      </div>
    </div>
  )
}

/** A new conversation on the project: the composer, waiting for its first message (or a /scenario). */
function DraftSession({ project, title, onProject, onOpenRun }: { project: string; title: string; onProject: () => void; onOpenRun: (run: RunSummary) => void }) {
  const state = useProjects()
  // `project` is the project key: `store/name` in a shared Store (layerfs#506)
  const found = state.data?.find((p) => (p.key ?? p.name) === project)
  const ready = !!found?.initialized
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        size="md"
        className="[&>div]:pt-2"
        eyebrow={
          <nav aria-label="Breadcrumb" className="reveal flex min-w-0 flex-1 items-center gap-1 text-sm">
            <button
              type="button"
              onClick={onProject}
              className="group/crumb -ml-1 flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1.5 pl-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="surface flex size-6 shrink-0 items-center justify-center rounded-md">
                <LfsProject aria-hidden="true" className="size-3.5" />
              </span>
              <span className="truncate font-medium">{title}</span>
            </button>
            <span aria-hidden="true" className="px-0.5 text-[15px] font-light text-foreground/20">
              /
            </span>
            <h1 className="truncate font-medium text-foreground">New session</h1>
          </nav>
        }
      />
      <div className="vt-panel flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="surface flex size-11 items-center justify-center rounded-lg">
            <MessagesSquare aria-hidden="true" className="size-5 text-primary" />
          </span>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">What should the agent do on {title}?</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {state.data && !ready ? (
              <>
                {project} has no LayerFS state yet. Start it from a scenario: type <code className="font-mono text-foreground">/scenario {project}</code>.
              </>
            ) : (
              <>
                It works on the project as it is now, through <code className="font-mono">layerfs</code>, and can start subagents. Type{' '}
                <code className="font-mono text-foreground">/scenario</code> to reset the project and play a scenario instead.
              </>
            )}
          </p>
        </div>
        <div className="shrink-0 px-8 pt-1 pb-4">
          <div className="mx-auto w-full max-w-[1000px]">
            <Composer project={project} onOpenRun={onOpenRun} autoFocus />
          </div>
        </div>
      </div>
    </div>
  )
}
