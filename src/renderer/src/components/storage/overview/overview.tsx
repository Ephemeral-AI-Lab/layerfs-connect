// The board (layerfs-storage.md): one line of facts with search, then one
// card per Store with its projects. Stores that need you come first, then
// shared Stores, then projects' own Stores. Warnings and failed transfers show
// only while they are true; this machine and the connections open from the line.
import { Download, HardDrive, Plus, Search, TriangleAlert, X } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { siSqlite } from 'simple-icons'

import { Empty, LoadError } from '@/components/projects/states'
import { count, type NewTab, useStorage } from '@/components/storage/actions'
import { Mark } from '@/components/storage/icons'
import { LOW_DISK } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { attentionOf, StoreCard } from '@/components/storage/overview/store-card'
import { totalText } from '@/components/storage/size'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { TransferTray } from '@/components/storage/transfers/transfer-tray'
import { dismissJob } from '@/components/storage/transfers/use-transfers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StoreInfo } from '@shared/host-api'

/** The SQLite mark, for the empty state's lit tile. */
const SqliteMark = ({ className }: { className?: string }) => <Mark icon={siSqlite} className={className} />

/** Search shows from this many Stores up (or while it holds words). */
const SEARCH_FROM = 6

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

  const all = view.stores.list
  const attention = new Map(all.map((x) => [x.name, attentionOf(x, s)]))
  // needs you, then shared Stores, then projects' own Stores; by name within each
  const rank = (x: StoreInfo) => (attention.get(x.name) ? 0 : transfers.runningFor(x.name) ? 1 : x.legacy ? 3 : 2)
  const q = query.trim().toLowerCase()
  const pass = (x: StoreInfo): Row | null => {
    if (!q || x.name.toLowerCase().includes(q)) return { store: x, match: null }
    const p = x.projects.find((name) => name.toLowerCase().includes(q))
    return p ? { store: x, match: p } : null
  }
  const rows = all
    .map(pass)
    .filter((x): x is Row => x !== null)
    .sort((a, b) => rank(a.store) - rank(b.store) || a.store.name.localeCompare(b.store.name))

  const lowDisk = !!status && [status.disk.home, status.disk.volumes].some((n) => n !== null && n < LOW_DISK)
  const worker = status?.worker
  const workerDown = !!worker && worker.state !== 'starting' && (worker.state !== 'running' || !!worker.error)
  const nothing = view.stores.available && !all.length
  const reading = !view.stores.available && !loadedProjects

  // the tray only for what has no card to show it: failed jobs, and imports still copying into a new Store
  const trayJobs = transfers.shown.filter((j) => isFailed(j) || (j.kind === 'import' && isRunning(j)))
  const hideTray = () => {
    trayJobs.filter((j) => !isRunning(j)).forEach((j) => dismissJob(j.id))
    setTrayHidden(true)
  }

  return (
    <>
      {!error && !nothing && <FactsLine query={query} onQuery={setQuery} showSearch={all.length >= SEARCH_FROM || !!query} />}
      {!trayHidden && trayJobs.length > 0 && <TransferTray transfers={{ ...transfers, shown: trayJobs }} onHide={hideTray} actionsFor={s.refusalActions} />}
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
      <BuildLine />
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-4">
            {reading
              ? Array.from({ length: 6 }, (_, i) => <span key={i} className="shimmer h-36 rounded-2xl" />)
              : rows.map(({ store, match }, i) => <StoreCard key={store.name} store={store} match={match} attention={attention.get(store.name) ?? null} index={Math.min(i, 12)} />)}
          </div>
          {!reading && q && !rows.length && (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              {t('No Stores match.')}{' '}
              <button type="button" onClick={() => setQuery('')} className="rounded-md text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                {t('Clear')}
              </button>
            </p>
          )}
        </>
      )}
    </>
  )
}

