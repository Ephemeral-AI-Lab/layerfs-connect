import { t, useI18n } from '@/i18n'
import { MessageSquarePlus, RotateCw } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react'
import { projectLabel, projectRef } from '@shared/host-api'

import { LfsProject } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion/count-up'
import { HeroTile } from '@/components/motion/hero'
import { PageHeader } from '@/components/motion/page-header'
import { Tab, TabBar } from '@/components/motion/tabs'
import { viewTransition } from '@/components/motion/view-transition'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, type HistoryView } from '@/components/projects/history-tab'
import { ProjectSandboxesContent, ProjectStorageContent } from '@/components/projects/project-storage'
import { ProjectSessionsContent } from '@/components/projects/project-sessions'
import { LoadError, Loading } from '@/components/projects/states'
import { projectRuns } from '@/components/live/live-data'
import { LiveTab } from '@/components/live/live-tab'
import { isLive } from '@/components/live/run-format'
import { StoreBadge, isProject, storeFacts, useStorageView } from '@/components/projects/store-facts'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ago, bytes } from '@/data/format'
import { host, onHostEvent } from '@/host/client'
import { chatLive, chatProject, useChatSessions } from '@/host/use-chat-sessions'
import { useHostQuery } from '@/host/use-host'

import '@/components/projects/history/history.css'

type ProjectTab = 'history' | 'files' | 'live' | 'storage' | 'sandboxes' | 'sessions'
/** The views a page that holds the project shows in its own tab bar (a chat's). */
export type EmbeddedProjectView = 'files' | 'history' | 'sandboxes'

// what works on the project now (Live, its Sessions), then what it holds (History, Files), then where (Storage, Sandboxes)
const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'history', label: 'History' },
  { id: 'files', label: 'Files' },
  { id: 'storage', label: 'Storage' },
  { id: 'sandboxes', label: 'Sandboxes' },
]

/** A `#projects/<key>/<tab>` hash's tab (older names too); Live when absent. */
function openingTab(initial?: string): ProjectTab {
  if (initial === 'work' || initial === 'worktree' || initial === 'worktrees') return 'sandboxes'
  if (initial === 'chats' || initial === 'runs') return 'sessions'
  if (initial === 'blame') return 'files'
  return PROJECT_TABS.find((tab) => tab.id === initial)?.id ?? 'live'
}

interface ProjectViewProps {
  /** The project key (projectKey: `store/name` in a shared Store). */
  project: string
  initialTab?: string
  initialBranch?: string
  onBack: () => void
  /** What the back link returns to (the chat this was opened from); "Projects" when absent. */
  backLabel?: string
  onNewChat: () => void
  /** Opens one of the project's chats on the Chat page. */
  onOpenChat: (session: string) => void
  /**
   * Shows only this view, with no page header or tabs: the page around it
   * (a chat) has the tab bar. A Sandbox's "browse files" asks it for Files.
   */
  embedded?: EmbeddedProjectView
  onEmbeddedView?: (view: EmbeddedProjectView) => void
}

