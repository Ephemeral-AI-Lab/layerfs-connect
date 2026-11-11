import { useEffect, useState } from 'react'
import { projectKey, projectLabel, type ProjectSummary } from '@shared/host-api'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ChatHome } from '@/components/chat/chat-home'
import { discardSessionDraft } from '@/components/chat/chat-drafts'
import { DeleteChatDialog, type DeleteChatTarget } from '@/components/chat/delete-chat-dialog'
import { ComputePage } from '@/components/compute/compute-page'
import { viewTransition } from '@/components/motion/view-transition'
import { ProjectView } from '@/components/projects/project-view'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { DeleteProjectDialog } from '@/components/projects/delete-project-dialog'
import { ProjectsHome } from '@/components/projects/projects-home'
import { SettingsContext, type SettingsSection } from '@/components/settings/settings-context'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { StoragePage } from '@/components/storage/storage-page'
import { TabErrorBoundary } from '@/components/tabs/tab-error-boundary'
import { sameTarget, useTabs, type TabTarget } from '@/components/tabs/use-tabs'
import { setGo } from '@/components/tabs/go'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useProjects } from '@/host/use-projects'
import { agentHost, onChatRemoved } from '@/host/agent-client'
import { useI18n } from '@/i18n'
import { UpgradeScreen, useConversion } from '@/components/upgrade-screen'
import { WindowBar } from '@/components/window-bar'

/** Where the sidebar's open or folded state is kept. */
const SIDEBAR_STORE = 'connect.sidebar'

