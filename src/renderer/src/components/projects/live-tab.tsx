import { Info, Pause, Play } from 'lucide-react'
import { useMemo, useState } from 'react'

import { FlowGraph } from '@/components/projects/flow-graph'
import { useWorkflow } from '@/components/projects/use-workflow'
import { Button } from '@/components/ui/button'
import { computesFor } from '@/data/flow'
import type { Project } from '@/data/sample'
import { type Database, type SyncLocation, databaseName } from '@/data/storage'

interface LiveTabProps {
  project: Project
  db?: Database
  location?: SyncLocation
  /** The session open in the sidebar, marked "This session". */
  currentSession?: string
  onOpenSession: (id: string) => void
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

/** Agents, the project and its database, and the computes, with each call animated. */
export function LiveTab({ project, db, location, currentSession, onOpenSession }: LiveTabProps) {
  const [running, setRunning] = useState(true)
  const computes = useMemo(() => computesFor(project, db), [project, db])
  const startToPush = db?.kind === 'sqlite' && db.sync?.status.state === 'ahead' ? db.sync.status.commits : 0
  const state = useWorkflow(project, computes, db?.kind === 'sqlite' && db.sync !== undefined, startToPush, running)

  const live = Object.values(state.sessions)
  const mounted = live.filter((l) => l.phase !== 'idle').length
  const inFlight = live.filter((l) => l.phase === 'exec' || l.phase === 'commit').length

  const where =
    db?.kind === 'postgres'
      ? `PostgreSQL, live in ${db.label ?? databaseName(db)}`
      : db
        ? `Local SQLite, ${db.file}${location ? ` synced with ${location.name}` : ' on this machine'}`
        : 'No database'
  const sentence =
    db?.kind === 'postgres'
      ? `Each mount, on any of ${computes.length} computes, starts from the live head; each Commit lands in the database at once.`
      : location
        ? `Each mount starts from ${db?.kind === 'sqlite' ? db.file : 'the file'}'s head on this machine; Commits wait here until you push them to ${location.name}.`
        : 'Each mount starts from the head on this machine; nothing leaves it, because the database is local only.'

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border bg-card/60">
        <header className="flex items-center gap-4 border-b px-6 py-3.5">
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {where} · {project.sessions.length} session{project.sessions.length === 1 ? '' : 's'} · {inFlight} call
            {inFlight === 1 ? '' : 's'} in flight
          </p>
          <Button variant="ghost" size="sm" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause /> : <Play />} {running ? 'Pause' : 'Play'}
          </Button>
        </header>

        <div className="px-6 py-8">
          <FlowGraph
            project={project}
            db={db}
            computes={computes}
            state={state}
            currentSession={currentSession}
            onOpenSession={onOpenSession}
          />
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-6 border-t px-6 py-5">
          <p className="max-w-sm text-sm text-muted-foreground">{sentence}</p>
          <div className="ml-auto flex gap-7">
            <Stat value={mounted} label="Workspaces mounted" />
            <Stat value={inFlight} label="calls in flight" />
            <Stat value={state.head} label="Commits" />
            <Stat value={state.toPush} label="to push" />
          </div>
        </footer>
      </section>
      <p className="flex items-center gap-2 text-xs text-faint">
        <Info aria-hidden="true" className="size-3.5" />
        Sample run. Each call mounts a Workspace from the head, runs, commits and unmounts; the host process will report
        the real ones.
      </p>
    </div>
  )
}
