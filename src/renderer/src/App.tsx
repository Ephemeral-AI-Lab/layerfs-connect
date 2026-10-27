import { useState } from 'react'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ComputePage } from '@/components/compute/compute-page'
import { type ProjectTab, ProjectView } from '@/components/projects/project-view'
import { ProjectsHome } from '@/components/projects/projects-home'
import { StoragePage } from '@/components/storage/storage-page'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { COMPUTE_SETTINGS, type ComputeSettings } from '@/data/compute'
import { PROJECTS } from '@/data/sample'
import { DATABASES, type Database, SYNC_LOCATIONS, type SyncLocation } from '@/data/storage'

// Dev aid: a hash from CONNECT_VIEW picks the first page and its state:
// "#storage/<database>", "#storage/add/<choice>[/<provider>]",
// "#compute/<linux|win32|darwin>", "#compute/stop", "#compute/unmount",
// "#projects" or "#projects/<project>[/<tab>|/blame|/map|/replay][/<branch>]".
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['projects', 'storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const askOnOpen = startPage === 'compute' && startId === 'stop'
const unmountOnOpen = startPage === 'compute' && startId === 'unmount'
const [startProject, startTab, ...startBranchParts] = startPage === 'projects' ? startRest : []
const startBranch = startBranchParts?.join('/') || undefined

function opening(): Selection {
  if (startProject && PROJECTS.some((p) => p.key === startProject)) return { kind: 'project', id: startProject }
  const page = START_PAGES.find((p) => p === startPage)
  return { kind: 'nav', id: page ?? 'sessions' }
}

export function App() {
  const [selected, setSelected] = useState<Selection>(opening)
  const [compute, setCompute] = useState<ComputeSettings>(
    // The stop question needs Docker off the default first.
    askOnOpen ? { ...COMPUTE_SETTINGS, defaultTarget: 'modal' } : COMPUTE_SETTINGS,
  )
  const [databases, setDatabases] = useState<Database[]>(DATABASES)
  const [locations, setLocations] = useState<SyncLocation[]>(SYNC_LOCATIONS)

  const page = selected.kind === 'nav' ? selected.id : undefined
  const openSession = (id: string) => setSelected({ kind: 'session', id })
  const setAutoPush = (id: string, on: boolean) =>
    setDatabases((all) =>
      all.map((d) => (d.id === id && d.kind === 'sqlite' && d.sync ? { ...d, sync: { ...d.sync, autoPush: on } } : d)),
    )

  // A project page for a picked project, or for the project of the open
  // session (until a session page exists).
  const projectKey =
    selected.kind === 'project'
      ? selected.id
      : selected.kind === 'session'
        ? PROJECTS.find((p) => p.sessions.some((s) => s.id === selected.id))?.key
        : undefined

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          selected={selected}
          onSelect={setSelected}
          storageCount={databases.length}
          computeCount={Object.values(compute.enabled).filter(Boolean).length}
        />
        <main className="min-w-0 flex-1 bg-background">
          {/* Other pages stay empty for now. */}
          {page === 'storage' && (
            <StoragePage
              databases={databases}
              locations={locations}
              initialId={startId}
              onAdd={({ database, location }) => {
                if (location) setLocations((all) => [...all, location])
                setDatabases((all) => [...all, database])
              }}
              onAutoPushChange={setAutoPush}
            />
          )}
          {page === 'projects' && (
            <ProjectsHome
              databases={databases}
              locations={locations}
              onOpen={(key) => setSelected({ kind: 'project', id: key })}
            />
          )}
          {projectKey && (
            <ProjectView
              projectKey={projectKey}
              databases={databases}
              locations={locations}
              currentSession={selected.kind === 'session' ? selected.id : undefined}
              onOpenSession={openSession}
              onBack={() => setSelected({ kind: 'nav', id: 'projects' })}
              onAutoPushChange={setAutoPush}
              initialTab={startTab as ProjectTab | 'blame' | 'map' | 'replay' | undefined}
              initialBranch={startBranch}
            />
          )}
          {page === 'compute' && (
            <ComputePage
              settings={compute}
              onChange={setCompute}
              platform={startPlatform}
              arch={window.connect.arch}
              askOnOpen={askOnOpen}
              unmountOnOpen={unmountOnOpen}
              onOpenSession={openSession}
            />
          )}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  )
}
