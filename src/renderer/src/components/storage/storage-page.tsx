// The Storage page on LayerFS 2.0 (docs/ui/layerfs-storage.md): sqlite Stores
// grouped by the machine that holds them, PostgreSQL Stores, buckets with
// their backups, and the moves, backups and restores this host started.
// Every Store row shows its projects, size, state (idle, in use, moving,
// down) and backup chips; its menu moves it, backs it up, adds a project
// (native only) or removes it. The view is read again on the host's
// `storage` events; jobs move on `storage-job` events.
import { Archive, ArrowRightLeft, ChevronDown, Database, Ellipsis, FolderPlus, HardDrive, HardDriveDownload, HardDriveUpload, ListRestart, Plus, RotateCw, Trash2, TriangleAlert, Unplug } from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'

import { GapLine } from '@/components/gap-line'
import { PageHeader } from '@/components/motion/page-header'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { Refusal } from '@/components/refusal'
import { StateChip } from '@/components/state-chip'
import { Chip, type Tone } from '@/components/storage/chips'
import { ConfirmByName } from '@/components/storage/dialogs/confirm-by-name'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { Bar } from '@/components/storage/meters'
import { Notice } from '@/components/storage/notice'
import { Card } from '@/components/storage/overview/row-parts'
import { NewDialog } from '@/components/storage/new-dialog'
import { type StorageDialog, StorageDialogs } from '@/components/storage/storage-dialogs'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/data/format'
import { clearingCall, opWords } from '@/data/states'
import { host, onHostEvent, onProjectsChanged } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import type { ProjectCatalog } from '@/host/use-projects'
import { t, useI18n } from '@/i18n'
import type { BackupFile, BackupState, BucketRow, StorageJob, StorageView, StoreRow } from '@shared/host-api'

import '@/components/storage/storage.css'

export const BACKUP: Record<BackupState, { tone: Tone; label: string; dashed?: boolean }> = {
  current: { tone: 'success', label: 'Backed up' },
  store_changed: { tone: 'warning', label: 'Store changed' },
  bucket_changed: { tone: 'warning', label: 'Bucket changed' },
  both_changed: { tone: 'danger', label: 'Both changed' },
  unknown: { tone: 'neutral', label: 'Unknown', dashed: true },
  unlinked: { tone: 'neutral', label: 'Not linked' },
  missing: { tone: 'danger', label: 'Missing' },
}

const MACHINE_ORDER = (a: { name: string }, b: { name: string }) => (a.name === 'native' ? -1 : b.name === 'native' ? 1 : a.name === 'docker' ? -1 : b.name === 'docker' ? 1 : a.name.localeCompare(b.name))

interface StoragePageProps {
  catalog: ProjectCatalog
  /** Opens a project's page by its key. */
  onOpenProject?: (key: string) => void
  /** Opens New project with the Store chosen. */
  onAddProject?: (store: string) => void
}

