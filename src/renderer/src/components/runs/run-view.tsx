// A session's (one replay's) views: its Conversation on the session page, and
// the project's Live, History and Storage, read from the newest session, on
// the project page. The page header above names the project or session;
// these only add what is theirs. The session page's one-row header comes from
// here, as it names the agents: "Crew / root / work-a (2 subagents running)".
import type { DemoDetail, RunDetail, RunSummary, StepView } from '@shared/host-api'
import { Gauge, RotateCw, TriangleAlert } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react'

import { AgentSwitcher, type SwitcherAgent } from '@/components/runs/agent-switcher'
import { Conversation } from '@/components/runs/conversation'
import { PageHeader } from '@/components/motion/page-header'
import { TabBar } from '@/components/motion/tabs'
import { ProjectSandboxes, ProjectStorage } from '@/components/projects/project-storage'
import { LiveTab } from '@/components/runs/live-tab'
import { Spinner } from '@/components/runs/run-badges'
import { activity, agentColors, isLive, stepKey, plural } from '@/components/runs/run-format'
import { ThinkingLine } from '@/components/runs/thread-items'
import { type HistoryInit, RunHistoryTab, RunTimelineTab, useRunProject } from '@/components/runs/run-project-tabs'
import { type Entry, buildThread, threadSize } from '@/components/runs/thread'
import { useNow, useRun } from '@/components/runs/use-run'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { HostError } from '@/host/client'

export type RunTab = 'live' | 'timeline' | 'conversation' | 'history' | 'storage' | 'sandboxes'

interface RunPanelProps {
  runId: string
  tab: RunTab
  /** Switches the page's tab (a Live session opens its agent's conversation). */
  onTab?: (tab: RunTab) => void
  /** The agent shown; root when absent. */
  agent?: string
  /** Live: the project's sessions, which decide when this one goes idle. */
  sessions?: RunSummary[]
  onAgent: (name: string) => void
  /** Live: opens an agent of another session of the project. */
  onOpenSession?: (run: string, agent: string) => void
  historyInit?: HistoryInit
  /** Timeline: opens a Branch in History. */
  onOpenBranch?: (name: string) => void
  /** Conversation: the breadcrumb's start (project / session) and the row's trailing facts. */
  lead?: ReactNode
  meta?: ReactNode
  /** The session page's tabs, a row under the breadcrumb; `pane` replaces the conversation (another tab), given the agent shown. */
  tabs?: ReactNode
  pane?: ReactNode | ((agent: string) => ReactNode)
  /** Conversation: the box under it, given the thread's size to show. */
  composer?: (aside: ReactNode) => ReactNode
}

/** A run's tab, live: loads the run once and follows its events. */
export function RunPanel({ runId, tab, onTab, agent, onAgent, onOpenSession, historyInit, onOpenBranch, sessions, lead, meta, tabs, pane, composer }: RunPanelProps) {
  const live = useRun(runId)
  if (live.run)
    return (
      <RunBody
        run={live.run}
        demo={live.demo}
        views={live.views}
        tab={tab}
        onTab={onTab}
        picked={agent}
        onAgent={onAgent}
        onOpenSession={onOpenSession}
        historyInit={historyInit}
        onOpenBranch={onOpenBranch}
        sessions={sessions}
        lead={lead}
        meta={meta}
        tabs={tabs}
        pane={pane}
        composer={composer}
      />
    )
  const bar = lead && <SessionBar lead={lead} meta={meta} tabs={tabs} />
  if (live.error)
    return (
      <>
        {bar}
        <RunError error={live.error} onRetry={live.reload} />
      </>
    )
  return (
    <>
      {bar}
      <div aria-busy="true" aria-label="Loading the run" className="stagger mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-8 py-8">
        <LoadingNote />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3" style={{ opacity: 1 - i * 0.25 }}>
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </>
  )
}

/** Says the session is loading; after a few seconds, that the host is slow (LayerFS busy), so a wait does not read as a broken page. */
function LoadingNote() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [])
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      {slow ? 'Still loading this session: the host is slow to answer while LayerFS is busy.' : 'Loading this session…'}
    </p>
  )
}

