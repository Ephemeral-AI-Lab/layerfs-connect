// The Storage page (docs/ui/layerfs-storage.md, storage-links §3). Stores
// first: a summary strip, then every Store in two family bands, SQLite (files
// on this machine, each linked to at most one remote file) and PostgreSQL
// (schemas, live in a database); then every connection in one grid. A row or
// card opens its own page; the view lives in the URL hash
// (#storage/store/work), so back works. When the linked LayerFS build lacks
// part of the storage view, a capabilities card says which part and why.
import { ChevronDown, Cloud, Database, DatabaseZap, Download, Plus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { PageHeader, viewTransition } from '@/components/motion'
import { LoadError } from '@/components/projects/states'
import { parseRoute, type RemoveTarget, type Route, routeHash, StorageContext, type StorageActions } from '@/components/storage/actions'
import { BucketDetail } from '@/components/storage/detail/bucket-detail'
import { ConnectionDetail } from '@/components/storage/detail/connection-detail'
import { MachineDetail } from '@/components/storage/detail/machine-detail'
import { PostgresqlStoreDetail } from '@/components/storage/detail/postgresql-store-detail'
import { SqliteStoreDetail } from '@/components/storage/detail/sqlite-store-detail'
import { StorageDialogs, type DialogState } from '@/components/storage/dialogs/storage-dialogs'
import { pullDiscards } from '@/components/storage/dialogs/pull-dialog'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { Overview } from '@/components/storage/overview/overview'
import { SummaryStrip } from '@/components/storage/overview/summary-strip'
import { PUSH_REPLACES } from '@/components/storage/sync/sync-state'
import { isFailed } from '@/components/storage/transfers/phases'
import { onJobEnded, putJob, type Transfers, useTransfers } from '@/components/storage/transfers/use-transfers'
import { Unavailable } from '@/components/storage/unavailable'
import { loadStorage, normalizeJob, normalizeView } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { host, onProjectsChanged } from '@/host/client'
import { useHostQuery, useStorageEvents } from '@/host/use-host'
import type { ProjectCatalog } from '@/host/use-projects'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { type ProjectSummary, projectKey, type StorageCheck, type StorageView, type StoreInfo } from '@shared/host-api'

import '@/components/storage/storage.css'

/** The view is read again this often while the page is visible and focused (§8.4). */
const VIEW_MS = 15_000
/** Link checks run on open when older than this, and again this often while visible. */
const CHECK_STALE_MS = 2 * 60_000
const CHECK_MS = 5 * 60_000

const visible = () => document.visibilityState === 'visible' && document.hasFocus()

const FALLBACK_REASON = 'This LayerFS build keeps one Store per project. Shared Stores, links and PostgreSQL need layerfs#506.'

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
    stores: { available: false, reason: base?.stores.reason ?? FALLBACK_REASON, list: [...byName.values()] },
    remotes: base?.remotes ?? { available: false, reason: 'Needs layerfs#506.', list: [] },
    postgresql: base?.postgresql ?? { available: false, reason: 'Needs layerfs#506.', connections: [] },
    jobs: [],
  })
}

const NO_TRANSFERS: Transfers = { all: [], running: [], shown: [], jobFor: () => undefined, runningFor: () => undefined }

interface StoragePageProps {
  catalog: ProjectCatalog
  /** Dev aid: a view to open first when the hash names none ("store/work", "machine"). */
  initialId?: string
  /** Opens a project's page by its key (`store/name` in a shared Store). */
  onOpenProject?: (key: string) => void
}