export function StoragePage({ catalog, onOpenProject, onAddProject }: StoragePageProps) {
  useI18n()
  const [tick, setTick] = useState(0)
  const reload = () => setTick((n) => n + 1)
  const storage = useHostQuery(() => host.storage(), [tick], 'storage')
  const [jobs, setJobs] = useState<Map<string, StorageJob>>(new Map())
  const [dialog, setDialog] = useState<StorageDialog | null>(null)
  const [removing, setRemoving] = useState<StoreRow | null>(null)
  const [dropping, setDropping] = useState<{ kind: 'postgresql' | 'bucket'; name: string } | null>(null)
  const [listing, setListing] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState<null | 'empty' | 'add' | 'postgresql'>(null)
  const [failed, setFailed] = useState<unknown>(null)
  /** A menu action that answers at once (a pull starts a job): its refusal shows on the page. */
  const act = (work: () => Promise<unknown>) => {
    setFailed(null)
    work().then(reload, (e: unknown) => setFailed(e))
  }
  useEffect(() => onProjectsChanged(reload), [])
  useEffect(
    () =>
      onHostEvent((e) => {
        if (e.type === 'storage') reload()
        else if (e.type === 'storage-job') setJobs((m) => new Map(m).set(e.job.id, e.job))
      }),
    [],
  )
  const view = storage.data
  const done = () => {
    reload()
    catalog.reload()
  }
  // the view's jobs, with what events said since
  const allJobs = view ? [...new Map([...view.jobs.map((j) => [j.id, j] as const), ...[...jobs.values()].map((j) => [j.id, j] as const)]).values()].sort((x, y) => y.started - x.started) : []
  const sqlite = view?.stores.filter((s) => s.kind === 'sqlite') ?? []
  const postgresql = view?.stores.filter((s) => s.kind === 'postgresql') ?? []
  const groups = view ? [...view.machines].sort(MACHINE_ORDER).map((m) => ({ machine: m, stores: sqlite.filter((s) => s.machine === m.name) })).filter((g) => g.stores.length) : []
  const listBucket = async (name: string) => {
    setListing(name)
    try {
      await host.listBucket(name)
    } finally {
      setListing(null)
      reload()
    }
  }

  return (
    <div className="@container/storage h-svh min-w-0 overflow-y-auto">
      <PageHeader
        sticky
        className="page-header-solid"
        width="max-w-5xl"
        title={t('Storage')}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" className="rounded-full px-3.5" onClick={() => setNewOpen('empty')}>
              <Plus />
              {t('New')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="rounded-full px-3.5">
                  <Unplug />
                  {t('Connect…')}
                  <ChevronDown className="size-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setNewOpen('postgresql')}>
                  <Database /> {t('A PostgreSQL Store')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setNewOpen('add')}>
                  <Archive /> {t('A bucket for backups')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" className="rounded-full px-3.5" onClick={reload}>
              <RotateCw />
              {t('Refresh')}
            </Button>
          </div>
        }
      />
      <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-4 px-4 pt-2 pb-12 @min-[30rem]/storage:px-6 @min-[56rem]/storage:px-8">
        {!view ? (
          storage.error ? <LoadError error={storage.error} what={t('the storage')} onRetry={storage.reload} /> : <Loading label={t('Reading the Stores')} />
        ) : (
          <>
            <GapLine what="Store totals (dedupe, compression, what Init stored)" />
            {failed && (
              <Notice tone="danger" icon={TriangleAlert} title={t('Refused')} actions={<Button size="sm" variant="ghost" className="h-7 rounded-xl px-2 text-xs" onClick={() => setFailed(null)}>{t('Dismiss')}</Button>}>
                <Refusal error={failed} />
              </Notice>
            )}
            {(allJobs.length > 0 || view.stores.some((s) => s.op)) && (
              <section className="flex flex-col gap-2" aria-label={t('Operations')}>
                <h2 className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t('Operations')}</h2>
                {/* operations LayerFS records (any process's: the CLI's too) on Stores this host is not running a job on */}
                {view.stores.filter((s) => s.op && !allJobs.some((j) => j.store === s.name && !j.ended)).map((s) => (
                  <OpRow key={s.name} store={s} />
                ))}
                {allJobs.slice(0, 8).map((j) => (
                  <JobRow key={j.id} job={j} />
                ))}
              </section>
            )}

            {view.stores.length === 0 && (
              <Empty icon={HardDrive} title={t('No Stores yet')} className="glass-liquid rounded-2xl border-solid">
                {t('Create a Store on native, add projects, push it to any machine.')}
              </Empty>
            )}

            {groups.map(({ machine, stores }, i) => (
              <Card key={machine.name} index={i} className="p-0">
                <header className="flex items-center gap-2 border-b border-foreground/[0.06] px-5 py-3">
                  <HardDrive aria-hidden="true" className="size-4 text-(--icon-accent)" />
                  <h2 className="text-sm font-semibold">{machine.name}</h2>
                  <span className="text-xs text-muted-foreground">{machine.platform}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t(stores.length === 1 ? '1 Store' : '{n} Stores', { n: stores.length })}</span>
                </header>
                <ul className="divide-y divide-foreground/[0.05]">
                  {stores.map((s) => (
                    <StoreLine
                      key={s.name}
                      store={s}
                      view={view}
                      onOpenProject={onOpenProject}
                      menu={
                        <>
                          {s.machine === 'native' ? (
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'push', store: s })} disabled={s.state !== 'idle'}>
                              <HardDriveUpload /> {t('Push to…')}
                            </DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem onSelect={() => act(() => host.pullStore(s.name))} disabled={s.state === 'busy'}>
                                <HardDriveDownload /> {t('Pull to native')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'move', store: s })} disabled={s.state === 'busy'}>
                                <ArrowRightLeft /> {t('Move to another machine…')}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'backup', store: s })} disabled={s.state === 'down' || s.state === 'busy'}>
                            <Archive /> {t('Back up to…')}
                          </DropdownMenuItem>
                          {/* project.init goes only into a Store on native (§9 Q9) */}
                          <DropdownMenuItem onSelect={() => onAddProject?.(s.name)} disabled={s.machine !== 'native' || !onAddProject}>
                            <FolderPlus /> {t(s.machine === 'native' ? 'Add project' : 'Add project (native only)')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(s)}>
                            <Trash2 /> {t('Remove…')}
                          </DropdownMenuItem>
                        </>
                      }
                    />
                  ))}
                </ul>
              </Card>
            ))}

            {postgresql.length > 0 && (
              <Card index={groups.length} className="p-0">
                <header className="flex items-center gap-2 border-b border-foreground/[0.06] px-5 py-3">
                  <Database aria-hidden="true" className="size-4 text-(--icon-accent)" />
                  <h2 className="text-sm font-semibold">{t('PostgreSQL Stores')}</h2>
                  <span className="ml-auto text-xs text-muted-foreground">{t('Connected databases: they never move')}</span>
                </header>
                <ul className="divide-y divide-foreground/[0.05]">
                  {postgresql.map((s) => (
                    <StoreLine
                      key={s.name}
                      store={s}
                      view={view}
                      onOpenProject={onOpenProject}
                      menu={
                        <>
                          <DropdownMenuItem onSelect={() => onAddProject?.(s.name)} disabled={!onAddProject}>
                            <FolderPlus /> {t('Add project')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDropping({ kind: 'postgresql', name: s.name })}>
                            <Unplug /> {t('Disconnect…')}
                          </DropdownMenuItem>
                        </>
                      }
                    />
                  ))}
                </ul>
              </Card>
            )}

            <section className="flex flex-col gap-2.5 pt-2" aria-labelledby="buckets-title">
              <h2 id="buckets-title" className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {t('Buckets and backups')}
              </h2>
              {view.buckets.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{t('No bucket connected. Connect an r2 or MinIO bucket to back Stores up.')}</p>
              ) : (
                view.buckets.map((b, i) => <BucketCard key={b.name} bucket={b} index={i} listing={listing === b.name} onList={() => void listBucket(b.name)} onRestore={(file) => setDialog({ kind: 'restore', bucket: b.name, file })} onDisconnect={() => setDropping({ kind: 'bucket', name: b.name })} />)
              )}
            </section>
          </>
        )}
      </div>

      <NewDialog open={newOpen !== null} initial={newOpen ?? 'empty'} onOpenChange={(o) => !o && setNewOpen(null)} view={view} onChanged={done} />
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
    </div>
  )
}