/** The session page's header, one row as in dsh: project / root / … / agent ⇕, then facts on the right, then its tabs. */
function SessionBar({ lead, meta, tabs, live, children }: { lead: ReactNode; meta?: ReactNode; tabs?: ReactNode; live?: boolean; children?: ReactNode }) {
  return (
    <PageHeader
      size="md"
      live={live}
      className="[&>div]:pt-2"
      eyebrow={
        <nav aria-label="Breadcrumb" className="reveal flex min-w-0 flex-1 items-center gap-1 text-sm">
          {lead}
          {children}
        </nav>
      }
      actions={meta && <span className="reveal flex min-w-0 items-center gap-1.5 truncate pl-4 text-xs text-muted-foreground tabular-nums">{meta}</span>}
      tabs={tabs && <TabBar aria-label="Session">{tabs}</TabBar>}
    />
  )
}

function Slash() {
  return (
    <span aria-hidden="true" className="px-0.5 text-[15px] font-light text-foreground/20">
      /
    </span>
  )
}

function RunError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const missing = error instanceof HostError && error.status === 404
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-20 text-center">
      <TriangleAlert aria-hidden="true" className="size-6 text-destructive" />
      <h2 className="text-[15px] font-semibold">{missing ? 'This run no longer exists' : 'Could not load this run'}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
      {!missing && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  )
}

interface BodyProps {
  run: RunDetail
  demo: DemoDetail | undefined
  views: Map<string, StepView>
  tab: RunTab
  onTab?: (tab: RunTab) => void
  picked?: string
  onAgent: (name: string) => void
  onOpenSession?: (run: string, agent: string) => void
  historyInit?: HistoryInit
  onOpenBranch?: (name: string) => void
  sessions?: RunSummary[]
  lead?: ReactNode
  meta?: ReactNode
  tabs?: ReactNode
  pane?: ReactNode | ((agent: string) => ReactNode)
  composer?: (aside: ReactNode) => ReactNode
}

