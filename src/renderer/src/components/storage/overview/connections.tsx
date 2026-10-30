// Connections (storage-links §3.1 region 4, layerfs#509): every connection
// in one grid, all providers together, PostgreSQL servers included. A card
// shows the mark, name, endpoint and bucket (or host and database), health,
// and `N files · size` for a bucket (`N Stores · size` for a database). A
// bucket card opens its file list; a PostgreSQL card opens its connection
// page. A connection binds no Store.
import { ArrowUpRight, CloudOff, KeyRound, LoaderCircle, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'

import { spotlight } from '@/components/motion'
import { count, middle, useStorage } from '@/components/storage/actions'
import { filesOf } from '@/components/storage/detail/bucket-detail'
import { providerLabel } from '@/components/storage/identity/providers'
import { FamilyTile, ProviderTile } from '@/components/storage/identity/store-icon'
import { Card } from '@/components/storage/overview/row-parts'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import type { PostgresqlConnection, RemoteInfo } from '@shared/host-api'

const TILE =
  'sc-card group glass-liquid card-hover sheen-sweep spotlight reveal flex min-w-0 flex-col gap-2 rounded-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'

function TileHead({ mark, name, sub, busy }: { mark: React.ReactNode; name: string; sub: string; busy?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {mark}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13.5px] font-semibold group-hover:text-primary">{name}</span>
        <span className="block truncate text-[11.5px] font-medium text-muted-foreground">{sub}</span>
      </span>
      {busy ? <LoaderCircle aria-label={t('A transfer is running')} className="size-3.5 motion-safe:animate-spin text-primary" /> : <ArrowUpRight aria-hidden="true" className="sc-arrow size-4 shrink-0 text-primary" />}
    </span>
  )
}

function BucketCard({ remote, index }: { remote: RemoteInfo; index: number }) {
  const s = useStorage()
  const busy = s.transfers.running.some((j) => j.kind !== 'import' && j.target === remote.name)
  const files = filesOf(remote, s.view.stores.list)
  const linked = files.filter((f) => f.linkedBy).length
  return (
    <button type="button" onClick={() => s.open({ view: 'location', id: remote.name })} onPointerMove={spotlight} className={TILE} style={{ '--i': index } as CSSProperties}>
      <TileHead mark={<ProviderTile provider={remote.provider} size="md" />} name={remote.name} sub={providerLabel(remote.provider)} busy={busy} />
      <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={remote.location}>
        {middle(remote.location, 44)}
      </span>
      <span className="mt-auto flex flex-wrap items-center gap-x-2 border-t border-foreground/[0.06] pt-2.5 text-xs text-muted-foreground tabular-nums">
        {!remote.hasSecret ? (
          <span className="inline-flex items-center gap-1 font-medium text-warning">
            <KeyRound aria-hidden="true" className="size-3" /> {t('no keys')}
          </span>
        ) : (
          <HealthDot health={remote.health} />
        )}
        <span aria-hidden="true">·</span>
        <span>
          {remote.files || files.length ? count(files.length, 'file') : t('not listed')}
          {remote.bytes !== null && files.length > 0 ? ` · ${bytes(remote.bytes)}` : ''}
        </span>
        {files.length > 0 && <span className="text-faint">({t('{n} linked', { n: linked })})</span>}
      </span>
    </button>
  )
}

function DatabaseCard({ connection, index }: { connection: PostgresqlConnection; index: number }) {
  const s = useStorage()
  const h = connection.health
  return (
    <button type="button" onClick={() => s.open({ view: 'connection', id: connection.name })} onPointerMove={spotlight} className={TILE} style={{ '--i': index } as CSSProperties}>
      <TileHead mark={<FamilyTile family="postgresql" size="md" />} name={connection.name} sub={`PostgreSQL${h.serverVersion ? ` ${h.serverVersion}` : ''}`} />
      <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={connection.url}>
        {[connection.host, connection.database].filter(Boolean).join(' / ') || middle(connection.url, 44)}
      </span>
      <span className="mt-auto flex flex-wrap items-center gap-x-2 border-t border-foreground/[0.06] pt-2.5 text-xs text-muted-foreground tabular-nums">
        <HealthDot health={h} />
        {h.latencyMs !== null && <span className="text-faint">{Math.round(h.latencyMs)} ms</span>}
        <span aria-hidden="true">·</span>
        <span>
          {count(connection.stores.length, 'Store')}
          {connection.bytes !== null ? ` · ${bytes(connection.bytes)}` : ''}
        </span>
      </span>
    </button>
  )
}

export function Connections({ index = 0 }: { index?: number }) {
  useI18n()
  const s = useStorage()
  const { remotes, postgresql } = s.view
  const on = remotes.available || postgresql.available
  const total = remotes.list.length + postgresql.connections.length
  const add = on ? (
    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.addLocation()}>
      <Plus /> {t('Add connection')}
    </Button>
  ) : (
    <Unavailable reason={remotes.reason ?? undefined}>
      <Button size="sm" variant="outline" className="rounded-xl" disabled>
        <Plus /> {t('Add connection')}
      </Button>
    </Unavailable>
  )
  const buckets = [...remotes.list].sort((a, b) => providerLabel(a.provider).localeCompare(providerLabel(b.provider)) || a.name.localeCompare(b.name))
  return (
    <Card aria-labelledby="connections-h" index={index} className="overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-5 pb-4">
        <h2 id="connections-h" className="text-[15px] font-semibold tracking-tight">
          {t('Connections')}
        </h2>
        {total > 0 && (
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {count(remotes.list.length, 'bucket')} · {count(postgresql.connections.length, 'database')}
          </span>
        )}
        <span className="ml-auto">{add}</span>
        <p className="basis-full text-xs text-muted-foreground text-pretty">
          {t('Buckets hold SQLite Store files, each linked to one Store here or not loaded; databases hold PostgreSQL Stores. A connection binds no Store.')}
        </p>
      </header>
      {total === 0 ? (
        <div className="sc-soon mx-5 mb-5 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-xl border border-dashed border-foreground/20 text-muted-foreground">
            <CloudOff aria-hidden="true" className="size-4" />
          </span>
          <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{on ? t('No connections yet. Add a bucket to publish a Store, or a PostgreSQL database.') : (remotes.reason ?? t('Connections need a LayerFS build with remotes.'))}</p>
        </div>
      ) : (
        <div className="stagger grid grid-cols-1 gap-3 border-t border-foreground/[0.06] p-5 @min-[560px]/storage:grid-cols-2 @min-[960px]/storage:grid-cols-3">
          {buckets.map((r, n) => (
            <BucketCard key={r.name} remote={r} index={n} />
          ))}
          {postgresql.connections.map((c, n) => (
            <DatabaseCard key={c.name} connection={c} index={buckets.length + n} />
          ))}
        </div>
      )}
    </Card>
  )
}
