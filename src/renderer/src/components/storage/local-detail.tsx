// Local SQLite, the one storage LayerFS has today: the home's numbers, free
// disk as gauges, the LayerFS box (the worker) that opens every Store, the
// "local only" note and every project in the home.
import { CloudOff, Link2, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

import { LfsWorker } from '@/components/lfs-icons'
import { Chip, type Tone } from '@/components/storage/chips'
import { DatabaseIcon, Tile } from '@/components/storage/icons'
import { DiskGauge, LOW_DISK, Stat } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { ProjectsTable } from '@/components/storage/projects-table'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { when } from '@/data/format'
import { cn } from '@/lib/utils'
import type { HostStatus, ProjectSummary } from '@shared/host-api'

import '@/components/storage/storage.css'

export const NOT_YET = 'Not available yet: LayerFS has no remotes (#446)'

const i = (n: number) => ({ '--i': n }) as CSSProperties

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
export function WorkerSection({ status, index = 0 }: { status: HostStatus; index?: number }) {
  const w = status.worker
  const chip = workerChip(status)
  const up = chip.live === true
  return (
    <section className="surface reveal rounded-xl" style={i(index)}>
      <header className="flex items-start gap-3 px-5 pt-4">
        <span className="relative">
          <Tile className={cn(up && 'text-primary')}>
            <LfsWorker className="size-5" />
          </Tile>
          {up && <span aria-hidden="true" className="pulse-ring absolute -top-0.5 -right-0.5 size-2 rounded-full bg-success text-success" />}
        </span>
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
          <Fact label="State">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn('size-1.5 rounded-full', up ? 'bg-success' : w.error ? 'bg-destructive' : 'bg-warning')} />
              {w.state}
            </span>
          </Fact>
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
  const ready = projects.filter((p) => p.initialized).length
  const chip = workerChip(status)
  const lowDisk = (n: number | null) => n !== null && n < LOW_DISK

  return (
    <div className="flex flex-col gap-5">
      <header className="reveal flex items-start gap-4">
        <span className="relative">
          <span aria-hidden="true" className="bg-brand absolute -inset-3 rounded-full opacity-20 blur-xl dark:opacity-25" />
          <DatabaseIcon kind="sqlite" size="lg" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">Local storage</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-xl font-semibold tracking-[-0.01em]">{project ? `${project.name}’s Store` : 'Local SQLite'}</h2>
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
        <section className="surface reveal rounded-xl" style={i(1)}>
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

      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Projects" value={projects.length} hint={ready === projects.length ? 'all initialized' : `${ready} initialized`} index={1} />
        <Stat label="Store volumes" value={volumes} hint="one Docker volume each" index={2} />
        <Stat label="Volume prefix" index={3} hint="names every container and volume">
          <span className="font-mono text-lg">{status.settings.containerPrefix}</span>
        </Stat>
      </dl>

      <section className="surface reveal rounded-xl px-5 py-4" style={i(4)}>
        <header className="mb-3 flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">Disk</h3>
          <span className="text-xs text-faint">free space where the Stores are written</span>
        </header>
        <dl className="grid grid-cols-2 gap-8">
          <DiskGauge label="Beside the home" free={status.disk.home} index={5} />
          <DiskGauge label="For Docker volumes" free={status.disk.volumes} unknown="Docker is not answering" index={6} />
        </dl>
      </section>

      <WorkerSection status={status} index={6} />

      <section className="sc-soon reveal rounded-xl" style={i(7)}>
        <header className="flex items-center gap-3 px-5 py-4">
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

      <div className="reveal [&>section]:shadow-[var(--highlight),var(--elev-1)]" style={i(8)}>
        <ProjectsTable projects={projects} title={project ? 'All projects in this home' : 'Projects'} current={project?.name} onOpenRun={onOpenRun} />
      </div>
    </div>
  )
}
