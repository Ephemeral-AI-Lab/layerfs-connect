import { fill } from '@/lib/text'
// The Storage page (docs/connect README, "Storage and projects"): every Store
// as a wide card that holds its projects (store-section.tsx), no tabs. A Store
// holds its projects (a push, pull or backup carries them all), so a project
// shows as a tile in its Store's card. The header: search (Stores and
// projects; a Store whose name matches shows whole, else only matching tiles,
// and cards with none hide), Backup buckets (buckets-modal.tsx), New Store,
// Refresh. Under it: how many Stores and projects and the sqlite size, and
// what `layerfs doctor` finds (each card also shows its own findings). Cards:
// the home's Stores, those on machines (by machine), then PostgreSQL. Each
// card's footer has its backups.
// A job shows on its Store's card and page (job-progress.tsx); the header's
// chip counts those running or failed. The view is read again on the host's
// `storage` events and on a poll; jobs move on `storage-job` events
// (host/storage-jobs.ts). A Store's page (focus `store:<name>`) shows in place
// of the board, with the same dialogs.
import { Archive, HardDrive, Plus, RotateCw, Search, SearchX, TriangleAlert, Unplug, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { GapLine } from '@/components/layerfs/GapLine'
import { PageHeader } from '@/components/layerfs/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/layerfs/States'
import { useProjectRows } from '@/layerfs/project-rows'
import { Input } from '@/components/ui/input'
import { Refusal } from '@/components/layerfs/Refusal'
import { SIMULATED_REFUSAL, SimulationPicker, useSimulation } from '@/components/layerfs/Simulation'
import { type BucketsFocus, BucketsModal } from '@/pages/storage/BucketsDialog'
import { ConfirmByName } from '@/pages/storage/dialogs/ConfirmByName'
import { DoctorBadge, DoctorFindings, useDoctor } from '@/pages/storage/NeedsAttention'
import { NewDialog, type NewStorePane } from '@/pages/storage/NewStoreDialog'
import { Notice } from '@/pages/storage/Notice'
import { type StorageDialog, StorageDialogs } from '@/pages/storage/StorageDialogs'
import { flashStore, JobsChip, useNow } from '@/pages/storage/JobProgress'
import { inHome } from '@/pages/storage/StoreCard'
import { StoreSection } from '@/pages/storage/StoreSection'
import { StorePage } from '@/pages/storage/StorePage'
import { focusOf } from '@/layerfs/go'
import { Button } from '@/components/ui/button'
import { SIMULATIONS } from '@/layerfs/compute-sim'
import { bytes } from '@/layerfs/format'
import { simStorage } from '@/layerfs/home-sim'
import { cardJob, jobCounts } from '@/layerfs/job-progress'
import { host, onHostEvent, onProjectsChanged } from '@/layerfs/client'
import { dismissJob, seedJobs, useStorageJobs } from '@/layerfs/storage-jobs'
import { useHostQuery, usePoll } from '@/layerfs/use-host'
import type { ProjectCatalog } from '@/layerfs/use-projects'
import type { MachineSandbox, StorageJob, StoreBackupLink, StoreRow } from '@/layerfs/host-api'

import '@/pages/storage/storage.css'

export { BACKUP } from '@/pages/storage/BucketCard'

const byName = (a: StoreRow, b: StoreRow) => a.name.localeCompare(b.name)
const sizeOf = (list: StoreRow[]) => list.reduce((n, s) => n + (s.size?.bytes ?? 0), 0)

interface StoragePageProps {
  catalog: ProjectCatalog
  /** Opens a project's page by its key; `from` names the place Back returns to (a Store's page). */
  onOpenProject?: (key: string, from?: string) => void
  /** `store:<name>`: that Store's page instead of the board (go.ts). */
  focus?: string
  /** Opens New project with the Store chosen. */
  onAddProject?: (store: string) => void
  /** Opens a Store's page (null: the board), in this tab or a new one. */
  onOpenStore?: (name: string | null, newTab?: boolean) => void
  /** Back where this tab came from, when a Store's page was opened from another page. */
  back?: { label: string; onBack: () => void }
  /** New project with no Store chosen (unused here: each Store card has Add project). */
  onNewProject?: () => void
}

export function StoragePage({ catalog, onOpenProject, onAddProject, onOpenStore, focus, back }: StoragePageProps) {
  const [tick, setTick] = useState(0)
  const reload = () => setTick((n) => n + 1)
  // machines (for Sandbox counts) and doctor are read on load, Refresh and changes, not on the poll
  const [look, setLook] = useState(0)
  const [checks, setChecks] = useState(0)
  const storage = useHostQuery(() => host.storage(), [tick], 'storage')
  const machinesRead = useHostQuery(() => host.machines(), [look])
  const doctor = useDoctor(checks)
  const known = useStorageJobs()
  // each project's chats and machines, for the cards' tiles (a hook: before the Store page's early return)
  const rows = useProjectRows(catalog)
  const now = useNow(10_000)
  const [query, setQuery] = useState('')
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [dialog, setDialog] = useState<StorageDialog | null>(null)
  const [removing, setRemoving] = useState<StoreRow | null>(null)
  const [dropping, setDropping] = useState<{ kind: 'postgresql' | 'bucket'; name: string } | null>(null)
  const [listing, setListing] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState<null | NewStorePane>(null)
  /** Backup buckets: open on a bucket, the Add form, or (null) the first bucket; false when closed. */
  const [buckets, setBuckets] = useState<BucketsFocus | false>(false)
  const [failed, setFailed] = useState<unknown>(null)
  // dev builds: a simulated host (shared with Machines and Projects) is drawn, and every action is refused here
  const simId = useSimulation()
  const simulated = simId ? SIMULATIONS[simId] : null
  const live = <A extends unknown[]>(work: (...args: A) => void) => (...args: A) => (simulated ? setFailed(SIMULATED_REFUSAL) : work(...args))
  /** A menu action that answers at once (a pull starts a job): its refusal shows on the page. */
  const act = (work: () => Promise<unknown>) => {
    setFailed(null)
    work().then(reload, (e: unknown) => setFailed(e))
  }
  const changed = () => {
    reload()
    setLook((n) => n + 1)
  }
  const refresh = () => {
    changed()
    setChecks((n) => n + 1)
  }
  useEffect(() => onProjectsChanged(changed), [])
  useEffect(
    () =>
      onHostEvent((e) => {
        if (e.type === 'storage') changed()
      }),
    [],
  )
  const view = simulated ? simStorage(simulated) : storage.data
  const f = focusOf(focus)
  const detail = f?.kind === 'store' ? f.name : null
  // store.list carries state and op: a push the CLI started shows here (§8.9)
  usePoll(reload)
  const done = () => {
    changed()
    catalog.reload()
  }
  // the view's jobs, with what events said since (a simulated host's are its own)
  useEffect(() => {
    if (!simulated && storage.data) seedJobs(storage.data.jobs)
  }, [simulated, storage.data])
  const allJobs = simulated ? (view?.jobs ?? []) : known.jobs
  const jobOf = (store: string) => cardJob(allJobs, store, known.dismissed, now)
  const counts = jobCounts(allJobs, known.dismissed)
  /** The first card with a running job, else with a failed one: where the header's chip goes. */
  const jobStore = (counts.running ? allJobs.find((j) => !j.ended) : allJobs.find((j) => j.ended && j.error && !known.dismissed.has(j.id)))?.store
  /** Starts a failed job again: the same call (a move whose push failed: that push). */
  const retry = (j: StorageJob) => {
    if (j.kind === 'push' || (j.kind === 'move' && j.error?.note === 'pulled')) return host.pushStore(j.store, j.target)
    if (j.kind === 'pull') return host.pullStore(j.store)
    if (j.kind === 'move') return host.moveStore(j.store, j.target)
    if (j.kind === 'backup') return host.backupStore(j.store, j.target, j.file ?? undefined)
    return host.restoreBackup(j.target, j.store, j.file ?? undefined)
  }
  const stores = useMemo(() => [...(view?.stores ?? [])].sort(byName), [view])
  const sqlite = stores.filter((s) => s.kind === 'sqlite')
  const total = sizeOf(sqlite)
  // every card in one grid: the home's Stores, then those on machines (by machine), then PostgreSQL
  const ordered = [...sqlite.filter(inHome), ...sqlite.filter((s) => !inHome(s)).sort((a, b) => (a.machine ?? '').localeCompare(b.machine ?? '') || byName(a, b)), ...stores.filter((s) => s.kind === 'postgresql')]
  // Sandboxes by project key; when machines cannot be read the column is left out, nothing waits on it
  const sandboxes = useMemo(() => {
    const read = simulated ? simulated.view : machinesRead.data
    const m = read?.available ? read : null
    if (!m) return null
    const by = new Map<string, MachineSandbox[]>()
    for (const b of m.sandboxes) if (b.project) by.set(b.project, [...(by.get(b.project) ?? []), b])
    return by
  }, [machinesRead.data, simulated])
  const actionsFor = (s: StoreRow) => ({
    push: live(() => setDialog({ kind: 'push', store: s })),
    pull: live(() => act(() => host.pullStore(s.name))),
    move: live(() => setDialog({ kind: 'move', store: s })),
    backup: live(() => setDialog({ kind: 'backup', store: s })),
    backupTo: live((l: StoreBackupLink) => act(() => host.backupStore(s.name, l.bucket, l.file))),
    restore: live((bucket: string, file: string) => setDialog({ kind: 'restore', bucket, file })),
    remove: live(() => setRemoving(s)),
    disconnect: live(() => setDropping({ kind: 'postgresql', name: s.name })),
    start: live(() => act(() => host.startMachine(s.machine!))),
    addProject: onAddProject && live(() => onAddProject(s.name)),
    buckets: () => setBuckets(null),
    retry: live((j: StorageJob) => {
      dismissJob(j.id)
      act(() => retry(j))
    }),
  })
  const listBucket = async (name: string) => {
    setListing(name)
    try {
      await host.listBucket(name)
    } finally {
      setListing(null)
      reload()
    }
  }

  const dialogs = (
    <>
      <BucketsModal
        open={buckets !== false}
        onOpenChange={(o) => !o && setBuckets(false)}
        focus={buckets === false ? null : buckets}
        view={view}
        listing={listing}
        simulated={!!simulated}
        onList={live((name: string) => void listBucket(name))}
        onRestore={live((bucket: string, file: string) => setDialog({ kind: 'restore', bucket, file }))}
        onDisconnect={live((name: string) => setDropping({ kind: 'bucket', name }))}
        onBackup={live((store: string, bucket: string, file: string) => act(() => host.backupStore(store, bucket, file)))}
        onConnected={done}
      />
      <NewDialog open={newOpen !== null} initial={newOpen ?? 'empty'} onOpenChange={(o) => !o && setNewOpen(null)} view={view} onChanged={done} onNewBucket={() => setBuckets({ add: true })} />
      <StorageDialogs dialog={dialog} view={view} onClose={() => setDialog(null)} done={done} />
      <ConfirmByName
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? ''}?`}
        body={`The Store and every project in it (${removing?.projects.length ?? 0}) are deleted with all their history. Backups in buckets stay.`}
        name={removing?.name}
        action={'Remove'}
        onConfirm={async (typed) => {
          await host.removeStore(removing!.name, typed)
          done()
        }}
      />
      <ConfirmByName
        open={!!dropping}
        onOpenChange={(o) => !o && setDropping(null)}
        icon={Unplug}
        title={fill(dropping?.kind === 'bucket' ? 'Disconnect the bucket {name}?' : 'Disconnect the PostgreSQL Store {name}?', { name: dropping?.name ?? '' })}
        body={
          dropping?.kind === 'bucket'
            ? 'Every Store’s link to this bucket goes too: their backup chips and states are lost. The files stay in the bucket.'
            : 'This home forgets the Store and its projects. The database and its data stay; connect it again to use them.'
        }
        action={'Disconnect'}
        onConfirm={async () => {
          if (dropping!.kind === 'bucket') await host.disconnectBucket(dropping!.name)
          else await host.disconnectStore(dropping!.name)
          done()
        }}
      />
    </>
  )

  if (detail && view)
    return (
      <div className="@container/storage h-svh min-w-0 overflow-y-auto">
        <div className="mx-auto flex min-w-0 flex-col gap-4 px-4 pt-1.5 pb-12 @min-[480px]/storage:px-5">
          {failed !== null && (
            <Notice tone="danger" icon={TriangleAlert} title={'Refused'} actions={<Button size="sm" variant="ghost" className="h-7 rounded-lg-plus px-2 text-sm" onClick={() => setFailed(null)}>{'Dismiss'}</Button>}>
              <Refusal error={failed} />
            </Notice>
          )}
          <StorePage
            key={detail}
            name={detail}
            view={view}
            job={jobOf(detail)}
            jobs={allJobs.filter((j) => j.store === detail)}
            sandboxes={sandboxes}
            catalog={catalog}
            actions={actionsFor}
            onBack={() => onOpenStore?.(null)}
            back={back}
            onOpenProject={onOpenProject && live((key: string) => onOpenProject(key, detail))}
          />
        </div>
        {dialogs}
      </div>
    )

  const q = query.trim().toLowerCase()
  const findingsFor = (name: string) => (simulated ? [] : (doctor.data?.findings ?? []).filter((f) => f.entity?.kind === 'store' && f.entity.name === name))
  const sections = ordered.map((s) => {
    const all = s.projects.map((name) => {
      const key = `${s.name}/${name}`
      return { key, name, row: rows.byKey.get(key) }
    })
    const storeHit = !q || `${s.name} ${s.kind} ${s.machine ?? ''} ${s.postgresql?.target ?? ''}`.toLowerCase().includes(q)
    const projects = storeHit ? all : all.filter((p) => `${p.name} ${p.row?.runs?.map((r) => r.machine).join(' ') ?? ''}`.toLowerCase().includes(q))
    return { s, projects, searching: !storeHit, show: storeHit || projects.length > 0 }
  })
  const shownSections = sections.filter((x) => x.show)
  const projectCount = stores.reduce((n, s) => n + s.projects.length, 0)

  return (
    <div className="@container/storage h-svh min-w-0 overflow-y-auto">
      <PageHeader
        sticky
        size="md"
        className="page-header-solid"
        title={'Storage'}
        badges={
          view && (
            <JobsChip running={counts.running} failed={counts.failed} onShow={jobStore ? () => requestAnimationFrame(() => flashStore(jobStore)) : undefined} />
          )
        }
        actions={
          <div className="flex h-8 items-center gap-2">
            <SimulationPicker />
            <div className="group/search relative w-64 min-w-40">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/search:text-(--icon-accent)" />
              <Input
                aria-label={'Search stores and projects'}
                placeholder={'Search stores and projects'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    setQuery('')
                  }
                }}
                className="glass h-8 rounded-full pl-9 pr-8 text-base shadow-xs focus-visible:ring-primary/40"
              />
              {query && (
                <button type="button" aria-label={'Clear search'} onClick={() => setQuery('')} className="absolute top-1/2 right-2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-3" />
                </button>
              )}
            </div>
            <Button size="sm" variant="outline" className="rounded-full px-3.5" onClick={() => setBuckets(null)} title={'The buckets Store backups go to, and their files'}>
              <Archive />
              {'Backup buckets'}
              {view && <span className="tabular-nums text-muted-foreground">{view.buckets.length}</span>}
            </Button>
            <Button size="sm" className="rounded-full px-3.5" onClick={live(() => setNewOpen('empty'))} title={'An empty or restored SQLite Store, or a PostgreSQL database'}>
              <Plus />
              {'New Store'}
            </Button>
            <Button variant="outline" size="icon-sm" className="rounded-full" aria-label={'Refresh'} title={'Refresh'} onClick={() => { refresh(); catalog.reload() }}>
              <RotateCw />
            </Button>
          </div>
        }
      />
      <div className="mx-auto flex min-w-0 flex-col gap-3 px-4 pt-0 pb-12 @min-[480px]/storage:px-5">
        {!view ? (
          storage.error ? <LoadError error={storage.error} what={'the storage'} onRetry={storage.reload} /> : <Loading label={'Reading the Stores'} />
        ) : (
          <>
            {failed && (
              <Notice tone="danger" icon={TriangleAlert} title={'Refused'} actions={<Button size="sm" variant="ghost" className="h-7 rounded-lg-plus px-2 text-sm" onClick={() => setFailed(null)}>{'Dismiss'}</Button>}>
                <Refusal error={failed} />
              </Notice>
            )}

            <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {[
                  fill(stores.length === 1 ? '1 Store' : '{n} Stores', { n: stores.length }),
                  fill(projectCount === 1 ? '1 project' : '{n} projects', { n: projectCount }),
                  sqlite.length > 0 && fill(sqlite.length === 1 ? '{size} in 1 sqlite Store' : '{size} in {n} sqlite Stores', { size: bytes(total), n: sqlite.length }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {!simulated && <span className="ml-auto"><DoctorBadge read={doctor} open={doctorOpen} onToggle={() => setDoctorOpen(!doctorOpen)} /></span>}
            </div>
            {doctorOpen && !simulated && <DoctorFindings read={doctor} />}

            {stores.length === 0 ? (
              <Empty
                icon={HardDrive}
                title={'No Stores yet'}
                className="glass-liquid rounded-2xl border-solid"
                action={
                  <Button size="sm" variant="outline" className="rounded-full px-3.5" onClick={live(() => setNewOpen('empty'))}>
                    <Plus /> {'New Store'}
                  </Button>
                }
              >
                {'Create a Store in the home, restore one from a backup, or connect a PostgreSQL database.'}
              </Empty>
            ) : shownSections.length === 0 ? (
              <Empty icon={SearchX} title={'Nothing matches'} className="rounded-2xl" action={<Button variant="outline" size="sm" onClick={() => setQuery('')}>{'Clear search'}</Button>}>
                {`No Store or project matches “${query.trim()}”. Search by name or machine.`}
              </Empty>
            ) : (
              <section aria-label={'Stores'} className="flex flex-col gap-4">
                {shownSections.map(({ s, projects, searching }, i) => (
                  <StoreSection
                    key={s.name}
                    index={Math.min(i, 12)}
                    store={s}
                    machine={view.machines.find((m) => m.name === s.machine)}
                    buckets={view.buckets}
                    job={jobOf(s.name)}
                    projects={projects}
                    searching={searching}
                    now={rows.now}
                    findings={findingsFor(s.name)}
                    on={actionsFor(s)}
                    onOpenProject={onOpenProject && live((key: string) => onOpenProject(key))}
                    onOpen={onOpenStore && ((newTab) => onOpenStore(s.name, newTab))}
                  />
                ))}
              </section>
            )}
            {stores.length > 0 && !q && <GapLine className="px-1 text-xs" what="Store totals (dedupe, compression, what Init stored)" />}

          </>
        )}
      </div>

      {dialogs}
    </div>
  )
}
