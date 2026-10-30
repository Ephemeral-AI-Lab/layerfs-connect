// The overview (storage-redesign §3.1): the summary strip, the transfer tray,
// what this LayerFS build can do, notices, the toolbar, both family bands and
// every connection. Search, filter and sort live here; the bands render.
import { Download, Plus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { siSqlite } from 'simple-icons'

import { Empty, LoadError } from '@/components/projects/states'
import { useStorage } from '@/components/storage/actions'
import { Mark } from '@/components/storage/icons'
import { LOW_DISK } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { Capabilities } from '@/components/storage/overview/capabilities'
import { Connections } from '@/components/storage/overview/connections'
import { PostgresqlBand } from '@/components/storage/overview/postgresql-band'
import type { Sort, SortKey } from '@/components/storage/overview/row-parts'
import { SqliteBand } from '@/components/storage/overview/sqlite-band'
import { SummaryStrip } from '@/components/storage/overview/summary-strip'
import { type Filter, Toolbar } from '@/components/storage/overview/toolbar'
import { NEEDS_ACTION, severity } from '@/components/storage/sync/sync-state'
import { isFailed } from '@/components/storage/transfers/phases'
import { TransferTray } from '@/components/storage/transfers/transfer-tray'
import { Button } from '@/components/ui/button'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

/** The SQLite mark, for the empty state's lit tile. */
const SqliteMark = ({ className }: { className?: string }) => <Mark icon={siSqlite} className={className} />

type Row = { store: StoreInfo; match: string | null }

interface OverviewProps {
  error?: Error
  onRetry: () => void
  trayHidden: boolean
  setTrayHidden: (hidden: boolean) => void
  loadedProjects: boolean
}

export function Overview({ error, onRetry, trayHidden, setTrayHidden, loadedProjects }: OverviewProps) {
  useI18n()
  const s = useStorage()
  const { view, status, transfers } = s
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 1 })
  const onSort = (key: SortKey) => setSort((x) => (x.key === key ? { key, dir: x.dir === 1 ? -1 : 1 } : { key, dir: key === 'size' ? -1 : 1 }))

  const sqlite = view.stores.list.filter((x) => x.kind === 'sqlite')
  const pg = view.stores.list.filter((x) => x.kind === 'postgresql')
  const downConnections = new Set(view.postgresql.connections.filter((c) => c.health.state === 'unreachable' || c.health.state === 'denied').map((c) => c.name))
  const failedOn = new Set(transfers.shown.filter(isFailed).map((j) => j.store))
  const attention = (x: StoreInfo) => (x.kind === 'sqlite' ? NEEDS_ACTION.includes(x.sync.state) || failedOn.has(x.name) : downConnections.has(x.connection ?? ''))

  const q = query.trim().toLowerCase()
  const pass = (x: StoreInfo): Row | null => {
    if (filter === 'attention' && !attention(x)) return null
    if (!q || x.name.toLowerCase().includes(q)) return { store: x, match: null }
    const p = x.projects.find((name) => name.toLowerCase().includes(q))
    return p ? { store: x, match: p } : null
  }
  const cmp = (a: StoreInfo, b: StoreInfo) => {
    if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir
    const d = sort.key === 'size' ? (a.size?.bytes ?? -1) - (b.size?.bytes ?? -1) : severity(a.sync.state) - severity(b.sync.state)
    return d * sort.dir || a.name.localeCompare(b.name)
  }
  const kept = (list: StoreInfo[]) => list.map(pass).filter((x): x is Row => x !== null)
  const sqliteRows = kept(sqlite).sort((a, b) => cmp(a.store, b.store))
  const pgRows = kept(pg).sort((a, b) => a.store.name.localeCompare(b.store.name))
  const filtering = !!q || filter !== 'all'
  const noMatch = filtering && !sqliteRows.length && !pgRows.length
  const empty = filter === 'attention' && !q ? t('Nothing needs attention. Every linked Store is in sync or being checked.') : t('No Stores match.')

  const lowDisk = !!status && [status.disk.home, status.disk.volumes].some((n) => n !== null && n < LOW_DISK)
  const worker = status?.worker
  const workerDown = !!worker && worker.state !== 'starting' && (worker.state !== 'running' || !!worker.error)
  const nothing = view.stores.available && !sqlite.length && !pg.length

  const attentionAndGo = () => {
    setFilter('attention')
    requestAnimationFrame(() => document.getElementById('sqlite-band')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  return (
    <>
      <div className={cn('transition-opacity duration-(--dur-base)', error && 'opacity-55')}>
        <SummaryStrip view={view} transfers={transfers} onAttention={attentionAndGo} trayHidden={trayHidden} onShowTray={() => setTrayHidden(false)} index={0} />
      </div>
      {!trayHidden && <TransferTray transfers={transfers} onHide={() => setTrayHidden(true)} actionsFor={s.refusalActions} index={1} />}
      <Capabilities index={2} />
      {workerDown && (
        <Notice
          tone="warning"
          icon={TriangleAlert}
          title={t('The LayerFS box is down')}
          actions={
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.open({ view: 'machine' })}>
              {t('This machine')}
            </Button>
          }
        >
          {t('SQLite Stores can’t be read or moved until it runs.')}
        </Notice>
      )}
      {lowDisk && (
        <Notice tone="warning" icon={TriangleAlert} title={t('Disk space is low')}>
          {t('Init and Commits write into the Store volumes, and a push stages a file beside its Store; a full disk fails them.')}
        </Notice>
      )}
      {error ? (
        <LoadError error={error} what={t('the storage')} onRetry={onRetry} />
      ) : nothing ? (
        <Empty
          icon={SqliteMark}
          title={t('No Stores yet')}
          className="glass-liquid rounded-2xl border-solid"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" className="rounded-xl" onClick={s.newStore}>
                <Plus /> {t('New Store')}
              </Button>
              {view.remotes.list.length > 0 && (
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.open({ view: 'location', id: view.remotes.list[0].name })}>
                  <Download /> {t('Load…')}
                </Button>
              )}
            </div>
          }
        >
          {t('A Store holds your projects’ history. Make one, or load one from a connection’s files.')}
        </Empty>
      ) : (
        <>
          <Toolbar
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={setFilter}
            counts={{ all: sqlite.length + pg.length, attention: [...sqlite, ...pg].filter(attention).length }}
            noMatch={noMatch}
            index={3}
          />
          <SqliteBand stores={!view.stores.available && !loadedProjects ? null : sqliteRows} all={sqlite} sort={sort} onSort={onSort} empty={filtering ? empty : undefined} index={4} />
          {(view.postgresql.available || pg.length > 0) && <PostgresqlBand stores={pgRows} all={pg} filtering={filtering} empty={empty} index={5} />}
          {(view.remotes.available || view.postgresql.available) && <Connections index={6} />}
        </>
      )}
    </>
  )
}
