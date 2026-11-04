import { t, useI18n } from '@/i18n'
import { MessageSquarePlus, RotateCw } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { projectLabel, projectRef } from '@shared/host-api'

import { LfsProject } from '@/components/lfs-icons'
import { PageHeader } from '@/components/motion/page-header'
import { Tab, TabBar, TabDivider } from '@/components/motion/tabs'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab, type HistoryView } from '@/components/projects/history-tab'
import { ProjectSandboxesContent, ProjectStorageContent } from '@/components/projects/project-storage'
import { ProjectSessionsContent } from '@/components/projects/project-sessions'
import { LoadError, Loading } from '@/components/projects/states'
import { StoreBanner } from '@/components/projects/store-banner'
import { runsOn, RunsOnChips } from '@/components/projects/where-chips'
import { projectRuns } from '@/components/live/live-data'
import { LiveTab } from '@/components/live/live-tab'
import { isLive } from '@/components/live/run-format'
import { isProject, storeFacts, useStorageView } from '@/components/projects/store-facts'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { Crumbs } from '@/components/tabs/crumbs'
import { go } from '@/components/tabs/go'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ago, bytes } from '@/data/format'
import { host, onHostEvent } from '@/host/client'
import { chatLive, chatProject, useChatSessions } from '@/host/use-chat-sessions'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

import '@/components/projects/history/history.css'

type ProjectTab = 'history' | 'files' | 'live' | 'storage' | 'sandboxes' | 'chats'
/** The views a page that holds the project shows in its own tab bar (a chat's). */
export type EmbeddedProjectView = 'files' | 'history' | 'sandboxes'

// By use, in every language: Live first, then the work (chats, files, history), then where it runs and where it is stored.
const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'chats', label: 'Chats' },
  { id: 'files', label: 'Files' },
  { id: 'history', label: 'History' },
  { id: 'sandboxes', label: 'Sandboxes' },
  { id: 'storage', label: 'Storage' },
]

/** A `#projects/<key>/<tab>` hash's tab (older names too); undefined when absent. */
function askedTab(initial?: string): ProjectTab | undefined {
  if (initial === 'work' || initial === 'worktree' || initial === 'worktrees') return 'sandboxes'
  if (initial === 'sessions' || initial === 'runs') return 'chats'
  if (initial === 'blame') return 'files'
  return PROJECT_TABS.find((tab) => tab.id === initial)?.id
}

interface ProjectViewProps {
  /** The project key (projectKey: `store/name` in a shared Store). */
  project: string
  initialTab?: string
  initialBranch?: string
  onBack: () => void
  /** The previous page or chat; "Projects" when opened without navigation history. */
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
  const tabs = PROJECT_TABS.map((item) => ({ ...item, label: t(item.label) }))
  const asked = askedTab(initialTab)
  const [ownTab, setTab] = useState<ProjectTab>(asked ?? 'chats')
  // with no tab asked for, the page opens on Live once the chats show one working; a click keeps its choice
  const settled = useRef(asked !== undefined)
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
  const select = (next: ProjectTab) => { settled.current = true; setTab(next) }
  // the project's chats, kept current from the host's chat events
  const [sessionsRead, setSessionsRead] = useState(0)
  const chats = useChatSessions(`${revision}:${sessionsRead}`)
  const sessions = useMemo(() => chats.sessions?.filter((c) => chatProject(c) === project), [chats.sessions, project])
  const openSessions = sessions?.filter((c) => !c.archived).length ?? 0
  const working = sessions?.some((c) => !c.archived && chatLive(c)) ?? false
  // Live: the project's chats that work in LayerFS, drawn with every call they make
  const runs = useMemo(() => projectRuns(sessions, project), [sessions, project])
  const liveCount = runs?.filter((run) => isLive(run.state)).length ?? 0
  const liveNow = liveCount > 0

  useEffect(() => {
    if (settled.current || !sessions) return
    settled.current = true
    if (liveNow) setTab('live')
  }, [sessions, liveNow])

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

  // The Store is the crumb above; the line says where it runs (each machine a link), then recency and size.
  const runsAt = s ? runsOn(s.sandboxes) : null
  const facts = s ? (
    <>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <button type="button" onClick={() => select('sandboxes')} title={t('Show its Sandboxes')} className="rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t('Runs on')}</button>
        <RunsOnChips runs={runsAt} className="flex-nowrap" />
      </span>
      <span aria-hidden="true" className="px-2 text-faint">·</span>
      <span title={s.last ? t("Last Commit {value1} on {value2}", { value1: ago(s.last.at), value2: s.last.branch }) : undefined}>
        {s.last ? t("Last Commit {value1}", { value1: ago(s.last.at) }) : t("No Commits yet")}
      </span>
      <span aria-hidden="true" className="px-2 text-faint">·</span>
      <span>{bytes(store?.size ?? s.store.bytes)}</span>
    </>
  ) : state.loading ? t('Loading…') : undefined

