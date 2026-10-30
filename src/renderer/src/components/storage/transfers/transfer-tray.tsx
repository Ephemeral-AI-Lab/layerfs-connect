// The transfer tray (storage-redesign §3.1 region 3): every running job, then
// the ones that ended in the last ten minutes, newest first. A failed job
// stays until dismissed. Hide folds it into the summary strip's cell.
import { ChevronUp } from 'lucide-react'

import { TransferRow } from '@/components/storage/transfers/transfer-row'
import type { RefusalActions } from '@/components/storage/transfers/refusal'
import { isFailed, isRunning, useNow } from '@/components/storage/transfers/phases'
import { dismissJob, type Transfers } from '@/components/storage/transfers/use-transfers'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SyncJob } from '@shared/host-api'

interface TransferTrayProps {
  transfers: Transfers
  onHide: () => void
  /** The refusal block's buttons for a job. */
  actionsFor: (job: SyncJob) => RefusalActions
}

export function TransferTray({ transfers, onHide, actionsFor }: TransferTrayProps) {
  // ended rows age out of the tray on their own
  useNow(transfers.shown.some((j) => !isRunning(j)), 30_000)
  const jobs = transfers.shown
  if (!jobs.length) return null
  const running = jobs.filter(isRunning).length
  return (
    <section aria-label="Transfers" className="surface reveal @container/tray overflow-hidden rounded-xl">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {running > 0 && <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />}
          Transfers
        </h2>
        <span className="text-xs text-faint">{running ? `${running} running` : 'None running'}</span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={onHide}>
          <ChevronUp /> Hide
        </Button>
      </header>
      <ul className="divide-y">
        {jobs.map((job) => (
          <li key={job.id} className={cn('relative px-4 py-2.5', isRunning(job) && 'sc-live-row', isFailed(job) && 'bg-destructive/[0.025]')}>
            <TransferRow job={job} form={isFailed(job) ? 'card' : 'row'} actions={actionsFor(job)} onDismiss={isRunning(job) ? undefined : () => dismissJob(job.id)} />
          </li>
        ))}
      </ul>
    </section>
  )
}
