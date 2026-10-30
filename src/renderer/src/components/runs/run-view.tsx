// One scenario run's page: its conversation agent by agent, its checks
// (main.landed among them) and its Trace of LayerFS calls, with Stop while it
// plays. Loaded once and kept live from the host's events (use-run).
import type { CheckResult, DemoDetail, RunDetail, StepView } from '@shared/host-api'
import { Activity, ChevronLeft, CircleCheck, CircleX, Clock, Hourglass, ListChecks, LoaderCircle, MessagesSquare, Square, TriangleAlert } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { projectRef } from '@shared/host-api'

import { LfsAgent, LfsLayer } from '@/components/lfs-icons'
import { HeroTile, Stat } from '@/components/motion/hero'
import { PageHeader } from '@/components/motion/page-header'
import { spotlight } from '@/components/motion/spotlight'
import { Tab, TabBar } from '@/components/motion/tabs'
import { viewTransition } from '@/components/motion/view-transition'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { AgentSwitcher, type SwitcherAgent } from '@/components/runs/agent-switcher'
import { Conversation } from '@/components/runs/conversation'
import { RunStateBadge, Spinner } from '@/components/runs/run-badges'
import { activity, agentColors, ago, duration, isLive, plural, runName, stepKey } from '@/components/runs/run-format'
import { ThinkingLine } from '@/components/runs/thread-items'
import { type Entry, buildThread, threadSize } from '@/components/runs/thread'
import { type HistoryTarget, TraceView } from '@/components/runs/trace-view'
import { useNow, useRun } from '@/components/runs/use-run'
import { Chip } from '@/components/storage/chips'
import { Button } from '@/components/ui/button'
import { HostError, host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type RunTab = 'conversation' | 'checks' | 'trace'

interface RunViewProps {
  runId: string
  /** The project key the page is under. */
  project: string
  /** The agent shown; root when absent. */
  agent?: string
  onAgent: (name: string) => void
  /** Back to the project page. */
  onBack: () => void
  /** Opens the project's History on a Trace checkpoint. */
  onOpenHistory?: (at: HistoryTarget) => void
}

export function RunView({ runId, project, agent, onAgent, onBack, onOpenHistory }: RunViewProps) {
  useI18n()
  const live = useRun(runId)
  const back = <BackLink project={project} onBack={onBack} />
  // runs an older engine saved as live Pi sessions are not shown: Chat replaces them
  const hidden = live.run && (live.run.kind === 'live' || (live.run.state as string) === 'idle')
  if (live.run && !hidden && !live.removed)
    return <RunBody run={live.run} demo={live.demo} views={live.views} picked={agent} onAgent={onAgent} back={back} onOpenHistory={onOpenHistory} />
  const missing = live.removed || hidden || (live.error instanceof HostError && live.error.status === 404)
  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader size="md" className="[&>div]:pt-3" eyebrow={back} />
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        {missing ? (
          <Empty icon={MessagesSquare} title={t('This session is not available')} action={<Button variant="outline" size="sm" className="rounded-xl" onClick={onBack}>{t('Back to the project')}</Button>}>
            {live.removed ? t('It was deleted.') : t('It was deleted, or an older build saved it as a live session, which Chat replaces.')}
          </Empty>
        ) : live.error ? (
          <LoadError error={live.error} what={t('this session')} onRetry={live.reload} />
        ) : (
          <Loading label={t('Reading the session')} />
        )}
      </div>
    </div>
  )
}

function BackLink({ project, onBack }: { project: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="group/back -ml-1 flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="size-4 transition-transform duration-(--dur-base) ease-out-expo group-hover/back:-translate-x-0.5" />
      {projectRef(project).name}
    </button>
  )
}

interface BodyProps {
  run: RunDetail
  demo: DemoDetail | undefined
  views: Map<string, StepView>
  picked?: string
  onAgent: (name: string) => void
  back: React.ReactNode
  onOpenHistory?: (at: HistoryTarget) => void
}

