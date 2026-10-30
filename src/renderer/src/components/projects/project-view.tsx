import { t, useI18n } from '@/i18n'
import { ChevronLeft, FolderTree, GitBranch, MessageSquarePlus, RotateCw, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { projectLabel, projectRef, type RunSummary } from '@shared/host-api'

import { LfsBranch, LfsCommit, LfsLayer, LfsProject, LfsStore } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion/count-up'
import { HeroTile, Stat, StatSkeleton } from '@/components/motion/hero'
import { PageHeader } from '@/components/motion/page-header'
import { Segmented, type SegmentedOption } from '@/components/motion'
import { Tab, TabBar } from '@/components/motion/tabs'
import { viewTransition } from '@/components/motion/view-transition'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, type HistoryView } from '@/components/projects/history-tab'
import type { HistoryItem } from '@/components/projects/history/lineage-graph'
import { ScenarioPicker, useDemos } from '@/components/projects/scenario-picker'
import { ProjectSandboxesContent, ProjectStorageContent } from '@/components/projects/project-storage'
import { LoadError, Loading } from '@/components/projects/states'
import { StoreBadge, isProject, storeFacts, useStorageView } from '@/components/projects/store-facts'
import { DemoScript } from '@/components/runs/demo-script'
import { activeRun } from '@/components/runs/live-data'
import { LiveTab } from '@/components/runs/live-tab'
import { isLive } from '@/components/runs/run-format'
import { useNow } from '@/components/runs/use-run'
import { RunList } from '@/components/runs/run-list'
import { RunView } from '@/components/runs/run-view'
import type { HistoryTarget } from '@/components/runs/trace-view'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import { Button } from '@/components/ui/button'
import { ago, bytes } from '@/data/format'
import { host, onHostEvent } from '@/host/client'
import { useHostQuery } from '@/host/use-host'

import '@/components/projects/history/history.css'

type ProjectTab = 'history' | 'storage' | 'sandboxes' | 'sessions' | 'script'
type HistoryPart = 'history' | 'files'

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'storage', label: 'Storage' },
  { id: 'sandboxes', label: 'Sandboxes' },
]

const HISTORY_PARTS: SegmentedOption<HistoryPart>[] = [
  { value: 'history', label: 'History', icon: GitBranch },
  { value: 'files', label: 'Files', icon: FolderTree },
]

/** A `#projects/<key>/<tab>` hash's tab (older names too); undefined picks Sessions when the project has runs, else History. */
function openingTab(initial?: string): ProjectTab | undefined {
  if (initial === 'work' || initial === 'worktree' || initial === 'worktrees') return 'sandboxes'
  if (initial === 'runs' || initial === 'replays' || initial === 'live') return 'sessions'
  if (initial === 'files' || initial === 'blame' || initial === 'map') return 'history'
  if (initial === 'sessions' || initial === 'script') return initial
  return PROJECT_TABS.find((tab) => tab.id === initial)?.id
}

/** A Trace checkpoint as a History selection: its Commit or Layer. */
const historyItem = (at: HistoryTarget): HistoryItem | undefined =>
  at.layer ? { kind: 'layer', id: at.layer } : at.commit ? { kind: 'commit', id: at.commit } : undefined

interface ProjectViewProps {
  /** The project key (projectKey: `store/name` in a shared Store). */
  project: string
  initialTab?: string
  initialBranch?: string
  /** A scenario run on the project: its page shows instead of the project's. */
  run?: string
  /** The run's agent shown; its root when absent. */
  agent?: string
  /** Opens a run of the project (and an agent of it), or back to the project page with no run. */
  onOpenRun: (run?: string, agent?: string) => void
  /** The scenario whose run made the project (ProjectSummary.demo), if any. */
  ownScenario?: string | null
  onBack: () => void
  onNewChat: () => void
}

