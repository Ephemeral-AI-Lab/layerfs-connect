import { HardDrive, Info, Plus } from 'lucide-react'
import { useState } from 'react'

import { type AddChoice, AddStorageDialog, type Added } from '@/components/storage/add-storage-dialog'
import { Dot, StatusChip, databaseStatus } from '@/components/storage/chips'
import { DatabaseIcon, ProviderIcon, Tile } from '@/components/storage/icons'
import { LocalDetail } from '@/components/storage/local-detail'
import { PROVIDERS } from '@/components/storage/provider-form'
import { PostgresDetail } from '@/components/storage/postgres-detail'
import { Button } from '@/components/ui/button'
import { PROJECTS } from '@/data/sample'
import { type Database, LOCAL_STORAGE, type SyncLocation, databaseName } from '@/data/storage'
import { cn } from '@/lib/utils'

interface StoragePageProps {
  databases: Database[]
  locations: SyncLocation[]
  onAdd: (added: Added) => void
  onAutoPushChange: (id: string, on: boolean) => void
  /** Dev aid: a database id, or 'add/<choice>[/<provider>]' to open the dialog. */
  initialId?: string
}

const projectsOf = (id: string) => PROJECTS.filter((p) => p.database === id)

const CHOICES: AddChoice[] = ['new', 'pull', 'postgres']

export function StoragePage({ databases, locations, onAdd, onAutoPushChange, initialId }: StoragePageProps) {
  const opening = initialId?.startsWith('add') ? CHOICES.find((c) => c === initialId.split('/')[1]) ?? 'new' : undefined
  const [selectedId, setSelectedId] = useState(opening ? databases[0]?.id : (initialId ?? databases[0]?.id))
  const [adding, setAdding] = useState(opening !== undefined)
  const selected = databases.find((d) => d.id === selectedId) ?? databases[0]
  const locationOf = (id?: string) => locations.find((l) => l.id === id)

  const groups = [
    { label: 'Local storage', note: LOCAL_STORAGE, mono: true, items: databases.filter((d) => d.kind === 'sqlite') },
    { label: 'Remote storage', note: 'PostgreSQL, always live', mono: false, items: databases.filter((d) => d.kind === 'postgres') },
  ]

  return (
    <div className="flex h-svh flex-col">
      <header className="flex items-center justify-between gap-4 px-8 pt-7 pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">Storage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Databases that hold your projects' history. Each holds any number of projects.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus /> Add storage
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 px-8">
        <nav aria-label="Databases" className="w-72 shrink-0 overflow-y-auto pb-8">
          {groups.map((group) => (
            <div key={group.label} className="mb-6">
              <div className="mb-2 px-2">
                <h2 className="text-[13px] font-semibold">{group.label}</h2>
                <p className={cn('truncate text-faint', group.mono ? 'font-mono text-[11px]' : 'text-xs')}>{group.note}</p>
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((db) => {
                  const count = projectsOf(db.id).length
                  const active = db.id === selected?.id
                  const status = databaseStatus(db)
                  const location = db.kind === 'sqlite' ? locationOf(db.sync?.location) : undefined
                  // The list flags only states that need a hand; the rest show in the detail.
                  const flag = db.kind === 'sqlite' && db.sync && db.sync.status.state !== 'in-sync'
                  return (
                    <li key={db.id}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => setSelectedId(db.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active ? 'bg-card shadow-xs ring-1 ring-border' : 'hover:bg-foreground/[0.04]',
                        )}
                      >
                        {/* The row icon says where a database lives or syncs. */}
                        {db.kind === 'postgres' ? (
                          <DatabaseIcon db={db} size="sm" />
                        ) : location ? (
                          <ProviderIcon provider={location.provider} size="sm" />
                        ) : (
                          <Tile size="sm">
                            <HardDrive aria-hidden="true" />
                          </Tile>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{databaseName(db)}</span>
                          <span className="flex items-center gap-1 truncate text-xs text-faint">
                            {count === 1 ? '1 project' : `${count} projects`}
                            {location && <span className="truncate">· {location.name}</span>}
                            {db.kind === 'sqlite' && !db.sync && <span>· local only</span>}
                          </span>
                        </span>
                        {flag && <StatusChip status={status} compact />}
                        {db.kind === 'postgres' && <Dot tone={status.tone} label={status.label} />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto pb-8">
          {selected?.kind === 'sqlite' && (
            <LocalDetail
              key={selected.id}
              db={selected}
              location={locationOf(selected.sync?.location)}
              projects={projectsOf(selected.id)}
              onAutoPushChange={(on) => onAutoPushChange(selected.id, on)}
            />
          )}
          {selected?.kind === 'postgres' && (
            <PostgresDetail key={selected.id} db={selected} projects={projectsOf(selected.id)} />
          )}
          <p className="mt-5 flex items-center gap-2 text-xs text-faint">
            <Info aria-hidden="true" className="size-3.5" />
            Sample data. Pull, push and PostgreSQL wait on LayerFS remotes (#446, A4–A9).
          </p>
        </div>
      </div>

      <AddStorageDialog
        open={adding}
        onOpenChange={setAdding}
        locations={locations}
        takenFiles={databases.flatMap((d) => (d.kind === 'sqlite' ? [d.file] : []))}
        initialChoice={opening}
        initialProvider={PROVIDERS.find((p) => p === initialId?.split('/')[2])}
        onAdd={(added) => {
          onAdd(added)
          setSelectedId(added.database.id)
          setAdding(false)
        }}
      />
    </div>
  )
}
