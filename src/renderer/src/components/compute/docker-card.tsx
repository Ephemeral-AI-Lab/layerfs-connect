import { Check, Info, TriangleAlert, Unplug } from 'lucide-react'

import { type SandboxGroup, SandboxList } from '@/components/compute/sandbox-list'
import { DefaultChip, TargetHeader, TargetIcon } from '@/components/compute/target-parts'
import { LfsSandbox } from '@/components/lfs-icons'
import { Loading } from '@/components/projects/states'
import { Chip } from '@/components/storage/chips'
import { workerChip } from '@/components/storage/local-detail'
import { STORAGE_FIT } from '@/data/compute'
import { bytes, shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'
import type { HostStatus } from '@shared/host-api'

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
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
  const { docker, worker, settings } = status
  const up = docker.level === 'ok'
  const all = groups?.flatMap((g) => g.sandboxes) ?? []
  const running = all.filter((s) => s.state === 'running')
  const mounted = all.reduce((n, s) => n + s.workspaces.length, 0)
  const chip = workerChip(status)
  const lowDisk = status.disk.volumes !== null && status.disk.volumes < 20e9

  return (
    <section className="rounded-xl border bg-card">
      <TargetHeader
        className="px-5 pt-5"
        icon={<TargetIcon id="docker" size="lg" />}
        title="Docker"
        subtitle={`Each run's Workspaces mount in Sandbox containers · ${STORAGE_FIT.docker}`}
        chips={
          <>
            <DefaultChip />
            {up ? (
              <Chip tone="success" icon={Check}>
                Engine {docker.version ?? 'running'}
              </Chip>
            ) : (
              <Chip tone="danger" icon={Unplug}>
                Not reachable
              </Chip>
            )}
          </>
        }
      />

      {!up && (
        <p className="mx-5 mt-4 flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {docker.error ?? `Docker answers ${docker.level}.`} Runs, Init and Sandboxes need Docker running.
        </p>
      )}

      <dl className="mx-5 mt-5 grid grid-cols-4 gap-4 border-t pt-4">
        <Stat label="Socket">
          <span className="font-mono text-[13px]" title={settings.docker}>
            {settings.docker}
          </span>
        </Stat>
        <Stat label={worker ? 'Worker' : 'Store access'}>
          {worker ? (
            <span className="flex min-w-0 items-center gap-1.5" title={worker.error ?? undefined}>
              <span className="truncate font-mono text-[13px]">{worker.name}</span>
              <Chip tone={chip.tone} live={chip.live} className="shrink-0">
                {worker.state}
              </Chip>
            </span>
          ) : (
            'In process'
          )}
        </Stat>
        <Stat label="Free for volumes">
          <span className={lowDisk ? 'text-warning' : undefined}>{bytes(status.disk.volumes)}</span>
        </Stat>
        <Stat label="Sandbox image">
          <span className="font-mono text-[13px]" title={settings.image ?? undefined}>
            {settings.image ? shortDigest(settings.image) : <span className="text-warning">not set</span>}
          </span>
        </Stat>
      </dl>
      {worker?.build && (
        <p className="mx-5 mt-3 truncate text-xs text-muted-foreground" title={worker.build}>
          Worker build <span className="font-mono">{worker.build}</span>
        </p>
      )}
      {worker?.error && (
        <p className="mx-5 mt-2 flex items-start gap-2 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {worker.error}
        </p>
      )}

      <div className="mt-5 border-t">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
          <h4 className="flex items-baseline gap-2 text-sm font-semibold">
            Sandboxes{' '}
            {groups && (
              <span className="text-xs font-normal text-faint">
                {running.length} running · {mounted} Workspace{mounted === 1 ? '' : 's'} mounted
              </span>
            )}
          </h4>
        </div>
        {failed.length > 0 && (
          <p className="flex items-center gap-2 px-5 pt-1 text-xs text-warning">
            <Info aria-hidden="true" className="size-3.5 shrink-0" />
            Could not read the Sandboxes of {failed.join(', ')}.
          </p>
        )}
        {!groups ? (
          <Loading label="Reading each project's Sandboxes" className="py-8" />
        ) : all.length === 0 ? (
          <p className="flex items-center gap-2 px-5 pt-2 pb-5 text-sm text-muted-foreground">
            <LfsSandbox className="size-4" />
            No Sandboxes. A run starts one when its first command mounts a Workspace.
          </p>
        ) : (
          <SandboxList groups={groups} />
        )}
      </div>

      {status.platform !== 'linux' && (
        <p className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          On this machine the LayerFS box (the worker) also runs in Docker, beside the Sandboxes.
        </p>
      )}
    </section>
  )
}
