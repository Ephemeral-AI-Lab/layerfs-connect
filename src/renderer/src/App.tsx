import { useState } from 'react'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ComputePage } from '@/components/compute/compute-page'
import { ProjectView } from '@/components/projects/project-view'
import { ProjectsHome } from '@/components/projects/projects-home'
import { useRuns } from '@/components/runs/use-runs'
import { StoragePage } from '@/components/storage/storage-page'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

// Dev aid: a hash from CONNECT_VIEW picks the first page and its state:
// "#storage/<database>", "#storage/add/<choice>[/<provider>]",
// "#compute/<linux|win32|darwin>",
// "#projects", "#projects/<demo>[/<tab>][/<branch>]" (the project page; tabs:
// live, history, storage, sessions, script; older names map onto them) or
// "#runs/<run id>[/<agent>]" (a session: one replay's conversation).
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['projects', 'storage', 'compute']
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

export function App() {
  const [picked, setSelected] = useState<Opening>(opening)
  const { runs } = useRuns()

  // A session opens under its project; its demo comes from the runs.
  const pickedRun = picked.kind === 'run' ? runs?.find((r) => r.id === picked.id) : undefined
  const selected: Selection =
    picked.kind === 'run'
      ? pickedRun
        ? { kind: 'project', id: pickedRun.demo, run: picked.id, agent: picked.agent }
        : { kind: 'nav', id: 'projects' }
      : picked
  const page = picked.kind === 'nav' ? picked.id : undefined
  const openProject = (id: string) => setSelected({ kind: 'project', id })
  const openRun = (id: string) => {
    const r = runs?.find((x) => x.id === id)
    setSelected(r ? { kind: 'project', id: r.demo, run: id } : { kind: 'run', id })
  }
  const startHere = startProject && selected.kind === 'project' && startProject === selected.id && !selected.run

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar selected={selected} onSelect={setSelected} />
        <main className="min-w-0 flex-1 bg-background">
          {page === 'storage' && <StoragePage initialId={startId} onOpenRun={openRun} />}
          {page === 'projects' && <ProjectsHome onOpenProject={openProject} onOpenRun={openRun} />}
          {selected.kind === 'project' && (
            <ProjectView
              key={selected.id}
              demo={selected.id}
              runId={selected.run}
              agent={selected.agent}
              onPick={(p) => setSelected({ kind: 'project', id: selected.id, ...p })}
              onBack={() => setSelected({ kind: 'nav', id: 'projects' })}
              initialTab={startHere ? startTab : undefined}
              initialBranch={startHere ? startBranch : undefined}
            />
          )}
          {picked.kind === 'run' && !pickedRun && (
            <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
              {runs ? `No session ${picked.id}.` : 'Reading the sessions…'}
            </div>
          )}
          {page === 'compute' && <ComputePage platform={startPlatform} />}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  )
}
