// A demo project and its sessions. The project page is the demo's LayerFS
// project: its Live view, History, Storage and Sandboxes, read from the newest session
// (each session is one replay, which starts the project again from the
// demo's fixture), and the list of Sessions. A session page is one replay:
// its conversation, agent by agent. Both carry the small replay control,
// whose menu opens the scenario.
import { Activity, ChevronLeft, Clock, MessagesSquare, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { LfsBranch, LfsCommit, LfsLayer, LfsProject, LfsSandbox, LfsStore } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion/count-up'
import { HeroTile, Stat, StatSkeleton } from '@/components/motion/hero'
import { PageHeader } from '@/components/motion/page-header'
import { Tab, TabBar } from '@/components/motion/tabs'
import { viewTransition } from '@/components/motion/view-transition'
import { Empty, Loading } from '@/components/projects/states'
import { DemoScript } from '@/components/runs/demo-script'
import { RunStateBadge, SessionHint } from '@/components/runs/run-badges'
import { duration, isLive, runLabel } from '@/components/runs/run-format'
import { ReplayControl } from '@/components/runs/replay-control'
import { RunList } from '@/components/runs/run-list'
import type { HistoryInit } from '@/components/runs/run-project-tabs'
import { RunPanel } from '@/components/runs/run-view'
import { type HistoryTarget, TraceView } from '@/components/runs/trace-view'
import { useNow } from '@/components/runs/use-run'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { ago, bytes } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import type { RunSummary } from '@shared/host-api'

type ProjectTab = 'live' | 'history' | 'storage' | 'sandboxes' | 'sessions' | 'script'

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'history', label: 'History' },
  { id: 'storage', label: 'Storage' },
  { id: 'sandboxes', label: 'Sandboxes' },
]

