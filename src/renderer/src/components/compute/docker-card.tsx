import { t, useI18n } from '@/i18n'
// Docker, the compute LayerFS has today: the engine and the worker, free
// space for volumes, the Sandbox image, how full the open Sandboxes are,
// and every project's Sandboxes. A reachable engine's icon pulses.
import { Check, Info, TriangleAlert, Unplug } from 'lucide-react'
import type { CSSProperties } from 'react'

import { type SandboxGroup, SANDBOX_CAPACITY, SandboxList } from '@/components/compute/sandbox-list'
import { DefaultChip, TargetHeader, TargetIcon } from '@/components/compute/target-parts'
import { LfsSandbox } from '@/components/lfs-icons'
import { CountUp, spotlight } from '@/components/motion'
import { CountBytes } from '@/components/projects/store-visuals'
import { Loading } from '@/components/projects/states'
import { Chip } from '@/components/storage/chips'
import { workerChip } from '@/components/storage/local-detail'
import { Bar, LOW_DISK } from '@/components/storage/meters'
import { shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'
import type { HostStatus } from '@shared/host-api'

import '@/components/storage/storage.css'

function Stat({ label, children, className, index = 0 }: { label: string; children: React.ReactNode; className?: string; index?: number }) {
  useI18n()
  return (
    <div className={cn('reveal min-w-0', className)} style={{ '--i': index } as CSSProperties}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 truncate text-sm">{children}</dd>
    </div>
  )
}

/** A big counted number with its label, for the Sandboxes' summary. */
function Count({ value, label, brand }: { value: number; label: string; brand?: boolean }) {
  useI18n()
  return (
    <span className="flex items-baseline gap-1.5">
      <CountUp value={value} className={cn('text-lg leading-6 font-semibold', brand && value > 0 && 'text-brand')} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}

interface DockerCardProps {
  status: HostStatus
  /** Sandboxes by project; undefined while they are read. */
  groups?: SandboxGroup[]
  /** Projects whose Sandboxes could not be read. */
  failed: string[]
}

export function DockerCard({ status, groups, failed }: DockerCardProps) {
  useI18n()
  const { docker, worker, settings } = status
  const up = docker.level === 'ok'
  const all = groups?.flatMap((g) => g.sandboxes) ?? []
  const running = all.filter((s) => s.state === 'running')
  const open = all.filter((s) => s.state !== 'gone')
  const mounted = all.reduce((n, s) => n + s.workspaces.length, 0)
  const room = open.length * SANDBOX_CAPACITY
  const chip = workerChip(status)
  const lowDisk = status.disk.volumes !== null && status.disk.volumes < LOW_DISK

  return (
    <section
      onPointerMove={spotlight}
      className="@container/docker-card glass-liquid card-hover sheen-sweep spotlight reveal-scale min-w-0 overflow-hidden rounded-2xl"
    >
      <TargetHeader
        className="px-5 pt-5"
        icon={
          <span className="relative">
            {up && <span aria-hidden="true" className="absolute -inset-2 rounded-2xl bg-[#1D63ED] opacity-15 blur-lg dark:opacity-10" />}
            <TargetIcon id="docker" size="lg" />
            {up && <span aria-hidden="true" className="pulse-ring absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-success text-success ring-2 ring-card" />}
          </span>
        }
        title={t("Docker")}
        subtitle={t("Sandbox container runtime · Local SQLite")}
        chips={
          <>
            <DefaultChip />
            {up ? (
              <Chip tone="success" icon={Check}>{t("Engine ")}{docker.version ?? t('running')}
              </Chip>
            ) : (
              <Chip tone="danger" icon={Unplug}>{t("Not reachable")}</Chip>
            )}
          </>
        }
      />

      {!up && (
        <p className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/15 ring-inset">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {docker.error ?? t('Docker answers {level}.', { level: docker.level })}{t("Runs, Init and Sandboxes need Docker running.")}</p>
      )}

      <dl className="mx-5 mt-5 grid grid-cols-1 gap-4 border-t pt-4 @min-[24rem]/docker-card:grid-cols-2 @min-[50rem]/docker-card:grid-cols-4">
        <Stat label={t("Socket")} index={1}>
          <span className="font-mono text-[13px]" title={settings.docker}>
            {settings.docker}
          </span>
        </Stat>
        <Stat label={worker ? t("Worker") : t("Store access")} index={2}>
          {worker ? (
            <span className="flex min-w-0 items-center gap-1.5" title={worker.error ?? undefined}>
              <span className="truncate text-[13px]">{worker.name}</span>
              <Chip tone={chip.tone} live={chip.live} className="shrink-0">
                {t(worker.state)}
              </Chip>
            </span>
          ) : (
            t('In process')
          )}
        </Stat>
        <Stat label={t("Free for volumes")} index={3}>
          <span className={cn('font-medium', lowDisk && 'text-warning')}>
            <CountBytes value={status.disk.volumes} />
          </span>
          {lowDisk && <span className="ml-1.5 text-xs text-warning">{t("Low space")}</span>}
        </Stat>
        <Stat label={t("Sandbox image")} index={4}>
          <span className="font-mono text-[13px]" title={settings.image ?? undefined}>
            {settings.image ? shortDigest(settings.image) : <span className="text-warning">{t("not set")}</span>}
          </span>
        </Stat>
      </dl>
      {worker?.build && (
        <p className="mx-5 mt-3 truncate text-xs text-muted-foreground" title={worker.build}>{t("Worker build ")}<span className="font-mono">{worker.build}</span>
        </p>
      )}
      {worker?.error && (
        <p className="mx-5 mt-2 flex items-start gap-2 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {worker.error}
        </p>
      )}

      <div className="mt-5 border-t bg-muted/20">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 pt-4 pb-2">
          <h4 className="text-sm font-semibold">{t("Sandboxes")}</h4>
          {groups && (
            <>
              <Count value={running.length} label={t("running")} brand />
              <Count value={mounted} label={t(mounted === 1 ? "Workspace mounted" : "Workspaces mounted")} />
              {room > 0 && (
                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground tabular-nums" title={t("Workspaces mounted against the room in the open Sandboxes")}>
                  <Bar share={mounted / room} live={running.length > 0} wait={300} className="w-28" />
                  {mounted} / {room}{t("slots")}</span>
              )}
            </>
          )}
        </div>
        {failed.length > 0 && (
          <p className="flex items-center gap-2 px-5 pt-1 text-xs text-warning">
            <Info aria-hidden="true" className="size-3.5 shrink-0" />{t("Could not read the Sandboxes of ")}{failed.join(', ')}.
          </p>
        )}
        {!groups ? (
          <Loading label={t("Reading each project's Sandboxes")} className="py-8" />
        ) : all.length === 0 ? (
          <div className="mx-5 mt-1 mb-5 flex items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-xs text-muted-foreground">
            <span className="surface drift flex size-8 items-center justify-center rounded-lg text-faint">
              <LfsSandbox className="size-4" />
            </span>{t("No active sandboxes")}</div>
        ) : (
          <SandboxList groups={groups} />
        )}
      </div>
    </section>
  )
}
