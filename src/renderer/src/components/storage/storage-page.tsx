// The Storage page on LayerFS 2.0 (docs/ui/layerfs-storage.md): the home of
// Stores and their backups. Stores: every Store's card in one grid: the
// sqlite Stores saved under the LayerFS home (`native`), those pushed to a
// machine (by machine; a Store is in exactly one place), then the PostgreSQL
// Stores (on no machine). Each card shows where it is, its size, its backup
// locations and state (or its PostgreSQL server), its main moves as buttons, every Store-wide action in
// its menu (push, pull, move, back up, add project, remove or disconnect),
// and its projects, each with its Sandboxes. Backups: the buckets and their
// files, with Restore. Each tab has its own header actions.
// A job shows on its Store's card and page (job-progress.tsx); the header's
// chip counts those running or failed. Above both tabs, what `layerfs doctor`
// finds. The view is read again on the host's `storage` events and on a poll;
// jobs move on `storage-job` events (host/storage-jobs.ts). A Store's page
// (focus `store:<name>`) shows in place of the board, with the same dialogs.
import { Archive, ChevronDown, HardDrive, House, Plus, RotateCw, TriangleAlert, Unplug } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { GapLine } from '@/components/gap-line'
import { Segmented } from '@/components/motion'
import { PageHeader } from '@/components/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { Refusal } from '@/components/refusal'
import { SIMULATED_REFUSAL, SimulationPicker, useSimulation } from '@/components/simulation'
import { BucketCard } from '@/components/storage/bucket-card'
import { ConfirmByName } from '@/components/storage/dialogs/confirm-by-name'
import { DoctorBadge, DoctorFindings, useDoctor } from '@/components/storage/needs-attention'
import { NewDialog, type NewStorePane } from '@/components/storage/new-dialog'
import { Notice } from '@/components/storage/notice'
import { type StorageDialog, StorageDialogs } from '@/components/storage/storage-dialogs'
import { flashStore, JobsChip, useNow } from '@/components/storage/job-progress'
import { inHome, StoreCard } from '@/components/storage/store-card'
import { StorePage } from '@/components/storage/store-page'
import { focusOf } from '@/components/tabs/go'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SIMULATIONS } from '@/data/compute-sim'
import { bytes } from '@/data/format'
import { simStorage } from '@/data/home-sim'
import { cardJob, jobCounts } from '@/data/job-progress'
import { host, onHostEvent, onProjectsChanged } from '@/host/client'
import { dismissJob, seedJobs, useStorageJobs } from '@/host/storage-jobs'
import { useHostQuery, usePoll } from '@/host/use-host'
import type { ProjectCatalog } from '@/host/use-projects'
import { t, useI18n } from '@/i18n'
import type { MachineSandbox, StorageJob, StoreBackupLink, StoreRow } from '@shared/host-api'

import '@/components/storage/storage.css'

export { BACKUP } from '@/components/storage/bucket-card'

const byName = (a: StoreRow, b: StoreRow) => a.name.localeCompare(b.name)
const sizeOf = (list: StoreRow[]) => list.reduce((n, s) => n + (s.size?.bytes ?? 0), 0)

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-4'

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
}

