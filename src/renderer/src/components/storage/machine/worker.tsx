// The LayerFS box (the worker container that opens every SQLite Store on
// macOS and Windows) as a chip and as a section. Moved from local-detail.tsx;
// Compute's Docker card reads workerChip too.
import { TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

import { LfsWorker } from '@/components/lfs-icons'
import { Chip, type Tone } from '@/components/storage/chips'
import { Tile } from '@/components/storage/icons'
import { cn } from '@/lib/utils'
import type { HostStatus } from '@shared/host-api'

const i = (n: number) => ({ '--i': n }) as CSSProperties

export function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
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
