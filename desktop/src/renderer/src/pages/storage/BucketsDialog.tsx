import { fill } from '@/lib/text'
// Backup buckets (docs/connect README, "Backup buckets"): one modal for the
// buckets Store backups go to. Left: the buckets added (provider, how many
// files, a dot when its listing failed or a backup drifted) and Add bucket.
// Right: the chosen bucket's SQLite files as backup.list answers them (one
// <prefix>/<file>/store.sqlite per Store backup): its Store, state, size, when
// written and the move that fits (Restore…, Sync backup, Back up now), with
// List again and Configure: where it points (LayerFS keeps that fixed), its
// keys (those Connect saved can be replaced), its Stores and Disconnect. Or
// the Add bucket form: a provider card (MinIO and Cloudflare R2 connect;
// Amazon S3 waits for a later LayerFS), its fields or a pasted URL, and the
// keys, which the host keeps in an owner-only file. Listing asks the bucket
// each time, so it is a button, never automatic.
import { Archive, ArrowLeft, Database, HardDriveDownload, KeyRound, ListRestart, LoaderCircle, Plus, RefreshCw, Settings2, TriangleAlert, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Refusal } from '@/components/layerfs/Refusal'
import { SIMULATED_REFUSAL } from '@/components/layerfs/Simulation'
import { BACKUP } from '@/pages/storage/BucketCard'
import { Chip } from '@/components/layerfs/Chips'
import { Tile } from '@/pages/storage/StorageIcons'
import { type FieldValues, type ProviderEntry, PROVIDERS } from '@/components/layerfs/identity/providers'
import { Notice } from '@/pages/storage/Notice'
import { Choice, ProviderTile, SecretField, TextField } from '@/pages/storage/StorageDialogs'
import { go } from '@/layerfs/go'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ago, bytes, when } from '@/layerfs/format'
import { host } from '@/layerfs/client'
import { cn } from '@/lib/utils'
import type { BackupFile, BucketRow, StorageView } from '@/layerfs/host-api'

/** What the modal shows: a bucket by name, the Add form, or (null) the first bucket. */
export type BucketsFocus = string | { add: true } | null

const SHORT: Record<string, string> = { minio: 'MinIO', r2: 'R2' }
const LONG: Record<string, string> = { minio: 'MinIO', r2: 'Cloudflare R2' }
/** The providers offered: those LayerFS backs up to, then Amazon S3 for later. */
const OFFERED = PROVIDERS.filter((p) => p.request || p.id === 's3')
const READY = OFFERED.filter((p) => p.request)
const KEY_FIELDS = new Set(['accessKey', 'secretKey'])
const SHARED_FIELDS = new Set(['name', 'bucket', 'prefix'])

/** A bucket that needs a look: its listing failed, or a backup in it drifted. */
const attention = (b: BucketRow) => !!b.error || (b.files ?? []).some((f) => f.state === 'both_changed' || f.state === 'missing' || f.state === 'store_changed' || f.state === 'bucket_changed')

/** A bucket's provider logo (MinIO, Cloudflare) on a tile; an archive box when its provider is not known. */
function BucketMark({ provider, size = 'sm' }: { provider: string | null; size?: 'sm' | 'md' }) {
  const entry = provider ? PROVIDERS.find((p) => p.id === provider) : undefined
  return entry ? <ProviderTile entry={entry} size={size} /> : <Tile size={size}><Archive aria-hidden="true" className="text-muted-foreground" /></Tile>
}

interface BucketsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  focus: BucketsFocus
  view: StorageView | undefined
  /** The bucket being listed now. */
  listing: string | null
  /** A simulated host (dev builds): every action is refused here. */
  simulated: boolean
  onList: (bucket: string) => void
  onRestore: (bucket: string, file: string) => void
  onDisconnect: (bucket: string) => void
  /** Backs `store` up to `bucket` as `file` (Sync backup, Back up now). */
  onBackup: (store: string, bucket: string, file: string) => void
  /** A bucket was connected: the page reads the view again. */
  onConnected: () => void
}

