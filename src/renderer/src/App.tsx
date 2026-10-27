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
// "#projects", "#projects/<demo>[/<tab>][/<branch>]" (tabs: live, conversation,
// trace, work, history, replays, script; the old runs, files, blame, map,
// replay, storage and sandboxes map onto them),
// "#sessions/<demo>/<agent>" (a session of the newest replay) or
// "#runs/<run id>[/<tab>|/<agent>]" (a replay, earlier ones too).
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['projects', 'storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const [startProject, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startBranch = startBranchParts?.join('/') || undefined
const [startRun, startRunPart] = startPage === 'runs' ? startRest : []
const [sessionDemo, sessionAgent] = startPage === 'sessions' ? startRest : []
/** Tab names a hash may carry; anything else after a run id is an agent. */
const TAB_NAMES = ['live', 'conversation', 'trace', 'work', 'history', 'runs', 'replays', 'script'] // trace and work: old names
const runTab = startRunPart && TAB_NAMES.includes(startRunPart) ? startRunPart : undefined

/** A selection before the runs are read: a hash's run names no demo yet. */
type Opening = Selection | { kind: 'run'; id: string; agent?: string }

function opening(): Opening {
  if (startRun) return { kind: 'run', id: startRun, agent: runTab ? undefined : startRunPart }
  if (sessionDemo) return { kind: 'project', id: sessionDemo, agent: sessionAgent }
  if (startProject) return { kind: 'project', id: startProject }
  const page = START_PAGES.find((p) => p === startPage)
  return { kind: 'nav', id: page ?? 'projects' }
}

export function App() {
  const [picked, setSelected] = useState<Opening>(opening)
  const { runs } = useRuns()

  // A replay opens on its demo's page; its demo comes from the runs.
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
  const startHere =
    (startProject && selected.kind === 'project' && startProject === selected.id) ||
    (startRun && selected.kind === 'project' && selected.run === startRun)

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
              initialTab={startHere ? (startRun ? runTab : startTab) : undefined}
              initialBranch={startHere ? startBranch : undefined}
            />
          )}
          {picked.kind === 'run' && !pickedRun && (
            <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
              {runs ? `No replay ${picked.id}.` : 'Reading the replays…'}
            </div>
          )}
          {page === 'compute' && <ComputePage platform={startPlatform} />}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  )
}
