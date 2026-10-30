// The PostgreSQL band (storage-redesign §3.1 region 7): connections as group
// headers, their Stores under them. Live, so there is nothing to sync; the
// one bridge from SQLite is import, shown as each row's From.
import { ChevronRight, Import, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'

import { count, useStorage } from '@/components/storage/actions'
import { Chip } from '@/components/storage/chips'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { ColumnHead } from '@/components/storage/overview/row-parts'
import { PendingImportRow, PostgresqlStoreRow } from '@/components/storage/overview/postgresql-store-row'
import { BandHead } from '@/components/storage/overview/sqlite-band'
import { totalText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { ago } from '@/data/format'
import type { PostgresqlConnection, StoreInfo } from '@shared/host-api'

/** A connection's header row: mark, name, health, version, where, synchronous_commit. */
function ConnectionHeader({ connection }: { connection: PostgresqlConnection }) {
  const s = useStorage()
  const h = connection.health
  const down = h.state === 'unreachable' || h.state === 'denied'
  return (
    <div role="row" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 bg-muted/30 px-5 py-2">
      <span role="rowheader" className="flex min-w-0 items-center gap-2.5">
        <FamilyTile family="postgresql" size="sm" />
        <button
          type="button"
          onClick={() => s.open({ view: 'connection', id: connection.name })}
          className="group inline-flex items-center gap-1 rounded-sm font-mono text-[13px] font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        >
          {connection.name}
          <ChevronRight aria-hidden="true" className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5" />
        </button>
      </span>
      <span role="cell" className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <HealthDot health={h} />
        {down ? (
          h.at && <span className="text-faint">checked {ago(h.at)}</span>
        ) : (
          h.serverVersion && <span>PostgreSQL {h.serverVersion}</span>
        )}
        {(connection.host || connection.database) && (
          <span className="truncate font-mono text-[11.5px] text-faint @max-[759px]/storage:hidden">
            {connection.host ?? ''}
            {connection.database ? `/${connection.database}` : ''}
          </span>
        )}
        <Chip tone="neutral" className="font-mono text-[11px] font-normal">
          sync_commit {connection.synchronousCommit}
        </Chip>
      </span>
    </div>
  )
}

interface PostgresqlBandProps {
  stores: { store: StoreInfo; match: string | null }[] | null
  all: StoreInfo[]
  /** The filter is on: connections without matching Stores hide. */
  filtering: boolean
  empty?: React.ReactNode
  index?: number
}

export function PostgresqlBand({ stores, all, filtering, empty, index = 0 }: PostgresqlBandProps) {
  const s = useStorage()
  const pg = s.view.postgresql
  const connections = [...pg.connections].sort((a, b) => a.name.localeCompare(b.name))
  const imports = s.transfers.running.filter((j) => j.kind === 'import')
  const known = all.filter((x) => x.size)
  const total = known.reduce((n, x) => n + x.size!.bytes, 0)
  const style = { '--i': index } as CSSProperties

  const add = pg.available ? (
    <Button size="sm" variant="outline" onClick={() => s.addLocation({ provider: 'postgresql' })}>
      <Plus /> Add connection
    </Button>
  ) : (
    <Unavailable reason={pg.reason ?? undefined}>
      <Button size="sm" variant="outline" disabled>
        <Plus /> Add connection
      </Button>
    </Unavailable>
  )

  // no connection: one line of invitation, not an empty table (§10.2)
  if (!connections.length)
    return (
      <section aria-label="PostgreSQL Stores" className="sc-soon reveal flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3.5" style={style}>
        <span className="sc-soon-mark">
          <FamilyTile family="postgresql" size="md" />
        </span>
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground text-pretty">
          <span className="font-medium text-foreground">PostgreSQL:</span> Stores that live in a database, for Sandboxes anywhere. Import a SQLite Store into one.
          {!pg.available && pg.reason && <span className="block text-xs text-faint">{pg.reason}</span>}
        </p>
        {add}
      </section>
    )

  const byConnection = (name: string) => (stores ?? []).filter((x) => x.store.connection === name)
  return (
    <section aria-labelledby="pg-band-h" className="surface reveal overflow-hidden rounded-2xl" style={style}>
      <BandHead
        id="pg-band-h"
        family="postgresql"
        title="PostgreSQL Stores"
        counts={`${count(all.length, 'Store')} in ${count(connections.length, 'connection')} · ${totalText(total, all.length - known.length, all.length)} in databases`}
        about="Live: each Store is a schema, and every Commit goes straight to the database. Nothing to sync."
        side={add}
      />
      {pg.reason && pg.available && (
        <p role="alert" className="border-t px-5 py-2 text-xs text-destructive">
          {pg.reason}
        </p>
      )}
      <div role="table" aria-label="PostgreSQL Stores" className="border-t">
        <div role="rowgroup">
          <div role="row" data-head className="sc-row sc-pg-row border-b bg-muted/25 pl-12">
            <ColumnHead label="Store" className="sc-a-name" />
            <ColumnHead label="Projects" className="sc-a-projects" />
            <ColumnHead label="Size" className="sc-a-size" />
            <ColumnHead label="From" className="sc-a-from" />
            <ColumnHead label="Created" className="sc-a-created" />
            <ColumnHead label="Status" className="sc-a-pill" />
            <span role="columnheader" className="sc-a-action">
              <span className="sr-only">Actions</span>
            </span>
          </div>
        </div>
        {connections.map((c) => {
          const rows = byConnection(c.name)
          const pending = imports.filter((j) => j.target.split('/')[0] === c.name)
          if (filtering && !rows.length) return null
          return (
            <div key={c.name} role="rowgroup" aria-label={`Connection ${c.name}`} className="divide-y divide-border/70 border-b last:border-b-0">
              <ConnectionHeader connection={c} />
              {rows.map(({ store, match }) => (
                <PostgresqlStoreRow key={store.name} store={store} connection={c} match={match} />
              ))}
              {pending.map((j) => (
                <PendingImportRow key={j.id} job={j} />
              ))}
              {!rows.length && !pending.length && stores !== null && (
                <div role="row" className="flex items-center gap-3 py-2.5 pr-5 pl-12 text-[13px] text-muted-foreground">
                  <span role="cell" className="flex-1">
                    No Stores yet. Import a SQLite Store into it.
                  </span>
                  <span role="cell">
                    <Button size="xs" variant="outline" onClick={() => s.importInto({ connection: c.name })}>
                      <Import /> Import…
                    </Button>
                  </span>
                </div>
              )}
            </div>
          )
        })}
        {filtering && stores?.length === 0 && (
          <div role="row" className="px-5 py-6 text-center text-[13px] text-muted-foreground">
            <span role="cell">{empty ?? 'No Stores match.'}</span>
          </div>
        )}
      </div>
    </section>
  )
}
