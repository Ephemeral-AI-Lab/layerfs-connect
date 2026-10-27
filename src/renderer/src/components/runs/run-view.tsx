// A session's (one replay's) views: its Conversation on the session page, and
// the project's Live, History and Storage, read from the newest session, on
// the project page. The page header above names the project or session;
// these only add what is theirs (the Conversation's agent switcher).
import type { DemoDetail, RunDetail, StepView } from '@shared/host-api'
import { Gauge, RotateCw, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'

import { AgentSwitcher, type SwitcherAgent } from '@/components/runs/agent-switcher'
import { Conversation } from '@/components/runs/conversation'
import { ProjectStorage } from '@/components/projects/project-storage'
import { LiveTab } from '@/components/runs/live-tab'
import { Spinner } from '@/components/runs/run-badges'
import { agentColors, stepKey } from '@/components/runs/run-format'
import { RunActionButton, useRunActions } from '@/components/runs/run-actions'
import { type HistoryInit, RunHistoryTab, useRunProject } from '@/components/runs/run-project-tabs'
import { type Entry, buildThread, threadSize } from '@/components/runs/thread'
import { useRun } from '@/components/runs/use-run'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { HostError } from '@/host/client'

export type RunTab = 'live' | 'conversation' | 'history' | 'storage'

interface RunPanelProps {
  runId: string
  tab: RunTab
  /** Switches the page's tab (a Live session opens its agent's conversation). */
  onTab?: (tab: RunTab) => void
  /** Opens a session started with New session. */
  onOpenRun?: (runId: string) => void
  /** The agent (session) shown; root when absent. */
  agent?: string
  onAgent: (name: string) => void
  historyInit?: HistoryInit
}

/** A run's tab, live: loads the run once and follows its events. */
export function RunPanel({ runId, tab, onTab, onOpenRun, agent, onAgent, historyInit }: RunPanelProps) {
  const live = useRun(runId)
  if (live.run)
    return (
      <RunBody
        run={live.run}
        demo={live.demo}
        views={live.views}
        tab={tab}
        onTab={onTab}
        onOpenRun={onOpenRun}
        picked={agent}
        onAgent={onAgent}
        historyInit={historyInit}
      />
    )
  if (live.error) return <RunError error={live.error} onRetry={live.reload} />
  return (
    <div aria-busy="true" aria-label="Loading the run" className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-8 py-8">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
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
  onOpenRun?: (runId: string) => void
  picked?: string
  onAgent: (name: string) => void
  historyInit?: HistoryInit
}

function RunBody({ run, demo, views, tab, onTab, onOpenRun, picked, onAgent: setPicked, historyInit }: BodyProps) {
  const root = run.agents.find((a) => a.parent === null)?.name ?? demo?.agents.find((a) => a.prompt === null)?.name ?? 'root'
  const actions = useRunActions(run, onOpenRun)

  // Only the agents started so far: a subagent appears when its parent starts it, as in a live session.
  const agents = useMemo<SwitcherAgent[]>(() => run.agents.map((a) => ({ ...a })), [run.agents])
  const agent = picked && agents.some((a) => a.name === picked) ? picked : root
  const namesKey = [...(demo?.agents.map((a) => a.name) ?? []), ...run.agents.map((a) => a.name)].join('\u0000')
  const colorOf = useMemo(() => agentColors([...new Set(namesKey.split('\u0000'))]), [namesKey])

  const turns = useMemo(() => {
    const entries: Entry[] = run.steps
      .filter((s) => s.agent === agent)
      .map((s) => {
        const key = stepKey(s.agent, s.index)
        return { key, agent: s.agent, index: s.index, view: views.get(key), result: s }
      })
    return buildThread({
      agent,
      parent: agents.find((a) => a.name === agent)?.parent ?? null,
      children: new Set(agents.filter((a) => a.parent === agent).map((a) => a.name)),
      entries,
      incoming: run.messages.filter((m) => m.to === agent),
    })
  }, [run.steps, run.messages, views, agent, agents])
  const steps = useMemo(() => run.steps.filter((s) => s.agent === agent).length, [run.steps, agent])

  if (tab === 'live')
    return (
      <LiveTab
        run={run}
        agents={agents}
        colorOf={colorOf}
        onOpenAgent={(name) => {
          setPicked(name)
          onTab?.('conversation')
        }}
      />
    )
  if (tab === 'history') return <ProjectHistory run={run} historyInit={historyInit} />
  if (tab === 'storage') return <ProjectStorage run={run} />

  const empty = actions.live ? (
    <div className="flex flex-col items-center gap-2 py-20 text-center text-sm text-muted-foreground">
      <Spinner className="size-5" />
      {run.state === 'starting' ? (
        <>
          Initializing <span className="font-mono text-foreground">{run.project}</span> from the demo’s fixture…
        </>
      ) : (
        `Waiting for ${agent} to start…`
      )}
    </div>
  ) : (
    <p className="py-20 text-center text-sm text-muted-foreground">{agent} ran no steps in this run.</p>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-8 pt-3">
        <div className="mx-auto flex w-full max-w-[1000px] items-center gap-3">
          <AgentSwitcher agents={agents} value={agent} onChange={setPicked} colorOf={colorOf} />
          {actions.error && <span className="ml-auto max-w-80 truncate text-xs text-destructive">{actions.error}</span>}
        </div>
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
        <Conversation key={agent} turns={turns} colorOf={colorOf} onOpenAgent={setPicked} live={actions.live} empty={empty} />
      </div>
      <div className="shrink-0 px-8 pb-3">
        <div className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-2">
          <div className="flex w-full items-center gap-3 rounded-2xl border bg-card py-1.5 pr-1.5 pl-4 shadow-xs">
            <span className="min-w-0 flex-1 truncate text-sm text-faint">Scripted session · replies come from the scenario</span>
            <RunActionButton actions={actions} className="text-muted-foreground" />
          </div>
          <span className="flex items-center gap-1.5 text-xs text-faint tabular-nums">
            <Gauge aria-hidden="true" className="size-3.5" />
            {threadSize(turns, steps)}
          </span>
        </div>
      </div>
    </div>
  )
}

function ProjectHistory({ run, historyInit }: { run: RunDetail; historyInit?: HistoryInit }) {
  const project = useRunProject(run)
  return <RunHistoryTab run={run} project={project} init={historyInit} />
}
