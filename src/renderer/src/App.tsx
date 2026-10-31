import { useEffect, useState } from 'react'
import { projectKey, projectLabel, type ProjectSummary } from '@shared/host-api'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ChatHome } from '@/components/chat/chat-home'
import { discardSessionDraft } from '@/components/chat/chat-drafts'
import { DeleteChatDialog, type DeleteChatTarget } from '@/components/chat/delete-chat-dialog'
import { ComputePage } from '@/components/compute/compute-page'
import { CursorAura } from '@/components/motion/cursor-aura'
import { viewTransition } from '@/components/motion/view-transition'
import { ProjectView } from '@/components/projects/project-view'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { DeleteProjectDialog } from '@/components/projects/delete-project-dialog'
import { ProjectsHome } from '@/components/projects/projects-home'
import { SettingsContext, type SettingsSection } from '@/components/settings/settings-context'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { StoragePage } from '@/components/storage/storage-page'
import { TabErrorBoundary } from '@/components/tabs/tab-error-boundary'
import { TabStrip } from '@/components/tabs/tab-strip'
import { sameTarget, useTabs, type TabsApi, type TabTarget } from '@/components/tabs/use-tabs'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useProjects } from '@/host/use-projects'
import { agentHost, onChatRemoved } from '@/host/agent-client'
import { useI18n } from '@/i18n'

/** Where the sidebar's open or folded state is kept. */
const SIDEBAR_STORE = 'connect.sidebar'

