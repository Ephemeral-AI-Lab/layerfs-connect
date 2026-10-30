import { useEffect, useRef, useState } from 'react'
import { projectKey, projectLabel, type ProjectSummary } from '@shared/host-api'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ChatHome } from '@/components/chat/chat-home'
import { ComputePage } from '@/components/compute/compute-page'
import { CursorAura } from '@/components/motion/cursor-aura'
import { viewTransition } from '@/components/motion/view-transition'
import { ProjectView } from '@/components/projects/project-view'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { DeleteProjectDialog } from '@/components/projects/delete-project-dialog'
import { ProjectsHome } from '@/components/projects/projects-home'
import { StoragePage } from '@/components/storage/storage-page'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useProjects } from '@/host/use-projects'
import { host } from '@/host/client'
import { useI18n } from '@/i18n'

// CONNECT_VIEW selects a page (#projects, the default; #chat, #storage, #compute) or a real project and its initial tab:
// "#projects/<key>[/<tab>][/<branch>]", where a key in a shared Store is
// written encoded ("team%2Fapp" for team/app); or a scenario run's page,
// "#runs/<run id>[/<agent>]", under the project it played on.
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['chat', 'projects', 'storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const [startProjectPart, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startProject = startProjectPart ? decodeURIComponent(startProjectPart) : undefined
const startBranch = startBranchParts.join('/') || undefined
const [startRun, startAgent] = startPage === 'runs' ? startRest : []

function opening(): Selection {
  if (startProject) return { kind: 'project', id: startProject }
  if (startRun) return { kind: 'nav', id: 'projects' }
  return { kind: 'nav', id: START_PAGES.find((p) => p === startPage) ?? 'projects' }
}

export function App() {
  const { locale, t } = useI18n()
  const [selected, setSelected] = useState<Selection>(opening)
  const [chatIntent, setChatIntent] = useState<{ id: number; project?: string; session?: string } | null>(null)
  const [projectLocation, setProjectLocation] = useState<{ id?: string; tab?: string; branch?: string }>(() => ({ id: startProject, tab: startTab, branch: startBranch }))
  const chatRequest = useRef(0)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const projects = useProjects()
  const select = (next: Selection) => {
    if (next.kind !== selected.kind || next.id !== selected.id || (next.kind === 'project' && selected.kind === 'project' && next.run !== selected.run)) viewTransition(() => {
      setSelected(next)
      setChatIntent(null)
      setProjectLocation({ id: undefined, tab: undefined, branch: undefined })
    })
  }
  const page = selected.kind === 'nav' ? selected.id : undefined
  const openProject = (id: string, branch?: string) => viewTransition(() => {
    setSelected({ kind: 'project', id })
    setChatIntent(null)
    setProjectLocation({ id, tab: branch ? 'history' : undefined, branch })
  })
  const newProjectChat = (project: string) => viewTransition(() => {
    setChatIntent({ id: ++chatRequest.current, project })
    setSelected({ kind: 'nav', id: 'chat' })
  })
  /** A chat conversation from the sidebar, on the Chat page. */
  const openChat = (session: string) => {
    if (selected.kind === 'nav' && selected.id === 'chat' && selected.session === session) return
    viewTransition(() => {
      setChatIntent({ id: ++chatRequest.current, session })
      setSelected({ kind: 'nav', id: 'chat', session })
    })
  }
  const location = selected.kind === 'project' && selected.id === projectLocation.id ? projectLocation : undefined
  /** A run of `project` (one of its agents), or the project page when `run` is absent; switching agents does not move the page. */
  const openRun = (project: string, run?: string, agent?: string) => {
    const next: Selection = { kind: 'project', id: project, run, agent }
    if (selected.kind === 'project' && selected.id === project && selected.run === run) setSelected(next)
    else viewTransition(() => { setSelected(next); setChatIntent(null) })
  }

  // a `#runs/<id>` start hash: the run's page, under the project it played on
  useEffect(() => {
    if (!startRun) return
    let live = true
    host.run(startRun).then(
      (run) => live && setSelected({ kind: 'project', id: run.project, run: run.id, agent: startAgent || undefined }),
      () => live && setSelected({ kind: 'nav', id: 'projects' }),
    )
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (window.connect.platform === 'darwin') {
      document.title = ''
      return
    }
    const titles: Record<NavId, string> = { chat: 'Chat', projects: 'Projects', storage: 'Storage', compute: 'Compute' }
    document.title = `${selected.kind === 'project' ? projectLabel(selected.id) : t(titles[selected.id])} · LayerFS Connect`
  }, [selected, locale, t])

  return (
    <TooltipProvider>
      <SidebarProvider className="relative min-h-svh w-full bg-background overflow-hidden">
        <CursorAura />
        <AppSidebar selected={selected} projects={projects} onSelect={select} onNewProject={() => setNewProjectOpen(true)} onDeleteProject={setDeleteTarget} onOpenChat={openChat} onNewChat={newProjectChat} />
        <main className="canvas vt-page @container/workspace min-w-0 flex-1 relative z-10 flex flex-col">
          {page === 'chat' && (
            <ChatHome
              key={chatIntent?.id ?? 'chat'}
              initialProject={chatIntent?.project}
              initialSession={chatIntent?.session}
              projects={projects}
              onOpenProject={openProject}
              onOpenRun={(project, run) => openRun(project, run)}
              // the sidebar marks the conversation open now (none for a new one)
              onActiveSession={(id) => setSelected((s) => (s.kind === 'nav' && s.id === 'chat' && s.session !== (id ?? undefined) ? { ...s, session: id ?? undefined } : s))}
            />
          )}
          {page === 'storage' && <StoragePage catalog={projects} initialId={startId} onOpenProject={openProject} />}
          {page === 'projects' && <ProjectsHome projects={projects} onOpenProject={openProject} onNewProject={() => setNewProjectOpen(true)} />}
          {selected.kind === 'project' && (
            <ProjectView
              key={`${selected.id}:${location?.branch ?? ''}`}
              project={selected.id}
              onBack={() => select({ kind: 'nav', id: 'projects' })}
              onNewChat={() => newProjectChat(selected.id)}
              initialTab={location?.tab}
              initialBranch={location?.branch}
              run={selected.run}
              agent={selected.agent}
              onOpenRun={(run, agent) => openRun(selected.id, run, agent)}
              ownScenario={projects.data?.find((p) => projectKey(p) === selected.id)?.demo}
            />
          )}
          {page === 'compute' && <ComputePage platform={startPlatform} />}
        </main>
      </SidebarProvider>
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} onCreated={(project) => { projects.add(project); openProject(projectKey(project)) }} />
      {deleteTarget && <DeleteProjectDialog project={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={async (key) => {
        await projects.remove(key)
        if (localStorage.getItem('connect.agent.project') === key) localStorage.removeItem('connect.agent.project')
        if (selected.kind === 'project' && selected.id === key) select({ kind: 'nav', id: 'projects' })
      }} />}
    </TooltipProvider>
  )
}