/** One Store: its name, projects, size, state, backup chips and menu. */
function StoreLine({ store: s, view, menu, onOpenProject }: { store: StoreRow; view: StorageView; menu: React.ReactNode; onOpenProject?: (key: string) => void }) {
  useI18n()
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <StoreIcon family={s.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] font-semibold">{s.name}</span>
          <StateChip entity="store" state={s.state} op={s.op} />
          {s.links.map((l) => {
            const listed = view.buckets.find((b) => b.name === l.bucket)?.files?.find((f) => f.file === l.file && f.store === s.name)
            const chip = BACKUP[listed?.state ?? 'unknown']
            return (
              <span key={l.bucket} title={listed?.reason ?? (listed ? `${l.bucket}/${l.file}` : t('{bucket} not listed yet', { bucket: l.bucket }))}>
                <Chip tone={chip.tone} dashed={chip.dashed} icon={Archive}>
                  {l.bucket}: {t(chip.label)}
                </Chip>
              </span>
            )
          })}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          {s.projects.length === 0
            ? t('No projects')
            : s.projects.map((p, i) => (
                <span key={p}>
                  {i > 0 && ', '}
                  <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => onOpenProject?.(`${s.name}/${p}`)}>
                    {p}
                  </button>
                </span>
              ))}
          <span aria-hidden="true">·</span>
          <span className="tabular-nums" title={s.size ? t('{file} file, {wal} WAL', { file: bytes(s.size.file), wal: bytes(s.size.wal) }) : undefined}>
            {s.kind === 'postgresql' ? t('in its database') : s.size ? bytes(s.size.bytes) : t('size unknown')}
          </span>
          {s.down && <span className="text-destructive">· {s.down}</span>}
        </p>
        {s.state === 'unresolved' && (
          <p className="mt-1 font-mono text-[11px] text-destructive">{t('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}</p>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t('{store}’s actions', { store: s.name })} className="rounded-xl text-muted-foreground">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** One bucket: its linked Stores and the files of its last listing (backup.list), each with its state. */
function BucketCard({ bucket: b, index, listing, onList, onRestore, onDisconnect }: { bucket: BucketRow; index: number; listing: boolean; onList: () => void; onRestore: (file: string) => void; onDisconnect: () => void }) {
  useI18n()
  return (
    <Card index={index} className="p-0">
      <header className="flex flex-wrap items-center gap-2 border-b border-foreground/[0.06] px-5 py-3">
        <Archive aria-hidden="true" className="size-4 text-(--icon-accent)" />
        <h3 className="font-mono text-sm font-semibold">{b.name}</h3>
        <span className="text-xs text-muted-foreground">{b.listed ? t('listed {when}', { when: ago(b.listed) }) : t('not listed yet')}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 rounded-xl px-2.5 text-xs" onClick={onList} disabled={listing}>
            <ListRestart className={listing ? 'motion-safe:animate-spin' : ''} />
            {t('List files')}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-xl px-2.5 text-xs text-muted-foreground" onClick={onDisconnect}>
            <Unplug />
            {t('Disconnect…')}
          </Button>
        </div>
      </header>
      {b.error && (
        <div className="px-5 pt-3">
          <Notice tone="danger" icon={TriangleAlert} title={t('The bucket did not list')}>
            {b.error.code}: {b.error.message}
          </Notice>
        </div>
      )}
      {b.files === null ? (
        <p className="px-5 py-3 text-xs text-muted-foreground">{t('List the bucket to see its files and their states (it is asked on each listing).')}</p>
      ) : b.files.length === 0 ? (
        <p className="px-5 py-3 text-xs text-muted-foreground">{t('No backups in this bucket.')}</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-5 py-2 font-medium">{t('File')}</th>
              <th className="px-2 py-2 font-medium">{t('Store')}</th>
              <th className="px-2 py-2 font-medium">{t('State')}</th>
              <th className="px-2 py-2 text-right font-medium">{t('Size')}</th>
              <th className="px-2 py-2 font-medium">{t('Written')}</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/[0.05]">
            {b.files.map((f: BackupFile) => {
              const chip = BACKUP[f.state] ?? BACKUP.unknown
              return (
                <tr key={`${f.file}:${f.store ?? ''}`}>
                  <td className="px-5 py-2 font-mono">{f.file}</td>
                  <td className="px-2 py-2 font-mono text-muted-foreground">{f.store ?? '—'}</td>
                  <td className="px-2 py-2" title={f.reason ?? undefined}>
                    <Chip tone={chip.tone} dashed={chip.dashed}>
                      {t(chip.label)}
                    </Chip>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{bytes(f.bytes)}</td>
                  <td className="px-2 py-2 text-muted-foreground" title={when(f.modified)}>
                    {f.modified ? ago(f.modified) : '—'}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {f.state !== 'missing' && (
                      <Button size="sm" variant="ghost" className="h-7 rounded-xl px-2 text-xs" onClick={() => onRestore(f.file)} title={t('Installs on native')}>
                        <HardDriveDownload />
                        {t('Restore…')}
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="px-5 pt-1 pb-3 text-[11px] text-muted-foreground">{t('A restore always installs on native, as a new Store.')}</p>
    </Card>
  )
}

/** An operation LayerFS records on a Store that this host did not start (or no longer tracks): a push from the CLI, an unresolved one. */
function OpRow({ store: s }: { store: StoreRow }) {
  useI18n()
  const uncertain = s.state === 'unresolved'
  return (
    <div className="glass-liquid reveal flex flex-col gap-1 rounded-2xl px-4 py-2.5 text-xs shadow-xs" style={{ '--i': 0 } as CSSProperties}>
      <div className="flex flex-wrap items-center gap-2">
        <StateChip entity="store" state={s.state} />
        <span className="font-mono">{s.name}</span>
        <span className="text-muted-foreground">{opWords(s.op)}</span>
        {s.op?.started && <span className="ml-auto text-muted-foreground">{t('started {when}', { when: ago(s.op.started) })}</span>}
      </div>
      {uncertain && <p className="font-mono text-[11px] text-destructive">{t('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}</p>}
    </div>
  )
}

const KIND = { push: 'Push', pull: 'Pull', move: 'Move', backup: 'Backup', restore: 'Restore' } as const

/** A job this host started: its phase, done/total where the call gives it, and how it ended. */
function JobRow({ job: j }: { job: StorageJob }) {
  useI18n()
  const [again, setAgain] = useState<string | null>(null)
  const running = !j.ended
  const share = j.total ? Math.min(1, (j.done ?? 0) / j.total) : null
  return (
    <div className="glass-liquid reveal flex flex-col gap-1.5 rounded-2xl px-4 py-2.5 text-xs shadow-xs" style={{ '--i': 0 } as CSSProperties}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={j.error ? 'danger' : running ? 'info' : 'success'} live={running}>
          {t(KIND[j.kind])}
        </Chip>
        <span className="font-mono">
          {j.store} {j.kind === 'restore' || j.kind === 'pull' ? '←' : '→'} {j.target}
          {j.file ? `/${j.file}` : ''}
        </span>
        {j.kind === 'move' && j.half && (
          <span className="text-muted-foreground">{t(j.half === 'pull' ? '1 of 2: pull to native' : '2 of 2: push to {machine}', { machine: j.target })}</span>
        )}
        <span className="text-muted-foreground">{j.error ? t('failed in {phase}', { phase: j.error.phase ?? t('an unknown phase') }) : running ? (j.phase ?? t('starting')) : t('done {when}', { when: ago(j.ended) })}</span>
        {share !== null && running && (
          <span className="ml-auto tabular-nums text-muted-foreground">
            {bytes(j.done)} / {bytes(j.total)}
          </span>
        )}
      </div>
      {share !== null && running && <Bar share={share} live />}
      {j.error && <Refusal error={j.error} className="text-destructive" />}
      {j.error?.note === 'pulled' && (
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          {t('The pull finished: {store} is on native now.', { store: j.store })}
          <Button size="sm" variant="outline" className="h-6 rounded-lg px-2 text-[11px]" disabled={again !== null} onClick={() => { setAgain('…'); host.pushStore(j.store, j.target).then(() => setAgain(null), (e: unknown) => setAgain(e instanceof Error ? e.message : String(e))) }}>
            <HardDriveUpload className="size-3" /> {t('Push to {machine} again', { machine: j.target })}
          </Button>
          {again && again !== '…' && <span className="text-destructive">{again}</span>}
        </p>
      )}
    </div>
  )
}
