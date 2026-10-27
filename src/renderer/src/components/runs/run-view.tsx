import type { DemoDetail, RunDetail, StepView } from '@shared/host-api'
import { Activity, ListTree, RotateCw, ScrollText, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AgentTree } from '@/components/runs/agent-tree'
import { KindLegend, Spinner } from '@/components/runs/run-badges'
import { agentColors, duration, isLive } from '@/components/runs/run-format'
import { RunHeader } from '@/components/runs/run-header'
import { Transcript, transcriptItems } from '@/components/runs/run-transcript'
import { FinalChecks, TraceTab } from '@/components/runs/trace-tab'
import { useRun } from '@/components/runs/use-run'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { HostError } from '@/host/client'
import { cn } from '@/lib/utils'

interface RunViewProps {
  runId: string
  onOpenProject?: (demo: string) => void
  /** Dev aid: open on the Trace tab. */
  initialTab?: 'transcript' | 'trace'
  /** Dev aid: open the transcript at this step, "<agent>:<index>". */
  initialStep?: string
}

/** The live session page of one demo run. */
export function RunView({ runId, onOpenProject, initialTab, initialStep }: RunViewProps) {
  const live = useRun(runId)
  if (live.run) return <RunBody key={runId} run={live.run} demo={live.demo} views={live.views} onOpenProject={onOpenProject} initialTab={initialTab} initialStep={initialStep} />
  if (live.error) return <RunError error={live.error} onRetry={live.reload} />
  return <RunLoading />
}

function RunLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the run" className="flex h-svh flex-col">
      <div className="flex flex-col gap-3 border-b px-6 pt-5 pb-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-3 w-[28rem]" />
      </div>
      <div className="grid flex-1 grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2 border-r p-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  )
}

function RunError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const missing = error instanceof HostError && error.status === 404
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-3 px-8 text-center">
      <TriangleAlert aria-hidden="true" className="size-6 text-destructive" />
      <h1 className="text-[15px] font-semibold">{missing ? 'This run no longer exists' : 'Could not load this run'}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
      {!missing && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  )
}

type Tab = 'transcript' | 'trace'

interface BodyProps {
  run: RunDetail
  demo: DemoDetail | undefined
  views: Map<string, StepView>
  onOpenProject?: (demo: string) => void
  initialTab?: Tab
  initialStep?: string
}

