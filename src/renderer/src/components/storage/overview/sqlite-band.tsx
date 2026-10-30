// The SQLite band (storage-links §3.1): every local SQLite Store as a row,
// `Store | Linked to | Sync | actions` (layerfs#509: one link per Store).
// The header says what the family is, what it holds and costs, and how this
// machine is doing. Connections have their own section below the bands.
import { ChevronRight, Plus, TriangleAlert } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { Dot } from '@/components/storage/chips'
import { workerChip } from '@/components/storage/machine/worker'
import { LOW_DISK } from '@/components/storage/meters'
import { BandHead, Card, ColumnHead, type Sort, type SortKey } from '@/components/storage/overview/row-parts'
import { SqliteStoreRow } from '@/components/storage/overview/sqlite-store-row'
import { totalText } from '@/components/storage/size'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

/** "This machine: 111 GB free · ● Worker running", a link to the This machine page. */
function MachineLink() {
  const s = useStorage()
  const st = s.status
  if (!st) return null
  const free = [st.disk.home, st.disk.volumes].filter((n): n is number => n !== null)
  const low = free.length > 0 && Math.min(...free) < LOW_DISK
  const chip = workerChip(st)
  const docker = st.docker.level !== 'ok'
  return (
    <button
      type="button"
      onClick={() => s.open({ view: 'machine' })}
      className="group flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs text-muted-foreground outline-none ring-1 ring-transparent transition-colors hover:bg-foreground/[0.04] hover:text-foreground hover:ring-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span>
        {t('This machine:')}{' '}
        {docker ? (
          <span className="font-medium text-warning">{t('Docker is not answering')}</span>
        ) : (
          <span className={cn('font-semibold tabular-nums', low ? 'text-warning' : 'text-foreground')}>{free.length ? t('{size} free', { size: bytes(Math.min(...free)) }) : t('free space unknown')}</span>
        )}
      </span>
      <span aria-hidden="true" className="text-faint">
        ·
      </span>
      <span className="flex items-center gap-1.5">
        <Dot tone={chip.tone} label={t(chip.label)} />
        <span aria-hidden="true">{t(chip.label)}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

interface SqliteBandProps {
  /** The Stores to show, filtered and sorted; null while the first view is read. */
  stores: { store: StoreInfo; match: string | null }[] | null
  /** Every SQLite Store, for the header's totals. */
  all: StoreInfo[]
  sort: Sort
  onSort: (key: SortKey) => void
  /** Words when the filter hides every Store. */
  empty?: React.ReactNode
  index?: number
}

export function SqliteBand({ stores, all, sort, onSort, empty, index = 0 }: SqliteBandProps) {
  useI18n()
  const s = useStorage()
  const known = all.filter((x) => x.size)
  const total = known.reduce((n, x) => n + x.size!.bytes, 0)
  const on = s.view.stores.available
  return (
    <Card id="sqlite-band" aria-labelledby="sqlite-band-h" index={index} className="scroll-mt-4 overflow-hidden">
      <BandHead
        id="sqlite-band-h"
        family="sqlite"
        title={t('SQLite Stores')}
        counts={stores === null ? t('Reading…') : `${count(all.length, 'Store')} · ${t('{size} on this machine', { size: totalText(total, all.length - known.length, all.length) })}`}
        about={on ? t('One file per Store, in its own Docker volume. Each links to at most one file in a bucket: publish, push, pull.') : t('One Store per project, each in its own Docker volume. This LayerFS build can’t group projects into shared Stores yet.')}
        side={
          <>
            <MachineLink />
            {on ? (
              <Button size="sm" variant="outline" className="rounded-xl" onClick={s.newStore}>
                <Plus /> {t('New Store')}
              </Button>
            ) : (
              <Unavailable reason={s.view.stores.reason ?? undefined}>
                <Button size="sm" variant="outline" className="rounded-xl" disabled>
                  <Plus /> {t('New Store')}
                </Button>
              </Unavailable>
            )}
          </>
        }
      />
      {s.view.stores.reason && on && (
        <p role="alert" className="flex items-center gap-2 border-t border-foreground/[0.06] px-5 py-2 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {s.view.stores.reason}
        </p>
      )}
      <div role="table" aria-label={t('SQLite Stores')} className="border-t border-foreground/[0.06]">
        <div role="rowgroup">
          <div role="row" data-head className="sc-row sc-sqlite-row border-b border-foreground/[0.06] bg-foreground/[0.015]">
            <ColumnHead label={t('Store')} sortKey="name" sort={sort} onSort={onSort} className="sc-a-name" />
            <ColumnHead label={t('Linked to')} className="sc-a-copies" />
            <ColumnHead label={t('Status')} sortKey="status" sort={sort} onSort={onSort} className="sc-a-pill" />
            <span role="columnheader" className="sc-a-action">
              <span className="sr-only">{t('Actions')}</span>
            </span>
          </div>
        </div>
        <div role="rowgroup" className="stagger divide-y divide-foreground/[0.06]">
          {stores === null
            ? Array.from({ length: 3 }, (_, i) => (
                <div key={i} role="row" className="sc-row">
                  <Skeleton className="h-7 w-full rounded-xl" />
                </div>
              ))
            : stores.map(({ store, match }) => <SqliteStoreRow key={store.name} store={store} match={match} />)}
          {stores?.length === 0 && (
            <div role="row" className="px-5 py-8 text-center text-[13px] text-muted-foreground">
              <span role="cell">{empty ?? t('No SQLite Stores yet.')}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
