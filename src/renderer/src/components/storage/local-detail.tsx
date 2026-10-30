import { t, useI18n } from '@/i18n'
// Local SQLite, the primary storage engine LayerFS uses today: the home's numbers, free
// disk as gauges, the LayerFS box (the worker) that opens every Store, and
// every project in the home.
import { Folder, HardDrive, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

import { LfsWorker } from '@/components/lfs-icons'
import { spotlight } from '@/components/motion'
import { Chip, type Tone } from '@/components/storage/chips'
import { DatabaseIcon } from '@/components/storage/icons'
import { DiskGauge, LOW_DISK, Stat } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { ProjectsTable } from '@/components/storage/projects-table'
import { when } from '@/data/format'
import { cn } from '@/lib/utils'
import type { HostStatus, ProjectSummary } from '@shared/host-api'

import '@/components/storage/storage.css'

export const NOT_YET = 'Planned for upcoming release'

const i = (n: number) => ({ '--i': n }) as CSSProperties

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  useI18n()
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
  return { tone: 'warning', label: t('Worker {state}', {state: t(w.state)}) }
}

/** The LayerFS box: the worker container that opens every Store on macOS and Windows. */
export function WorkerSection({ status, index = 0 }: { status: HostStatus; index?: number }) {
  useI18n()
  const w = status.worker
  const chip = workerChip(status)
  const up = chip.live === true
  return (
    <section onPointerMove={spotlight} className="@container/worker glass-liquid card-hover spotlight reveal min-w-0 rounded-2xl p-5 shadow-xs" style={i(index)}>
      <header className="flex items-start gap-3.5">
        <span className="glass-strong flex size-10 shrink-0 items-center justify-center rounded-xl text-primary border border-primary/20 shadow-xs">
          <LfsWorker className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">{w ? t("LayerFS Storage Worker") : t("Host Store Access")}</h3>
            <Chip tone={chip.tone} live={chip.live}>
              {t(chip.label)}
            </Chip>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {w
              ? t("Container daemon for SQLite stores on loopback.")
              : t("Host process direct store access.")}
          </p>
        </div>
      </header>
      {w && (
        <dl className="mt-4 grid grid-cols-1 gap-4 border-t pt-4 @min-[32rem]/worker:grid-cols-3">
          <Fact label={t("Container Name")} mono>
            {w.name}
          </Fact>
          <Fact label={t("Runtime State")}>
            <span className="flex items-center gap-1.5 font-medium">
              <span aria-hidden="true" className={cn('size-2 rounded-full', up ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : w.error ? 'bg-destructive' : 'bg-amber-500')} />
              {t(w.state)}
            </span>
          </Fact>
          <Fact label={t("Engine Build")} mono>
            <span title={w.build ?? undefined}>{w.build ?? t('unknown')}</span>
          </Fact>
        </dl>
      )}
      {w?.error && (
        <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3 text-xs text-destructive flex items-start gap-2.5">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{t("Worker offline:")}</span> {w.error}.
          </div>
        </div>
      )}
    </section>
  )
}

interface LocalDetailProps {
  status: HostStatus
  projects: ProjectSummary[]
  /** One project's Storage tab: its own Store first. */
  project?: ProjectSummary
  onOpenProject?: (project: string) => void
}

