// The transfer tray (storage-redesign §3.1 region 3): every running job, then
// the ones that ended in the last ten minutes, newest first. A failed job
// stays until dismissed. Hide folds it into the summary strip's cell.
import { ChevronUp } from 'lucide-react'
import type { CSSProperties } from 'react'

import { spotlight } from '@/components/motion'
import type { RefusalActions } from '@/components/storage/transfers/refusal'
import { isFailed, isRunning, useNow } from '@/components/storage/transfers/phases'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { dismissJob, type Transfers } from '@/components/storage/transfers/use-transfers'
import { Button } from '@/components/ui/button'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SyncJob } from '@shared/host-api'

interface TransferTrayProps {
  transfers: Transfers
  onHide: () => void
  /** The refusal block's buttons for a job. */
  actionsFor: (job: SyncJob) => RefusalActions
  index?: number
}

export function TransferTray({ transfers, onHide, actionsFor, index = 0 }: TransferTrayProps) {
  useI18n()
  // ended rows age out of the tray on their own
  useNow(transfers.shown.some((j) => !isRunning(j)), 30_000)
  const jobs = transfers.shown
  if (!jobs.length) return null
  const running = jobs.filter(isRunning).length
  return (
    <section
      aria-label={t('Transfers')}
      onPointerMove={spotlight}
      className="@container/tray glass-liquid spotlight reveal overflow-hidden rounded-2xl shadow-xs"
      style={{ '--i': index } as CSSProperties}
    >
      <header className="flex items-center gap-2 border-b border-foreground/[0.06] px-5 py-2.5">
        <h2 className="flex items-center gap-2 text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
          {running > 0 && <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />}
          {t('Transfers')}
        </h2>
        <span className="text-xs text-muted-foreground">{running ? t('{n} running', { n: running }) : t('None running')}</span>
        <Button size="xs" variant="ghost" className="ml-auto rounded-lg" onClick={onHide}>
          <ChevronUp /> {t('Hide')}
        </Button>
      </header>
      <ul className="divide-y divide-foreground/[0.06]">
        {jobs.map((job) => (
          <li key={job.id} className={cn('relative px-5 py-3', isRunning(job) && 'sc-live-row', isFailed(job) && 'bg-destructive/[0.025]')}>
            <TransferRow job={job} form={isFailed(job) ? 'card' : 'row'} actions={actionsFor(job)} onDismiss={isRunning(job) ? undefined : () => dismissJob(job.id)} />
          </li>
        ))}
      </ul>
    </section>
  )
}
