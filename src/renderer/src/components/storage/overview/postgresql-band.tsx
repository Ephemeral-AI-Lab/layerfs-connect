// The PostgreSQL band (storage-redesign §3.1 region 7): connections as group
// headers, their Stores under them. Live, so there is nothing to sync; the
// one bridge from SQLite is import, shown as each row's From.
import { ChevronRight, Import, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'

import { spotlight } from '@/components/motion'
import { count, useStorage } from '@/components/storage/actions'
import { Chip } from '@/components/storage/chips'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { PendingImportRow, PostgresqlStoreRow } from '@/components/storage/overview/postgresql-store-row'
import { BandHead, Card, ColumnHead } from '@/components/storage/overview/row-parts'
import { totalText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { ago } from '@/data/format'
import { t, useI18n } from '@/i18n'
import type { PostgresqlConnection, StoreInfo } from '@shared/host-api'

/** A connection's header row: mark, name, health, version, where, synchronous_commit. */
function ConnectionHeader({ connection }: { connection: PostgresqlConnection }) {
  const s = useStorage()
  const h = connection.health
  const down = h.state === 'unreachable' || h.state === 'denied'
  return (
    <div role="row" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 bg-foreground/[0.02] px-5 py-2.5">
      <span role="rowheader" className="flex min-w-0 items-center gap-2.5">
        <FamilyTile family="postgresql" size="sm" />
        <button
          type="button"
          onClick={() => s.open({ view: 'connection', id: connection.name })}
          className="group inline-flex items-center gap-1 rounded-md font-mono text-[13px] font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        >
          {connection.name}
          <ChevronRight aria-hidden="true" className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5" />
        </button>
      </span>
      <span role="cell" className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <HealthDot health={h} />
        {down ? h.at && <span className="text-faint">{t('checked {ago}', { ago: ago(h.at) })}</span> : h.serverVersion && <span>PostgreSQL {h.serverVersion}</span>}
        {(connection.host || connection.database) && (
          <span className="truncate font-mono text-[11.5px] text-faint @max-[759px]/storage:hidden">
            {connection.host ?? ''}
            {connection.database ? `/${connection.database}` : ''}
          </span>
        )}
        <Chip tone="neutral" className="font-mono font-medium">
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
  useI18n()
  const s = useStorage()
  const pg = s.view.postgresql
  const connections = [...pg.connections].sort((a, b) => a.name.localeCompare(b.name))
  const imports = s.transfers.running.filter((j) => j.kind === 'import')
  const known = all.filter((x) => x.size)
  const total = known.reduce((n, x) => n + x.size!.bytes, 0)

  const add = pg.available ? (
    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.addLocation({ provider: 'postgresql' })}>
      <Plus /> {t('Add connection')}
    </Button>
  ) : (
    <Unavailable reason={pg.reason ?? undefined}>
      <Button size="sm" variant="outline" className="rounded-xl" disabled>
        <Plus /> {t('Add connection')}
      </Button>
    </Unavailable>
  )

  // no connection: one line of invitation, not an empty table (§10.2)
  if (!connections.length)
    return (
      <section aria-label={t('PostgreSQL Stores')} onPointerMove={spotlight} className="sc-soon spotlight reveal flex flex-wrap items-center gap-3.5 px-5 py-4" style={{ '--i': index } as CSSProperties}>
        <span className="sc-soon-mark">
          <FamilyTile family="postgresql" size="md" />
        </span>
        <p className="min-w-0 flex-1 text-[13px] text-muted-foreground text-pretty">
          <span className="font-semibold text-foreground">PostgreSQL · </span>
          {t('Stores that live in a database, for Sandboxes anywhere. Import a SQLite Store into one.')}
        </p>
        {add}
      </section>
    )

  const byConnection = (name: string) => (stores ?? []).filter((x) => x.store.connection === name)
  return (
    <Card aria-labelledby="pg-band-h" index={index} className="overflow-hidden">
      <BandHead
        id="pg-band-h"
        family="postgresql"
        title={t('PostgreSQL Stores')}
        counts={`${t('{stores} in {connections}', { stores: count(all.length, 'Store'), connections: count(connections.length, 'connection') })} · ${t('{size} in databases', { size: totalText(total, all.length - known.length, all.length) })}`}
        about={t('Live: each Store is a schema, and every Commit goes straight to the database. Nothing to sync.')}
        side={add}
      />
      {pg.reason && pg.available && (
        <p role="alert" className="border-t border-foreground/[0.06] px-5 py-2 text-xs text-destructive">
          {pg.reason}
        </p>
      )}
      <div role="table" aria-label={t('PostgreSQL Stores')} className="border-t border-foreground/[0.06]">
        <div role="rowgroup">
          <div role="row" data-head className="sc-row sc-pg-row border-b border-foreground/[0.06] bg-foreground/[0.015] pl-12">
            <ColumnHead label={t('Store')} className="sc-a-name" />
            <ColumnHead label={t('Projects')} className="sc-a-projects" />
            <ColumnHead label={t('Size')} className="sc-a-size" />
            <ColumnHead label={t('From')} className="sc-a-from" />
            <ColumnHead label={t('Created')} className="sc-a-created" />
            <ColumnHead label={t('Status')} className="sc-a-pill" />
            <span role="columnheader" className="sc-a-action">
              <span className="sr-only">{t('Actions')}</span>
            </span>
          </div>
        </div>
        {connections.map((c) => {
          const rows = byConnection(c.name)
          const pending = imports.filter((j) => j.target.split('/')[0] === c.name)
          if (filtering && !rows.length) return null
          return (
            <div key={c.name} role="rowgroup" aria-label={t('Connection {name}', { name: c.name })} className="divide-y divide-foreground/[0.06] border-b border-foreground/[0.06] last:border-b-0">
              <ConnectionHeader connection={c} />
              {rows.map(({ store, match }) => (
                <PostgresqlStoreRow key={store.name} store={store} connection={c} match={match} />
              ))}
              {pending.map((j) => (
                <PendingImportRow key={j.id} job={j} />
              ))}
              {!rows.length && !pending.length && stores !== null && (
                <div role="row" className="flex items-center gap-3 py-3 pr-5 pl-12 text-[13px] text-muted-foreground">
                  <span role="cell" className="flex-1">
                    {t('No Stores yet. Import a SQLite Store into it.')}
                  </span>
                  <span role="cell">
                    <Button size="xs" variant="outline" className="rounded-lg" onClick={() => s.importInto({ connection: c.name })}>
                      <Import /> {t('Import…')}
                    </Button>
                  </span>
                </div>
              )}
            </div>
          )
        })}
        {filtering && stores?.length === 0 && (
          <div role="row" className="px-5 py-8 text-center text-[13px] text-muted-foreground">
            <span role="cell">{empty ?? t('No Stores match.')}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
