// A Store's job on its page (storage-redesign §3.2 region 3): the running or
// last job in its full form, with the refusal block when it failed.
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import type { RefusalActions } from '@/components/storage/transfers/refusal'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { dismissJob } from '@/components/storage/transfers/use-transfers'
import { cn } from '@/lib/utils'
import type { SyncJob } from '@shared/host-api'

export function JobCard({ job, actions, className }: { job: SyncJob; actions?: RefusalActions; className?: string }) {
  const running = isRunning(job)
  return (
    <section aria-label="Transfer" className={cn('surface reveal @container/tray rounded-xl px-4 py-3.5', running && 'sc-live-row', isFailed(job) && 'border-destructive/30', className)}>
      <TransferRow job={job} form="card" actions={actions} onDismiss={running ? undefined : () => dismissJob(job.id)} />
    </section>
  )
}
