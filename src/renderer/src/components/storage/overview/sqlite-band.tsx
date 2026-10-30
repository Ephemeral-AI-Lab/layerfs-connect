// The SQLite band (storage-links §3.1): every local SQLite Store as a row,
// `Store | Linked to | Sync | actions` (layerfs#509: one link per Store).
// The header says what the family is, what it holds and costs, and how this
// machine is doing. Connections have their own section below the bands.
import { ChevronRight, Plus, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'

import { count, useStorage } from '@/components/storage/actions'
import { Dot } from '@/components/storage/chips'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { workerChip } from '@/components/storage/machine/worker'
import { LOW_DISK } from '@/components/storage/meters'
import { ColumnHead, type Sort, type SortKey } from '@/components/storage/overview/row-parts'
import { SqliteStoreRow } from '@/components/storage/overview/sqlite-store-row'
import { totalText } from '@/components/storage/size'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { bytes } from '@/data/format'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

/** The band's title block, shared with the PostgreSQL band. */
export function BandHead({ id, family, title, counts, about, side, index = 0 }: { id: string; family: 'sqlite' | 'postgresql'; title: string; counts: React.ReactNode; about: string; side?: React.ReactNode; index?: number }) {
  return (
    <header className="sc-band-head reveal px-5 pt-4 pb-3" style={{ '--i': index } as CSSProperties}>
      <FamilyTile family={family} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 id={id} className="text-[12px] font-semibold tracking-[0.08em] uppercase">{title}</h2>
          <span className="text-[13px] text-muted-foreground tabular-nums">{counts}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-faint text-pretty">{about}</p>
      </div>
      {side && <div className="sc-band-side flex shrink-0 flex-wrap items-center justify-end gap-2">{side}</div>}
    </header>
  )
}

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
      className="group flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span>
        This machine:{' '}
        {docker ? (
          <span className="text-warning">Docker is not answering</span>
        ) : (
          <span className={cn('font-medium tabular-nums', low ? 'text-warning' : 'text-foreground')}>{free.length ? `${bytes(Math.min(...free))} free` : 'free space unknown'}</span>
        )}
      </span>
      <span aria-hidden="true" className="text-faint">
        ·
      </span>
      <span className="flex items-center gap-1.5">
        <Dot tone={chip.tone} label={chip.label} />
        <span aria-hidden="true">{chip.label}</span>
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
  const s = useStorage()
  const known = all.filter((x) => x.size)
  const total = known.reduce((n, x) => n + x.size!.bytes, 0)
  const on = s.view.stores.available
  return (
    <section id="sqlite-band" aria-labelledby="sqlite-band-h" className="surface reveal scroll-mt-4 overflow-hidden rounded-2xl" style={{ '--i': index } as CSSProperties}>
      <BandHead
        id="sqlite-band-h"
        family="sqlite"
        title="SQLite Stores"
        counts={stores === null ? 'Reading…' : `${count(all.length, 'Store')} · ${totalText(total, all.length - known.length, all.length)} on this machine`}
        about="One file per Store, in its own Docker volume. Each links to at most one file in a bucket: publish, push, pull."
        side={
          <>
            <MachineLink />
            {on ? (
              <Button size="sm" variant="outline" onClick={s.newStore}>
                <Plus /> New Store
              </Button>
            ) : (
              <Unavailable reason={s.view.stores.reason ?? undefined}>
                <Button size="sm" variant="outline" disabled>
                  <Plus /> New Store
                </Button>
              </Unavailable>
            )}
          </>
        }
      />
      {s.view.stores.reason && on && (
        <p role="alert" className="flex items-center gap-2 border-t px-5 py-2 text-xs text-destructive">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {s.view.stores.reason}
        </p>
      )}
      <div role="table" aria-label="SQLite Stores" className="border-t">
        <div role="rowgroup">
          <div role="row" data-head className="sc-row sc-sqlite-row border-b bg-muted/25">
            <ColumnHead label="Store" sortKey="name" sort={sort} onSort={onSort} className="sc-a-name" />
            <ColumnHead label="Linked to" className="sc-a-copies" />
            <ColumnHead label="Status" sortKey="status" sort={sort} onSort={onSort} className="sc-a-pill" />
            <span role="columnheader" className="sc-a-action">
              <span className="sr-only">Actions</span>
            </span>
          </div>
        </div>
        <div role="rowgroup" className="stagger divide-y divide-border/70">
          {stores === null
            ? Array.from({ length: 3 }, (_, i) => (
                <div key={i} role="row" className="sc-row">
                  <Skeleton className="h-7 w-full" />
                </div>
              ))
            : stores.map(({ store, match }) => <SqliteStoreRow key={store.name} store={store} match={match} />)}
          {stores?.length === 0 && (
            <div role="row" className="px-5 py-6 text-center text-[13px] text-muted-foreground">
              <span role="cell">{empty ?? 'No SQLite Stores yet.'}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
