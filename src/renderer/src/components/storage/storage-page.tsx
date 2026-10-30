// The Storage page (docs/ui/layerfs-storage.md, storage-links §3). Stores
// first: one board of every Store in two family bands, SQLite (files on this
// machine, each linked to at most one remote file) and PostgreSQL (schemas,
// live in a database); then every connection in one grid. A row or card opens
// its own page; the view lives in the URL hash (#storage/store/work), so back
// works.
import { ChevronDown, Cloud, Database, DatabaseZap, Download, Plus, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { siSqlite } from 'simple-icons'

import { type LayerFSPart, LayerFSTabs } from '@/components/layerfs-tabs'
import { PageHeader, viewTransition } from '@/components/motion'
import { Empty, LoadError } from '@/components/projects/states'
import { parseRoute, type RemoveTarget, type Route, routeHash, StorageContext, type StorageActions, useStorage } from '@/components/storage/actions'
import { BucketDetail } from '@/components/storage/detail/bucket-detail'
import { ConnectionDetail } from '@/components/storage/detail/connection-detail'
import { MachineDetail } from '@/components/storage/detail/machine-detail'
import { PostgresqlStoreDetail } from '@/components/storage/detail/postgresql-store-detail'
import { SqliteStoreDetail } from '@/components/storage/detail/sqlite-store-detail'
import { AddLocationDialog, type LocationFamily } from '@/components/storage/dialogs/add-location-dialog'
import { AddProjectDialog } from '@/components/storage/dialogs/add-project-dialog'
import { ConfirmByName } from '@/components/storage/dialogs/confirm-by-name'
import { ImportDialog } from '@/components/storage/dialogs/import-dialog'
import { LoadDialog } from '@/components/storage/dialogs/load-dialog'
import { NewStoreDialog } from '@/components/storage/dialogs/new-store-dialog'
import { PublishDialog } from '@/components/storage/dialogs/publish-dialog'
import { PullDialog, pullDiscards } from '@/components/storage/dialogs/pull-dialog'
import { PushConflictDialog } from '@/components/storage/dialogs/push-conflict-dialog'
import { SendDialog } from '@/components/storage/dialogs/send-dialog'
import { Mark } from '@/components/storage/icons'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { LOW_DISK } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { Connections } from '@/components/storage/overview/connections'
import { PostgresqlBand } from '@/components/storage/overview/postgresql-band'
import type { Sort, SortKey } from '@/components/storage/overview/row-parts'
import { SqliteBand } from '@/components/storage/overview/sqlite-band'
import { SummaryStrip } from '@/components/storage/overview/summary-strip'
import { type Filter, Toolbar } from '@/components/storage/overview/toolbar'
import { NEEDS_ACTION, PUSH_REPLACES, severity } from '@/components/storage/sync/sync-state'
import { isFailed } from '@/components/storage/transfers/phases'
import { TransferTray } from '@/components/storage/transfers/transfer-tray'
import { onJobEnded, putJob, type Transfers, useTransfers } from '@/components/storage/transfers/use-transfers'
import { Unavailable } from '@/components/storage/unavailable'
import { loadStorage, normalizeJob, normalizeView } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { host, onHostEvent, onProjectsChanged } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { ProjectSummary, StorageCheck, StorageView, StoreInfo } from '@shared/host-api'

import '@/components/storage/storage.css'

/** The view is read again this often while the page is visible and focused (§8.4). */
const VIEW_MS = 15_000
/** Link checks run on open when older than this, and again this often while visible. */
const CHECK_STALE_MS = 2 * 60_000
const CHECK_MS = 5 * 60_000

const visible = () => document.visibilityState === 'visible' && document.hasFocus()

/** A host or LayerFS build without Stores (§10.4): each project's own Store, from /api/projects. */
function fallbackView(projects: ProjectSummary[], base: StorageView | null): StorageView {
  const byName = new Map<string, { name: string; kind: string; volume: string | null; projects: string[]; legacy: boolean; created: number | null; connection: string | null }>()
  for (const p of projects) {
    const name = p.store ?? p.name
    const at = byName.get(name)
    if (at) at.projects.push(p.name)
    else byName.set(name, { name, kind: p.kind ?? 'sqlite', volume: p.volume, projects: [p.name], legacy: !p.store, created: p.created, connection: p.connection ?? null })
  }
  return normalizeView({
    stores: { available: false, reason: base?.stores.reason ?? 'This LayerFS build keeps one Store per project. Stores, links and PostgreSQL need layerfs#506.', list: [...byName.values()] },
    remotes: base?.remotes ?? { available: false, reason: 'Needs layerfs#506.', list: [] },
    postgresql: base?.postgresql ?? { available: false, reason: 'Needs layerfs#506.', connections: [] },
    jobs: [],
  })
}

type Dialog =
  | { kind: 'publish'; store: StoreInfo; remote?: string }
  | { kind: 'send'; store: StoreInfo }
  | { kind: 'load'; remote: string; file: string }
  | { kind: 'pull'; store: StoreInfo }
  | { kind: 'conflict'; store: StoreInfo }
  | { kind: 'unlink'; store: StoreInfo }
  | { kind: 'import'; store?: string; connection?: string }
  | { kind: 'location'; family?: LocationFamily; provider?: string }
  | { kind: 'new-store' }
  | { kind: 'add-project'; store: StoreInfo }
  | { kind: 'remove'; target: RemoveTarget }
  | null

interface StoragePageProps {
  /** Opens a project's page by its key. */
  onOpenProject?: (key: string) => void
  /** Opens another part of the LayerFS page (Projects, Compute). */
  onPart?: (part: LayerFSPart) => void
}

export function StoragePage({ onOpenProject, onPart }: StoragePageProps) {
  // ---------- the view, its route and its data ----------
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash) ?? { view: 'overview' })
  const scroller = useRef<HTMLDivElement>(null)
  const overviewTop = useRef(0)

  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => onProjectsChanged(reload), [reload])
  const status = useHostQuery(() => host.status(), [tick], 'status')
  const projects = useHostQuery(() => host.projects(), [tick], 'projects:storage')
  const storage = useHostQuery(loadStorage, [tick], 'storage')
  const loaded = storage.data !== undefined
  const raw = storage.data ?? null
  const view = useMemo(() => (!loaded ? null : raw && raw.stores.available ? raw : fallbackView(projects.data ?? [], raw)), [loaded, raw, projects.data])
  const transfers = useTransfers(raw?.jobs)

  // ---------- navigation: hash, back button, Alt+←, mouse back ----------
  const open = useCallback((next: Route) => {
    if (routeHash(next) === window.location.hash) return
    window.history.pushState({ storage: true }, '', routeHash(next))
    viewTransition(() => setRoute(next), 'tab')
  }, [])
  useEffect(() => {
    if (!parseRoute(window.location.hash)) window.history.replaceState({ storage: true }, '', '#storage')
    const onPop = () => {
      const next = parseRoute(window.location.hash)
      if (next) viewTransition(() => setRoute(next), 'tab')
    }
    const back = () => {
      if (parseRoute(window.location.hash)?.view === 'overview') return
      if ((window.history.state as { storage?: boolean } | null)?.storage) window.history.back()
      else open({ view: 'overview' })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft' && !document.querySelector('[role="dialog"]')) {
        e.preventDefault()
        back()
      }
    }
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [open])
  // the overview keeps its scroll position on the way back; a detail page opens at its top
  const lastView = useRef(route.view)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = route.view === 'overview' ? overviewTop.current : 0
    lastView.current = route.view
  }, [route])
  const trackScroll = () => {
    if (lastView.current === 'overview' && scroller.current) overviewTop.current = scroller.current.scrollTop
  }

  // ---------- polling, events and checks (§8.4) ----------
  useEffect(() => {
    const t = setInterval(() => visible() && reload(), VIEW_MS)
    const off = onHostEvent((e) => e.type === 'storage' && reload())
    return () => {
      clearInterval(t)
      off()
    }
  }, [reload])
  const [userChecking, setUserChecking] = useState(false)
  const check = useCallback(
    async (body: StorageCheck = {}) => {
      setUserChecking(true)
      try {
        await host.checkStorage(body)
      } finally {
        setUserChecking(false)
        reload()
      }
    },
    [reload],
  )
  const canCheck = !!view && (view.supports.check || view.supports.postgresqlStatus)
  const checkedAt = view?.checkedAt ?? null
  const autoChecked = useRef(false)
  useEffect(() => {
    if (!canCheck) return
    if (!autoChecked.current && (checkedAt === null || Date.now() - checkedAt > CHECK_STALE_MS)) {
      autoChecked.current = true
      host.checkStorage({}).then(reload, () => undefined)
    }
    const t = setInterval(() => visible() && host.checkStorage({}).then(reload, () => undefined), CHECK_MS)
    return () => clearInterval(t)
  }, [canCheck, checkedAt, reload])

  // a job that ends: read the view again, and flash its Store once
  const [flash, setFlash] = useState<StorageActions['flash']>(null)
  useEffect(
    () =>
      onJobEnded((job) => {
        reload()
        if (!isFailed(job)) setFlash({ store: job.kind === 'import' ? (job.from ?? job.store) : job.store, token: Date.now() })
      }),
    [reload],
  )
  const reveal = useCallback(
    (store: string) => {
      setFlash({ store, token: Date.now() })
      if (route.view === 'overview') requestAnimationFrame(() => document.getElementById(`store-row-${store}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    },
    [route.view],
  )

  // ---------- actions and dialogs ----------
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = useCallback((o: boolean) => !o && setDialog(null), [])
  const remotes = view?.remotes.list
  const started = useCallback((job: unknown) => putJob(normalizeJob(job, remotes ?? [])), [remotes])
  const [trayHidden, setTrayHidden] = useState(false)

  const ctx: StorageActions | null = useMemo(() => {
    if (!view) return null
    const storeOf = (name: string) => view.stores.list.find((s) => s.name === name)
    const pullNow = async (store: StoreInfo) => {
      started(await host.pull(store.name, store.name))
      setTrayHidden(false)
    }
    return {
      view,
      status: status.data ?? null,
      transfers,
      open,
      publish: (store, remote) => setDialog({ kind: 'publish', store, remote }),
      push: async (store) => {
        if (store.link && PUSH_REPLACES.includes(store.link.sync)) {
          setDialog({ kind: 'conflict', store })
          return
        }
        started(await host.push(store.name))
        setTrayHidden(false)
      },
      pushAnyway: (store) => setDialog({ kind: 'conflict', store }),
      pull: async (store) => {
        if (pullDiscards(store)) setDialog({ kind: 'pull', store })
        else await pullNow(store)
      },
      send: (store) => setDialog({ kind: 'send', store }),
      load: ({ remote, file }) => setDialog({ kind: 'load', remote, file }),
      unlink: (store) => setDialog({ kind: 'unlink', store }),
      importInto: (o = {}) => setDialog({ kind: 'import', ...o }),
      addLocation: (o = {}) => setDialog({ kind: 'location', ...o }),
      newStore: () => setDialog({ kind: 'new-store' }),
      addProject: (store) => setDialog({ kind: 'add-project', store }),
      remove: (target) => setDialog({ kind: 'remove', target }),
      check,
      checking: userChecking || view.checking > 0,
      refusalActions: (job) => {
        const store = storeOf(job.store)
        if (!store) return { onMachine: () => open({ view: 'machine' }) }
        return {
          onPullFirst: () => setDialog({ kind: 'pull', store }),
          onPushAnyway: () => setDialog({ kind: 'conflict', store }),
          onPullAgain: () => void pullNow(store).catch(() => undefined),
          onCheck: () => void check({ store: job.store }).catch(() => undefined),
          onMachine: () => open({ view: 'machine' }),
        }
      },
      flash,
      openProject: onOpenProject
        ? (store, name) => {
            const p = projects.data?.find((x) => x.name === name && (x.store ?? x.name) === store)
            onOpenProject(p?.key ?? p?.name ?? `${store}/${name}`)
          }
        : undefined,
      sizeReason: status.data && status.data.docker.level !== 'ok' ? 'Docker is not answering' : null,
    }
  }, [view, status.data, transfers, open, started, check, userChecking, flash, onOpenProject, projects.data])

  // ---------- the header ----------
  const on = view?.stores.available === true
  const remotesOn = view?.remotes.available === true
  const pgOn = view?.postgresql.available === true
  const headerActions = (
    <>
      {remotesOn || pgOn ? (
        <SplitButton
          label="Add connection"
          icon={<Plus />}
          variant="outline"
          onMain={() => setDialog({ kind: 'location' })}
          items={[
            { label: 'Bucket (MinIO, R2)…', icon: <Cloud />, onSelect: () => setDialog({ kind: 'location', family: 'copy' }), disabled: !remotesOn },
            { label: 'PostgreSQL connection…', icon: <Database />, onSelect: () => setDialog({ kind: 'location', family: 'database' }), disabled: !pgOn },
          ]}
        />
      ) : (
        <Unavailable reason={view?.remotes.reason ?? 'Needs layerfs#506'}>
          <Button variant="outline" disabled>
            <Plus /> Add connection
          </Button>
        </Unavailable>
      )}
      {on ? (
        <SplitButton
          label="New Store"
          icon={<Plus />}
          onMain={() => setDialog({ kind: 'new-store' })}
          items={[
            { label: 'Load from a connection…', icon: <Download />, onSelect: () => open({ view: 'location', id: view?.remotes.list[0]?.name ?? '' }), disabled: !view?.remotes.list.length },
            { label: 'Import into PostgreSQL…', icon: <DatabaseZap />, onSelect: () => setDialog({ kind: 'import' }), disabled: !view?.postgresql.connections.length },
          ]}
        />
      ) : (
        <Unavailable reason={view?.stores.reason ?? 'Needs layerfs#506'}>
          <Button disabled>
            <Plus /> New Store
          </Button>
        </Unavailable>
      )}
    </>
  )

  return (
    <div className="flex h-svh flex-col">
      <PageHeader
        size="md"
        title="LayerFS"
        width="max-w-6xl"
        live={transfers.running.length > 0}
        tabs={<LayerFSTabs current="storage" onPick={onPart} />}
        description="Where projects' history lives: SQLite Stores on this machine, each linked to at most one file in a bucket, and PostgreSQL Stores that live in a database."
        actions={headerActions}
      />
      <div ref={scroller} onScroll={trackScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="@container/storage vt-panel mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pt-5 pb-12 sm:px-8">
          {!ctx ? (
            storage.error ? (
              <LoadError error={storage.error} what="the storage" onRetry={reload} />
            ) : (
              <OverviewSkeleton />
            )
          ) : (
            <StorageContext.Provider value={ctx}>
              {route.view === 'overview' && <Overview error={storage.error} onRetry={reload} trayHidden={trayHidden} setTrayHidden={setTrayHidden} loadedProjects={projects.data !== undefined} />}
              {route.view === 'store' &&
                (ctx.view.stores.list.find((s) => s.name === route.id)?.kind === 'postgresql' ? <PostgresqlStoreDetail name={route.id} /> : <SqliteStoreDetail name={route.id} />)}
              {route.view === 'location' && <BucketDetail name={route.id} />}
              {route.view === 'connection' && <ConnectionDetail name={route.id} />}
              {route.view === 'machine' && <MachineDetail />}
              <Dialogs dialog={dialog} setDialog={setDialog} close={close} started={started} reveal={reveal} reload={reload} />
            </StorageContext.Provider>
          )}
        </div>
      </div>
    </div>
  )
}

/** A button with a menu of related ways beside it. */
function SplitButton({
  label,
  icon,
  variant = 'default',
  onMain,
  items,
}: {
  label: string
  icon: React.ReactNode
  variant?: 'default' | 'outline'
  onMain: () => void
  items: { label: string; icon: React.ReactNode; onSelect: () => void; disabled?: boolean }[]
}) {
  return (
    <span className="inline-flex">
      <Button variant={variant} onClick={onMain} className="rounded-r-none">
        {icon} {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} aria-label={`More ways: ${label}`} className={cn('rounded-l-none px-1.5', variant === 'default' ? 'border-l border-l-primary-foreground/25' : '-ml-px')}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {items.map((it) => (
            <DropdownMenuItem key={it.label} onSelect={it.onSelect} disabled={it.disabled}>
              <span className="text-muted-foreground [&_svg]:size-4">{it.icon}</span> {it.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

/** The SQLite mark, for the empty state's lit tile. */
const SqliteMark = ({ className }: { className?: string }) => <Mark icon={siSqlite} className={className} />

const NO_TRANSFERS: Transfers = { all: [], running: [], shown: [], jobFor: () => undefined, runningFor: () => undefined }

/** The first load: four skeleton cells, and each band's header reading over three rows (§10.1). */
function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Reading the storage" className="flex flex-col gap-5">
      <SummaryStrip view={null} transfers={NO_TRANSFERS} onAttention={() => {}} trayHidden={false} onShowTray={() => {}} />
      {(['sqlite', 'postgresql'] as const).map((family) => (
        <div key={family} className="surface rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <FamilyTile family={family} size="md" />
            <span className="text-[12px] font-semibold tracking-[0.08em] uppercase">{family === 'sqlite' ? 'SQLite Stores' : 'PostgreSQL Stores'}</span>
            <span className="text-[13px] text-faint">Reading…</span>
          </div>
          <div className="mt-5 flex flex-col gap-3">
            {[0, 1, 2].map((r) => (
              <span key={r} className="shimmer h-7 rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- the overview ----------

interface OverviewProps {
  error?: Error
  onRetry: () => void
  trayHidden: boolean
  setTrayHidden: (hidden: boolean) => void
  loadedProjects: boolean
}

function Overview({ error, onRetry, trayHidden, setTrayHidden, loadedProjects }: OverviewProps) {
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
  const pass = (x: StoreInfo): { store: StoreInfo; match: string | null } | null => {
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
  const kept = (list: StoreInfo[]) => list.map(pass).filter((x): x is { store: StoreInfo; match: string | null } => x !== null)
  const sqliteRows = kept(sqlite).sort((a, b) => cmp(a.store, b.store))
  const pgRows = kept(pg).sort((a, b) => a.store.name.localeCompare(b.store.name))
  const filtering = !!q || filter !== 'all'
  const noMatch = filtering && !sqliteRows.length && !pgRows.length
  const empty = filter === 'attention' && !q ? 'Nothing needs attention. Every linked Store is in sync or being checked.' : 'No Stores match.'

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
        <SummaryStrip view={view} transfers={transfers} onAttention={attentionAndGo} trayHidden={trayHidden} onShowTray={() => setTrayHidden(false)} />
      </div>
      {!trayHidden && <TransferTray transfers={transfers} onHide={() => setTrayHidden(true)} actionsFor={s.refusalActions} />}
      {!view.stores.available && (
        <Notice tone="info" icon={Database} title="One Store per project">
          {view.stores.reason ?? 'This LayerFS build keeps one Store per project. Stores, links and PostgreSQL need layerfs#506.'}
        </Notice>
      )}
      {workerDown && (
        <Notice
          tone="warning"
          icon={TriangleAlert}
          title="The LayerFS box is down"
          actions={
            <Button size="sm" variant="outline" onClick={() => s.open({ view: 'machine' })}>
              This machine
            </Button>
          }
        >
          SQLite Stores can’t be read or moved until it runs.
        </Notice>
      )}
      {lowDisk && (
        <Notice tone="warning" icon={TriangleAlert} title="Disk space is low">
          Init and Commits write into the Store volumes, and a push stages a file beside its Store; a full disk fails them.
        </Notice>
      )}
      {error ? (
        <LoadError error={error} what="the storage" onRetry={onRetry} />
      ) : nothing ? (
        <Empty
          icon={SqliteMark}
          title="No Stores yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={s.newStore}>
                <Plus /> New Store
              </Button>
              {view.remotes.list.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => s.open({ view: 'location', id: view.remotes.list[0].name })}>
                  <Download /> Load…
                </Button>
              )}
            </div>
          }
        >
          A Store holds your projects’ history. Make one, or load one from a connection’s files.
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
          />
          <SqliteBand stores={!view.stores.available && !loadedProjects ? null : sqliteRows} all={sqlite} sort={sort} onSort={onSort} empty={filtering ? empty : undefined} index={3} />
          {view.stores.available && <PostgresqlBand stores={pgRows} all={pg} filtering={filtering} empty={empty} index={4} />}
          {view.stores.available && <Connections index={5} />}
        </>
      )}
    </>
  )
}

// ---------- dialogs: one owner, one of each ----------

interface DialogsProps {
  dialog: Dialog
  setDialog: (d: Dialog) => void
  close: (open: boolean) => void
  started: (job: unknown) => void
  reveal: (store: string) => void
  reload: () => void
}

function Dialogs({ dialog: d, setDialog, close, started, reveal, reload }: DialogsProps) {
  const s = useStorage()
  const view = s.view
  const remove = d?.kind === 'remove' ? d.target : null
  const taken = useMemo(() => new Set(view.stores.list.map((x) => x.name)), [view.stores.list])
  const removeText = (t: RemoveTarget) => {
    if (t.kind === 'store') {
      const n = t.store.projects.length
      return t.store.kind === 'sqlite'
        ? { title: `Remove ${t.store.name}?`, body: `Deletes ${t.store.name} and ${n === 1 ? 'its project' : `all ${n} of its projects`} from this machine.${t.store.link ? ` Its linked file ${t.store.link.remote} / ${t.store.link.file} stays.` : ''}`, name: t.store.name, action: 'Remove Store' }
        : { title: `Remove ${t.store.name}?`, body: `Drops the schema ${t.store.schema ?? ''} and ${n === 1 ? 'its project' : `its ${n} projects`} from ${t.store.connection ?? 'its database'}.`, name: t.store.name, action: 'Remove Store' }
    }
    if (t.kind === 'remote') return { title: `Remove ${t.name}?`, body: 'The files in the bucket stay. LayerFS forgets the connection, and Connect deletes its keys. Refused while a Store links to it.', action: 'Remove connection' }
    return { title: `Forget ${t.name}?`, body: `Its ${t.stores === 1 ? 'Store stays' : `${t.stores} Stores stay`} in the database. Connect forgets the URL and can’t open them until you add it again.`, action: 'Forget connection' }
  }
  return (
    <>
      {d?.kind === 'publish' && <PublishDialog open onOpenChange={close} view={view} store={d.store} remote={d.remote} onDone={reveal} />}
      {d?.kind === 'send' && <SendDialog open onOpenChange={close} view={view} store={d.store} onDone={reveal} />}
      {d?.kind === 'load' && (
        <LoadDialog
          open
          onOpenChange={close}
          view={view}
          remote={d.remote}
          file={d.file}
          free={s.status?.disk.volumes ?? null}
          onDone={reveal}
          onOpenStore={(store) => {
            setDialog(null)
            s.open({ view: 'store', id: store })
          }}
        />
      )}
      {d?.kind === 'pull' && <PullDialog open onOpenChange={close} store={d.store} onPull={async (typed) => started(await host.pull(d.store.name, typed))} />}
      {d?.kind === 'conflict' && (
        <PushConflictDialog
          open
          onOpenChange={close}
          store={d.store}
          onOverwrite={async () => started(await host.push(d.store.name, { force: true }))}
          onPullFirst={() => (pullDiscards(d.store) ? setDialog({ kind: 'pull', store: d.store }) : (setDialog(null), void host.pull(d.store.name, d.store.name).then(started, () => undefined)))}
        />
      )}
      {d?.kind === 'unlink' && d.store.link && (
        <ConfirmByName
          open
          onOpenChange={close}
          title={`Unlink ${d.store.name}?`}
          body={`${d.store.name} becomes local only. The file ${d.store.link.remote} / ${d.store.link.file} stays in the bucket, not loaded, and can be loaded again.`}
          name={d.store.name}
          action="Unlink"
          onConfirm={async (typed) => {
            await host.unlink(d.store.name, typed)
            reload()
          }}
        />
      )}
      <ImportDialog
        open={d?.kind === 'import'}
        onOpenChange={close}
        view={view}
        store={d?.kind === 'import' ? d.store : undefined}
        connection={d?.kind === 'import' ? d.connection : undefined}
        onDone={reveal}
      />
      <AddLocationDialog
        open={d?.kind === 'location'}
        onOpenChange={close}
        view={view}
        family={d?.kind === 'location' ? d.family : undefined}
        provider={d?.kind === 'location' ? d.provider : undefined}
        onChanged={reload}
      />
      <NewStoreDialog
        open={d?.kind === 'new-store'}
        onOpenChange={close}
        taken={taken}
        onCreated={(name) => {
          reload()
          reveal(name)
        }}
      />
      {d?.kind === 'add-project' && <AddProjectDialog store={d.store} open onOpenChange={close} onDone={reload} />}
      {remove && (
        <ConfirmByName
          open
          onOpenChange={close}
          {...removeText(remove)}
          onConfirm={async (typed) => {
            if (remove.kind === 'store') await host.removeStore(remove.store.name, typed)
            else if (remove.kind === 'remote') await host.removeRemote(remove.name)
            else await host.removePostgresql(remove.name)
            reload()
            s.open({ view: 'overview' })
          }}
        />
      )}
    </>
  )
}