function RunBody({ run, demo, views, onOpenProject, initialTab = 'transcript', initialStep }: BodyProps) {
  const [agent, setAgent] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [traceOpened, setTraceOpened] = useState(initialTab === 'trace')
  const jumpTo = useRef<string | null>(initialStep ?? null)
  const runLive = isLive(run.state)

  // Colours follow the demo's agents, root first, so they never shift mid-run.
  const namesKey = [...(demo?.agents.map((a) => a.name) ?? []), ...run.agents.map((a) => a.name)].join('\u0000')
  const colorOf = useMemo(() => agentColors([...new Set(namesKey.split('\u0000'))]), [namesKey])
  const root = run.agents.find((a) => a.parent === null)?.name ?? demo?.agents.find((a) => a.prompt === null)?.name ?? null
  const parents = useMemo(() => new Map(run.agents.map((a) => [a.name, a.parent])), [run.agents])
  const shownAgent = agent && run.agents.some((a) => a.name === agent) ? agent : null

  const items = useMemo(
    () => transcriptItems(run, views, shownAgent, root),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.steps, run.messages, views, shownAgent, root],
  )
  const calls = useMemo(() => run.steps.flatMap((s) => s.calls), [run.steps])

  const openTab = (t: Tab) => {
    setTab(t)
    if (t === 'trace') setTraceOpened(true)
  }
  const openStep = (step: string) => {
    jumpTo.current = step
    setAgent(null)
    setTab('transcript')
  }
  useEffect(() => {
    if (tab !== 'transcript' || !jumpTo.current) return
    const el = document.querySelector(`[data-item="s:${CSS.escape(jumpTo.current)}"]`)
    jumpTo.current = null
    el?.scrollIntoView({ block: 'start' })
  }, [tab, items])

  const title = demo?.title ?? run.demo
  const empty = runLive ? (
    <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
      <Spinner className="size-5" />
      {run.state === 'starting' ? (
        <>
          Initializing <span className="font-mono text-foreground">{run.project}</span> from the demo’s fixture…
        </>
      ) : (
        'Waiting for the first step…'
      )}
    </div>
  ) : (
    <p className="py-16 text-center text-sm text-muted-foreground">
      {shownAgent ? `${shownAgent} ran no steps.` : 'No steps ran in this run.'}
    </p>
  )
  const footer =
    !runLive && !shownAgent ? (
      <div className="mt-2 flex flex-col gap-3 rounded-xl border bg-card p-4">
        <p className="text-[13px] font-semibold">
          {run.state === 'passed' ? 'Run passed' : run.state === 'failed' ? 'Run failed' : 'Run stopped'}
          <span className="font-normal text-muted-foreground">
            {' '}
            after {duration((run.ended ?? run.started) - run.started)} · {run.done}/{run.of} steps
          </span>
        </p>
        <FinalChecks checks={run.checks} live={false} />
      </div>
    ) : null

  const TABS: { id: Tab; label: string; icon: typeof Activity; count: number }[] = [
    { id: 'transcript', label: 'Transcript', icon: ScrollText, count: run.steps.length },
    { id: 'trace', label: 'Trace', icon: Activity, count: calls.length },
  ]

  return (
    <div className="flex h-svh flex-col">
      <RunHeader run={run} title={title} onOpenProject={onOpenProject} />
      <div className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside aria-label="Agents" className="flex min-h-0 flex-col border-r bg-sidebar/50">
          <div className="flex items-center gap-1.5 px-4 pt-4 pb-2 text-xs font-medium text-faint">
            <ListTree aria-hidden="true" className="size-3.5" /> Agents
            <span className="font-normal">{run.agents.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {run.agents.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">{runLive ? 'The root agent starts once the project is ready.' : 'No agents ran.'}</p>
            ) : (
              <AgentTree
                agents={run.agents}
                colorOf={colorOf}
                selected={shownAgent}
                onSelect={setAgent}
                started={run.steps.length}
                total={run.of}
              />
            )}
          </div>
          <div className="flex flex-col gap-2 border-t px-4 py-3">
            <span className="text-[11px] font-medium text-faint">Call kinds</span>
            <KindLegend className="gap-x-2.5" />
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div role="tablist" aria-label="Run" className="flex h-11 shrink-0 items-center gap-1 border-b px-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => openTab(t.id)}
                className={cn(
                  'relative flex h-11 items-center gap-1.5 px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === t.id ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon aria-hidden="true" className="size-3.5" />
                {t.label}
                <span className="text-[11px] text-faint tabular-nums">{t.count}</span>
                {tab === t.id && <span aria-hidden="true" className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-foreground" />}
              </button>
            ))}
            {shownAgent && tab === 'transcript' && (
              <span className="ml-auto flex items-center gap-1.5 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs text-muted-foreground">
                Only <span className={cn('font-medium', colorOf(shownAgent).text)}>{shownAgent}</span>
                <button
                  type="button"
                  aria-label="Show every agent"
                  onClick={() => setAgent(null)}
                  className="rounded p-0.5 outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              </span>
            )}
          </div>
          <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'transcript' && 'hidden')}>
            <Transcript
              items={items}
              colorOf={colorOf}
              parents={parents}
              live={runLive}
              root={root}
              filtered={shownAgent !== null}
              empty={empty}
              footer={footer}
            />
          </div>
          {traceOpened && (
            <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'trace' && 'hidden')}>
              <TraceTab calls={calls} checks={run.checks} live={runLive} colorOf={colorOf} onOpenStep={openStep} />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
