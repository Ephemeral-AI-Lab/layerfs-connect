// What a failed or refused job says, by the runtime's error code
// (storage-redesign §5.5). Known codes get a title, a plain body and the next
// step; anything else shows the message as it came.
import { ArrowDownToLine, ArrowUpFromLine, HardDrive, RefreshCw, TriangleAlert } from 'lucide-react'

import { targetName, useNow } from '@/components/storage/transfers/phases'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t, useI18n } from '@/i18n'
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

export function refusalText(job: SyncJob): { title: string; body: string; tip?: string; busy?: boolean } {
  const code = job.error?.code ?? ''
  const message = job.error?.message ?? t('It failed without a message.')
  const where = targetName(job)
  if (is(code, 'Conflict') && job.kind === 'push')
    return {
      title: t('Push refused: {where} changed', { where }),
      body: t('The linked file in {where} changed since this machine last pushed or pulled. Pull it first to keep its changes, or overwrite it.', { where }),
      tip: t('The check runs before the upload; a push from another machine in between is not caught.'),
    }
  if (is(code, 'Busy') || (job.kind === 'pull' && /open|busy|in use/i.test(message) && !code))
    return {
      title: t(job.kind === 'pull' ? 'Pull refused: {store} is open' : 'Refused: {store} is open', { store: job.store }),
      body: t('A Sandbox, a Workspace or the LayerFS box holds it. The box lets go about a minute after its last use.'),
      busy: true,
    }
  if (is(code, 'Capacity')) return { title: t('Not enough space'), body: `${message} ${t('A push stages a copy beside the Store, so it needs about the Store’s size free in the Docker volumes.')}` }
  if (is(code, 'Unknown', 'Uncertain'))
    return { title: t('Outcome unknown'), body: t('The connection dropped after sending. The remote file may or may not have changed. Check it before trying again.') }
  if (is(code, 'Unavailable')) return { title: t('Couldn’t reach {where}', { where }), body: `${message}. ${t('Nothing was sent.')}` }
  if (is(code, 'Integrity')) return { title: t('The file didn’t verify'), body: `${t('The downloaded file didn’t match its sha256. Nothing was replaced.')} ${message}` }
  if (is(code, 'Exists')) return { title: t('That file exists'), body: `${message} ${t('Pick another file name.')}` }
  if (is(code, 'Linked')) return { title: t('Already linked'), body: message }
  if (is(code, 'NotLinked')) return { title: t('Not linked'), body: `${message} ${t('Publish the Store first.')}` }
  if (is(code, 'Unsupported')) return { title: t('Not in this LayerFS build'), body: message }
  return { title: t('{verb} failed', { verb: t(`${job.kind[0].toUpperCase()}${job.kind.slice(1)}`) }), body: message }
}

/** A failed job's block: what happened in words, and the buttons that move on from it. */
export function RefusalCard({ job, actions = {}, className }: { job: SyncJob; actions?: RefusalActions; className?: string }) {
  useI18n()
  const code = job.error?.code ?? ''
  const text = refusalText(job)
  const busy = !!text.busy
  const now = useNow(busy && job.ended !== null && Date.now() - job.ended < LET_GO_MS)
  const wait = busy && job.ended !== null ? Math.max(0, Math.ceil((job.ended + LET_GO_MS - now) / 1000)) : 0
  const title = (
    <p className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-destructive">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {text.title}
    </p>
  )
  return (
    <div role="alert" className={cn('rounded-xl border border-destructive/25 bg-linear-to-r from-destructive/[0.07] to-destructive/[0.02] px-3.5 py-3', className)}>
      {text.tip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{title}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{text.tip}</TooltipContent>
        </Tooltip>
      ) : (
        title
      )}
      <p className="mt-1 text-xs leading-relaxed break-words text-muted-foreground">{text.body}</p>
      <div className="mt-2.5 flex flex-wrap gap-2 empty:hidden">
        {is(code, 'Conflict') && job.kind === 'push' && (
          <>
            {actions.onPullFirst && (
              <Button size="sm" variant="outline" className="rounded-xl" onClick={actions.onPullFirst}>
                <ArrowDownToLine /> {t('Pull first…')}
              </Button>
            )}
            {actions.onPushAnyway && (
              <Button size="sm" variant="destructive" className="rounded-xl" onClick={actions.onPushAnyway}>
                <ArrowUpFromLine /> {t('Overwrite…')}
              </Button>
            )}
          </>
        )}
        {busy && actions.onPullAgain && (
          <Button size="sm" variant="outline" className="rounded-xl" disabled={wait > 0} onClick={actions.onPullAgain}>
            <ArrowDownToLine /> {wait > 0 ? t('Pull again in {n} s', { n: wait }) : t('Pull again')}
          </Button>
        )}
        {is(code, 'Capacity') && actions.onMachine && (
          <Button size="sm" variant="outline" className="rounded-xl" onClick={actions.onMachine}>
            <HardDrive /> {t('This machine')}
          </Button>
        )}
        {is(code, 'Unknown', 'Uncertain', 'Unavailable') && actions.onCheck && (
          <Button size="sm" variant="outline" className="rounded-xl" onClick={actions.onCheck}>
            <RefreshCw /> {t('Check now')}
          </Button>
        )}
      </div>
    </div>
  )
}
