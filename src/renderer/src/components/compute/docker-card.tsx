import { Box, Check, Info, Trash2 } from 'lucide-react'

import { SandboxList } from '@/components/compute/sandbox-list'

import { DefaultChip, TargetHeader, TargetIcon, TargetSwitch } from '@/components/compute/target-parts'
import { Chip } from '@/components/storage/chips'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { type DockerInfo, LEFTOVERS, STORAGE_FIT, type SandboxRow } from '@/data/compute'
import { cn } from '@/lib/utils'

interface DockerCardProps {
  docker: DockerInfo
  sandboxes: SandboxRow[]
  enabled: boolean
  isDefault: boolean
  locked?: string
  onToggle: (on: boolean) => void
  /** macOS and Windows run the LayerFS box in Docker whatever this switch says. */
  boxNeedsDocker: boolean
  onOpenSession: (id: string) => void
  /** Dev aid: open the unmount question. */
  unmountOnOpen?: boolean
}

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  )
}

export function DockerCard({
  docker,
  sandboxes,
  enabled,
  isDefault,
  locked,
  onToggle,
  boxNeedsDocker,
  onOpenSession,
  unmountOnOpen,
}: DockerCardProps) {
  const running = sandboxes.filter((s) => s.running)
  const lowDisk = docker.diskFreeRatio < 0.2

  return (
    <section className="rounded-xl border bg-card">
      <TargetHeader
        className="px-5 pt-5"
        icon={<TargetIcon id="docker" size="lg" />}
        title="Docker"
        subtitle={`Each session runs in a Sandbox container · ${STORAGE_FIT.docker}`}
        chips={
          <>
            {isDefault && <DefaultChip />}
            <Chip tone="success" icon={Check}>
              {docker.engine} {docker.version}
            </Chip>
          </>
        }
        control={<TargetSwitch id="docker" checked={enabled} onChange={onToggle} locked={locked} />}
      />

      <dl className="mx-5 mt-5 grid grid-cols-4 gap-4 border-t pt-4">
        <Stat label="Context">
          <span className="font-mono text-[13px]">{docker.context}</span>
        </Stat>
        <Stat label="Limits">
          {docker.cpus} CPUs · {docker.memory}
        </Stat>
        <Stat label="Disk free">
          <span className={lowDisk ? 'text-warning' : undefined}>
            {docker.diskFree} of {docker.diskTotal}
          </span>
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
            <span
              className={cn('block h-full rounded-full', lowDisk ? 'bg-warning' : 'bg-success')}
              style={{ width: `${Math.round(docker.diskFreeRatio * 100)}%` }}
            />
          </span>
        </Stat>
        <Stat label="Image">
          <span className="font-mono text-[13px]">{docker.image}</span>
        </Stat>
      </dl>

      <div className="mt-5 border-t">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
          <h4 className="flex items-baseline gap-2 text-sm font-semibold">
            Sandboxes{' '}
            <span className="text-xs font-normal text-faint">
              {running.length} running · {sandboxes.reduce((n, s) => n + s.workspaces.length, 0)} Workspaces
            </span>
          </h4>
          {LEFTOVERS.count > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {LEFTOVERS.count} stopped hold {LEFTOVERS.size}
              <Unavailable reason="Needs the LayerFS host process">
                <Button variant="outline" size="sm" disabled>
                  <Trash2 /> Clean up
                </Button>
              </Unavailable>
            </div>
          )}
        </div>
        {sandboxes.length === 0 ? (
          <p className="flex items-center gap-2 px-5 pt-2 pb-5 text-sm text-muted-foreground">
            <Box aria-hidden="true" className="size-4 text-faint" />
            No Sandboxes. One starts when a session runs its first command.
          </p>
        ) : (
          <SandboxList sandboxes={sandboxes} onOpenSession={onOpenSession} unmountOnOpen={unmountOnOpen} />
        )}
      </div>

      {boxNeedsDocker && (
        <p className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <Info aria-hidden="true" className="size-3.5 shrink-0" />
          On this machine the LayerFS box also runs in Docker, so Docker stays installed even with this switch off.
        </p>
      )}
    </section>
  )
}
