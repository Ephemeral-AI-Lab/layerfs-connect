import { useState } from 'react'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ComputePage } from '@/components/compute/compute-page'
import { ProjectView } from '@/components/projects/project-view'
import { ProjectsHome } from '@/components/projects/projects-home'
import { RunView } from '@/components/runs/run-view'
import { StoragePage } from '@/components/storage/storage-page'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

// Dev aid: a hash from CONNECT_VIEW picks the first page and its state:
// "#storage/<database>", "#storage/add/<choice>[/<provider>]",
// "#compute/<linux|win32|darwin>",
// "#projects", "#projects/<demo>[/<tab>|/blame|/map|/replay][/<branch>]" or
// "#runs/<run id>[/trace|/<agent>:<step index>]".
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['projects', 'storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const [startProject, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startBranch = startBranchParts?.join('/') || undefined
const [startRun, startRunTab] = startPage === 'runs' ? startRest : []

function opening(): Selection {
  if (startRun) return { kind: 'run', id: startRun }
  if (startProject) return { kind: 'project', id: startProject }
  const page = START_PAGES.find((p) => p === startPage)
  return { kind: 'nav', id: page ?? 'projects' }
}

export function App() {
  const [selected, setSelected] = useState<Selection>(opening)

  const page = selected.kind === 'nav' ? selected.id : undefined
  const openRun = (id: string) => setSelected({ kind: 'run', id })
  const openProject = (demo: string) => setSelected({ kind: 'project', id: demo })

  const projectKey = selected.kind === 'project' ? selected.id : undefined

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar selected={selected} onSelect={setSelected} />
        <main className="min-w-0 flex-1 bg-background">
          {page === 'storage' && <StoragePage initialId={startId} onOpenRun={openRun} />}
          {page === 'projects' && <ProjectsHome onOpenProject={openProject} onOpenRun={openRun} />}
          {projectKey && (
            <ProjectView
              key={projectKey}
              demo={projectKey}
              onOpenRun={openRun}
              onBack={() => setSelected({ kind: 'nav', id: 'projects' })}
              initialTab={startProject === projectKey ? startTab : undefined}
              initialBranch={startProject === projectKey ? startBranch : undefined}
            />
          )}
          {selected.kind === 'run' && (
            <RunView
              key={selected.id}
              runId={selected.id}
              onOpenProject={openProject}
              initialTab={startRun === selected.id && startRunTab === 'trace' ? 'trace' : undefined}
              initialStep={startRun === selected.id && startRunTab?.includes(':') ? startRunTab : undefined}
            />
          )}
          {page === 'compute' && <ComputePage platform={startPlatform} />}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  )
}
