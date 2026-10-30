// Connections (storage-links §3.1 region 4, layerfs#509): every connection
// in one grid, all providers together, PostgreSQL servers included. A card
// shows the mark, name, endpoint and bucket (or host and database), health,
// and `N files · size` for a bucket (`N Stores · size` for a database). An S3
// card opens its file list (Linked to X · Open, or Not loaded · Load…); a
// PostgreSQL card opens its connection page. Add connection sits on the
// header. A connection binds no Store.
import { CloudOff, LoaderCircle, Plus } from 'lucide-react'
import type { CSSProperties } from 'react'
import { siPostgresql } from 'simple-icons'

import { count, middle, useStorage } from '@/components/storage/actions'
import { filesOf } from '@/components/storage/detail/bucket-detail'
import { Mark, Tile } from '@/components/storage/icons'
import { providerLabel } from '@/components/storage/identity/providers'
import { ProviderTile } from '@/components/storage/identity/store-icon'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { bytes } from '@/data/format'
import type { PostgresqlConnection, RemoteInfo } from '@shared/host-api'

const CARD =
  'group flex min-w-0 flex-col gap-1.5 rounded-xl bg-muted/35 px-4 py-3 text-left ring-1 ring-foreground/[0.06] ring-inset outline-none transition-colors duration-(--dur-fast) hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring dark:bg-muted/25'

function BucketCard({ remote }: { remote: RemoteInfo }) {
  const s = useStorage()
  const busy = s.transfers.running.some((j) => j.kind !== 'import' && j.target === remote.name)
  const files = filesOf(remote, s.view.stores.list)
  const linked = files.filter((f) => f.linkedBy).length
  return (
    <button type="button" onClick={() => s.open({ view: 'location', id: remote.name })} className={CARD}>
      <span className="flex min-w-0 items-center gap-2.5">
        <ProviderTile provider={remote.provider} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px] font-medium group-hover:text-primary">{remote.name}</span>
          <span className="block truncate text-[11.5px] text-faint">{providerLabel(remote.provider)}</span>
        </span>
        {busy && <LoaderCircle aria-label="A transfer is running" className="size-3.5 animate-spin text-primary" />}
      </span>
      <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={remote.location}>
        {middle(remote.location, 44)}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
        {!remote.hasSecret ? <span className="text-warning">no keys</span> : <HealthDot health={remote.health} />}
        <span aria-hidden="true">·</span>
        <span>
          {remote.files || files.length ? count(files.length, 'file') : 'not listed'}
          {remote.bytes !== null && files.length > 0 ? ` · ${bytes(remote.bytes)}` : ''}
        </span>
        {files.length > 0 && <span className="text-faint">({linked} linked)</span>}
      </span>
    </button>
  )
}

function DatabaseCard({ connection }: { connection: PostgresqlConnection }) {
  const s = useStorage()
  const h = connection.health
  return (
    <button type="button" onClick={() => s.open({ view: 'connection', id: connection.name })} className={CARD}>
      <span className="flex min-w-0 items-center gap-2.5">
        <Tile size="sm">
          <Mark icon={siPostgresql} className="size-4" />
        </Tile>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px] font-medium group-hover:text-primary">{connection.name}</span>
          <span className="block truncate text-[11.5px] text-faint">PostgreSQL{h.serverVersion ? ` ${h.serverVersion}` : ''}</span>
        </span>
      </span>
      <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={connection.url}>
        {[connection.host, connection.database].filter(Boolean).join(' / ') || middle(connection.url, 44)}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
        <HealthDot health={h} />
        {h.latencyMs !== null && <span className="text-faint">{h.latencyMs} ms</span>}
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
  const s = useStorage()
  const { remotes, postgresql } = s.view
  const on = remotes.available || postgresql.available
  const total = remotes.list.length + postgresql.connections.length
  const add = on ? (
    <Button size="sm" variant="outline" onClick={() => s.addLocation()}>
      <Plus /> Add connection
    </Button>
  ) : (
    <Unavailable reason={remotes.reason ?? undefined}>
      <Button size="sm" variant="outline" disabled>
        <Plus /> Add connection
      </Button>
    </Unavailable>
  )
  const buckets = [...remotes.list].sort((a, b) => providerLabel(a.provider).localeCompare(providerLabel(b.provider)) || a.name.localeCompare(b.name))
  return (
    <section aria-labelledby="connections-h" className="surface reveal overflow-hidden rounded-2xl" style={{ '--i': index } as CSSProperties}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4 pb-3">
        <h2 id="connections-h" className="text-[12px] font-semibold tracking-[0.08em] uppercase">
          Connections
        </h2>
        <span className="text-[13px] text-muted-foreground tabular-nums">{total ? `${count(remotes.list.length, 'bucket')} · ${count(postgresql.connections.length, 'database')}` : ''}</span>
        <p className="basis-full text-[12.5px] text-faint">Buckets hold SQLite Store files, each linked to one Store here or not loaded; databases hold PostgreSQL Stores. A connection binds no Store.</p>
        <span className="ml-auto">{add}</span>
      </header>
      {total === 0 ? (
        <div className="sc-soon mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-lg px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg border border-dashed text-faint">
            <CloudOff aria-hidden="true" className="size-4" />
          </span>
          <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">{on ? 'No connections yet. Add a bucket to publish a Store, or a PostgreSQL database.' : (remotes.reason ?? 'Connections need a LayerFS build with remotes.')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 border-t px-4 py-4 @min-[560px]/storage:grid-cols-2 @min-[960px]/storage:grid-cols-3">
          {buckets.map((r) => (
            <BucketCard key={r.name} remote={r} />
          ))}
          {postgresql.connections.map((c) => (
            <DatabaseCard key={c.name} connection={c} />
          ))}
        </div>
      )}
    </section>
  )
}
