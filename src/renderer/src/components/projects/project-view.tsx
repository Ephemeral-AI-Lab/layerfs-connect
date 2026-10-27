import { Activity, Box, ChevronLeft, Database as DatabaseGlyph, FileCode2, History } from 'lucide-react'
import { useState } from 'react'

import { SandboxList } from '@/components/compute/sandbox-list'
import { LayerfsMark } from '@/components/layerfs-mark'
import { FilesTab } from '@/components/projects/files-tab'
import { HistoryTab } from '@/components/projects/history-tab'
import { LiveTab } from '@/components/projects/live-tab'
import { StatusChip, databaseStatus } from '@/components/storage/chips'
import { LocalDetail } from '@/components/storage/local-detail'
import { PostgresDetail } from '@/components/storage/postgres-detail'
import { SANDBOXES } from '@/data/compute'
import { PROJECTS } from '@/data/sample'
import { type Database, type SyncLocation, databaseName } from '@/data/storage'
import { cn } from '@/lib/utils'

export type ProjectTab = 'live' | 'files' | 'history' | 'storage' | 'sandboxes'

interface ProjectViewProps {
  projectKey: string
  databases: Database[]
  locations: SyncLocation[]
  /** The session open in the sidebar; opening one shows the Live tab. */
  currentSession?: string
  onOpenSession: (id: string) => void
  onBack: () => void
  onAutoPushChange: (databaseId: string, on: boolean) => void
  /** Dev aid: the tab to open on; 'blame' opens Files in Blame, 'map' History's Map. */
  initialTab?: ProjectTab | 'blame' | 'map' | 'replay'
  /** Dev aid: the Branch History focuses first. */
  initialBranch?: string
}

export function ProjectView({
  projectKey,
  databases,
  locations,
  currentSession,
  onOpenSession,
  onBack,
  onAutoPushChange,
  initialTab,
  initialBranch,
}: ProjectViewProps) {
  const project = PROJECTS.find((p) => p.key === projectKey) ?? PROJECTS[0]
  const busy = project.sessions.some((s) => s.busy)
  // Live first when something is happening, Files otherwise.
  const opening = (): ProjectTab =>
    initialTab === 'blame' ? 'files' : initialTab === 'map' || initialTab === 'replay' ? 'history' : (initialTab ?? (busy || currentSession ? 'live' : 'files'))
  const [tab, setTab] = useState<ProjectTab>(opening)

  // A different project or session starts from its own opening tab.
  const [seen, setSeen] = useState(`${projectKey}|${currentSession}`)
  if (seen !== `${projectKey}|${currentSession}`) {
    setSeen(`${projectKey}|${currentSession}`)
    setTab(currentSession ? 'live' : busy ? 'live' : 'files')
  }

  const db = databases.find((d) => d.id === project.database)
  const location = db?.kind === 'sqlite' ? locations.find((l) => l.id === db.sync?.location) : undefined
  const sandboxes = SANDBOXES.filter((s) => s.project === project.key)
  const inDb = PROJECTS.filter((p) => p.database === project.database)

  const TABS: { id: ProjectTab; label: string; icon: typeof Activity; count?: number }[] = [
    { id: 'live', label: 'Live', icon: Activity },
    { id: 'files', label: 'Files', icon: FileCode2 },
    { id: 'history', label: 'History', icon: History },
    { id: 'storage', label: 'Storage', icon: DatabaseGlyph },
    { id: 'sandboxes', label: 'Sandboxes', icon: Box, count: sandboxes.length },
  ]

  return (
    <div className="h-svh overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-8 pt-5 pb-8">
        <header className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 flex w-fit items-center gap-1 rounded text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" /> Projects
          </button>
          <div className="flex items-center gap-3">
            <LayerfsMark className="size-8" />
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">{project.key}</h1>
            {db && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {db.kind === 'postgres' ? (db.label ?? databaseName(db)) : db.file}
                <StatusChip status={databaseStatus(db)} />
              </span>
            )}
          </div>
        </header>

        <nav aria-label="Project" className="-mb-1 flex gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={t.id === tab ? 'page' : undefined}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 pt-1 pb-2.5 text-sm font-medium outline-none transition-colors focus-visible:text-foreground',
                t.id === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="size-4" />
              {t.label}
              {t.count !== undefined && <span className="text-xs font-normal text-faint">{t.count}</span>}
            </button>
          ))}
        </nav>

        {tab === 'live' && (
          <LiveTab project={project} db={db} location={location} currentSession={currentSession} onOpenSession={onOpenSession} />
        )}
        {tab === 'files' && <FilesTab key={project.key} project={project} initialMode={initialTab === 'blame' ? 'blame' : 'file'} />}
        {tab === 'history' && (
          <HistoryTab
            key={`${project.key}|${currentSession}`}
            project={project}
            currentSession={currentSession}
            initialBranch={initialBranch}
            initialView={initialTab === 'map' || initialTab === 'replay' ? 'map' : 'lineage'}
            autoplay={initialTab === 'replay'}
          />
        )}
        {tab === 'storage' &&
          (db?.kind === 'sqlite' ? (
            <LocalDetail
              db={db}
              location={location}
              projects={inDb}
              onAutoPushChange={(on) => onAutoPushChange(db.id, on)}
            />
          ) : db?.kind === 'postgres' ? (
            <PostgresDetail db={db} projects={inDb} />
          ) : (
            <p className="text-sm text-muted-foreground">This project has no database.</p>
          ))}
        {tab === 'sandboxes' &&
          (sandboxes.length > 0 ? (
            <section className="rounded-xl border bg-card">
              <header className="border-b px-5 pt-4 pb-3">
                <h3 className="text-sm font-semibold">Sandboxes for {project.key}</h3>
                <p className="text-xs text-muted-foreground">On Docker, this machine. Each opens to its mounted Workspaces.</p>
              </header>
              <SandboxList sandboxes={sandboxes} onOpenSession={onOpenSession} showProject={false} />
            </section>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
              <Box aria-hidden="true" className="size-6 text-faint" />
              <p className="text-sm font-medium">No Sandboxes running for {project.key}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                One starts when a session runs its first command, and closes itself two minutes after its last
                Workspace unmounts.
              </p>
            </div>
          ))}
      </div>
    </div>
  )
}
