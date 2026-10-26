import { useState } from 'react'

import { AppSidebar, type NavId, type Selection } from '@/components/app-sidebar'
import { ComputePage } from '@/components/compute/compute-page'
import { StoragePage } from '@/components/storage/storage-page'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { COMPUTE_SETTINGS, type ComputeSettings } from '@/data/compute'
import { DATABASES, type Database, SYNC_LOCATIONS, type SyncLocation } from '@/data/storage'

// Dev aid: a hash from CONNECT_VIEW picks the first page and its state:
// "#storage/<database>", "#storage/add/<choice>[/<provider>]",
// "#compute/<linux|win32|darwin>", "#compute/stop" or "#compute/unmount".
const [startPage, ...startRest] = window.location.hash.slice(1).split('/')
const startId = startRest.join('/') || undefined
const START_PAGES: NavId[] = ['storage', 'compute']
const startPlatform = ['linux', 'win32', 'darwin'].find((p) => p === startId) ?? window.connect.platform
const askOnOpen = startPage === 'compute' && startId === 'stop'
const unmountOnOpen = startPage === 'compute' && startId === 'unmount'

export function App() {
  const [selected, setSelected] = useState<Selection>(
    START_PAGES.find((p) => p === startPage)
      ? { kind: 'nav', id: startPage as NavId }
      : { kind: 'nav', id: 'sessions' },
  )
  const [compute, setCompute] = useState<ComputeSettings>(
    // The stop question needs Docker off the default first.
    askOnOpen ? { ...COMPUTE_SETTINGS, defaultTarget: 'modal' } : COMPUTE_SETTINGS,
  )
  const [databases, setDatabases] = useState<Database[]>(DATABASES)
  const [locations, setLocations] = useState<SyncLocation[]>(SYNC_LOCATIONS)

  const page = selected.kind === 'nav' ? selected.id : undefined
  const onStorage = page === 'storage'

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
          {onStorage && (
            <StoragePage
              databases={databases}
              locations={locations}
              initialId={startId}
              onAdd={({ database, location }) => {
                if (location) setLocations((all) => [...all, location])
                setDatabases((all) => [...all, database])
              }}
              onAutoPushChange={(id, on) =>
                setDatabases((all) =>
                  all.map((d) => (d.id === id && d.kind === 'sqlite' && d.sync ? { ...d, sync: { ...d.sync, autoPush: on } } : d)),
                )
              }
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
              onOpenSession={(id) => setSelected({ kind: 'session', id })}
            />
          )}
        </main>
      </SidebarProvider>
    </TooltipProvider>
  )
}