export function StoragePage({ catalog, onOpenProject, onAddProject, onOpenStore, focus, back }: StoragePageProps) {
  useI18n()
  const [tick, setTick] = useState(0)
  const reload = () => setTick((n) => n + 1)
  // machines (for Sandbox counts) and doctor are read on load, Refresh and changes, not on the poll
  const [look, setLook] = useState(0)
  const [checks, setChecks] = useState(0)
  const storage = useHostQuery(() => host.storage(), [tick], 'storage')
  const machinesRead = useHostQuery(() => host.machines(), [look])
  const doctor = useDoctor(checks)
  const known = useStorageJobs()
  const now = useNow(10_000)
  const [tab, setTab] = useState<'stores' | 'backups'>('stores')
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [dialog, setDialog] = useState<StorageDialog | null>(null)
  const [removing, setRemoving] = useState<StoreRow | null>(null)
  const [dropping, setDropping] = useState<{ kind: 'postgresql' | 'bucket'; name: string } | null>(null)
  const [listing, setListing] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState<null | NewStorePane>(null)
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

  const cards = (list: StoreRow[]) => (
    <div className={GRID}>
      {list.map((s, i) => (
        <StoreCard
          key={s.name}
          index={Math.min(i, 12)}
          store={s}
          machine={view?.machines.find((m) => m.name === s.machine)}
          buckets={view?.buckets ?? []}
          job={jobOf(s.name)}
          sandboxes={sandboxes}
          onOpenProject={onOpenProject && live((key: string) => onOpenProject(key))}
          onOpen={onOpenStore && ((newTab) => onOpenStore(s.name, newTab))}
          on={actionsFor(s)}
        />
      ))}
    </div>
  )

  const dialogs = (
    <>
      <NewDialog open={newOpen !== null} initial={newOpen ?? 'empty'} onOpenChange={(o) => !o && setNewOpen(null)} view={view} onChanged={done} onNewBucket={() => { setTab('backups'); setDialog({ kind: 'bucket' }) }} />
      <StorageDialogs dialog={dialog} view={view} onClose={() => setDialog(null)} done={done} />
      <ConfirmByName
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('Remove {store}?', { store: removing?.name ?? '' })}
        body={t('The Store and every project in it ({n}) are deleted with all their history. Backups in buckets stay.', { n: removing?.projects.length ?? 0 })}
        name={removing?.name}
        action={t('Remove')}
        onConfirm={async (typed) => {
          await host.removeStore(removing!.name, typed)
          done()
        }}
      />
      <ConfirmByName
        open={!!dropping}
        onOpenChange={(o) => !o && setDropping(null)}
        icon={Unplug}
        title={t(dropping?.kind === 'bucket' ? 'Disconnect the bucket {name}?' : 'Disconnect the PostgreSQL Store {name}?', { name: dropping?.name ?? '' })}
        body={
          dropping?.kind === 'bucket'
            ? t('Every Store’s link to this bucket goes too: their backup chips and states are lost. The files stay in the bucket.')
            : t('This home forgets the Store and its projects. The database and its data stay; connect it again to use them.')
        }
        action={t('Disconnect')}
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
        <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-4 px-4 pt-6 pb-12 @min-[30rem]/storage:px-6 @min-[56rem]/storage:px-8">
          {failed !== null && (
            <Notice tone="danger" icon={TriangleAlert} title={t('Refused')} actions={<Button size="sm" variant="ghost" className="h-7 rounded-xl px-2 text-xs" onClick={() => setFailed(null)}>{t('Dismiss')}</Button>}>
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

  return (
    <div className="@container/storage h-svh min-w-0 overflow-y-auto">
      <PageHeader
        sticky
        className="page-header-solid"
        width="max-w-5xl"
        title={t('Storage')}
        badges={
          view && (
            <>
              <Segmented
                aria-label={t('Storage')}
                role="tablist"
                className="ml-3"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'stores', label: t('Stores'), count: view.stores.length },
                  { value: 'backups', label: t('Backups'), count: view.buckets.length },
                ]}
              />
              <JobsChip
                running={counts.running}
                failed={counts.failed}
                onShow={
                  jobStore
                    ? () => {
                        setTab('stores')
                        requestAnimationFrame(() => flashStore(jobStore))
                      }
                    : undefined
                }
              />
            </>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            <SimulationPicker />
            {tab === 'stores' ? (
              <Button size="sm" className="rounded-full px-3.5" onClick={live(() => setNewOpen('empty'))} title={t('An empty or restored SQLite Store, or a PostgreSQL database')}>
                <Plus />
                {t('New Store')}
              </Button>
            ) : (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full px-3.5" disabled={!sqlite.length || !view?.buckets.length}>
                      <Archive />
                      {t('Back up a Store…')}
                      <ChevronDown className="size-3.5 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
                    {sqlite.map((s) => (
                      <DropdownMenuItem key={s.name} disabled={s.state === 'down' || s.state === 'busy'} onSelect={live(() => setDialog({ kind: 'backup', store: s }))}>
                        {inHome(s) ? <House /> : <HardDrive />}
                        <span className="font-mono">{s.name}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">{inHome(s) ? t('Home') : s.machine}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" className="rounded-full px-3.5" onClick={live(() => setDialog({ kind: 'bucket' }))}>
                  <Plus />
                  {t('New bucket')}
                </Button>
              </>
            )}
            <Button variant="outline" size="icon-sm" className="rounded-full" aria-label={t('Refresh')} title={t('Refresh')} onClick={refresh}>
              <RotateCw />
            </Button>
          </div>
        }
      />
      <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-3 px-4 pt-2 pb-12 @min-[30rem]/storage:px-6 @min-[56rem]/storage:px-8">
        {!view ? (
          storage.error ? <LoadError error={storage.error} what={t('the storage')} onRetry={storage.reload} /> : <Loading label={t('Reading the Stores')} />
        ) : (
          <>
            {failed && (
              <Notice tone="danger" icon={TriangleAlert} title={t('Refused')} actions={<Button size="sm" variant="ghost" className="h-7 rounded-xl px-2 text-xs" onClick={() => setFailed(null)}>{t('Dismiss')}</Button>}>
                <Refusal error={failed} />
              </Notice>
            )}

            <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 px-1">
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {tab === 'stores' && sqlite.length > 0 && t(sqlite.length === 1 ? '{size} in 1 sqlite Store' : '{size} in {n} sqlite Stores', { size: bytes(total), n: sqlite.length })}
              </span>
              {!simulated && <DoctorBadge read={doctor} open={doctorOpen} onToggle={() => setDoctorOpen(!doctorOpen)} />}
            </div>
            {doctorOpen && !simulated && <DoctorFindings read={doctor} />}

            {tab === 'stores' ? (
              <>
                {stores.length === 0 ? (
                  <Empty
                    icon={HardDrive}
                    title={t('No Stores yet')}
                    className="glass-liquid rounded-2xl border-solid"
                    action={
                      <Button size="sm" variant="outline" className="rounded-full px-3.5" onClick={live(() => setNewOpen('empty'))}>
                        <Plus /> {t('New Store')}
                      </Button>
                    }
                  >
                    {t('Create a Store in the home, restore one from a backup, or connect a PostgreSQL database.')}
                  </Empty>
                ) : (
                  <section aria-label={t('Stores')}>{cards(ordered)}</section>
                )}
                {stores.length > 0 && <GapLine className="px-1 pt-1 text-[11px]" what="Store totals (dedupe, compression, what Init stored)" />}
              </>
            ) : (
              <>
                {view.buckets.length === 0 ? (
                  <Empty
                    icon={Archive}
                    title={t('No bucket connected')}
                    className="glass-liquid rounded-2xl border-solid"
                    action={
                      <Button size="sm" variant="outline" className="rounded-full px-3.5" onClick={live(() => setDialog({ kind: 'bucket' }))}>
                        <Plus /> {t('New bucket')}
                      </Button>
                    }
                  >
                    {t('No bucket connected. Connect an r2 or MinIO bucket to back Stores up.')}
                  </Empty>
                ) : (
                  view.buckets.map((b, i) => <BucketCard key={b.name} bucket={b} index={i} listing={listing === b.name} onList={live(() => void listBucket(b.name))} onRestore={live((file) => setDialog({ kind: 'restore', bucket: b.name, file }))} onDisconnect={live(() => setDropping({ kind: 'bucket', name: b.name }))} />)
                )}
                <p className="px-1 text-[11px] text-muted-foreground">{t('A restore always saves the Store in the home; push it to a machine afterwards.')}</p>
              </>
            )}
          </>
        )}
      </div>

      {dialogs}
    </div>
  )
}