export function StoragePage({ catalog, initialId, onOpenProject }: StoragePageProps) {
  useI18n()
  // ---------- the view, its route and its data ----------
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash) ?? (initialId ? parseRoute(`#storage/${initialId}`) : null) ?? { view: 'overview' })
  const scroller = useRef<HTMLDivElement>(null)
  const overviewTop = useRef(0)

  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const reloadCatalog = catalog.reload
  useEffect(() => onProjectsChanged(reload), [reload])
  const status = useHostQuery(() => host.status(), [tick])
  const storage = useHostQuery(loadStorage, [tick])
  const projects = catalog.data
  const loaded = storage.data !== undefined
  const raw = storage.data ?? null
  const view = useMemo(() => (!loaded ? null : raw && raw.stores.available ? raw : fallbackView(projects ?? [], raw)), [loaded, raw, projects])
  const transfers = useTransfers(raw?.jobs)

  // ---------- navigation: hash, back button, Alt+←, mouse back ----------
  const open = useCallback((next: Route) => {
    if (routeHash(next) === window.location.hash) return
    window.history.pushState({ storage: true }, '', routeHash(next))
    viewTransition(() => setRoute(next), 'tab')
  }, [])
  useEffect(() => {
    if (!parseRoute(window.location.hash)) window.history.replaceState({ storage: true }, '', routeHash(route))
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
      // leaving Storage: its hash no longer names the page on screen
      if (parseRoute(window.location.hash)) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const timer = setInterval(() => visible() && reload(), VIEW_MS)
    return () => clearInterval(timer)
  }, [reload])
  useStorageEvents((e) => e.type === 'storage' && reload())
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
    const timer = setInterval(() => visible() && host.checkStorage({}).then(reload, () => undefined), CHECK_MS)
    return () => clearInterval(timer)
  }, [canCheck, checkedAt, reload])

  // a job that ends: read the view and the projects again, and flash its Store once
  const [flash, setFlash] = useState<StorageActions['flash']>(null)
  useEffect(
    () =>
      onJobEnded((job) => {
        reload()
        reloadCatalog()
        if (!isFailed(job)) setFlash({ store: job.kind === 'import' ? (job.from ?? job.store) : job.store, token: Date.now() })
      }),
    [reload, reloadCatalog],
  )
  const reveal = useCallback(
    (store: string) => {
      setFlash({ store, token: Date.now() })
      if (route.view === 'overview') requestAnimationFrame(() => document.getElementById(`store-row-${store}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    },
    [route.view],
  )

  // ---------- actions and dialogs ----------
  const [dialog, setDialog] = useState<DialogState>(null)
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
      remove: (target: RemoveTarget) => setDialog({ kind: 'remove', target }),
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
            const p = projects?.find((x) => x.name === name && (x.store ?? x.name) === store)
            onOpenProject(p ? projectKey(p) : store === name ? name : `${store}/${name}`)
          }
        : undefined,
      sizeReason: status.data && status.data.docker.level !== 'ok' ? 'Docker is not answering' : null,
    }
  }, [view, status.data, transfers, open, started, check, userChecking, flash, onOpenProject, projects])

  // ---------- the header ----------
  const on = view?.stores.available === true
  const remotesOn = view?.remotes.available === true
  const pgOn = view?.postgresql.available === true
  const headerActions = (
    <>
      {remotesOn || pgOn ? (
        <SplitButton
          label={t('Add connection')}
          icon={<Plus />}
          variant="outline"
          onMain={() => setDialog({ kind: 'location' })}
          items={[
            { label: t('Bucket (MinIO, R2)…'), icon: <Cloud />, onSelect: () => setDialog({ kind: 'location', family: 'copy' }), disabled: !remotesOn },
            { label: t('PostgreSQL connection…'), icon: <Database />, onSelect: () => setDialog({ kind: 'location', family: 'database' }), disabled: !pgOn },
          ]}
        />
      ) : (
        <Unavailable reason={view?.remotes.reason ?? 'Needs layerfs#506.'}>
          <Button variant="outline" className="rounded-xl" disabled>
            <Plus /> {t('Add connection')}
          </Button>
        </Unavailable>
      )}
      {on ? (
        <SplitButton
          label={t('New Store')}
          icon={<Plus />}
          onMain={() => setDialog({ kind: 'new-store' })}
          items={[
            { label: t('Load from a connection…'), icon: <Download />, onSelect: () => open({ view: 'location', id: view?.remotes.list[0]?.name ?? '' }), disabled: !view?.remotes.list.length },
            { label: t('Import into PostgreSQL…'), icon: <DatabaseZap />, onSelect: () => setDialog({ kind: 'import' }), disabled: !view?.postgresql.connections.length },
          ]}
        />
      ) : (
        <Unavailable reason={view?.stores.reason ?? FALLBACK_REASON}>
          <Button className="rounded-xl" disabled>
            <Plus /> {t('New Store')}
          </Button>
        </Unavailable>
      )}
    </>
  )

  const retry = () => {
    reload()
    reloadCatalog()
  }
  return (
    <div className="flex h-svh min-w-0 flex-col">
      <PageHeader
        title={t('Storage')}
        description={t('Where projects’ history lives: SQLite Stores on this machine, each linked to at most one file in a bucket, and PostgreSQL Stores that live in a database.')}
        live={transfers.running.length > 0}
        actions={headerActions}
      />
      <div ref={scroller} onScroll={trackScroll} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className="@container/storage vt-panel flex w-full min-w-0 flex-col gap-5 px-6 pt-1 pb-12 @min-[56rem]/workspace:px-8">
          {!ctx ? (
            storage.error ? (
              <LoadError error={storage.error} what={t('the storage')} onRetry={retry} />
            ) : (
              <OverviewSkeleton />
            )
          ) : (
            <StorageContext.Provider value={ctx}>
              {route.view === 'overview' && <Overview error={storage.error} onRetry={retry} trayHidden={trayHidden} setTrayHidden={setTrayHidden} loadedProjects={projects !== undefined} />}
              {route.view === 'store' &&
                (ctx.view.stores.list.find((s) => s.name === route.id)?.kind === 'postgresql' ? <PostgresqlStoreDetail name={route.id} /> : <SqliteStoreDetail name={route.id} />)}
              {route.view === 'location' && <BucketDetail name={route.id} />}
              {route.view === 'connection' && <ConnectionDetail name={route.id} />}
              {route.view === 'machine' && <MachineDetail />}
              <StorageDialogs dialog={dialog} setDialog={setDialog} started={started} reveal={reveal} reload={reload} />
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
      <Button variant={variant} onClick={onMain} className="rounded-l-xl rounded-r-none">
        {icon} {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            aria-label={t('More ways: {label}', { label })}
            className={cn('rounded-l-none rounded-r-xl px-1.5', variant === 'default' ? 'border-l border-l-primary-foreground/25' : '-ml-px')}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 rounded-xl">
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

/** The first load: the strip's cells, and each band's header reading over three rows (§10.1). */
function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label={t('Reading the storage')} className="flex flex-col gap-5">
      <SummaryStrip view={null} transfers={NO_TRANSFERS} onAttention={() => {}} trayHidden={false} onShowTray={() => {}} />
      {(['sqlite', 'postgresql'] as const).map((family) => (
        <div key={family} className="glass-liquid rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <FamilyTile family={family} size="md" />
            <span className="text-[15px] font-semibold tracking-tight">{family === 'sqlite' ? t('SQLite Stores') : t('PostgreSQL Stores')}</span>
            <span className="text-xs text-muted-foreground">{t('Reading…')}</span>
          </div>
          <div className="mt-5 flex flex-col gap-3">
            {[0, 1, 2].map((r) => (
              <span key={r} className="shimmer h-7 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
