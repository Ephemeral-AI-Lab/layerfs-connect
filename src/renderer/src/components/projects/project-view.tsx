import { t, useI18n } from '@/i18n'
import { ChevronLeft, FolderTree, GitBranch, MessageSquarePlus, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { projectLabel, projectRef } from '@shared/host-api'

import { LfsBranch, LfsCommit, LfsLayer, LfsProject, LfsStore } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion/count-up'
import { HeroTile, Stat, StatSkeleton } from '@/components/motion/hero'
import { PageHeader } from '@/components/motion/page-header'
import { Segmented, type SegmentedOption } from '@/components/motion'
import { Tab, TabBar } from '@/components/motion/tabs'
import { viewTransition } from '@/components/motion/view-transition'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, type HistoryView } from '@/components/projects/history-tab'
import { ProjectSandboxesContent, ProjectStorageContent } from '@/components/projects/project-storage'
import { LoadError, Loading } from '@/components/projects/states'
import { StoreBadge, isProject, storeFacts, useStorageView } from '@/components/projects/store-facts'
import { WorktreeContent } from '@/components/projects/worktree-view'
import { Button } from '@/components/ui/button'
import { ago, bytes } from '@/data/format'
import { host, onHostEvent } from '@/host/client'
import { useHostQuery } from '@/host/use-host'

import '@/components/projects/history/history.css'

type ProjectTab = 'history' | 'worktrees' | 'storage' | 'sandboxes'
type HistoryPart = 'history' | 'files'

const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'worktrees', label: 'Worktrees' },
  { id: 'storage', label: 'Storage' },
  { id: 'sandboxes', label: 'Sandboxes' },
]

const HISTORY_PARTS: SegmentedOption<HistoryPart>[] = [
  { value: 'history', label: 'History', icon: GitBranch },
  { value: 'files', label: 'Files', icon: FolderTree },
]

function openingTab(initial?: string): ProjectTab {
  if (initial === 'work' || initial === 'worktree') return 'worktrees'
  return PROJECT_TABS.find((tab) => tab.id === initial)?.id ?? 'history'
}

interface ProjectViewProps {
  /** The project key (projectKey: `store/name` in a shared Store). */
  project: string
  initialTab?: string
  initialBranch?: string
  onBack: () => void
  onNewChat: () => void
}

/** Real project state and history are available independently of agent sessions. */
export function ProjectView({ project, initialTab, initialBranch, onBack, onNewChat }: ProjectViewProps) {
  useI18n()
  const [tab, setTab] = useState<ProjectTab>(() => openingTab(initialTab))
  const [historyPart, setHistoryPart] = useState<HistoryPart>(initialTab === 'files' || initialTab === 'blame' ? 'files' : 'history')
  const [branch, setBranch] = useState(initialBranch)
  const [revision, setRevision] = useState(0)
  const state = useHostQuery(() => host.project(project), [project, revision])
  const storage = useStorageView()
  const s = state.data && isProject(state.data.project, project) ? state.data : undefined
  const store = s ? storeFacts(s.project, storage) : undefined
  const label = projectLabel(project)
  const refresh = () => setRevision((value) => value + 1)
  const initialView: HistoryView = initialTab === 'map' ? 'map' : 'lineage'

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

  const body = !s ? (
    state.error ? <LoadError error={state.error} what={label} onRetry={refresh} /> : <Loading label={t("Reading {value1}", {value1: label})} />
  ) : tab === 'worktrees' ? (
    <WorktreeContent state={s} onBrowseFiles={(name) => {
      setBranch(name)
      setHistoryPart('files')
      setTab('history')
    }} />
  ) : tab === 'storage' ? (
    <ProjectStorageContent state={s} store={store!} />
  ) : tab === 'sandboxes' ? (
    <ProjectSandboxesContent state={s} />
  ) : (
    <>
      <Segmented role="tablist" aria-label={t("History")} size="md" value={historyPart} onChange={setHistoryPart} options={HISTORY_PARTS.map((part) => ({ ...part, label: typeof part.label === 'string' ? t(part.label) : part.label }))} />
      <div className="hist-swap flex min-h-0 flex-1 flex-col">
        {historyPart === 'history' ? (
          <HistoryTab key={project} project={project} tick={revision} initialBranch={branch} initialView={initialView} />
        ) : (
          <FilesTab key={`${project}:${branch ?? ''}`} project={project} branches={s.branches} tick={revision} initialBranch={branch} />
        )}
      </div>
    </>
  )

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
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
            <Button size="sm" className="rounded-xl" disabled={!s?.project.initialized} onClick={onNewChat}>
              <MessageSquarePlus className="size-3.5" />{t("New chat")}</Button>
          </>
        }
        tabs={
          <TabBar aria-label={t("Project")}>
            {PROJECT_TABS.map((item) => (
              <Tab key={item.id} active={tab === item.id} onClick={() => viewTransition(() => setTab(item.id), 'tab')}>
                {t(item.label)}
              </Tab>
            ))}
          </TabBar>
        }
      />
      <div className="vt-panel min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-7xl flex-col gap-4 px-6 py-6 @min-[56rem]/workspace:px-8">
          {s && state.error && <LoadError error={state.error} what={label} onRetry={refresh} />}
          {body}
        </div>
      </div>
    </div>
  )
}