function RunBody({ run, demo, views, tab, onTab, picked, onAgent: setPicked, onOpenSession, historyInit, onOpenBranch, sessions, lead, meta, tabs, pane, composer }: BodyProps) {
  const root = run.agents.find((a) => a.parent === null)?.name ?? demo?.agents.find((a) => a.prompt === null)?.name ?? 'root'
  const live = isLive(run.state)

  // Only the agents started so far: a subagent appears when its parent starts it, as in a live session.
  const now = useNow(live)
  const agents = useMemo<SwitcherAgent[]>(
    () => run.agents.map((a) => ({ ...a, activity: activity(a, run.live.running.find((c) => c.agent === a.name), now) })),
    [run.agents, run.live.running, now],
  )
  const agent = picked && agents.some((a) => a.name === picked) ? picked : root
  const namesKey = [...(demo?.agents.map((a) => a.name) ?? []), ...run.agents.map((a) => a.name)].join('\u0000')
  const colorOf = useMemo(() => agentColors([...new Set(namesKey.split('\u0000'))]), [namesKey])

  const turns = useMemo(() => {
    const entries: Entry[] = run.steps
      .filter((s) => s.agent === agent)
      .map((s) => {
        const key = stepKey(s.agent, s.index)
        return { key, agent: s.agent, index: s.index, view: s.view ?? views.get(key), result: s }
      })
    return buildThread({
      agent,
      parent: agents.find((a) => a.name === agent)?.parent ?? null,
      children: new Set(agents.filter((a) => a.parent === agent).map((a) => a.name)),
      entries,
      incoming: run.messages.filter((m) => m.to === agent),
      prompt: agent === root ? (demo?.sessions?.find((s) => s.name === root)?.prompt ?? demo?.prompt) : null,
    })
  }, [run.steps, run.messages, views, agent, agents, root, demo?.prompt, demo?.sessions])
  const steps = useMemo(() => run.steps.filter((s) => s.agent === agent).length, [run.steps, agent])
  const shown = run.agents.find((a) => a.name === agent)
  // the agent's ancestors, root first, and how many of its subagents (at any depth) are running
  const chain = useMemo(() => {
    const out: string[] = []
    for (let p = agents.find((a) => a.name === agent)?.parent; p && !out.includes(p); p = agents.find((a) => a.name === p)?.parent ?? null) out.unshift(p)
    return out
  }, [agents, agent])
  const running = useMemo(() => {
    const under = (a: SwitcherAgent): boolean => {
      for (let p = a.parent; p; p = agents.find((x) => x.name === p)?.parent ?? null) if (p === agent) return true
      return false
    }
    return agents.filter((a) => a.state === 'running' && under(a)).length
  }, [agents, agent])

  if (tab === 'live')
    return (
      <LiveTab
        run={run}
        agents={agents}
        colorOf={colorOf}
        sessions={sessions}
        onOpenSession={onOpenSession}
        onOpenAgent={(name) => {
          setPicked(name)
          onTab?.('conversation')
        }}
      />
    )
  if (tab === 'timeline') return <ProjectTimeline run={run} historyInit={historyInit} onOpenBranch={onOpenBranch} />
  if (tab === 'history') return <ProjectHistory run={run} historyInit={historyInit} />
  if (tab === 'storage') return <ProjectStorage run={run} />
  if (tab === 'sandboxes') return <ProjectSandboxes run={run} />

  const empty = live ? (
    <div className="flex flex-col items-center gap-2 py-20 text-center text-sm text-muted-foreground">
      <Spinner className="size-5" />
      {run.state === 'starting' ? (
        run.queued ? (
          <>
            {run.phase}
            <span className="text-xs text-faint">It plays when one of them ends.</span>
          </>
        ) : (
          `${run.phase ?? 'Setting up its folder'}…`
        )
      ) : (
        `Waiting for ${agent} to start…`
      )}
    </div>
  ) : (
    <p className="py-20 text-center text-sm text-muted-foreground">{agent} ran no steps in this run.</p>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {lead ? (
        <SessionBar lead={lead} meta={meta} tabs={tabs} live={live}>
          {chain.map((name) => (
            <Fragment key={name}>
              <Slash />
              <button
                type="button"
                onClick={() => setPicked(name)}
                className="truncate rounded px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {name}
              </button>
            </Fragment>
          ))}
          <Slash />
          {/* the session's hint sits on the project crumb, so no tooltip covers this menu */}
          <span className="flex">
            <AgentSwitcher agents={agents} value={agent} onChange={setPicked} colorOf={colorOf} />
          </span>
          {running > 0 && (
            <span className="ml-1.5 flex shrink-0 items-center gap-1.5 rounded-full bg-primary/[0.08] px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20 ring-inset animate-in fade-in">
              <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />
              {plural(running, 'subagent')} running
            </span>
          )}
        </SessionBar>
      ) : (
        <div className="shrink-0 px-8 pt-3">
          <div className="mx-auto flex w-full max-w-[1000px] items-center gap-3">
            <AgentSwitcher agents={agents} value={agent} onChange={setPicked} colorOf={colorOf} />
          </div>
        </div>
      )}
      {pane ? (
        <div className="min-h-0 flex-1 overflow-y-auto">{typeof pane === 'function' ? pane(agent) : pane}</div>
      ) : (
        <>
          <div className="shrink-0 px-8">
            {run.error && (
              <div
                role="alert"
                className="mx-auto mt-2 flex w-full max-w-[1000px] items-start gap-2 rounded-lg bg-destructive/[0.07] px-3 py-2 text-[13px] text-destructive"
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words whitespace-pre-wrap">{run.error}</span>
              </div>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <Conversation
              key={agent}
              turns={turns}
              colorOf={colorOf}
              onOpenAgent={setPicked}
              live={live}
              empty={empty}
              footer={live && shown?.thinking ? <ThinkingLine /> : null}
            />
          </div>
          {composer ? (
            <div className="shrink-0 px-8 pt-1 pb-4">
              <div className="mx-auto w-full max-w-[1000px]">{composer(threadSize(turns, steps))}</div>
            </div>
          ) : (
            <div className="shrink-0 px-8 pb-3">
              <span className="mx-auto flex w-fit items-center gap-1.5 text-xs text-faint tabular-nums">
                <Gauge aria-hidden="true" className="size-3.5" />
                {threadSize(turns, steps)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ProjectTimeline({ run, historyInit, onOpenBranch }: { run: RunDetail; historyInit?: HistoryInit; onOpenBranch?: (name: string) => void }) {
  const project = useRunProject(run)
  return <RunTimelineTab run={run} project={project} init={historyInit} onOpenBranch={onOpenBranch} />
}

function ProjectHistory({ run, historyInit }: { run: RunDetail; historyInit?: HistoryInit }) {
  const project = useRunProject(run)
  return <RunHistoryTab run={run} project={project} init={historyInit} />
}
