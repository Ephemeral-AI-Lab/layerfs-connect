// One run's tabs on the project page: Conversation, Trace, Work and History.
// The page header above names the demo, the run and its state; these tabs
// only add what is theirs (the Conversation's agent switcher).
import type { DemoDetail, RunDetail, StepView } from '@shared/host-api'
import { Gauge, RotateCw, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AgentSwitcher, type SwitcherAgent } from '@/components/runs/agent-switcher'
import { Conversation } from '@/components/runs/conversation'
import { Spinner } from '@/components/runs/run-badges'
import { agentColors, stepKey } from '@/components/runs/run-format'
import { RunActionButton, useRunActions } from '@/components/runs/run-actions'
import { type HistoryInit, RunHistoryTab, WorkTab, useRunProject } from '@/components/runs/run-project-tabs'
import { type Entry, buildThread, threadSize } from '@/components/runs/thread'
import { TraceTab } from '@/components/runs/trace-tab'
import { useRun } from '@/components/runs/use-run'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { HostError } from '@/host/client'

export type RunTab = 'conversation' | 'trace' | 'work' | 'history'

interface RunPanelProps {
  runId: string
  tab: RunTab
  /** Switches the page's tab (a Trace row opens its agent's conversation). */
  onTab?: (tab: RunTab) => void
  /** Opens a run started with Run again. */
  onOpenRun?: (runId: string) => void
  /** Dev aid: the agent the conversation opens on, and where History opens. */
  initialAgent?: string
  historyInit?: HistoryInit
}

/** A run's tab, live: loads the run once and follows its events. */
export function RunPanel({ runId, tab, onTab, onOpenRun, initialAgent, historyInit }: RunPanelProps) {
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
        initialAgent={initialAgent}
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
  initialAgent?: string
  historyInit?: HistoryInit
}

function RunBody({ run, demo, views, tab, onTab, onOpenRun, initialAgent, historyInit }: BodyProps) {
  const root = run.agents.find((a) => a.parent === null)?.name ?? demo?.agents.find((a) => a.prompt === null)?.name ?? 'root'
  const [picked, setPicked] = useState(initialAgent)
  const actions = useRunActions(run, onOpenRun)

  // Every agent of the demo, started or not; started ones carry the run's state.
  const agents = useMemo<SwitcherAgent[]>(() => {
    const list: SwitcherAgent[] = run.agents.map((a) => ({ ...a }))
    for (const a of demo?.agents ?? [])
      if (!list.some((x) => x.name === a.name)) {
        const spawner = Object.entries(demo?.script ?? {}).find(([, steps]) =>
          steps.some((s) => s.tool === 'subagent' && s.segments.some((g) => g.detail === a.name)),
        )?.[0]
        list.push({ name: a.name, parent: a.prompt === null ? null : (spawner ?? root), state: 'waiting', done: 0, of: a.steps })
      }
    return list
  }, [run.agents, demo, root])
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
  const calls = useMemo(() => run.steps.flatMap((s) => s.calls), [run.steps])

  if (tab === 'trace')
    return (
      <TraceTab
        calls={calls}
        checks={run.checks}
        live={actions.live}
        colorOf={colorOf}
        onOpenStep={(step) => {
          setPicked(step.slice(0, step.lastIndexOf(':')))
          onTab?.('conversation')
        }}
      />
    )
  if (tab === 'work' || tab === 'history') return <ProjectTabs run={run} tab={tab} historyInit={historyInit} />

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
            <span className="min-w-0 flex-1 truncate text-sm text-faint">Scripted run · replies come from the scenario</span>
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

function ProjectTabs({ run, tab, historyInit }: { run: RunDetail; tab: 'work' | 'history'; historyInit?: HistoryInit }) {
  const project = useRunProject(run)
  return tab === 'work' ? <WorkTab run={run} project={project} /> : <RunHistoryTab run={run} project={project} init={historyInit} />
}
