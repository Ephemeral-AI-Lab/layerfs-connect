// A SQLite Store's size and the room a push needs (storage-redesign §3.2
// region 6). A push stages a snapshot beside the Store, so it needs about
// the Store's size free in the Docker volumes.
import { TriangleAlert } from 'lucide-react'

import { useStorage } from '@/components/storage/actions'
import { LOW_DISK } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { Section } from '@/components/storage/detail/parts'
import { sizeDetail } from '@/components/storage/size'
import { CountBytes } from '@/components/projects/store-visuals'
import { bytes } from '@/data/format'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

/** A push needs about the Store's size, plus the low-disk line. */
export function pushRoom(store: StoreInfo, free: number | null): { need: number | null; short: number | null } {
  const need = store.size?.bytes ?? null
  if (need === null || free === null) return { need, short: null }
  const short = need + LOW_DISK - free
  return { need, short: short > 0 ? short : null }
}

export function SizeCard({ store, index }: { store: StoreInfo; index?: number }) {
  const s = useStorage()
  const free = s.status?.disk.volumes ?? null
  const { need, short } = pushRoom(store, free)
  const staging = s.transfers.runningFor(store.name)
  const at = need !== null && free !== null && free > 0 ? Math.min(1, need / free) : null
  return (
    <Section index={index} aria-label="Size">
      <div className="grid grid-cols-1 gap-x-10 gap-y-5 px-5 py-4 @min-[760px]/storage:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs text-faint">Size on this machine</p>
          <p className="mt-1 text-[22px] leading-7 font-semibold tracking-[-0.02em]">
            {store.size ? <CountBytes value={store.size.bytes} /> : <span className="text-base font-medium text-faint">size unknown</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {store.size ? sizeDetail(store) : (s.sizeReason ?? 'This LayerFS build doesn’t report sizes')}
            {staging?.kind === 'push' && ' · + a staged copy while pushing'}
          </p>
        </div>
        <div className="min-w-0">
          <p className="flex items-baseline justify-between gap-2 text-xs text-faint">
            <span>Free in the Docker volumes</span>
            {need !== null && <span className="tabular-nums">push needs ~{bytes(need)}</span>}
          </p>
          <p className={cn('mt-1 text-[22px] leading-7 font-semibold tracking-[-0.02em]', short !== null && 'text-warning')}>
            {free !== null ? <CountBytes value={free} /> : <span className="text-base font-medium text-faint">Docker is not answering</span>}
          </p>
          <span className="relative mt-2 block h-2 overflow-hidden rounded-full bg-muted ring-1 ring-foreground/[0.04] ring-inset">
            {free !== null && <span className={cn('sc-fill-x absolute inset-0 rounded-full opacity-35', short !== null ? 'bg-warning' : 'bg-brand')} />}
            {at !== null && (
              <span
                className={cn('sc-fill-x absolute inset-y-0 left-0 rounded-l-full', short !== null ? 'bg-warning' : 'bg-brand')}
                style={{ width: `${Math.max(1, at * 100)}%`, boxShadow: '0 0 8px 0 var(--glow)' }}
              />
            )}
          </span>
          {at !== null && <p className="mt-1 text-[11px] text-faint tabular-nums">the filled part is what a push stages</p>}
        </div>
      </div>
      {short !== null && (
        <div className="px-5 pb-4">
          <Notice tone="warning" icon={TriangleAlert} title="Low space for a push">
            A push stages a copy beside the Store. Free about {bytes(short)} first. The push is still allowed; LayerFS refuses it if it must.
          </Notice>
        </div>
      )}
    </Section>
  )
}
