// The LayerFS box (the worker container that opens every SQLite Store on
// macOS and Windows) as a chip and as a section. Compute's Docker card reads
// workerChip too (through local-detail.tsx).
import { TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

import { LfsWorker } from '@/components/lfs-icons'
import { spotlight } from '@/components/motion'
import { Chip, type Tone } from '@/components/storage/chips'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { HostStatus } from '@shared/host-api'

/** One labelled fact. */
export function Fact({ label, children, mono, title }: { label: string; children: React.ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{label}</dt>
      <dd title={title} className={cn('mt-1 truncate', mono ? 'font-mono text-[12.5px]' : 'text-sm font-medium')}>
        {children}
      </dd>
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
  return { tone: 'warning', label: t('Worker {state}', { state: t(w.state) }) }
}

/** The LayerFS box: the worker container that opens every Store on macOS and Windows. */
export function WorkerSection({ status, index = 0 }: { status: HostStatus; index?: number }) {
  useI18n()
  const w = status.worker
  const chip = workerChip(status)
  const up = chip.live === true
  return (
    <section
      onPointerMove={spotlight}
      className="@container/worker glass-liquid card-hover spotlight reveal min-w-0 rounded-2xl p-5 shadow-xs"
      style={{ '--i': index } as CSSProperties}
    >
      <header className="flex items-start gap-3.5">
        <span className="glass-strong flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 text-primary shadow-xs">
          <LfsWorker className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">{w ? t('LayerFS box') : t('Store access')}</h3>
            <Chip tone={chip.tone} live={chip.live}>
              {t(chip.label)}
            </Chip>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {w ? t('A Linux container that opens each Store file directly and answers Connect’s Store calls on loopback.') : t('On Linux, Connect opens each Store file in its own process.')}
          </p>
        </div>
      </header>
      {w && (
        <dl className="mt-4 grid grid-cols-1 gap-4 border-t border-foreground/[0.06] pt-4 @min-[32rem]/worker:grid-cols-3">
          <Fact label={t('Container')}>
            {w.name}
          </Fact>
          <Fact label={t('State')}>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn('size-2 rounded-full', up ? 'bg-success' : w.error ? 'bg-destructive' : 'bg-warning')} />
              {t(w.state)}
            </span>
          </Fact>
          <Fact label={t('Build')} mono title={w.build ?? undefined}>
            {w.build ?? t('unknown')}
          </Fact>
        </dl>
      )}
      {w?.error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{w.error}</span>
        </div>
      )}
    </section>
  )
}