function RunBody({ run, demo, views, picked, onAgent, back, onOpenHistory }: BodyProps) {
  const [tab, setTab] = useState<RunTab>('conversation')
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  const root = run.agents.find((a) => a.parent === null)?.name ?? demo?.agents.find((a) => a.prompt === null)?.name ?? 'root'
  const live = isLive(run.state)
  const now = useNow(live)

  // Only the agents started so far: a subagent appears when its parent starts it.
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
        return { key, agent: s.agent, index: s.index, view: views.get(key), result: s }
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
  const stepChecks = useMemo(() => run.steps.flatMap((s) => s.checks.filter((c) => !c.ok).map((c) => ({ ...c, at: stepKey(s.agent, s.index) }))), [run.steps])
  const failedChecks = run.checks.filter((c) => !c.ok).length + stepChecks.length

  const stop = async () => {
    setStopping(true)
    setStopError('')
    try {
      await host.stopRun(run.id)
    } catch (e) {
      setStopError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
  }
  const pick = (next: RunTab) => viewTransition(() => setTab(next), 'tab')

  const empty = live ? (
    <div role="status" className="flex flex-col items-center gap-2 py-20 text-center text-sm text-muted-foreground">
      <Spinner className="size-5" />
      {run.queued ? (
        <>
          {run.phase ?? t('Waiting its turn')}
          <span className="text-xs">{t('It plays when one of the heavy scenarios playing now ends.')}</span>
        </>
      ) : run.state === 'starting' ? (
        `${run.phase ?? t('Setting up its folder')}…`
      ) : (
        t('Waiting for {name} to start…', { name: agent })
      )}
    </div>
  ) : (
    <p className="py-20 text-center text-sm text-muted-foreground">{t('{name} ran no steps in this session.', { name: agent })}</p>
  )

  const agentRow = (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-wrap items-center gap-1 px-6 pt-3 text-sm">
      {chain.map((name) => (
        <Fragment key={name}>
          <button type="button" onClick={() => onAgent(name)} className="truncate rounded-lg px-1.5 py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {name}
          </button>
          <span aria-hidden="true" className="px-0.5 text-[15px] font-light text-foreground/25">
            /
          </span>
        </Fragment>
      ))}
      <AgentSwitcher agents={agents} value={agent} onChange={onAgent} colorOf={colorOf} />
      {running > 0 && (
        <span className="ml-1.5 flex shrink-0 items-center gap-1.5 rounded-full bg-primary/[0.08] px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20 ring-inset">
          <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />
          {t('{n} running', { n: plural(running, 'subagent') })}
        </span>
      )}
      {tab === 'conversation' && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{threadSize(turns, steps)}</span>}
    </div>
  )

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        size="md"
        className="[&>div]:pt-3"
        live={live && !run.queued}
        eyebrow={back}
        icon={<HeroTile icon={LfsAgent} live={live && !run.queued} />}
        title={<span className="font-mono">{runName(run)}</span>}
        badges={run.queued ? <Chip tone="neutral" icon={Hourglass}>{t('Queued')}</Chip> : <RunStateBadge state={run.state} />}
        facts={
          <>
            <Stat icon={LfsLayer} index={1} title={t('Scenario')}>
              <span className="font-normal">{demo?.title ?? run.demo}</span>
            </Stat>
            <Stat icon={Clock} index={2} label={t('started {time}', { time: ago(run.started, now) })}>
              {run.queued ? '–' : duration((run.ended ?? now) - run.started)}
            </Stat>
            {run.of > 0 && (
              <Stat index={3} label={t('steps')} live={live && !run.queued}>
                {run.done}/{run.of}
              </Stat>
            )}
            {run.folder && (
              <Stat index={4} label={t('folder')} title={t('Its files are under /{folder}/ and its Branches are {folder}.<name>', { folder: run.folder })}>
                <span className="font-mono">/{run.folder}/</span>
              </Stat>
            )}
          </>
        }
        actions={
          live && (
            <Button variant="outline" size="sm" className="rounded-xl" disabled={stopping} onClick={() => void stop()}>
              {stopping ? <LoaderCircle className="size-3.5 animate-spin" /> : <Square className="size-3" />}
              {t('Stop')}
            </Button>
          )
        }
        tabs={
          <TabBar aria-label={t('Session')}>
            <Tab active={tab === 'conversation'} onClick={() => pick('conversation')}>
              <MessagesSquare aria-hidden="true" className="mr-1.5 size-3.5 opacity-80" />
              {t('Conversation')}
            </Tab>
            <Tab active={tab === 'checks'} onClick={() => pick('checks')}>
              <ListChecks aria-hidden="true" className="mr-1.5 size-3.5 opacity-80" />
              {t('Checks')}
              {failedChecks > 0 ? (
                <span className="ml-1.5 rounded-full bg-destructive/10 px-1.5 text-[11px] leading-[18px] font-medium text-destructive tabular-nums">{failedChecks}</span>
              ) : run.checks.length > 0 ? (
                <span className="ml-1.5 rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground tabular-nums">{run.checks.length}</span>
              ) : null}
            </Tab>
            <Tab active={tab === 'trace'} onClick={() => pick('trace')}>
              <Activity aria-hidden="true" className="mr-1.5 size-3.5 opacity-80" />
              {t('Trace')}
            </Tab>
          </TabBar>
        }
      >
        {(run.error || stopError) && (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3.5 py-2.5 text-[13px] text-destructive">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words whitespace-pre-wrap">{stopError || run.error}</span>
          </div>
        )}
      </PageHeader>
      <div className="vt-panel flex min-h-0 flex-1 flex-col">
        {tab === 'checks' ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Checks run={run} stepChecks={stepChecks} live={live} />
          </div>
        ) : tab === 'trace' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {agentRow}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TraceView key={agent} runId={run.id} agent={agent} live={live} started={run.started} onOpenHistory={onOpenHistory} />
            </div>
          </div>
        ) : (
          <>
            {agentRow}
            <Conversation key={agent} turns={turns} colorOf={colorOf} onOpenAgent={onAgent} live={live} empty={empty} footer={live && shown?.thinking ? <ThinkingLine /> : null} />
          </>
        )}
      </div>
    </div>
  )
}

