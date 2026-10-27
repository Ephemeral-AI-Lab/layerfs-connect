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
// "#projects", "#projects/<demo>[/<tab>][/<branch>]" (tabs: conversation, trace,
// work, history, runs, script; the old live, files, blame, map, replay, storage
// and sandboxes map onto them) or "#runs/<run id>[/<tab>|/<agent>]".
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['projects', 'storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const [startProject, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startBranch = startBranchParts?.join('/') || undefined
const [startRun, startRunPart] = startPage === 'runs' ? startRest : []
/** Tab names a hash may carry; anything else after a run id is an agent. */
const TAB_NAMES = ['conversation', 'trace', 'work', 'history', 'runs', 'script']

function opening(): Selection {
  if (startRun) return { kind: 'run', id: startRun }
  if (startProject) return { kind: 'project', id: startProject }
  const page = START_PAGES.find((p) => p === startPage)
  return { kind: 'nav', id: page ?? 'projects' }
}

export function App() {
  const [selected, setSelected] = useState<Selection>(opening)

  const page = selected.kind === 'nav' ? selected.id : undefined
  const openProject = (demo: string) => setSelected({ kind: 'project', id: demo })

  // A run opens on its demo's page; its demo comes with the selection or from the runs.
  const { runs } = useRuns()
  const runId = selected.kind === 'run' ? selected.id : undefined
  const runDemo = selected.kind === 'run' ? (selected.demo ?? runs?.find((r) => r.id === selected.id)?.demo) : undefined
  const demo = selected.kind === 'project' ? selected.id : runDemo
  const openRun = (id: string) => setSelected({ kind: 'run', id, demo: runs?.find((r) => r.id === id)?.demo ?? demo })
  const startHere = (startProject && startProject === demo) || (startRun && startRun === runId)
  const hashTab = startRun ? (startRunPart && TAB_NAMES.includes(startRunPart) ? startRunPart : undefined) : startTab

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar selected={selected} onSelect={setSelected} />
        <main className="min-w-0 flex-1 bg-background">
          {page === 'storage' && <StoragePage initialId={startId} onOpenRun={openRun} />}
          {page === 'projects' && <ProjectsHome onOpenProject={openProject} onOpenRun={openRun} />}
          {demo && (
            <ProjectView
              key={demo}
              demo={demo}
              runId={runId}
              onOpenRun={openRun}
              onBack={() => setSelected({ kind: 'nav', id: 'projects' })}
              initialTab={startHere ? hashTab : undefined}
              initialBranch={startHere ? startBranch : undefined}
              initialAgent={startHere && startRun && startRunPart && !TAB_NAMES.includes(startRunPart) ? startRunPart : undefined}
            />
          )}
          {selected.kind === 'run' && !demo && (
            <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
              {runs ? `No run ${selected.id}.` : 'Reading the runs…'}
            </div>
          )}
          {page === 'compute' && <ComputePage platform={startPlatform} />}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  )
}
