// A Store's size (storage-redesign §6): bytes in decimal units, tabular, with
// the split in the tooltip; "size unknown" with its reason when not known.
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ago, bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

const STALE_MS = 5 * 60_000

/** What the tooltip says about a known size: its split, and its age when old. */
export function sizeDetail(store: Pick<StoreInfo, 'kind' | 'size' | 'schema'>): string {
  const s = store.size
  if (!s) return ''
  const split =
    store.kind === 'postgresql'
      ? t('Tables, indexes and TOAST in schema {schema}', { schema: store.schema ?? t('unknown') })
      : s.file !== null
        ? `store.sqlite ${bytes(s.file)} · WAL ${bytes(s.wal ?? 0)}`
        : t('store.sqlite and its WAL')
  const old = s.at > 0 && Date.now() - s.at > STALE_MS ? ` · ${t('as of {ago}', { ago: ago(s.at) })}` : ''
  return split + old
}

interface SizeTextProps {
  store: Pick<StoreInfo, 'kind' | 'size' | 'schema'>
  /** Why it is unknown: "pg-cloud is not answering", "Docker is not answering". */
  reason?: string | null
  className?: string
}

export function SizeText({ store, reason, className }: SizeTextProps) {
  useI18n()
  if (!store.size) {
    const why = t(reason ?? (store.kind === 'postgresql' ? 'This LayerFS build doesn’t report schema sizes' : 'This LayerFS build doesn’t report sizes'))
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('text-faint whitespace-nowrap', className)}>{t('size unknown')}</span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('whitespace-nowrap tabular-nums', className)}>{bytes(store.size.bytes)}</span>
      </TooltipTrigger>
      <TooltipContent>{sizeDetail(store)}</TooltipContent>
    </Tooltip>
  )
}

/** "1.1 GB", "1.1 GB + 1 unknown", "size unknown". */
export function totalText(total: number, unknown: number, count: number): string {
  if (count === 0) return bytes(0)
  if (unknown === count) return t('size unknown')
  return unknown ? t('{bytes} + {n} unknown', { bytes: bytes(total), n: unknown }) : bytes(total)
}
