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
import { useI18n } from '@/i18n'

// CONNECT_VIEW selects a page or a real project and its initial tab:
// "#projects/<key>[/<tab>][/<branch>]", where a key in a shared Store is
// written encoded ("team%2Fapp" for team/app).
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['chat', 'projects', 'storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const [startProjectPart, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startProject = startProjectPart ? decodeURIComponent(startProjectPart) : undefined
const startBranch = startBranchParts.join('/') || undefined

function opening(): Selection {
  if (startProject) return { kind: 'project', id: startProject }
  return { kind: 'nav', id: START_PAGES.find((p) => p === startPage) ?? 'chat' }
}

export function App() {
  const { locale, t } = useI18n()
  const [selected, setSelected] = useState<Selection>(opening)
  const [chatIntent, setChatIntent] = useState<{ id: number; project: string } | null>(null)
  const [projectLocation, setProjectLocation] = useState<{ id?: string; tab?: string; branch?: string }>(() => ({ id: startProject, tab: startTab, branch: startBranch }))
  const chatRequest = useRef(0)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const projects = useProjects()
  const select = (next: Selection) => {
    if (next.kind !== selected.kind || next.id !== selected.id) viewTransition(() => {
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
  const location = selected.kind === 'project' && selected.id === projectLocation.id ? projectLocation : undefined

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
        <AppSidebar selected={selected} projects={projects} onSelect={select} onNewProject={() => setNewProjectOpen(true)} onDeleteProject={setDeleteTarget} />
        <main className="canvas vt-page @container/workspace min-w-0 flex-1 relative z-10 flex flex-col">
          {page === 'chat' && <ChatHome key={chatIntent?.id ?? 'chat'} initialProject={chatIntent?.project} projects={projects} onOpenProject={openProject} />}
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