/** Local SQLite: Connect's LayerFS home, each project's Store in its own Docker volume. */
export function LocalDetail({ status, projects, project, onOpenProject }: LocalDetailProps) {
  useI18n()
  const volumes = projects.filter((p) => p.volume).length
  const ready = projects.filter((p) => p.initialized).length
  const chip = workerChip(status)
  const lowDisk = (n: number | null) => n !== null && n < LOW_DISK

  return (
    <div className="@container/local-store flex min-w-0 flex-col gap-6">
      {/* Refined Header */}
      <header className="reveal flex items-start gap-4">
        <div className="glass-liquid flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/50 shadow-xs">
          <DatabaseIcon kind="sqlite" size="md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-wider uppercase text-muted-foreground/80">
            <span>{t("Primary Engine")}</span>
            <span>·</span>
            <span>{t("SQLite Embedded Store")}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {project ? t("{value1}’s Store", {value1: project.name}) : t("Local SQLite Storage")}
            </h2>
            <Chip tone={chip.tone} live={chip.live}>
              {t(chip.label)}
            </Chip>
          </div>
          <p className="mt-1 text-xs text-muted-foreground font-medium">
            {project
              ? t("Store file in volume {value1}", {value1: project.volume ?? '(none)'})
              : t(volumes === 1 ? "Embedded storage across {count} dedicated volume" : "Embedded storage across {count} dedicated volumes", {count: volumes})}
          </p>
          <div className="mt-2.5 inline-flex max-w-full items-center gap-2 rounded-xl bg-muted/40 px-3 py-1 text-xs text-muted-foreground ring-1 ring-border/50">
            <Folder className="size-3.5 text-faint shrink-0" />
            <span className="font-mono truncate" title={status.settings.home}>
              {status.settings.home}
            </span>
          </div>
        </div>
      </header>

      {/* Low disk warning */}
      {(lowDisk(status.disk.home) || lowDisk(status.disk.volumes)) && (
        <Notice tone="warning" icon={TriangleAlert} title={t("Host disk space low")}>{t("Low host space may cause Store write operations to fail.")}</Notice>
      )}

      {project && (
        <section onPointerMove={spotlight} className="glass-liquid spotlight reveal rounded-2xl p-5 shadow-xs" style={i(1)}>
          <header className="mb-3">
            <h3 className="text-sm font-semibold">{t("Project Metadata")}</h3>
          </header>
          <dl className="grid grid-cols-1 gap-4 border-t pt-4 @min-[34rem]/local-store:grid-cols-3">
            <Fact label={t("Store Volume")} mono>
              {project.volume ?? t('none')}
            </Fact>
            <Fact label={t("Initialized From")} mono>
              <span title={project.source ?? undefined}>{project.source ?? t('unknown')}</span>
            </Fact>
            <Fact label={t("Created")}>{when(project.created)}</Fact>
          </dl>
        </section>
      )}

      {/* Top 3 Stat Strip */}
      <div className="grid grid-cols-1 gap-3.5 @min-[34rem]/local-store:grid-cols-3">
        <Stat
          label={t("Total Projects")}
          value={projects.length}
          hint={ready === projects.length ? t('All initialized') : t('{count} initialized', {count: ready})}
          index={1}
        />
        <Stat
          label={t("Store Volumes")}
          value={volumes}
          hint={t("one per project")}
          index={2}
        />
        <Stat
          label={t("Volume Namespace")}
          index={3}
          hint={t("prefix")}
        >
          <span className="font-mono text-xl">{status.settings.containerPrefix}*</span>
        </Stat>
      </div>

      {/* Consolidated Disk Allocation Section */}
      <section onPointerMove={spotlight} className="glass-liquid card-hover spotlight reveal rounded-2xl p-5 shadow-xs" style={i(4)}>
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 border-b pb-3.5">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">{t("Disk Allocation & Health")}</h3>
          </div>
          <span className="text-xs text-muted-foreground font-medium">{t("Monitored storage partitions")}</span>
        </header>
        <dl className="grid grid-cols-1 gap-6 @min-[38rem]/local-store:grid-cols-2">
          <DiskGauge label={t("Local Host Filesystem")} free={status.disk.home} index={5} />
          <DiskGauge label={t("Docker Volume Partition")} free={status.disk.volumes} unknown="Docker daemon offline" index={6} />
        </dl>
      </section>

      {/* Worker Runtime Section */}
      <WorkerSection status={status} index={7} />

      {/* Projects Table */}
      <div className="reveal" style={i(8)}>
        <ProjectsTable
          projects={projects}
          title={project ? t("All projects in this home") : t("Projects on this Machine")}
          current={project?.name}
          onOpenProject={onOpenProject}
        />
      </div>
    </div>
  )
}
