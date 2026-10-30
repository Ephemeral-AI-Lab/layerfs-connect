// What a failed or refused job says, by the runtime's error code
// (storage-redesign §5.5). Known codes get a title, a plain body and the next
// step; anything else shows the message as it came.
import { ArrowDownToLine, ArrowUpFromLine, HardDrive, RefreshCw, TriangleAlert } from 'lucide-react'

import { targetName, useNow } from '@/components/storage/transfers/phases'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SyncJob } from '@shared/host-api'

export interface RefusalActions {
  onPullFirst?: () => void
  onPushAnyway?: () => void
  onPullAgain?: () => void
  onCheck?: () => void
  onMachine?: () => void
}

/** The box lets go of an open Store about a minute after its last use. */
const LET_GO_MS = 60_000

const is = (code: string, ...names: string[]) => names.some((n) => n.toLowerCase() === code.toLowerCase())

export function refusalText(job: SyncJob): { title: string; body: string; tip?: string } {
  const code = job.error?.code ?? ''
  const message = job.error?.message ?? 'It failed without a message.'
  const where = targetName(job)
  if (is(code, 'Conflict') && job.kind === 'push')
    return {
      title: `Push refused: ${where} changed`,
      body: `The linked file in ${where} changed since this machine last pushed or pulled. Pull it first to keep its changes, or overwrite it.`,
      tip: 'The check runs before the upload; a push from another machine in between is not caught.',
    }
  if (is(code, 'Busy') || (job.kind === 'pull' && /open|busy|in use/i.test(message) && !code))
    return { title: `${job.kind === 'pull' ? 'Pull' : 'It was'} refused: ${job.store} is open`, body: 'A Sandbox, a Workspace or the LayerFS box holds it. The box lets go about a minute after its last use.' }
  if (is(code, 'Capacity')) return { title: 'Not enough space', body: `${message} A push stages a copy beside the Store, so it needs about the Store’s size free in the Docker volumes.` }
  if (is(code, 'Unknown', 'Uncertain'))
    return { title: 'Outcome unknown', body: `The connection dropped after sending. The remote file may or may not have changed. Check it before ${job.kind === 'push' ? 'pushing' : 'trying'} again.` }
  if (is(code, 'Unavailable')) return { title: `Couldn’t reach ${where}`, body: `${message}. Nothing was sent.` }
  if (is(code, 'Integrity')) return { title: 'The file didn’t verify', body: `The downloaded file didn’t match its sha256. Nothing was replaced. ${message}` }
  if (is(code, 'Exists')) return { title: 'That file exists', body: `${message} Pick another file name.` }
  if (is(code, 'Linked')) return { title: 'Already linked', body: message }
  if (is(code, 'NotLinked')) return { title: 'Not linked', body: `${message} Publish the Store first.` }
  if (is(code, 'Unsupported')) return { title: 'Not in this LayerFS build', body: message }
  return { title: `${job.kind[0].toUpperCase()}${job.kind.slice(1)} failed`, body: message }
}

/** A failed job's block: what happened in words, and the buttons that move on from it. */
export function RefusalCard({ job, actions = {}, className }: { job: SyncJob; actions?: RefusalActions; className?: string }) {
  const code = job.error?.code ?? ''
  const t = refusalText(job)
  const busy = is(code, 'Busy') || t.title.includes('is open')
  const now = useNow(busy && job.ended !== null && Date.now() - job.ended < LET_GO_MS)
  const wait = busy && job.ended !== null ? Math.max(0, Math.ceil((job.ended + LET_GO_MS - now) / 1000)) : 0
  const title = (
    <p className="flex items-center gap-1.5 text-[13px] font-medium text-destructive">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {t.title}
    </p>
  )
  return (
    <div role="alert" className={cn('rounded-lg border border-destructive/25 bg-destructive/[0.04] px-3.5 py-3', className)}>
      {t.tip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{title}</span>
          </TooltipTrigger>
          <TooltipContent>{t.tip}</TooltipContent>
        </Tooltip>
      ) : (
        title
      )}
      <p className="mt-1 text-[12.5px] break-words text-muted-foreground">{t.body}</p>
      <div className="mt-2.5 flex flex-wrap gap-2 empty:hidden">
        {is(code, 'Conflict') && job.kind === 'push' && (
          <>
            {actions.onPullFirst && (
              <Button size="sm" variant="outline" onClick={actions.onPullFirst}>
                <ArrowDownToLine /> Pull first…
              </Button>
            )}
            {actions.onPushAnyway && (
              <Button size="sm" variant="destructive" onClick={actions.onPushAnyway}>
                <ArrowUpFromLine /> Overwrite…
              </Button>
            )}
          </>
        )}
        {busy && actions.onPullAgain && (
          <Button size="sm" variant="outline" disabled={wait > 0} onClick={actions.onPullAgain}>
            <ArrowDownToLine /> {wait > 0 ? `Pull again in ${wait} s` : 'Pull again'}
          </Button>
        )}
        {is(code, 'Capacity') && actions.onMachine && (
          <Button size="sm" variant="outline" onClick={actions.onMachine}>
            <HardDrive /> This machine
          </Button>
        )}
        {is(code, 'Unknown', 'Uncertain', 'Unavailable') && actions.onCheck && (
          <Button size="sm" variant="outline" onClick={actions.onCheck}>
            <RefreshCw /> Check now
          </Button>
        )}
      </div>
    </div>
  )
}
