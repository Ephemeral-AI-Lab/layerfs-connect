import { useEffect, useState } from 'react'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ChatHome } from '@/components/chat/chat-home'
import { ComputePage } from '@/components/compute/compute-page'
import { viewTransition } from '@/components/motion/view-transition'
import { ProjectView } from '@/components/projects/project-view'
import { ProjectsHome } from '@/components/projects/projects-home'
import { projectOf } from '@/components/runs/run-format'
import { useRuns } from '@/components/runs/use-runs'
import { StoragePage } from '@/components/storage/storage-page'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useProjects as useProjectCatalog } from '@/host/use-projects'

// Dev aid: a hash from CONNECT_VIEW picks the first page and its state:
// "#storage", "#storage/store/<name>", "#storage/location/<remote>",
// "#storage/connection/<name>" or "#storage/machine" (the Storage page keeps
// its view in the hash, so back works there),
// "#compute/<linux|win32|darwin>", "#chat" (the Pi agent),
// "#projects", "#projects/<demo>[/<tab>][/<branch>]" (the project page; tabs:
// live, timeline, history, storage, sessions, script; older names map onto them) or
// "#runs/<run id>[/<agent>]" (a session: one replay's conversation).
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['chat', 'projects', 'storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const [startProject, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startBranch = startBranchParts?.join('/') || undefined
const [startRun, startRunPart] = startPage === 'runs' ? startRest : []

/** A selection before the runs are read: a hash's run names no demo yet. */
type Opening = Selection | { kind: 'run'; id: string; agent?: string }

function opening(): Opening {
  if (startRun) return { kind: 'run', id: startRun, agent: startRunPart }
  if (startProject) return { kind: 'project', id: startProject }
  const page = START_PAGES.find((p) => p === startPage)
  return { kind: 'nav', id: page ?? 'projects' }
}

/** Which page a selection shows; a change of page cross-fades (an agent switch within a session does not). */
const pageOf = (s: Opening) => (s.kind === 'nav' ? s.id : s.kind === 'run' ? `run:${s.id}` : `project:${s.id}:${s.run ?? ''}`)

export function App() {
  const [picked, setPicked] = useState<Opening>(opening)
  const setSelected = (next: Opening) => {
    if (pageOf(next) === pageOf(picked)) setPicked(next)
    else viewTransition(() => setPicked(next))
  }
  const { runs } = useRuns()
  // the Chat page's project directory
  const catalog = useProjectCatalog()

  // A session opens under its project; its demo comes from the runs.
  const pickedRun = picked.kind === 'run' ? runs?.find((r) => r.id === picked.id) : undefined
  const selected: Selection =
    picked.kind === 'run'
      ? pickedRun
        ? { kind: 'project', id: projectOf(pickedRun), run: picked.id, agent: picked.agent }
        : { kind: 'nav', id: 'projects' }
      : picked
  const page = picked.kind === 'nav' ? picked.id : undefined
  const openProject = (id: string) => setSelected({ kind: 'project', id })
  // Projects, Storage and Compute are the LayerFS page's parts (its tab row)
  const openPart = (id: NavId) => setSelected({ kind: 'nav', id })
  const openRun = (id: string) => {
    const r = runs?.find((x) => x.id === id)
    setSelected(r ? { kind: 'project', id: projectOf(r), run: id } : { kind: 'run', id })
  }
  const startHere = startProject && selected.kind === 'project' && startProject === selected.id && !selected.run && !selected.draft

  // back or forward onto a Storage hash (#storage/…) opens the Storage page; it reads the view from the hash
  useEffect(() => {
    const onPop = () => {
      if (window.location.hash.startsWith('#storage') && !(picked.kind === 'nav' && picked.id === 'storage')) setSelected({ kind: 'nav', id: 'storage' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  })

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar selected={selected} onSelect={setSelected} />
        <main className="canvas vt-page min-w-0 flex-1">
          {page === 'chat' && (
            <ChatHome projects={catalog} onOpenProject={(id) => openProject(id)} />
          )}
          {page === 'storage' && (
            <StoragePage onOpenProject={openProject} onPart={openPart} />
          )}
          {page === 'projects' && (
            <ProjectsHome onOpenProject={openProject} onOpenRun={openRun} onNewSession={(id) => setSelected({ kind: 'project', id, draft: true })} onPart={openPart} />
          )}
          {selected.kind === 'project' && (
            <ProjectView
              key={selected.id}
              demo={selected.id}
              runId={selected.run}
              draft={selected.draft}
              agent={selected.agent}
              onPick={(p) => setSelected({ kind: 'project', id: selected.id, ...p })}
              onBack={() => setSelected({ kind: 'nav', id: 'projects' })}
              initialTab={startHere ? startTab : undefined}
              initialBranch={startHere ? startBranch : undefined}
            />
          )}
          {picked.kind === 'run' && !pickedRun && (
            <div role="status" className="flex h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
              {!runs && <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />}
              {runs ? `No session ${picked.id}.` : 'Reading the sessions…'}
            </div>
          )}
          {page === 'compute' && <ComputePage platform={startPlatform} onPart={openPart} />}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  )
}