/** What a check means, for the ones every scenario run makes. */
const CHECK_ABOUT: Record<string, string> = {
  'main.landed': 'The run’s trunk Branch joined the project’s main once it passed.',
}

/** The run's final checks (main.landed among them), then any step check that failed. */
function Checks({ run, stepChecks, live }: { run: RunDetail; stepChecks: (CheckResult & { at: string })[]; live: boolean }) {
  useI18n()
  if (run.checks.length === 0 && stepChecks.length === 0)
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <Empty icon={ListChecks} title={live ? t('Checks run when the session ends') : t('No checks')}>
          {live ? t('Each step’s checks run as it ends; the final checks, main.landed among them, after the last step.') : t('This session recorded no checks.')}
        </Empty>
      </div>
    )
  // main.landed first: whether the run's work reached main
  const finals = [...run.checks].sort((a, b) => Number(b.name === 'main.landed') - Number(a.name === 'main.landed'))
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
      {finals.length > 0 && <CheckList title={t('Final checks')} checks={finals} />}
      {stepChecks.length > 0 && <CheckList title={t('Failed step checks')} checks={stepChecks} />}
    </div>
  )
}

function CheckList({ title, checks }: { title: string; checks: (CheckResult & { at?: string })[] }) {
  const passed = checks.filter((c) => c.ok).length
  return (
    <section onPointerMove={spotlight} className="glass-liquid spotlight reveal overflow-hidden rounded-2xl">
      <header className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{t('{passed} of {total} passed', { passed, total: checks.length })}</span>
      </header>
      <ol className="border-t border-foreground/[0.06]">
        {checks.map((c, i) => {
          const about = CHECK_ABOUT[c.name]
          return (
            <li key={`${c.at ?? ''}:${c.name}:${i}`} className={cn('flex items-start gap-3 border-b border-foreground/[0.05] px-5 py-3 last:border-b-0', !c.ok && 'bg-destructive/[0.03]')}>
              {c.ok ? <CircleCheck aria-label={t('Passed')} className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleX aria-label={t('Failed')} className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[13px] font-medium">{c.name}</span>
                  {c.at && <span className="font-mono text-[11px] text-muted-foreground">{c.at}</span>}
                </p>
                {about && <p className="text-xs text-muted-foreground">{t(about)}</p>}
                {c.detail && <p className={cn('mt-1 text-xs break-words whitespace-pre-wrap', c.ok ? 'text-foreground/80' : 'text-destructive')}>{c.detail}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