export function BucketsModal({ open, onOpenChange, focus, view, listing, simulated, onList, onRestore, onDisconnect, onBackup, onConnected }: BucketsModalProps) {
  const buckets = view?.buckets ?? []
  const [chosen, setChosen] = useState<BucketsFocus>(focus)
  useEffect(() => {
    if (open) setChosen(focus)
  }, [open, focus])
  const adding = (chosen !== null && typeof chosen === 'object') || buckets.length === 0
  const bucket = adding ? undefined : (buckets.find((b) => b.name === chosen) ?? buckets[0])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(640px,calc(100vh-64px))] gap-0 overflow-hidden p-0 sm:max-w-5xl" aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-foreground/[0.07] bg-foreground/[0.015]">
            <div className="px-4 pt-4 pb-3">
              <DialogTitle className="flex items-center gap-2 text-base-plus font-strong tracking-tight">
                <Archive aria-hidden="true" className="size-4 text-(--icon-accent)" />
                {'Backup buckets'}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">{'Where Store backups go'}</DialogDescription>
            </div>
            <ul aria-label={'Buckets'} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
              {buckets.map((b) => {
                const on = !adding && bucket?.name === b.name
                return (
                  <li key={b.name}>
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => setChosen(b.name)}
                      className={cn('flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', on ? 'bg-foreground/[0.06] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground')}
                    >
                      <BucketMark provider={b.provider} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate font-mono">{b.name}</span>
                          {attention(b) && <span aria-label={'Needs a look'} className={cn('size-1.5 shrink-0 rounded-full', b.error ? 'bg-destructive' : 'bg-amber-500')} />}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[b.provider ? (SHORT[b.provider] ?? b.provider) : null, b.files ? fill(b.files.length === 1 ? '1 file' : '{n} files', { n: b.files.length }) : 'not listed'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {buckets.length === 0 && <li className="px-2.5 py-2 text-sm text-muted-foreground">{'No bucket yet'}</li>}
            </ul>
            <div className="p-2">
              <button
                type="button"
                aria-current={adding ? 'true' : undefined}
                onClick={() => setChosen({ add: true })}
                className={cn('flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-2.5 py-2 text-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', adding ? 'border-foreground/25 bg-foreground/[0.04] text-foreground' : 'border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground')}
              >
                <Plus className="size-3.5" />
                {'Add bucket'}
              </button>
            </div>
          </aside>
          <section className="flex min-h-0 min-w-0 flex-col">
            {adding ? (
              <AddBucket key="add" simulated={simulated} taken={buckets.map((b) => b.name)} onConnected={(name) => { onConnected(); setChosen(name) }} />
            ) : bucket ? (
              <BucketPane key={bucket.name} bucket={bucket} view={view} listing={listing === bucket.name} simulated={simulated} onChanged={onConnected} onList={() => onList(bucket.name)} onRestore={(file) => onRestore(bucket.name, file)} onDisconnect={() => onDisconnect(bucket.name)} onBackup={(store, file) => onBackup(store, bucket.name, file)} />
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Where a bucket points, from its URL: MinIO's endpoint or R2's account, the bucket and the prefix. */
export function bucketPlace(url: string): { endpoint?: string; account?: string; jurisdiction?: string; bucket: string; prefix: string } | null {
  try {
    if (url.startsWith('r2://')) {
      const [path, query] = url.slice(5).split('?')
      const [account, bucket = '', ...prefix] = path.split('/').filter(Boolean)
      return { account, jurisdiction: new URLSearchParams(query ?? '').get('jurisdiction') ?? undefined, bucket, prefix: prefix.join('/') }
    }
    const u = new URL(url)
    const [bucket = '', ...prefix] = u.pathname.split('/').filter(Boolean)
    return { endpoint: u.origin, bucket, prefix: prefix.join('/') }
  } catch {
    return null
  }
}

/** The object a backup is in the bucket: `<prefix>/<file>/store.sqlite`. */
const objectKey = (prefix: string, file: string) => `${prefix ? `${prefix}/` : ''}${file}/store.sqlite`

/** One bucket: its SQLite files (each a whole Store's backup) with the move each needs, or Configure. */
function BucketPane({ bucket: b, view, listing, simulated, onList, onRestore, onDisconnect, onBackup, onChanged }: { bucket: BucketRow; view: StorageView | undefined; listing: boolean; simulated: boolean; onList: () => void; onRestore: (file: string) => void; onDisconnect: () => void; onBackup: (store: string, file: string) => void; onChanged: () => void }) {
  const [configuring, setConfiguring] = useState(false)
  const files = b.files
  const place = b.url ? bucketPlace(b.url) : null
  const total = (files ?? []).reduce((n, f) => n + (f.bytes ?? 0), 0)
  return (
    <>
      <header className="flex min-w-0 items-center gap-3 border-b border-foreground/[0.07] py-4 pr-14 pl-5">
        <BucketMark provider={b.provider} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate font-mono text-base-plus font-strong tracking-tight">{b.name}</h3>
            {b.provider && <span className="shrink-0 rounded-full bg-foreground/[0.05] px-2 py-px text-xs font-medium text-muted-foreground">{LONG[b.provider] ?? b.provider}</span>}
          </div>
          <p className={cn('min-w-0 truncate text-xs text-muted-foreground', b.url && 'font-mono')} title={b.url ?? undefined}>{b.url ?? 'Connected outside this host'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!configuring && (
            <Button size="sm" variant="outline" className="h-7 rounded-md px-2.5 text-sm" onClick={onList} disabled={listing}>
              <ListRestart className={cn('size-3.5', listing && 'motion-safe:animate-spin')} />
              {files === null ? 'List files' : 'List again'}
            </Button>
          )}
          <Button size="sm" variant={configuring ? 'secondary' : 'outline'} className="h-7 rounded-md px-2.5 text-sm" aria-pressed={configuring} onClick={() => setConfiguring((c) => !c)}>
            {configuring ? <ArrowLeft className="size-3.5" /> : <Settings2 className="size-3.5" />}
            {configuring ? 'Files' : 'Configure'}
          </Button>
        </div>
      </header>
      {configuring ? (
        <ConfigurePane key="configure" bucket={b} place={place} simulated={simulated} onDisconnect={onDisconnect} onChanged={onChanged} />
      ) : (
        <div key="files" className="tab-panel min-h-0 flex-1 gap-0! overflow-y-auto px-5 py-4">
          {b.error && (
            <div className="mb-3">
              <Notice tone="danger" icon={TriangleAlert} title={'The bucket did not list'}>
                {b.error.code}: {b.error.message}
              </Notice>
            </div>
          )}
          {files === null ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-foreground/15 px-6 py-10 text-center">
              <Database aria-hidden="true" className="size-5 text-muted-foreground" />
              <p className="max-w-sm text-sm text-muted-foreground">{'List the bucket to see its SQLite files and how each stands against its Store. It is asked each time you list it.'}</p>
              <Button size="sm" variant="outline" className="h-7 rounded-md px-2.5 text-sm" onClick={onList} disabled={listing}>
                {listing ? <LoaderCircle className="size-3.5 animate-spin" /> : <ListRestart className="size-3.5" />} {'List files'}
              </Button>
            </div>
          ) : files.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-foreground/15 px-6 py-10 text-center text-sm text-muted-foreground">{'No SQLite files here yet. Back a Store up from its card.'}</div>
          ) : (
            <>
              <p className="mb-2 flex flex-wrap items-center gap-x-1.5 px-1 text-xs text-muted-foreground">
                <span>{fill(files.length === 1 ? '1 SQLite file' : '{n} SQLite files', { n: files.length })}</span>
                <span aria-hidden="true" className="text-faint">·</span>
                <span className="tabular-nums">{bytes(total)}</span>
                {place?.prefix && (
                  <>
                    <span aria-hidden="true" className="text-faint">·</span>
                    <span>{'under'} <span className="font-mono text-foreground/80">{place.prefix}/</span></span>
                  </>
                )}
                {b.listed && (
                  <>
                    <span aria-hidden="true" className="text-faint">·</span>
                    <span>{`listed ${ago(b.listed)}`}</span>
                  </>
                )}
              </p>
              <div role="table" aria-label={`SQLite files in ${b.name}`} className="overflow-hidden rounded-xl ring-1 ring-foreground/[0.08] ring-inset">
                <div role="row" className={cn(FILE_GRID, 'border-b border-foreground/[0.06] bg-foreground/[0.02] py-1.5 text-3xs font-medium tracking-wide text-muted-foreground uppercase')}>
                  <span role="columnheader">{'File'}</span>
                  <span role="columnheader" className="hidden sm:block">{'State'}</span>
                  <span role="columnheader" className="hidden text-right sm:block">{'Size'}</span>
                  <span role="columnheader" className="hidden sm:block">{'Written'}</span>
                  <span role="columnheader"><span className="sr-only">{'Actions'}</span></span>
                </div>
                {files.map((f, i) => (
                  <FileRow key={`${f.file}:${f.store ?? ''}`} file={f} path={objectKey(place?.prefix ?? '', f.file)} first={i === 0} known={!!f.store && !!view?.stores.some((s) => s.name === f.store)} onRestore={() => onRestore(f.file)} onBackup={() => f.store && onBackup(f.store, f.file)} />
                ))}
              </div>
              <p className="mt-3 px-1 text-xs text-muted-foreground">{'A restore always makes a new Store in the home; the Store a backup came from is not changed.'}</p>
            </>
          )}
        </div>
      )}
    </>
  )
}

const FILE_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 sm:grid-cols-[minmax(0,1fr)_100px_64px_88px_120px]'

/** One SQLite file: its object path, its Store, its state, size and age, and the move it needs. */
function FileRow({ file: f, path, first, known, onRestore, onBackup }: { file: BackupFile; path: string; first: boolean; known: boolean; onRestore: () => void; onBackup: () => void }) {
  const chip = BACKUP[f.state] ?? BACKUP.unknown
  const move =
    f.state === 'store_changed' && known
      ? { label: 'Sync backup', icon: RefreshCw, run: onBackup, title: 'The Store changed since: back it up again' }
      : f.state === 'missing' && known
        ? { label: 'Back up now', icon: Archive, run: onBackup, title: 'The file is gone from the bucket: back the Store up again' }
        : f.state !== 'missing'
          ? { label: 'Restore…', icon: HardDriveDownload, run: onRestore, title: 'Saves it in the home as a new Store' }
          : null
  return (
    <div role="row" className={cn(FILE_GRID, 'bg-card/60 py-2.5', !first && 'border-t border-foreground/[0.06]')}>
      <span role="cell" className="flex min-w-0 items-center gap-2.5">
        <Database aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col">
          <span className="min-w-0 truncate font-mono text-sm" title={path}>
            <span className="text-foreground">{f.file}</span>
            <span className="text-muted-foreground">/store.sqlite</span>
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {f.store ? (
              <>
                {'Store'}{' '}
                <button type="button" onClick={() => go.store(f.store!)} className="rounded-sm font-mono outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" title={`Show ${f.store} on Storage`}>
                  {f.store}
                </button>
              </>
            ) : 'no Store'}
          </span>
        </span>
      </span>
      <span role="cell" className="hidden sm:block" title={f.reason ?? undefined}>
        <Chip tone={chip.tone} dashed={chip.dashed} className="h-5 px-2 text-3xs">{chip.label}</Chip>
      </span>
      <span role="cell" className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">{bytes(f.bytes)}</span>
      <span role="cell" className="hidden truncate text-sm text-muted-foreground sm:block" title={when(f.modified)}>{f.modified ? ago(f.modified) : '—'}</span>
      <span role="cell" className="flex justify-end">
        {move && (
          <Button size="xs" variant="ghost" className="rounded-md ring-1 ring-foreground/[0.08] ring-inset" onClick={move.run} title={move.title}>
            <move.icon /> {move.label}
          </Button>
        )}
      </span>
    </div>
  )
}

/** Configure: where the bucket points (fixed by LayerFS), its keys (Connect's own can be replaced), its Stores, and Disconnect. */
function ConfigurePane({ bucket: b, place, simulated, onDisconnect, onChanged }: { bucket: BucketRow; place: ReturnType<typeof bucketPlace>; simulated: boolean; onDisconnect: () => void; onChanged: () => void }) {
  const [replacing, setReplacing] = useState(false)
  const [access, setAccess] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const rows: [string, string | undefined][] = place
    ? [
        ['Provider', b.provider ? (LONG[b.provider] ?? b.provider) : undefined],
        place.account !== undefined ? ['Account', place.account] : ['Endpoint', place.endpoint],
        ...(place.jurisdiction ? [['Jurisdiction', place.jurisdiction] as [string, string]] : []),
        ['Bucket', place.bucket],
        ['Prefix', place.prefix || undefined],
        ['Region', b.region ?? undefined],
      ]
    : []
  const saveKeys = () => {
    if (simulated) return setError(SIMULATED_REFUSAL)
    setBusy(true)
    setError(null)
    host
      .replaceBucketKeys(b.name, { accessKey: access.trim(), secretKey: secret })
      .then(() => {
        setReplacing(false)
        setAccess('')
        setSecret('')
        setSaved(true)
        onChanged()
      })
      .catch((e: unknown) => setError(e))
      .finally(() => setBusy(false))
  }
  const section = 'flex flex-col gap-2.5'
  const heading = 'text-xs font-strong tracking-wide text-muted-foreground uppercase'
  return (
    <div className="tab-panel min-h-0 flex-1 gap-6! overflow-y-auto px-5 py-5">
      <section className={section}>
        <h4 className={heading}>{'Where it points'}</h4>
        {place ? (
          <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl bg-foreground/[0.025] px-4 py-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className={cn('min-w-0 truncate', label !== 'Provider' && 'font-mono', !value && 'text-faint')} title={value}>{value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="rounded-xl bg-foreground/[0.025] px-4 py-3 text-sm text-muted-foreground">{'This host did not connect it, so its place is not recorded here.'}</p>
        )}
        <p className="text-xs text-muted-foreground">{'LayerFS keeps a bucket’s place fixed. To back up somewhere else, add another bucket and back the Store up there.'}</p>
      </section>

      <section className={section}>
        <h4 className={heading}>{'Keys'}</h4>
        <div className="flex flex-col gap-3 rounded-xl bg-foreground/[0.025] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <KeyRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-sm">
              {b.keys === 'saved' ? (
                'Saved by Connect in an owner-only file on this computer.'
              ) : b.keys === 'reference' ? (
                <>
                  {'Read from'} <span className="font-mono">{b.key}</span>
                  <span className="text-muted-foreground">{` · ${'change them there'}`}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{'Not recorded on this host.'}</span>
              )}
            </p>
            {b.keys === 'saved' && !replacing && (
              <Button size="sm" variant="outline" className="h-7 shrink-0 rounded-md px-2.5 text-sm" onClick={() => { setReplacing(true); setSaved(false) }}>
                {'Replace keys'}
              </Button>
            )}
          </div>
          {saved && <p className="text-xs text-muted-foreground">{'New keys saved. List the bucket to check them.'}</p>}
          {replacing && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (access.trim() && secret && !busy) saveKeys()
              }}
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 flex-1"><TextField label={'Access key'} value={access} onChange={(v) => { setError(null); setAccess(v) }} mono autoFocus /></div>
                <div className="min-w-0 flex-1"><SecretField label={'Secret key'} value={secret} onChange={(v) => { setError(null); setSecret(v) }} /></div>
              </div>
              {error !== null && <Refusal error={error} className="text-sm text-destructive" />}
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" className="h-7 rounded-md px-2.5 text-sm" onClick={() => { setReplacing(false); setError(null) }}>{'Cancel'}</Button>
                <Button type="submit" size="sm" className="h-7 rounded-md px-3 text-sm" disabled={!access.trim() || !secret || busy}>
                  {busy && <LoaderCircle className="size-3.5 animate-spin" />}
                  {'Save keys'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className={section}>
        <h4 className={heading}>{'Stores backed up here'}</h4>
        {b.stores.length ? (
          <div className="flex flex-wrap gap-1.5">
            {b.stores.map((s) => (
              <button key={s} type="button" onClick={() => go.store(s)} title={`Show ${s} on Storage`} className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.04] px-2.5 py-1 font-mono text-sm outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-ring">
                <Database aria-hidden="true" className="size-3 text-muted-foreground" />
                {s}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{'No Store is linked yet. Back one up from its card.'}</p>
        )}
      </section>

      <section className="mt-auto flex items-center gap-4 rounded-xl border border-destructive/20 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-strong">{'Disconnect'}</p>
          <p className="text-xs text-muted-foreground">{'Stops backups here; its Stores lose their link. The files in the bucket stay.'}</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 shrink-0 rounded-md px-2.5 text-sm text-destructive hover:text-destructive" onClick={onDisconnect}>
          <Unplug className="size-3.5" />
          {'Disconnect…'}
        </Button>
      </section>
    </div>
  )
}

/** Add bucket: a provider, then its fields (or a pasted URL) and the keys. */
function AddBucket({ simulated, taken, onConnected }: { simulated: boolean; taken: string[]; onConnected: (name: string) => void }) {
  const [entry, setEntry] = useState<ProviderEntry>(READY[0])
  const [byUrl, setByUrl] = useState(false)
  const [values, setValues] = useState<FieldValues>(() => Object.fromEntries(READY[0].fields.map((f) => [f.key, f.default ?? ''])))
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const pick = (e: ProviderEntry) => {
    if (!e.request) return
    setEntry(e)
    setValues((v) => Object.fromEntries(e.fields.map((f) => [f.key, v[f.key] || (f.default ?? '')])))
  }
  const set = (key: string) => (v: string) => {
    setError(null)
    setValues((x) => ({ ...x, [key]: v }))
  }
  const fields = byUrl ? entry.fields.filter((f) => f.key === 'name' || KEY_FIELDS.has(f.key)) : entry.fields
  const problems = Object.fromEntries(fields.map((f) => [f.key, values[f.key] ? (f.validate?.(values[f.key]) ?? null) : null]))
  const name = (values.name ?? '').trim()
  if (name && taken.includes(name)) problems.name = 'A bucket has this name already.'
  const missing = [...fields.filter((f) => f.needed && !values[f.key]?.trim()).map((f) => f.needed!), ...(byUrl && !url.trim() ? ['URL'] : [])]
  const valid = !missing.length && Object.values(problems).every((p) => !p)
  const urlHint = entry.id === 'r2' ? 'r2://<account>/<bucket>/<prefix>' : 'http://localhost:9000/<bucket>/<prefix>'

  const submit = () => {
    if (simulated) return setError(SIMULATED_REFUSAL)
    setBusy(true)
    setError(null)
    const input = byUrl
      ? { name, url: url.trim(), provider: entry.id as 'minio' | 'r2', accessKey: values.accessKey?.trim(), secretKey: values.secretKey }
      : entry.request!(values)
    host
      .connectBucket(input)
      // connecting is only a record: list it at once, so a wrong endpoint or key shows here
      .then(() => host.listBucket(input.name))
      .then((listed) => {
        if (listed.error) setError(new Error(`${listed.error.code}: ${listed.error.message}`))
        onConnected(input.name)
      })
      .catch((e: unknown) => setError(e))
      .finally(() => setBusy(false))
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid && !busy) submit()
      }}
    >
      <header className="border-b border-foreground/[0.07] py-4 pr-14 pl-5">
        <h3 className="text-base-plus font-strong tracking-tight">{'Add bucket'}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{'A bucket that holds SQLite Store backups. Connecting it links no Store.'}</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <div role="radiogroup" aria-label={'Provider'} className="grid grid-cols-3 gap-2.5">
          {OFFERED.map((p) => {
            const on = p.id === entry.id
            const ready = !!p.request
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={!ready}
                onClick={() => pick(p)}
                title={ready ? undefined : `LayerFS 2.0 backs up to MinIO and Cloudflare R2; ${p.label} comes with a later LayerFS.`}
                className={cn(
                  'flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'border-primary/40 bg-primary/[0.04] shadow-xs' : 'border-foreground/[0.08] bg-background/40',
                  ready ? (on ? '' : 'hover:bg-foreground/[0.03]') : 'cursor-not-allowed opacity-55',
                )}
              >
                <ProviderTile entry={p} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-md font-strong">{p.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{ready ? 'Supported' : 'Later LayerFS'}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1 self-start rounded-lg bg-foreground/[0.05] p-0.5 text-sm" role="radiogroup" aria-label={'How to give its place'}>
          {[
            [false, 'Fields'],
            [true, 'Paste a URL'],
          ].map(([mode, label]) => (
            <button key={String(mode)} type="button" role="radio" aria-checked={byUrl === mode} onClick={() => setByUrl(mode as boolean)} className={cn('rounded-md px-2.5 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', byUrl === mode ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
              {label as string}
            </button>
          ))}
        </div>

        {[
          { title: 'Where', rows: byUrl ? [fields.filter((f) => f.key === 'name')] : [fields.filter((f) => SHARED_FIELDS.has(f.key)), fields.filter((f) => !SHARED_FIELDS.has(f.key) && !KEY_FIELDS.has(f.key))] },
          { title: 'Keys', rows: [fields.filter((f) => KEY_FIELDS.has(f.key))] },
        ].map((g) => (
          <section key={g.title} className="flex flex-col gap-3">
            <h4 className="text-xs font-strong tracking-wide text-muted-foreground uppercase">{g.title}</h4>
            {g.rows.filter((row) => row.length).map((row, r) => (
              <div key={r} className="flex flex-col gap-x-4 gap-y-3 sm:flex-row">
                {row.map((f) => (
                  <div key={f.key} className={f.kind === 'select' ? 'shrink-0 sm:min-w-36' : 'min-w-0 flex-1'}>
                    {f.kind === 'select' ? (
                      <Choice label={f.label} value={values[f.key] || '__none'} onChange={(v) => set(f.key)(v === '__none' ? '' : v)} options={(f.options ?? []).map((o) => ({ value: o.value || '__none', label: o.label }))} />
                    ) : f.kind === 'secret' ? (
                      <SecretField label={f.label} value={values[f.key] ?? ''} onChange={set(f.key)} />
                    ) : (
                      <TextField label={f.label} value={values[f.key] ?? ''} onChange={set(f.key)} placeholder={f.placeholder ? f.placeholder : undefined} mono={f.mono} autoFocus={f.key === 'name'} hint={problems[f.key] ? problems[f.key]! : undefined} />
                    )}
                  </div>
                ))}
              </div>
            ))}
            {g.title === 'Where' && byUrl && <TextField label={'URL'} value={url} onChange={(v) => { setError(null); setUrl(v) }} placeholder={urlHint} mono />}
            {entry.notes.filter((n) => g.rows.flat().some((f) => f.key === n.after)).map((n, k) => (
              <p key={k} className={cn('text-xs-plus leading-relaxed text-muted-foreground', n.mono && 'font-mono')}>{n.text(values)}</p>
            ))}
          </section>
        ))}
        {error !== null && <Refusal error={error} className="text-sm text-destructive" />}
      </div>
      <footer className="flex items-center gap-3 border-t border-foreground/[0.07] px-5 py-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{missing.length ? `Still needed: ${missing.join(', ')}` : 'Connect lists the bucket at once, so a wrong place or key shows here.'}</span>
        <Button type="submit" size="sm" className="h-8 rounded-lg-plus px-3.5" disabled={!valid || busy}>
          {busy && <LoaderCircle className="size-3.5 animate-spin" />}
          {'Test and connect'}
        </Button>
      </footer>
    </form>
  )
}
