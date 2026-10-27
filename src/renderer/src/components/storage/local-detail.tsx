import { CloudOff, Link2, TriangleAlert } from 'lucide-react'

import { LfsWorker } from '@/components/lfs-icons'
import { Chip, type Tone } from '@/components/storage/chips'
import { DatabaseIcon, Tile } from '@/components/storage/icons'
import { Notice } from '@/components/storage/notice'
import { ProjectsTable } from '@/components/storage/projects-table'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { bytes, when } from '@/data/format'
import type { HostStatus, ProjectSummary } from '@shared/host-api'

export const NOT_YET = 'Not available yet: LayerFS has no remotes (#446)'

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={mono ? 'mt-0.5 truncate font-mono text-[13px]' : 'mt-0.5 truncate text-sm'}>{children}</dd>
    </div>
  )
}

/** The worker's state as a chip; Linux has none: Store calls run in the host's own process. */
export function workerChip(status: HostStatus): { tone: Tone; live?: boolean; label: string } {
  const w = status.worker
  if (!w) return { tone: 'success', label: 'In process' }
  if (w.error) return { tone: 'danger', label: w.state === 'running' ? 'Worker unhealthy' : 'Worker down' }
  if (w.state === 'running') return { tone: 'success', live: true, label: 'Worker running' }
  if (w.state === 'starting') return { tone: 'info', label: 'Worker starting' }
  return { tone: 'warning', label: `Worker ${w.state}` }
}

/** The LayerFS box: the worker container that opens every Store on macOS and Windows. */
export function WorkerSection({ status }: { status: HostStatus }) {
  const w = status.worker
  const chip = workerChip(status)
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-start gap-3 px-5 pt-4">
        <Tile>
          <LfsWorker className="size-5" />
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{w ? 'LayerFS box' : 'Store access'}</h3>
            <Chip tone={chip.tone} live={chip.live}>
              {chip.label}
            </Chip>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {w
              ? 'A Linux container that opens each Store file directly and answers Connect’s Store calls on loopback.'
              : 'On Linux, Connect opens each Store file in its own process.'}
          </p>
        </div>
      </header>
      {w && (
        <dl className="mx-5 mt-4 mb-4 grid grid-cols-3 gap-4 border-t pt-4">
          <Fact label="Container" mono>
            {w.name}
          </Fact>
          <Fact label="State">{w.state}</Fact>
          <Fact label="Build" mono>
            <span title={w.build ?? undefined}>{w.build ?? 'unknown'}</span>
          </Fact>
        </dl>
      )}
      {w?.error && (
        <p className="flex items-start gap-2 border-t px-5 py-3 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {w.error}
        </p>
      )}
      {!w && <div className="pb-4" />}
    </section>
  )
}

interface LocalDetailProps {
  status: HostStatus
  projects: ProjectSummary[]
  /** One project's Storage tab: its own Store first. */
  project?: ProjectSummary
  onOpenRun?: (runId: string) => void
}

/** Local SQLite: Connect's LayerFS home, each project's Store in its own Docker volume. */
export function LocalDetail({ status, projects, project, onOpenRun }: LocalDetailProps) {
  const volumes = projects.filter((p) => p.volume).length
  const chip = workerChip(status)
  const lowDisk = (n: number | null) => n !== null && n < 20e9

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start gap-4">
        <DatabaseIcon kind="sqlite" size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-xl font-semibold tracking-[-0.01em]">
              {project ? `${project.name}’s Store` : 'Local SQLite'}
            </h2>
            <Chip tone={chip.tone} live={chip.live}>
              {chip.label}
            </Chip>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project
              ? `One SQLite Store file in the Docker volume ${project.volume ?? '(none)'}`
              : `SQLite · ${projects.length === 1 ? '1 project' : `${projects.length} projects`} · ${volumes} Store volume${volumes === 1 ? '' : 's'}`}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-faint" title={status.settings.home}>
            {status.settings.home}
          </p>
        </div>
      </header>

      {(lowDisk(status.disk.home) || lowDisk(status.disk.volumes)) && (
        <Notice tone="warning" icon={TriangleAlert} title="Disk space is low">
          Init and Commits write into the Store volumes; a full disk fails them.
        </Notice>
      )}

      {project && (
        <section className="rounded-xl border bg-card">
          <header className="px-5 pt-4">
            <h3 className="text-sm font-semibold">This project</h3>
          </header>
          <dl className="mx-5 mt-3 mb-4 grid grid-cols-3 gap-4">
            <Fact label="Store volume" mono>
              {project.volume ?? 'none'}
            </Fact>
            <Fact label="Initialized from" mono>
              <span title={project.source ?? undefined}>{project.source ?? 'unknown'}</span>
            </Fact>
            <Fact label="Created">{when(project.created)}</Fact>
          </dl>
        </section>
      )}

      <section className="rounded-xl border bg-card">
        <header className="px-5 pt-4">
          <h3 className="text-sm font-semibold">Disk</h3>
        </header>
        <dl className="mx-5 mt-3 mb-4 grid grid-cols-3 gap-4">
          <Fact label="Free beside the home">
            <span className={lowDisk(status.disk.home) ? 'text-warning' : undefined}>{bytes(status.disk.home)}</span>
          </Fact>
          <Fact label="Free for Docker volumes">
            <span className={lowDisk(status.disk.volumes) ? 'text-warning' : undefined}>
              {status.disk.volumes === null ? 'Docker is not answering' : bytes(status.disk.volumes)}
            </span>
          </Fact>
          <Fact label="Volume prefix" mono>
            {status.settings.containerPrefix}
          </Fact>
        </dl>
      </section>

      <WorkerSection status={status} />

      <section className="rounded-xl border bg-card">
        <header className="flex items-center gap-3 px-5 pt-4 pb-4">
          <span className="flex size-9 items-center justify-center rounded-lg border border-dashed text-faint">
            <CloudOff aria-hidden="true" className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Local only</p>
            <p className="text-xs text-muted-foreground">
              {project ? 'This Store has' : 'These Stores have'} no copy anywhere else. Sync locations are not available yet.
            </p>
          </div>
          <Unavailable reason={NOT_YET}>
            <Button variant="outline" size="sm" disabled>
              <Link2 /> Sync with…
            </Button>
          </Unavailable>
        </header>
      </section>

      <ProjectsTable
        projects={projects}
        title={project ? 'All projects in this home' : 'Projects'}
        current={project?.name}
        onOpenRun={onOpenRun}
      />
    </div>
  )
}