  const body = tab === 'live' ? (
    <LiveTab project={project} runs={runs} onOpenRun={(id) => onOpenChat(id)} />
  ) : tab === 'chats' ? (
    <ProjectSessionsContent
      sessions={sessions}
      error={chats.error}
      onRetry={() => setSessionsRead((n) => n + 1)}
      onOpenChat={onOpenChat}
      onNewChat={onNewChat}
      canChat={!!s}
      sandboxes={s?.sandboxes}
      machine={store?.machine ?? null}
      onOpenBranch={(name) => {
        setBranch(name)
        select('history')
      }}
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
      {tab === 'files' && s.project.storeState === 'down' ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          {t('{machine} is stopped. Start it to browse this Store’s files.', { machine: s.project.machine ?? t('Its machine') })}
        </p>
      ) : tab === 'files' ? (
        <FilesTab key={`${project}:${branch ?? ''}`} project={project} branches={s.branches} tick={revision} initialBranch={branch} />
      ) : (
        <HistoryTab key={project} project={project} state={s} initialBranch={branch} initialView={initialView} />
      )}
    </div>
  )

  if (embedded) {
    return (
      <div className="project-workspace min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-7xl flex-col gap-4 px-6 pt-4 pb-6 @min-[56rem]/workspace:px-8">
          {s && state.error && <LoadError error={state.error} what={label} onRetry={refresh} />}
          {s && <StoreBanner state={s} onStart={(machine) => host.startMachine(machine).then(refresh, refresh)} />}
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className="project-workspace flex h-svh min-h-0 flex-col">
      <PageHeader
        motion={false}
        size="sm"
        width="max-w-7xl"
        back={{ label: backLabel ?? t("Projects"), onBack }}
        eyebrow={projectRef(project).store && (
          <Crumbs
            items={[
              { label: t('Storage'), onClick: () => go.page('storage'), title: t('Open Storage') },
              {
                label: projectRef(project).store,
                icon: store && <StoreIcon family={store.family} size="sm" className="[&>span]:size-4 [&>span]:rounded-[5px] [&_svg]:size-2.5" />,
                onClick: () => go.store(projectRef(project).store!),
                title: t('Stored in {store}: open it on Storage', { store: projectRef(project).store! }),
              },
            ]}
          />
        )}
        title={<span className="flex min-w-0 items-center gap-1.5"><LfsProject className="size-4 shrink-0" /><span className="truncate">{projectRef(project).name}</span></span>}
        description={facts}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-7 rounded-lg text-muted-foreground hover:text-foreground" aria-label={t("Refresh")} disabled={state.loading} onClick={refresh}>
                  <RotateCw className={state.loading ? 'size-3.5 animate-spin' : 'size-3.5'} /></Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("Refresh")}</TooltipContent>
            </Tooltip>
            <Button size="sm" className="h-7 rounded-lg px-2.5" disabled={!s} onClick={onNewChat}>
              <MessageSquarePlus className="size-3.5" />{t("New chat")}</Button>
          </>
        }
        tabs={
          <TabBar aria-label={t("Project")} variant="line">
            {tabs.map((item) => (
              <Fragment key={item.id}>
                {item.id === 'sandboxes' && <TabDivider />}
                <Tab active={tab === item.id} onClick={() => select(item.id)}>
                  {((item.id === 'chats' && working) || (item.id === 'live' && liveNow)) && (
                    <span aria-hidden="true" className={cn('inline-block size-1.5 rounded-full bg-primary', item.id === 'live' && 'motion-safe:animate-pulse')} />
                  )}
                  {item.label}
                  {((item.id === 'chats' && openSessions > 0) || (item.id === 'live' && liveNow)) && (
                    <span className="rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground tabular-nums">
                      {item.id === 'live' ? liveCount : openSessions}
                    </span>
                  )}
                </Tab>
              </Fragment>
            ))}
          </TabBar>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full min-w-0 max-w-7xl flex-col gap-4 px-6 pt-3 pb-6 @min-[56rem]/workspace:px-8">
          {state.error && (s || tab === 'chats' || tab === 'live') && <LoadError error={state.error} what={label} onRetry={refresh} />}
          {s && <StoreBanner state={s} onStart={(machine) => host.startMachine(machine).then(refresh, refresh)} />}
          {body}
        </div>
      </div>
    </div>
  )
}
