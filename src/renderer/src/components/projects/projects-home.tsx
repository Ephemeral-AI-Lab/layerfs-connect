import { FolderPlus, GitBranch, Search } from 'lucide-react'
import { useState } from 'react'

import { AGENT_DOT } from '@/components/app-sidebar'
import { LayerfsMark } from '@/components/layerfs-mark'
import { Chip, StatusChip, databaseStatus } from '@/components/storage/chips'
import { DatabaseIcon } from '@/components/storage/icons'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { branchesFor } from '@/data/forks'
import { PROJECTS, type Project } from '@/data/sample'
import { type Database, type SyncLocation, databaseName } from '@/data/storage'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'active' | 'local' | 'postgres' | 'attention'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'local', label: 'Local SQLite' },
  { id: 'postgres', label: 'PostgreSQL' },
  { id: 'attention', label: 'Needs attention' },
]

interface ProjectsHomeProps {
  databases: Database[]
  locations: SyncLocation[]
  onOpen: (key: string) => void
}

export function ProjectsHome({ databases, locations, onOpen }: ProjectsHomeProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const dbOf = (p: Project) => databases.find((d) => d.id === p.database)
  const busy = (p: Project) => p.sessions.filter((s) => s.busy).length
  const needsAttention = (p: Project) => {
    const db = dbOf(p)
    return db ? ['warning', 'danger', 'info'].includes(databaseStatus(db).tone) : true
  }
  const matches = (p: Project) => {
    const db = dbOf(p)
    switch (filter) {
      case 'active':
        return busy(p) > 0
      case 'local':
        return db?.kind === 'sqlite'
      case 'postgres':
        return db?.kind === 'postgres'
      case 'attention':
        return needsAttention(p)
      default:
        return true
    }
  }
  // Busy projects first, then the rest as listed (most recent Commit first in the sample).
  const shown = PROJECTS.filter((p) => p.key.includes(query.trim().toLowerCase()) && matches(p)).sort(
    (a, b) => Number(busy(b) > 0) - Number(busy(a) > 0),
  )
  const inFlight = PROJECTS.reduce((n, p) => n + busy(p), 0)

  return (
    <div className="h-svh overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 pt-7 pb-10">
        <header className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {PROJECTS.length} projects · {inFlight} calls in flight across{' '}
              {PROJECTS.filter((p) => busy(p) > 0).length} of them
            </p>
          </div>
          <Unavailable reason="Init needs the LayerFS host process">
            <Button disabled>
              <FolderPlus /> New project
            </Button>
          </Unavailable>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
            <Input
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <div role="radiogroup" aria-label="Filter" className="flex gap-1 rounded-lg bg-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  filter === f.id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            No projects match. Try another filter or search.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
            {shown.map((p) => {
              const db = dbOf(p)
              const location = db?.kind === 'sqlite' ? locations.find((l) => l.id === db.sync?.location) : undefined
              const calls = busy(p)
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onOpen(p.key)}
                  className="group flex flex-col gap-4 rounded-xl border bg-card p-5 text-left outline-none transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-3">
                    <LayerfsMark className="size-8 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold group-hover:underline">{p.key}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.lastCommit.id} · {p.lastCommit.ago}
                      </div>
                    </div>
                    {calls > 0 && (
                      <Chip tone="info" live>
                        {calls} in flight
                      </Chip>
                    )}
                  </div>

                  {db && (
                    <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-2.5 py-2">
                      <DatabaseIcon db={db} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {db.kind === 'postgres' ? (db.label ?? databaseName(db)) : db.file}
                        </div>
                        <div className="truncate text-xs text-faint">
                          {db.kind === 'postgres' ? 'PostgreSQL · live' : location ? `Synced with ${location.name}` : 'Local only'}
                        </div>
                      </div>
                      <StatusChip status={databaseStatus(db)} compact />
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="flex gap-1">
                        {p.sessions.map((s) => (
                          <span
                            key={s.id}
                            aria-hidden="true"
                            className={cn('size-2 rounded-full', s.busy ? AGENT_DOT[s.agent] : 'bg-idle')}
                          />
                        ))}
                      </span>
                      {p.sessions.length} session{p.sessions.length === 1 ? '' : 's'}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <GitBranch aria-hidden="true" className="size-3.5" />
                        {branchesFor(p).length}
                      </span>
                      <span className="tabular-nums">{p.size}</span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
