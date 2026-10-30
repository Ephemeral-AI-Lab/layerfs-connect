// Sync state as a pill (storage-redesign §4.7): an icon and words, never
// colour alone. SyncPill is a Store's state, which is its one link's
// (storage-links §4); the tooltip says why and how old the facts are.
import { Chip } from '@/components/storage/chips'
import { SYNC } from '@/components/storage/sync/sync-state'
import { compactLabel } from '@/components/storage/transfers/phases'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ago } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StoreLink, StoreSyncState, SyncJob } from '@shared/host-api'

const STALE_MS = 10 * 60_000

/** A link's tooltip lines: its state, why, and how old the facts are (§4.6). */
export function copyTip(copy: StoreLink): string {
  const meta = SYNC[copy.sync]
  const lines = [`${copy.remote} / ${copy.file}: ${t(meta.label)}`]
  if (copy.sync === 'unknown' && copy.lastKnown) {
    const failed = copy.failedCheck
    const head = failed ? t('{remote} didn’t answer {ago}', { remote: copy.remote, ago: ago(failed.at) }) : t('Not answering now')
    lines.push(`${head}; ${t('last known: {state}', { state: t(SYNC[copy.lastKnown].label) })}${copy.check ? `, ${ago(copy.check.at)}` : ''}`)
  } else if (copy.reason) lines.push(copy.reason)
  if (copy.check && copy.sync !== 'unknown' && Date.now() - copy.check.at > STALE_MS) lines.push(t('as of {ago}', { ago: ago(copy.check.at) }))
  return lines.join('\n')
}

interface SyncPillProps {
  state: StoreSyncState
  /** The Store's link: its reason and staleness in the tooltip. */
  copy?: StoreLink | null
  /** A running job on it: the pill reads "Uploading 41%". */
  job?: SyncJob | null
  /** Icon and short label (project cards, the New project dialog). */
  compact?: boolean
  className?: string
}

/** A state's icon and words; a dashed ring when it is not known now, with the last known state if there is one. */
export function SyncPill({ state, copy, job, compact, className }: SyncPillProps) {
  useI18n()
  const shown: StoreSyncState = state === 'unknown' && copy?.lastKnown ? copy.lastKnown : state
  const meta = SYNC[shown] ?? SYNC.unknown
  const dashed = state === 'unknown'
  const label = job && state === 'transferring' ? compactLabel(job) : t(compact ? meta.short : meta.label)
  const tip = copy && state !== 'transferring' ? copyTip(copy) : t(meta.means)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', className)}>
          <Chip
            key={shown}
            tone={meta.tone}
            icon={meta.icon}
            dashed={dashed || meta.dashed}
            spin={meta.spin}
            className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-(--dur-base)"
          >
            {label}
          </Chip>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 whitespace-pre-line">{tip}</TooltipContent>
    </Tooltip>
  )
}