/** "16 Stores · 1.8 GB · 77.9 GB free on this machine · 2 buckets · 2 databases", and search on the right. */
function FactsLine({ query, onQuery, showSearch }: { query: string; onQuery: (q: string) => void; showSearch: boolean }) {
  const s = useStorage()
  const all = s.view.stores.list
  const known = all.filter((x) => x.size)
  const total = known.reduce((n, x) => n + x.size!.bytes, 0)
  const st = s.status
  const free = st ? [st.disk.home, st.disk.volumes].filter((n): n is number => n !== null) : []
  const low = free.length > 0 && Math.min(...free) < LOW_DISK
  const link = 'rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
  const dot = (
    <span aria-hidden="true" className="text-faint">
      ·
    </span>
  )
  return (
    <div className="reveal flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2" style={{ '--i': 0 } as CSSProperties}>
      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
        <span>{count(all.length, 'Store')}</span>
        {dot}
        <span>{totalText(total, all.length - known.length, all.length)}</span>
        {dot}
        <button type="button" onClick={() => s.open({ view: 'machine' })} className={cn(link, 'inline-flex items-center gap-1.5', low && 'font-medium text-warning')}>
          <HardDrive aria-hidden="true" className="size-3.5" />
          {st?.docker.level !== 'ok' && st ? t('Docker is not answering') : free.length ? t('{size} free on this machine', { size: bytes(Math.min(...free)) }) : t('This machine')}
        </button>
        <ConnectionsMenu dot={dot} link={link} />
      </p>
      {showSearch && <SearchField query={query} onQuery={onQuery} />}
    </div>
  )
}

/** "· 2 buckets · 1 database": each opens New on its tab, where its connections are listed and added. */
function ConnectionsMenu({ dot, link }: { dot: React.ReactNode; link: string }) {
  const s = useStorage()
  const { remotes, postgresql } = s.view
  const down = (h: { state: string }) => h.state === 'unreachable' || h.state === 'denied'
  const part = (on: boolean, n: number, one: string, tab: NewTab, sick: boolean) =>
    on && (
      <>
        {dot}
        <button type="button" onClick={() => s.newDialog(tab)} className={cn(link, 'inline-flex items-center gap-1.5')}>
          {sick && <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />}
          {n ? count(n, one) : t(`Add a ${one}`)}
        </button>
      </>
    )
  return (
    <>
      {part(remotes.available, remotes.list.length, 'bucket', 'sqlite', remotes.list.some((r) => down(r.health)))}
      {part(postgresql.available, postgresql.connections.length, 'database', 'postgresql', postgresql.connections.some((c) => down(c.health)))}
    </>
  )
}

/** Search over Store and project names: `/` focuses it, Esc clears it. */
function SearchField({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="relative w-full sm:w-60">
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault()
            onQuery('')
          }
        }}
        placeholder={t('Search Stores and projects')}
        aria-label={t('Search Stores and projects')}
        className="glass-liquid h-9 rounded-xl pr-8 pl-8.5"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onQuery('')}
          aria-label={t('Clear the search')}
          className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md border border-foreground/10 bg-muted/70 px-1.5 font-mono text-[10px] text-muted-foreground">
          /
        </kbd>
      )}
    </div>
  )
}

/** One quiet line when the linked LayerFS build lacks part of Storage; the build's reasons in the tooltip. */
function BuildLine() {
  const { view } = useStorage()
  const parts = [
    { name: 'Shared Stores', on: view.stores.available, reason: view.stores.reason },
    { name: 'Buckets', on: view.remotes.available, reason: view.remotes.reason },
    { name: 'PostgreSQL', on: view.postgresql.available, reason: view.postgresql.reason },
  ].filter((p) => !p.on)
  if (!parts.length) return null
  const tip = parts.map((p) => `${t(p.name)}: ${p.reason ?? t('Not in this build')}`).join('\n')
  return (
    <p title={tip} className="reveal flex items-center gap-2 text-xs text-muted-foreground">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="text-pretty">
        {t('Not in this LayerFS build: {parts}.', { parts: parts.map((p) => t(p.name)).join(', ') })}
        {!view.stores.available && ` ${t('Each project keeps its own SQLite Store.')}`}
      </span>
    </p>
  )
}
