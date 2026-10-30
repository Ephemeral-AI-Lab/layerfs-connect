// A Store's size (storage-redesign §6): bytes in decimal units, tabular, with
// the split in the tooltip; "size unknown" with its reason when not known.
import { ago } from '@/data/format'
import { bytes } from '@/data/format'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

const STALE_MS = 5 * 60_000

/** What the tooltip says about a known size: its split, and its age when old. */
export function sizeDetail(store: Pick<StoreInfo, 'kind' | 'size' | 'schema'>): string {
  const s = store.size
  if (!s) return ''
  const split =
    store.kind === 'postgresql'
      ? `Tables, indexes and TOAST in schema ${store.schema ?? 'unknown'}`
      : s.file !== null
        ? `store.sqlite ${bytes(s.file)} · WAL ${bytes(s.wal ?? 0)}`
        : 'store.sqlite and its WAL'
  const old = s.at > 0 && Date.now() - s.at > STALE_MS ? ` · as of ${ago(s.at)}` : ''
  return split + old
}

interface SizeTextProps {
  store: Pick<StoreInfo, 'kind' | 'size' | 'schema'>
  /** Why it is unknown: "pg-cloud is not answering", "Docker is not answering". */
  reason?: string | null
  className?: string
}

export function SizeText({ store, reason, className }: SizeTextProps) {
  if (!store.size) {
    const why = reason ?? (store.kind === 'postgresql' ? 'This LayerFS build doesn’t report schema sizes' : 'This LayerFS build doesn’t report sizes')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('text-faint whitespace-nowrap', className)}>size unknown</span>
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
  if (unknown === count) return 'size unknown'
  return unknown ? `${bytes(total)} + ${unknown} unknown` : bytes(total)
}