/** Real project state and history are available independently of agent sessions. */
export function ProjectView({ project, initialTab, initialBranch, run, agent, onOpenRun, ownScenario, onBack, onNewChat }: ProjectViewProps) {
  useI18n()
  const [chosenTab, setTab] = useState<ProjectTab | undefined>(() => openingTab(initialTab))
  const [historyAt, setHistoryAt] = useState<HistoryTarget>()
  const runs = useRuns(project)
  const demos = useDemos()
  const own = ownScenario ?? demos.data?.find((d) => d.id === projectRef(project).name)?.id ?? null
  const onStarted = useCallback((started: RunSummary[]) => { if (started[0]) onOpenRun(started[0].id) }, [onOpenRun])
  const { start, starting, error: refused, clearError } = useStartRun(onStarted)
  const hasRuns = !!runs.runs?.length
  const tab: ProjectTab = chosenTab === 'script' && !own ? 'history' : chosenTab ?? (hasRuns ? 'sessions' : 'history')
  const playing = runs.runs?.some((r) => isLive(r.state) && !r.queued) ?? false
  // Sessions opens with the live diagram while a run plays or ended a moment ago
  const now = useNow(hasRuns, 30_000)
  const showLive = runs.runs?.some((r) => activeRun(r, now)) ?? false
  const [historyPart, setHistoryPart] = useState<HistoryPart>(initialTab === 'files' || initialTab === 'blame' ? 'files' : 'history')
  const [branch, setBranch] = useState(initialBranch)
  const [revision, setRevision] = useState(0)
  // keyed like Live's read, so a revisit or a tab switch paints the last answer at once
  const state = useHostQuery(() => host.project(project), [project, revision], `project:${project}`)
  const storage = useStorageView()
  const s = state.data && isProject(state.data.project, project) ? state.data : undefined
  const store = s ? storeFacts(s.project, storage) : undefined
  const label = projectLabel(project)
  const refresh = () => setRevision((value) => value + 1)
  const initialView: HistoryView = initialTab === 'map' ? 'map' : 'lineage'
  const select = (next: ProjectTab) => viewTransition(() => setTab(next), 'tab')
  const openHistory = (at: HistoryTarget) => {
    setHistoryAt(at)
    if (at.branch) setBranch(at.branch)
    setHistoryPart('history')
    setTab('history')
    onOpenRun()
  }

  useEffect(() => {
    const seen = new Map<string, { updated: number; signature: string }>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => { timer = undefined; refresh() }, 250)
    }
    const unsubscribe = onHostEvent((event) => {
      if (event.type !== 'chat' || event.session.project !== project) return
      const session = event.session
      const previous = seen.get(session.id)
      if (previous && session.updated < previous.updated) return
      const workspace = session.workspace
      const signature = JSON.stringify([workspace?.head, workspace?.lastSaved, workspace?.state, session.state])
      seen.set(session.id, { updated: session.updated, signature })
      if (previous?.signature !== signature && (workspace || session.state !== 'running')) schedule()
    }, schedule)
    return () => { unsubscribe(); if (timer) clearTimeout(timer) }
  }, [project])

  const facts = s ? (
    <>
      <Stat icon={LfsCommit} index={1} title={s.last ? t("Last Commit {value1} on {value2}", {value1: ago(s.last.at), value2: s.last.branch}) : undefined}>
        <span className="font-normal text-muted-foreground">{s.last ? t("Last Commit {value1}", {value1: ago(s.last.at)}) : t("No Commits yet")}</span>
      </Stat>
      <Stat icon={LfsBranch} index={2} label={s.branches.length === 1 ? t("Branch") : t("Branches")}>
        <CountUp value={s.branches.length} />
      </Stat>
      <Stat icon={LfsLayer} index={3} label={s.commits === 1 ? t("Commit") : t("Commits")}>
        <CountUp value={s.commits} />
      </Stat>
      <Stat icon={LfsStore} index={4} label={t("on disk")} title={s.store.path ?? undefined}>
        <CountUp value={store?.size ?? s.store.bytes} format={bytes} />
      </Stat>
    </>
  ) : state.loading ? (
    <>{[28, 20, 22, 20].map((width, index) => <StatSkeleton key={index} style={{ width: `${width * 0.25}rem` }} />)}</>
  ) : undefined

  const body = tab === 'sessions' ? (
    <>
      {showLive && <LiveTab project={project} runs={runs.runs} onOpenRun={onOpenRun} />}
      <RunList
      runs={runs.runs}
      error={runs.error}
      reload={runs.reload}
      onOpenRun={(id) => onOpenRun(id)}
      titleOf={(id) => demos.data?.find((d) => d.id === id)?.title}
      action={<ScenarioPicker variant="primary" onPlay={(id) => void start(id, project)} starting={starting} own={own} disabled={!s?.project.initialized} />}
      />
    </>
  ) : !s ? (
    state.error ? <LoadError error={state.error} what={label} onRetry={refresh} /> : <Loading label={t("Reading {value1}", {value1: label})} />
  ) : tab === 'storage' ? (
    <ProjectStorageContent state={s} store={store!} />
  ) : tab === 'sandboxes' ? (
    <ProjectSandboxesContent project={project} state={s} tick={revision} onBrowseFiles={(name) => {
      setBranch(name)
      setHistoryPart('files')
      select('history')
    }} />
  ) : (
    <>
      <Segmented role="tablist" aria-label={t("History")} size="md" value={historyPart} onChange={setHistoryPart} options={HISTORY_PARTS.map((part) => ({ ...part, label: typeof part.label === 'string' ? t(part.label) : part.label }))} />
      <div className="hist-swap flex min-h-0 flex-1 flex-col">
        {historyPart === 'history' ? (
          <HistoryTab key={`${project}:${historyAt?.commit ?? historyAt?.layer ?? historyAt?.branch ?? ''}`} project={project} state={s} initialBranch={branch} initialView={initialView} initialItem={historyAt && historyItem(historyAt)} />
        ) : (
          <FilesTab key={`${project}:${branch ?? ''}`} project={project} branches={s.branches} tick={revision} initialBranch={branch} />
        )}
      </div>
    </>
  )

  if (run) return <RunView key={run} runId={run} project={project} agent={agent} onAgent={(name) => onOpenRun(run, name)} onBack={() => onOpenRun()} onOpenHistory={openHistory} />

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        live={playing}
        size="md"
        className="[&>div]:pt-3"
        eyebrow={
          <button
            type="button"
            onClick={onBack}
            className="group/back -ml-1 flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4 transition-transform duration-(--dur-base) ease-out-expo group-hover/back:-translate-x-0.5" />{t("Projects")}</button>
        }
        icon={<HeroTile icon={LfsProject} />}
        title={projectRef(project).name}
        badges={store && <StoreBadge facts={store} />}
        facts={facts}
        actions={
          <>
            <Button variant="outline" size="sm" className="rounded-xl" disabled={state.loading} onClick={refresh}>
              <RotateCw className={state.loading ? 'size-3.5 animate-spin' : 'size-3.5'} />{t("Refresh")}</Button>
            <ScenarioPicker onPlay={(id) => void start(id, project)} starting={starting} own={own} disabled={!s?.project.initialized} />
            <Button size="sm" className="rounded-xl" disabled={!s?.project.initialized} onClick={onNewChat}>
              <MessageSquarePlus className="size-3.5" />{t("New chat")}</Button>
          </>
        }
        tabs={
          <TabBar aria-label={t("Project")}>
            {PROJECT_TABS.map((item) => (
              <Tab key={item.id} active={tab === item.id} onClick={() => select(item.id)}>
                {t(item.label)}
              </Tab>
            ))}
            <span aria-hidden="true" className="mb-2.5 h-4 w-px shrink-0 bg-border" />
            <Tab active={tab === 'sessions'} onClick={() => select('sessions')}>
              {playing && <span aria-hidden="true" className="pulse-ring mr-2 inline-block size-1.5 rounded-full bg-primary text-primary" />}
              {t('Sessions')}
              {runs.runs && runs.runs.length > 0 && (
                <span className="ml-1.5 rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground tabular-nums">
                  <CountUp value={runs.runs.length} />
                </span>
              )}
            </Tab>
            {own && (
              <Tab active={tab === 'script'} onClick={() => select('script')}>
                {t('Script')}
              </Tab>
            )}
          </TabBar>
        }
      >
        {refused && (
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3.5 py-2.5 text-[13px] text-destructive">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{t('Could not start the scenario: {message}', { message: refused.message })}</span>
            <button type="button" aria-label={t('Dismiss')} onClick={clearError} className="rounded-full p-0.5 hover:bg-destructive/10">
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </PageHeader>
      {tab === 'script' && own ? (
        <div className="vt-panel flex min-h-0 flex-1 flex-col pt-4">
          <DemoScript demo={own} />
        </div>
      ) : (
      <div className="vt-panel min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-7xl flex-col gap-4 px-6 py-6 @min-[56rem]/workspace:px-8">
          {s && state.error && <LoadError error={state.error} what={label} onRetry={refresh} />}
          {body}
        </div>
      </div>
      )}
    </div>
  )
}