/** Tab names in `#projects/<demo>/<tab>` hashes (old names too), and where each went. */
function openingTab(initial?: string): { tab?: ProjectTab; history?: HistoryInit } {
  switch (initial) {
    case 'live':
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
      return { tab: 'history', history: { view: 'map', autoplay: initial === 'replay' } }
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

  const session = runId ? runs?.find((r) => r.id === runId) : undefined
  if (runId)
    return session ? (
      <SessionPage
        run={session}
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
      onBack={onBack}
      tab={tab}
      onTab={(t) => viewTransition(() => setTab(t), 'tab')}
      historyInit={historyAt ? { part: 'history', ...historyAt } : { ...opening.history, branch: initialBranch }}
      action={replay}
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
  tab: ProjectTab
  onTab: (tab: ProjectTab) => void
  historyInit: HistoryInit
}

/** The project: Live, History, Storage and Sandboxes from its newest session, then Sessions and Script. */
function ProjectPage({ demo, title, runs, runsError, onPick, onBack, tab, onTab: setTab, historyInit: history, action, refusal }: ProjectPageProps) {
  // The project holds its newest session's state; sessions from before one project per demo played elsewhere.
  const current = runs?.find((r) => r.project === demo)
  const state = useHostQuery(() => host.project(demo), [demo, current?.id, current?.state])
  const s = state.data?.project.name === demo ? state.data : undefined

  const playing = current && isLive(current.state)
  // The project's facts as stat pills, counting up as they arrive and as a session writes.
  const facts = s ? (
    <>
      <Stat icon={LfsCommit} index={1} live={playing} title={s.last ? `Last Commit ${ago(s.last.at)} on ${s.last.branch}` : undefined}>
        {s.last ? (
          <>
            {/* a narrow header keeps the time only; the title has it all */}
            <span className="font-normal text-muted-foreground @max-[40rem]/hero:hidden">last Commit </span>
            {ago(s.last.at)}
            <span className="@max-[40rem]/hero:hidden">
              <span className="font-normal text-muted-foreground"> on </span>
              <span className="font-mono text-[11.5px]">{s.last.branch}</span>
            </span>
          </>
        ) : (
          <span className="font-normal text-muted-foreground">no Commits yet</span>
        )}
      </Stat>
      <Stat icon={LfsBranch} index={2} label={s.branches.length === 1 ? 'Branch' : 'Branches'}>
        <CountUp value={s.branches.length} />
      </Stat>
      <Stat icon={LfsLayer} index={3} label={s.commits === 1 ? 'Commit' : 'Commits'} live={playing}>
        <CountUp value={s.commits} />
      </Stat>
      <Stat icon={LfsStore} index={4} label="Store" title={s.store.path ?? undefined}>
        <CountUp value={s.store.bytes} format={bytes} />
      </Stat>
    </>
  ) : state.error && current ? (
    <span className="reveal truncate text-xs text-muted-foreground">{state.error.message}</span>
  ) : current ? (
    <>
      {[28, 20, 22, 20].map((w, i) => (
        <StatSkeleton key={i} className="opacity-70" style={{ width: `${w * 0.25}rem` }} />
      ))}
    </>
  ) : (
    <>
      <Stat icon={LfsStore} index={1}>
        <span className="font-normal">Local SQLite Store</span>
      </Stat>
      <Stat icon={LfsSandbox} index={2}>
        <span className="font-normal">Docker Sandboxes</span>
      </Stat>
    </>
  )

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
        onAgent={(name) => onPick({ run: current.id, agent: name })}
        onOpenSession={(run, name) => onPick({ run, agent: name })}
        historyInit={history}
        sessions={runs?.filter((r) => r.project === demo)}
      />
    ) : runs || runsError ? (
      <div className="mx-auto w-full max-w-[1000px] px-8 py-8">
        <Empty icon={LfsProject} title={runsError ? 'Sessions are not readable right now' : `${title} has no sessions yet`} action={action}>
          {runsError ? (
            runsError.message
          ) : (
            <>
              A session Inits the LayerFS project <span className="font-mono text-foreground">{demo}</span> from the demo’s fixture and plays
              its scripted agents on it. Its Live view, History, Storage and Sandboxes show here.
            </>
          )}
        </Empty>
      </div>
    ) : (
      <Loading label="Reading the sessions" />
    )

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        size="md"
        className="[&>div]:pt-3"
        eyebrow={<BackLink onClick={onBack}>Projects</BackLink>}
        icon={<HeroTile icon={LfsProject} live={playing} />}
        title={title}
        badges={
          <>
            <ProjectChip name={demo} />
            {playing && (
              <button
                type="button"
                onClick={() => onPick({ run: current.id })}
                title="Open the playing session"
                className="group/playing flex shrink-0 items-center gap-2 rounded-md text-xs font-medium text-primary outline-none animate-in fade-in slide-in-from-left-1 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RunStateBadge state={current.state} />
                <span className="group-hover/playing:underline">{runLabel(current)} playing</span>
              </button>
            )}
          </>
        }
        facts={facts}
        live={playing}
        actions={action}
        tabs={
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
          </TabBar>
        }
      >
        {refusal}
      </PageHeader>
      <div className="vt-panel flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  )
}

interface SessionPageProps {
  title: string
  run: RunSummary
  agent?: string
  onAgent: (name: string) => void
  onProject: () => void
  onOpenHistory: (at: HistoryTarget) => void
}

/** One session (replay): its conversation, agent by agent, under a one-row breadcrumb header. */
function SessionPage({ run, title, agent, onAgent, onProject, onOpenHistory }: SessionPageProps) {
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
      <span className="flex items-center gap-1">
        <Clock aria-hidden="true" className="size-3.5 text-faint" />
        {duration((run.ended ?? now) - run.started)}
      </span>
      <span aria-hidden="true" className="text-faint">·</span>
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
          pane={view === 'trace' ? (shown: string) => <TraceView runId={run.id} agent={shown} live={live} started={run.started} onOpenHistory={onOpenHistory} /> : undefined}
          meta={meta}
        />
      </div>
    </div>
  )
}

function ProjectChip({ name }: { name: string }) {
  return (
    <span
      title={`The LayerFS project ${name}`}
      className="flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground ring-1 ring-foreground/[0.06] ring-inset"
    >
      <LfsProject className="size-3.5" />
      {name}
    </span>
  )
}

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/back -ml-1 flex w-fit items-center gap-1 rounded text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-4 transition-transform duration-(--dur-base) ease-out-expo group-hover/back:-translate-x-0.5" /> {children}
    </button>
  )
}