// CONNECT_VIEW selects a page (#projects, the default; #chat, #storage, #machines; #compute is its old name) or a real project and its initial tab:
// "#projects/<key>[/<tab>][/<branch>]", where a key in a shared Store is
// written encoded ("team%2Fapp" for team/app). It opens over the restored place (Back returns to it).
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const START_PAGES: NavId[] = ['chat', 'projects', 'machines', 'storage']
const PAGE_LABELS: Record<NavId, string> = { chat: 'Chat', projects: 'Projects', storage: 'Storage', machines: 'Machines' }
const [startProjectPart, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startProject = startProjectPart ? decodeURIComponent(startProjectPart) : undefined
const startBranch = startBranchParts.join('/') || undefined

function opening(): TabTarget | undefined {
  if (startProject) return { selected: { kind: 'project', id: startProject }, location: { tab: startTab, branch: startBranch } }
  const page = START_PAGES.find((p) => p === (startPage === 'compute' ? 'machines' : startPage))
  return page ? { selected: { kind: 'nav', id: page } } : undefined
}
/** Numbers each chat the window is asked to show, so a new one remounts the page (it starts past ids saved with the place). */
let chatNonce = Date.now()
/** Home is a new chat: the window opens on it when nothing was restored. */
const home = (): TabTarget => ({ selected: { kind: 'nav', id: 'chat' }, chat: { id: ++chatNonce, fresh: true } })

export function App() {
  const conversion = useConversion()
  const { locale, t } = useI18n()
  const tabs = useTabs(home, opening())
  const tab = tabs.active
  const selected = tab.selected
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  /** The Store New project opens on (Storage's "Add project"). */
  const [newProjectStore, setNewProjectStore] = useState<string | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const [deleteChatTarget, setDeleteChatTarget] = useState<DeleteChatTarget | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // the sidebar folds away (its button, the window bar's, or ⌘B) and stays so across launches
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      if (window.matchMedia('(max-width: 767px)').matches) return false
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

  /** Opens a place in the window; Back returns to the one it leaves. The place showing already stays. */
  const open = (target: TabTarget) => {
    if (sameTarget(selected, target.selected) && !target.chat && !target.location) return
    viewTransition(() => tabs.open(target))
  }
  const select = (next: Selection) =>
    // Machines (Storage) again while a machine's (Store's) page shows: the board
    next.kind === 'nav' && next.id === 'machines' && page === 'machines' && tab.location?.focus ? openMachine(null)
      : next.kind === 'nav' && next.id === 'storage' && page === 'storage' && tab.location?.focus ? openStore(null)
      : open({ selected: next })
  const page = selected.kind === 'nav' ? selected.id : undefined
  const openProject = (id: string, branch?: string) => open({ selected: { kind: 'project', id }, location: branch ? { tab: 'history', branch } : undefined })
  /** A chat's project: Back returns to the chat (`from`, its title). */
  const openChatProject = (id: string, branch?: string, from?: string) =>
    viewTransition(() => tabs.openHere({ selected: { kind: 'project', id }, location: branch ? { tab: 'history', branch } : undefined }, from))
  /** A project from Storage: Back returns there (`from`: the Store's page it was opened on). */
  const openStorageProject = (id: string, from?: string) =>
    viewTransition(() => tabs.openHere({ selected: { kind: 'project', id } }, from ?? t('Storage')))
  const openMachinesProject = (id: string, tab?: string) =>
    viewTransition(() => tabs.openHere({ selected: { kind: 'project', id }, location: tab ? { tab } : undefined }, t('Machines')))
  // cross-links (#537 §7): a row on Storage or Machines, or a project's tab, from anywhere
  useEffect(() =>
    setGo((place) => {
      if ('page' in place) open({ selected: { kind: 'nav', id: place.page }, location: place.focus ? { focus: place.focus } : undefined })
      else open({ selected: { kind: 'project', id: place.project }, location: place.tab ? { tab: place.tab } : undefined })
    }),
  )
  /** Return to the previous place, including an unlabelled page in tab history. */
  const cameFrom = tab.back?.at(-1)
  const backLabel = cameFrom?.label ?? (cameFrom?.selected.kind === 'project'
    ? projectLabel(cameFrom.selected.id)
    : cameFrom ? t(PAGE_LABELS[cameFrom.selected.id]) : undefined)
  /** A machine's or Store's page opened from another page: Back returns there (its own board is the crumb). */
  const pageBack = (board: NavId) =>
    cameFrom && backLabel && !(cameFrom.selected.kind === 'nav' && cameFrom.selected.id === board && !cameFrom.location?.focus)
      ? { label: backLabel, onBack: () => viewTransition(() => tabs.go(-1)) }
      : undefined
  /** A machine's page (Back returns to the board); null: the board, back where it came from when it did. */
  const openMachine = (name: string | null) => {
    if (name) return viewTransition(() => tabs.openHere({ selected: { kind: 'nav', id: 'machines' }, location: { focus: `machine:${name}` } }, t('Machines')))
    if (cameFrom?.selected.kind === 'nav' && cameFrom.selected.id === 'machines' && !cameFrom.location?.focus) viewTransition(() => tabs.go(-1))
    else viewTransition(() => tabs.openHere({ selected: { kind: 'nav', id: 'machines' } }))
  }
  /** A Store's page (Back returns to the board); null: the board, back where it came from when it did. */
  const openStore = (name: string | null) => {
    if (name) return viewTransition(() => tabs.openHere({ selected: { kind: 'nav', id: 'storage' }, location: { focus: `store:${name}` } }, t('Storage')))
    if (cameFrom?.selected.kind === 'nav' && cameFrom.selected.id === 'storage' && !cameFrom.location?.focus) viewTransition(() => tabs.go(-1))
    else viewTransition(() => tabs.openHere({ selected: { kind: 'nav', id: 'storage' } }))
  }
  /** A new chat on a project; Back returns to where it was started. */
  const newProjectChat = (project: string) => open({ selected: { kind: 'nav', id: 'chat' }, chat: { id: ++chatNonce, project, fresh: true } })
  /** A new chat with no project chosen. */
  const newChat = () => open(home())
  /** A chat conversation from the sidebar, on the Chat page. */
  const openChat = (session: string) => open({ selected: { kind: 'nav', id: 'chat', session }, chat: { id: ++chatNonce, session } })
  // Back and Forward: ⌘[ ⌘] (Alt+← → elsewhere) and the mouse's side buttons
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

  // a layout 2 home's one-time conversion is refused while anything in it is live: every page would fail, so the upgrade screen stands in
  if (conversion) return <UpgradeScreen refusal={conversion} />

  return (
    <SettingsContext.Provider value={settings}>
    <TooltipProvider>
      <SidebarProvider open={sidebarOpen} onOpenChange={showSidebar} className="app-shell relative isolate min-h-svh w-full overflow-hidden">
        <AppSidebar selected={selected} projects={projects} onSelect={select} onNewProject={() => setNewProjectOpen(true)} onDeleteProject={setDeleteTarget} onDeleteChat={(chat, returnFocus) => setDeleteChatTarget({ chat, returnFocus })} onOpenChat={openChat} onNewChat={newProjectChat} onNewSession={newChat} settingsOpen={settingsOpen} onOpenSettings={() => settings.open()} />
        <div className="canvas relative z-10 flex h-svh min-w-0 flex-1 flex-col">
          <WindowBar />
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
              focus={tab.location?.focus}
              catalog={projects}
              onOpenProject={openStorageProject}
              onOpenStore={openStore}
              back={pageBack('storage')}
              onAddProject={(store) => { setNewProjectStore(store); setNewProjectOpen(true) }}
            />}
            {page === 'projects' && <ProjectsHome key={tab.id} projects={projects} onOpenProject={openProject} onNewProject={() => setNewProjectOpen(true)} />}
            {selected.kind === 'project' && (
              <ProjectView
                key={`${tab.id}:${selected.id}:${tab.location?.branch ?? ''}`}
                project={selected.id}
                backLabel={backLabel}
                onBack={() => (cameFrom ? viewTransition(() => tabs.go(-1)) : select({ kind: 'nav', id: 'projects' }))}
                onNewChat={() => newProjectChat(selected.id)}
                // a session opens in the window; Back returns to the project
                onOpenChat={(session) => open({ selected: { kind: 'nav', id: 'chat', session }, chat: { id: ++chatNonce, session } })}
                initialTab={tab.location?.tab}
                initialBranch={tab.location?.branch}
              />
            )}
            {page === 'machines' && <ComputePage key={tab.id} focus={tab.location?.focus} onOpenProject={openMachinesProject} onOpenMachine={openMachine} back={pageBack('machines')} onOpenChat={(session) => open({ selected: { kind: 'nav', id: 'chat', session }, chat: { id: ++chatNonce, session } })} />}
            </TabErrorBoundary>
          </main>
        </div>
      </SidebarProvider>
      <NewProjectDialog open={newProjectOpen} initialStore={newProjectStore} onOpenChange={(open) => { setNewProjectOpen(open); if (!open) setNewProjectStore(undefined) }} onCreated={(project) => { projects.add(project); openProject(projectKey(project)) }} />
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