// CONNECT_VIEW selects a page (#projects, the default; #chat, #storage, #compute) or a real project and its initial tab:
// "#projects/<key>[/<tab>][/<branch>]", where a key in a shared Store is
// written encoded ("team%2Fapp" for team/app). It opens in a tab on top of the restored ones.
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['chat', 'projects', 'storage', 'compute']
const PAGE_LABELS: Record<NavId, string> = { chat: 'Chat', projects: 'Projects', storage: 'Storage', compute: 'Compute' }
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const [startProjectPart, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startProject = startProjectPart ? decodeURIComponent(startProjectPart) : undefined
const startBranch = startBranchParts.join('/') || undefined

function opening(): TabTarget | undefined {
  if (startProject) return { selected: { kind: 'project', id: startProject }, location: { tab: startTab, branch: startBranch } }
  const page = START_PAGES.find((p) => p === startPage)
  return page ? { selected: { kind: 'nav', id: page } } : undefined
}
/** Numbers each chat a tab is asked to show, so a new one remounts the page (it starts past ids saved with the tabs). */
let chatNonce = Date.now()
/** Home is a new chat: a new tab opens on it, and closing the last tab leaves one. */
const home = (): TabTarget => ({ selected: { kind: 'nav', id: 'chat' }, chat: { id: ++chatNonce, fresh: true } })

export function App() {
  const { locale, t } = useI18n()
  const tabs = useTabs(home, opening())
  const tab = tabs.active
  const selected = tab.selected
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const [deleteChatTarget, setDeleteChatTarget] = useState<DeleteChatTarget | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // the sidebar folds away (its button, the tab strip's, or ⌘B) and stays so across launches
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORE) !== 'closed'
    } catch {
      return true
    }
  })
  const showSidebar = (open: boolean) => {
    setSidebarOpen(open)
    try {
      localStorage.setItem(SIDEBAR_STORE, open ? 'open' : 'closed')
    } catch {
      // then it lasts only as long as the page
    }
  }
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('models')
  const [settings] = useState(() => ({
    open: (section?: SettingsSection) => {
      if (section) setSettingsSection(section)
      setSettingsOpen(true)
    },
  }))
  const projects = useProjects()

  useEffect(() => onChatRemoved((id) => {
    tabs.forgetSession(id)
    void discardSessionDraft(id)
  }), [tabs.forgetSession])

  /** Opens a place in this tab, or in a new one (⌘-click); a place already open switches to its tab. */
  const open = (target: TabTarget, newTab = false) => {
    if (!newTab && sameTarget(selected, target.selected) && !target.chat && !target.location) return
    viewTransition(() => tabs.open(target, newTab))
  }
  const select = (next: Selection, newTab?: boolean) => open({ selected: next }, newTab)
  const page = selected.kind === 'nav' ? selected.id : undefined
  const openProject = (id: string, branch?: string) => open({ selected: { kind: 'project', id }, location: branch ? { tab: 'history', branch } : undefined })
  /** A chat's project, in the chat's own tab: Back returns to the chat (`from`, its title). */
  const openChatProject = (id: string, branch?: string, from?: string) =>
    viewTransition(() => tabs.openHere({ selected: { kind: 'project', id }, location: branch ? { tab: 'history', branch } : undefined }, from))
  const openStorageProject = (id: string) =>
    viewTransition(() => tabs.openHere({ selected: { kind: 'project', id } }, t('Storage')))
  /** Return to the previous place, including an unlabelled page in tab history. */
  const cameFrom = tab.back?.at(-1)
  const backLabel = cameFrom?.label ?? (cameFrom?.selected.kind === 'project'
    ? projectLabel(cameFrom.selected.id)
    : cameFrom ? t(PAGE_LABELS[cameFrom.selected.id]) : undefined)
  /** A new chat keeps the project open: it gets a tab of its own. */
  const newProjectChat = (project: string) => open({ selected: { kind: 'nav', id: 'chat' }, chat: { id: ++chatNonce, project, fresh: true } }, true)
  /** A new chat with no project chosen, in a tab of its own. */
  const newChat = () => open(home(), true)
  /** A chat conversation from the sidebar, on the Chat page. */
  const openChat = (session: string) => open({ selected: { kind: 'nav', id: 'chat', session }, chat: { id: ++chatNonce, session } })
  /** Closing the last tab leaves a new chat in its place. */
  const closeTab = (id: string) => viewTransition(() => tabs.close(id, home()))
  // switching tabs moves the page like any other page change
  const strip: TabsApi = {
    ...tabs,
    activate: (id) => { if (id !== tab.id) viewTransition(() => tabs.activate(id)) },
    activateIndex: (i) => viewTransition(() => tabs.activateIndex(i)),
    cycle: (d) => viewTransition(() => tabs.cycle(d)),
    reopen: () => viewTransition(() => tabs.reopen()),
  }

  // Back and Forward in the active tab: ⌘[ ⌘] (Alt+← → elsewhere) and the mouse's side buttons
  useEffect(() => {
    const go = (delta: -1 | 1) => viewTransition(() => tabs.go(delta))
    const onKey = (e: KeyboardEvent) => {
      const mod = window.connect.platform === 'darwin' ? e.metaKey && !e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey
      if (!mod || e.shiftKey) return
      const [backKey, forwardKey] = window.connect.platform === 'darwin' ? ['BracketLeft', 'BracketRight'] : ['ArrowLeft', 'ArrowRight']
      const delta = e.code === backKey ? -1 : e.code === forwardKey ? 1 : 0
      if (!delta || (window.connect.platform !== 'darwin' && e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]'))) return
      e.preventDefault()
      go(delta)
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      go(e.button === 3 ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse) }
  }, [tabs.go])

  useEffect(() => {
    if (window.connect.platform === 'darwin') {
      document.title = ''
      return
    }
    document.title = `${selected.kind === 'project' ? projectLabel(selected.id) : t(PAGE_LABELS[selected.id])} · LayerFS Connect`
  }, [selected, locale, t])

  return (
    <SettingsContext.Provider value={settings}>
    <TooltipProvider>
      <SidebarProvider open={sidebarOpen} onOpenChange={showSidebar} className="relative isolate min-h-svh w-full bg-background overflow-hidden">
        <CursorAura />
        <AppSidebar selected={selected} projects={projects} onSelect={select} onNewProject={() => setNewProjectOpen(true)} onDeleteProject={setDeleteTarget} onDeleteChat={(chat, returnFocus) => setDeleteChatTarget({ chat, returnFocus })} onOpenChat={openChat} onNewChat={newProjectChat} onNewSession={newChat} settingsOpen={settingsOpen} onOpenSettings={() => settings.open()} />
        <div className="canvas relative z-10 flex h-svh min-w-0 flex-1 flex-col">
          <TabStrip tabs={strip} onNewTab={() => viewTransition(() => tabs.open(home(), true))} onClose={closeTab} />
          <main className="vt-page tab-body @container/workspace relative flex min-h-0 min-w-0 flex-1 flex-col">
            <TabErrorBoundary key={`${tab.id}:${selected.kind}:${selected.id}`}>
            {page === 'chat' && (
              <ChatHome
                key={`${tab.id}:${tab.chat?.id ?? 0}`}
                initialProject={selected.kind === 'nav' && selected.session ? undefined : tab.chat?.project}
                initialSession={(selected.kind === 'nav' && selected.session) || tab.chat?.session}
                startNew={tab.chat?.fresh}
                projects={projects}
                onOpenProject={openChatProject}
                initialView={selected.kind === 'nav' ? selected.view : undefined}
                // the tab keeps the view open, so Back returns to it
                onView={(view) => tabs.update(tab.id, (s) => (s.kind === 'nav' && s.id === 'chat' && s.view !== view ? { ...s, view } : s))}
                // the tab and the sidebar follow the conversation open now (none for a new one)
                onActiveSession={(id) => tabs.update(tab.id, (s) => (s.kind === 'nav' && s.id === 'chat' && s.session !== (id ?? undefined) ? { ...s, session: id ?? undefined } : s))}
              />
            )}
            {page === 'storage' && <StoragePage
              key={tab.id}
              catalog={projects}
              initialId={startId}
              initialRoute={selected.kind === 'nav' ? selected.view : undefined}
              onRoute={(view) => tabs.update(tab.id, (s) => s.kind === 'nav' && s.id === 'storage' && s.view !== view ? { ...s, view } : s)}
              onOpenProject={openStorageProject}
            />}
            {page === 'projects' && <ProjectsHome key={tab.id} projects={projects} onOpenProject={openProject} onNewProject={() => setNewProjectOpen(true)} onOpenChat={openChat} />}
            {selected.kind === 'project' && (
              <ProjectView
                key={`${tab.id}:${selected.id}:${tab.location?.branch ?? ''}`}
                project={selected.id}
                backLabel={backLabel}
                onBack={() => (cameFrom ? viewTransition(() => tabs.go(-1)) : select({ kind: 'nav', id: 'projects' }))}
                onNewChat={() => newProjectChat(selected.id)}
                // like New chat, a session opens in a tab of its own (or its tab, if open) and the project stays
                onOpenChat={(session) => open({ selected: { kind: 'nav', id: 'chat', session }, chat: { id: ++chatNonce, session } }, true)}
                initialTab={tab.location?.tab}
                initialBranch={tab.location?.branch}
              />
            )}
            {page === 'compute' && <ComputePage key={tab.id} platform={startPlatform} />}
            </TabErrorBoundary>
          </main>
        </div>
      </SidebarProvider>
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} onCreated={(project) => { projects.add(project); openProject(projectKey(project)) }} />
      {deleteChatTarget && <DeleteChatDialog target={deleteChatTarget} onClose={() => setDeleteChatTarget(null)} onDelete={async (id) => { await agentHost.remove(id) }} />}
      {deleteTarget && <DeleteProjectDialog project={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={async (key) => {
        await projects.remove(key)
        if (localStorage.getItem('connect.agent.project') === key) localStorage.removeItem('connect.agent.project')
        tabs.closeWhere((x) => x.selected.kind === 'project' && x.selected.id === key)
      }} />}
      <SettingsDialog open={settingsOpen} section={settingsSection} onOpenChange={setSettingsOpen} onSection={setSettingsSection} />
    </TooltipProvider>
    </SettingsContext.Provider>
  )
}