/** Real project state and history are available independently of agent sessions. */
export function ProjectView({ project, initialTab, initialBranch, onBack, backLabel, onNewChat, onOpenChat, embedded, onEmbeddedView }: ProjectViewProps) {
  useI18n()
  const [ownTab, setTab] = useState<ProjectTab>(() => openingTab(initialTab))
  const tab: ProjectTab = embedded ?? ownTab
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
  // the project's chats, kept current from the host's chat events
  const [sessionsRead, setSessionsRead] = useState(0)
  const chats = useChatSessions(`${revision}:${sessionsRead}`)
  const sessions = useMemo(() => chats.sessions?.filter((c) => chatProject(c) === project), [chats.sessions, project])
  const openSessions = sessions?.filter((c) => !c.archived).length ?? 0
  const working = sessions?.some((c) => !c.archived && chatLive(c)) ?? false
  // Live: the project's chats that work in LayerFS, drawn with every call they make
  const runs = useMemo(() => projectRuns(sessions, project), [sessions, project])
  const liveNow = runs?.some((run) => isLive(run.state)) ?? false

  useEffect(() => {
    const seen = new Map<string, { updated: number; signature: string }>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => { timer = undefined; refresh() }, 250)
    }
    const unsubscribe = onHostEvent((event) => {
      // a chat /scenario started is on its project too
      if (event.type !== 'chat' || (event.session.project ?? event.session.scenario?.project) !== project) return
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

  // the facts as one quiet line under the title
  const facts = s ? (
    <FactLine items={[
      { key: 'last', title: s.last ? t("Last Commit {value1} on {value2}", {value1: ago(s.last.at), value2: s.last.branch}) : undefined,
        content: s.last ? t("Last Commit {value1}", {value1: ago(s.last.at)}) : t("No Commits yet") },
      { key: 'branches', content: <><Count value={s.branches.length} />{s.branches.length === 1 ? t("Branch") : t("Branches")}</> },
      { key: 'commits', content: <><Count value={s.commits} />{s.commits === 1 ? t("Commit") : t("Commits")}</> },
      { key: 'disk', title: s.store.path ?? undefined, content: <><Count value={store?.size ?? s.store.bytes} format={bytes} />{t("on disk")}</> },
    ]} />
  ) : state.loading ? (
    <span aria-hidden="true" className="shimmer mt-1 inline-block h-3.5 w-80 max-w-full rounded-full align-middle" />
  ) : undefined

  const body = tab === 'live' ? (
    <LiveTab project={project} runs={runs} onOpenRun={(id) => onOpenChat(id)} />
  ) : tab === 'sessions' ? (
    <ProjectSessionsContent
      sessions={sessions}
      error={chats.error}
      onRetry={() => setSessionsRead((n) => n + 1)}
      onOpenChat={onOpenChat}
      onNewChat={onNewChat}
      canChat={!!s?.project.initialized}
    />
  ) : !s ? (
    state.error ? <LoadError error={state.error} what={label} onRetry={refresh} /> : <Loading label={t("Reading {value1}", {value1: label})} />
  ) : tab === 'storage' ? (
    <ProjectStorageContent state={s} store={store!} />
  ) : tab === 'sandboxes' ? (
    <ProjectSandboxesContent project={project} state={s} tick={revision} onBrowseFiles={(name) => {
      setBranch(name)
      if (embedded) return onEmbeddedView?.('files')
      select('files')
    }} />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">
      {tab === 'files' ? (
        <FilesTab key={`${project}:${branch ?? ''}`} project={project} branches={s.branches} tick={revision} initialBranch={branch} />
      ) : (
        <HistoryTab key={project} project={project} state={s} initialBranch={branch} initialView={initialView} />
      )}
    </div>
  )

  if (embedded) {
    return (
      <div className="vt-panel min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-7xl flex-col gap-4 px-6 pt-4 pb-6 @min-[56rem]/workspace:px-8">
          {s && state.error && <LoadError error={state.error} what={label} onRetry={refresh} />}
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <PageHeader
        live={working}
        size="md"
        className="[&>div]:pt-3"
        back={{ label: backLabel ?? t("Projects"), onBack }}
        icon={<HeroTile icon={LfsProject} />}
        title={projectRef(project).name}
        badges={store && <StoreBadge facts={store} project={projectRef(project).name} />}
        description={facts}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" className="rounded-xl" aria-label={t("Refresh")} disabled={state.loading} onClick={refresh}>
                  <RotateCw className={state.loading ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("Refresh")}</TooltipContent>
            </Tooltip>
            <Button size="sm" className="rounded-xl" disabled={!s?.project.initialized} onClick={onNewChat}>
              <MessageSquarePlus className="size-3.5" />{t("New chat")}</Button>
          </>
        }
        tabs={
          <TabBar aria-label={t("Project")}>
            {PROJECT_TABS.map((item) => (
              <Tab key={item.id} active={tab === item.id} onClick={() => select(item.id)}>
                {((item.id === 'sessions' && working) || (item.id === 'live' && liveNow)) && <span aria-hidden="true" className="pulse-ring mr-2 inline-block size-1.5 rounded-full bg-primary text-primary" />}
                {t(item.label)}
                {item.id === 'sessions' && openSessions > 0 && (
                  <span className="ml-1.5 rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground tabular-nums">
                    <CountUp value={openSessions} />
                  </span>
                )}
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

/** A number that counts up, then a space before its unit. */
function Count({ value, format }: { value: number | null; format?: (value: number) => string }) {
  return <><span className="font-medium text-foreground/80"><CountUp value={value} format={format} /></span>{' '}</>
}

/** Facts in one line, dot between them; the line is cut at the end when narrow. */
function FactLine({ items }: { items: { key: string; title?: string; content: ReactNode }[] }) {
  return (
    <span className="text-[13px]">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && <span aria-hidden="true" className="px-1.5 text-faint">·</span>}
          <span title={item.title}>{item.content}</span>
        </Fragment>
      ))}
    </span>
  )
}
