// New (layerfs-storage.md, Dialogs): one wide dialog of fixed size, two
// panes. The left pane has a tab per kind of Store (SQLite, PostgreSQL) and
// that kind's list: ways to make a Store, then its connections and "+" one of
// each provider. The right pane is whatever is chosen, in place: the New
// Store, Load or Import form, a bucket's or database's facts and files, or a
// provider's add form. Nothing opens another dialog. In a narrow window the
// panes stack: the list, then the chosen item over it with a back arrow.
import { ChevronLeft, Database, Download, ExternalLink, FolderInput, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Segmented } from '@/components/motion'
import { count, type NewTab, type Route, useStorage } from '@/components/storage/actions'
import { Dot } from '@/components/storage/chips'
import { filesOf } from '@/components/storage/detail/bucket-detail'
import { ConnectionForm } from '@/components/storage/dialogs/add-location-dialog'
import { BackLink } from '@/components/storage/dialogs/fields'
import { ImportForm } from '@/components/storage/dialogs/import-dialog'
import { LoadForm } from '@/components/storage/dialogs/load-dialog'
import { NewStoreForm } from '@/components/storage/dialogs/new-store-dialog'
import { PROVIDERS, providerInfos, providerLabel } from '@/components/storage/identity/providers'
import { FamilyTile, ProviderMark, ProviderTile } from '@/components/storage/identity/store-icon'
import { HealthDot, healthWords } from '@/components/storage/sync/health-dot'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { Health, RemoteInfo, StorageView } from '@shared/host-api'

export type { NewTab }

/** What the right pane shows. */
type Pane =
  | { kind: 'empty' }
  | { kind: 'files' }
  | { kind: 'load'; remote: string; file: string }
  | { kind: 'bucket'; name: string }
  | { kind: 'add-bucket' }
  | { kind: 'add-database' }
  | { kind: 'import' }
  | { kind: 'database'; name: string }
  | { kind: 'off'; title: string; reason: string }

const same = (a: Pane, b: Pane) => JSON.stringify(a) === JSON.stringify(b)

interface NewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: NewTab
  onTab: (tab: NewTab) => void
  /** The view changed (a Store or connection was made). */
  reload: () => void
  /** A Store was made: flash its card. */
  reveal: (store: string) => void
}

export function NewDialog({ open, onOpenChange, tab, onTab, reload, reveal }: NewDialogProps) {
  useI18n()
  const s = useStorage()
  const [pane, setPane] = useState<Pane>(() => firstPane(s.view, tab))
  // a narrow window shows one pane at a time
  const [focus, setFocus] = useState<'list' | 'pane'>('list')
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    if (!open) return
    setPane(firstPane(s.view, tab))
    setFocus('list')
    // the view refreshes underneath; only opening or a new tab picks the first pane again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const pick = (next: Pane) => {
    if (locked) return
    setPane(next)
    setFocus('pane')
  }
  const page = (route: Route) => {
    close()
    s.open(route)
  }
  const free = s.status?.disk.volumes ?? null
  const taken = new Set(s.view.stores.list.map((x) => x.name))
  const created = useCallback(
    (name: string) => {
      reload()
      reveal(name)
    },
    [reload, reveal],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (locked && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="@container/new h-[min(40rem,calc(100dvh-3rem))] gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[min(50rem,calc(100vw-3rem))]">
        <DialogDescription className="sr-only">{t('Make a SQLite or PostgreSQL Store, or connect a bucket or a database.')}</DialogDescription>
        <div className="grid h-full min-h-0 grid-cols-1 @min-[40rem]/new:grid-cols-[15rem_minmax(0,1fr)]">
          <nav
            aria-label={t('New')}
            className={cn(
              'flex min-h-0 flex-col overflow-y-auto border-foreground/[0.06] bg-foreground/[0.018] px-3 pt-5 pb-4 @min-[40rem]/new:border-r',
              focus === 'pane' && 'hidden @min-[40rem]/new:flex',
            )}
          >
            <DialogTitle className="px-2 pb-3 text-base font-semibold">{t('New')}</DialogTitle>
            <Segmented<NewTab>
              aria-label={t('Kind of Store')}
              role="tablist"
              value={tab}
              onChange={(next) => !locked && onTab(next)}
              className="mx-1 w-auto [&>button]:flex-1 [&>button]:justify-center"
              options={[
                { value: 'sqlite', label: 'SQLite' },
                { value: 'postgresql', label: 'PostgreSQL' },
              ]}
            />
            {tab === 'sqlite' ? <SqliteList pane={pane} pick={pick} locked={locked} /> : <PostgresqlList pane={pane} pick={pick} locked={locked} />}
          </nav>
          <section className={cn('flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto px-6 pt-5 pb-4', focus === 'list' && 'hidden @min-[40rem]/new:flex')}>
            <button
              type="button"
              onClick={() => setFocus('list')}
              disabled={locked}
              className="-mb-2 inline-flex w-fit items-center gap-0.5 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring @min-[40rem]/new:hidden"
            >
              <ChevronLeft aria-hidden="true" className="size-3.5" /> {t('New')}
            </button>
            <div key={JSON.stringify(pane)} className="flex min-h-0 flex-1 flex-col gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-(--dur-base)">
              {pane.kind === 'empty' && <NewStoreForm taken={taken} onCreated={created} onClose={close} onLock={setLocked} />}
              {pane.kind === 'files' && <AllFiles onLoad={(remote, file) => pick({ kind: 'load', remote, file })} onPage={page} />}
              {pane.kind === 'load' && (
                <>
                  <BackLink onBack={() => pick({ kind: 'files' })} label={t('Files')} disabled={locked} />
                  <LoadForm view={s.view} remote={pane.remote} file={pane.file} free={free} onDone={created} onOpenStore={(store) => page({ view: 'store', id: store })} onClose={close} onLock={setLocked} />
                </>
              )}
              {pane.kind === 'bucket' && <BucketPane name={pane.name} onLoad={(remote, file) => pick({ kind: 'load', remote, file })} onPage={page} />}
              {pane.kind === 'add-bucket' && <AddBucket onChanged={reload} onClose={close} onLock={setLocked} />}
              {pane.kind === 'add-database' && <ConnectionForm view={s.view} provider="postgresql" onChanged={reload} onClose={close} onLock={setLocked} />}
              {pane.kind === 'import' && <ImportForm view={s.view} onDone={created} onClose={close} onLock={setLocked} />}
              {pane.kind === 'database' && <DatabasePane name={pane.name} onPage={page} />}
              {pane.kind === 'off' && <Off title={pane.title} reason={pane.reason} />}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The pane a tab opens on: its first way that can be used, else adding what it needs. */
function firstPane(view: StorageView, tab: NewTab): Pane {
  if (tab === 'postgresql') {
    if (!view.postgresql.available) return { kind: 'off', title: 'PostgreSQL', reason: view.postgresql.reason ?? t('Not in this LayerFS build') }
    return view.postgresql.connections.length ? { kind: 'import' } : { kind: 'add-database' }
  }
  if (view.stores.available) return { kind: 'empty' }
  if (view.remotes.available) return view.remotes.list.length ? { kind: 'files' } : { kind: 'add-bucket' }
  return { kind: 'off', title: 'SQLite', reason: view.stores.reason ?? t('Not in this LayerFS build') }
}

// ---------- the lists ----------

interface ListProps {
  pane: Pane
  pick: (p: Pane) => void
  locked: boolean
}

function SqliteList({ pane, pick, locked }: ListProps) {
  const s = useStorage()
  const { stores, remotes } = s.view
  const buckets = [...remotes.list].sort((a, b) => String(a.provider).localeCompare(String(b.provider)) || a.name.localeCompare(b.name))
  const item = (p: Pane) => ({ on: same(pane, p), onClick: () => pick(p), locked })
  return (
    <>
      <About>{t('A Store file on this machine, linked to at most one file in a bucket.')}</About>
      <Label>{t('New Store')}</Label>
      <Item icon={<Plus />} off={stores.available ? null : (stores.reason ?? t('Not in this LayerFS build'))} {...item({ kind: 'empty' })}>
        {t('Empty Store')}
      </Item>
      <Item icon={<Download />} off={!remotes.available ? (remotes.reason ?? t('Not in this LayerFS build')) : !remotes.list.length ? t('Add a bucket first') : null} {...item({ kind: 'files' })}>
        {t('From a bucket file')}
      </Item>
      {remotes.available && (
        <>
          <Label>{t('Buckets')}</Label>
          {buckets.map((r) => (
            <Item key={r.name} icon={<ProviderMark provider={r.provider} className="size-3.5" />} health={r.health} {...item({ kind: 'bucket', name: r.name })}>
              {r.name}
            </Item>
          ))}
          {addableBuckets(s.view).length > 0 && (
            <Item icon={<Plus />} quiet {...item({ kind: 'add-bucket' })}>
              {t('Add bucket connection')}
            </Item>
          )}
        </>
      )}
    </>
  )
}

function PostgresqlList({ pane, pick, locked }: ListProps) {
  const s = useStorage()
  const { postgresql: pg, stores } = s.view
  const sqlite = stores.list.filter((x) => x.kind === 'sqlite' && x.projects.length)
  const connections = [...pg.connections].sort((a, b) => a.name.localeCompare(b.name))
  const item = (p: Pane) => ({ on: same(pane, p), onClick: () => pick(p), locked })
  return (
    <>
      <About>{t('A Store in a database, one schema each. Live: nothing to sync.')}</About>
      <Label>{t('New Store')}</Label>
      <Item
        icon={<FolderInput />}
        off={!pg.available ? (pg.reason ?? t('Not in this LayerFS build')) : !connections.length ? t('Add a database first') : !sqlite.length ? t('No SQLite Store with projects yet') : null}
        {...item({ kind: 'import' })}
      >
        {t('Copy a SQLite Store in')}
      </Item>
      {pg.available && (
        <>
          <Label>{t('Databases')}</Label>
          {connections.map((c) => (
            <Item key={c.name} icon={<Database />} health={c.health} {...item({ kind: 'database', name: c.name })}>
              {c.name}
            </Item>
          ))}
          <Item icon={<Plus />} quiet {...item({ kind: 'add-database' })}>
            {t('Add database connection')}
          </Item>
        </>
      )}
    </>
  )
}

function About({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pt-3 text-[11.5px] leading-relaxed text-muted-foreground text-pretty">{children}</p>
}

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="px-2 pt-4 pb-1 text-[11px] font-medium text-muted-foreground/80">{children}</h3>
}

interface ItemProps {
  icon: React.ReactNode
  on: boolean
  /** Why it can't be used now; shown on hover, and the line dims. */
  off?: string | null
  health?: Health
  /** A "+" line: quieter until chosen. */
  quiet?: boolean
  locked: boolean
  onClick: () => void
  children: React.ReactNode
}

/** One line of the list: an icon, the words, a health dot; chosen, it sits on a raised pill. */
function Item({ icon, on, off, health, quiet, locked, onClick, children }: ItemProps) {
  const w = health ? healthWords(health) : null
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!off || (locked && !on)}
      aria-current={on || undefined}
      title={off ?? undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'bg-background font-medium shadow-xs ring-1 ring-foreground/[0.07]' : 'hover:bg-foreground/[0.04]',
        quiet && !on && 'text-muted-foreground',
        off && 'cursor-default text-muted-foreground/60 hover:bg-transparent',
      )}
    >
      <span className={cn('flex w-4 shrink-0 justify-center text-muted-foreground [&_svg]:size-3.5', off && 'opacity-60')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {w && <Dot tone={w.tone} label={t(w.label)} />}
    </button>
  )
}

// ---------- the panes ----------

/** A pane's head: a mark, a title, one line. */
function PaneHead({ mark, title, children }: { mark: React.ReactNode; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex items-start gap-2.5 pr-8">
      {mark}
      <div className="min-w-0 pt-0.5">
        <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{title}</h2>
        {children && <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">{children}</p>}
      </div>
    </header>
  )
}

/** The bucket providers this LayerFS build can add (MinIO, Cloudflare R2). */
function addableBuckets(view: StorageView) {
  const infos = providerInfos(view)
  return PROVIDERS.filter((p) => p.family === 'copy' && p.fields.length > 0 && infos.find((i) => i.id === p.id)?.available)
}

/** Add a bucket connection: pick the provider, then its form below. */
function AddBucket({ onChanged, onClose, onLock }: { onChanged: () => void; onClose: () => void; onLock: (locked: boolean) => void }) {
  const s = useStorage()
  const providers = addableBuckets(s.view)
  const [provider, setProvider] = useState(String(providers[0]?.id ?? 'minio'))
  const [locked, setLocked] = useState(false)
  const lock = useCallback(
    (l: boolean) => {
      setLocked(l)
      onLock(l)
    },
    [onLock],
  )
  return (
    <>
      <PaneHead
        mark={
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-(--icon-accent)">
            <Plus className="size-4" />
          </span>
        }
        title={t('Add a bucket connection')}
      >
        {t('A bucket that holds SQLite Store files. Adding it links no Store; you can add as many as you like.')}
      </PaneHead>
      <div role="radiogroup" aria-label={t('Provider')} className="grid grid-cols-2 gap-2.5">
        {providers.map((p) => {
          const on = provider === String(p.id)
          return (
            <button
              key={String(p.id)}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={locked && !on}
              onClick={() => setProvider(String(p.id))}
              className={cn(
                'flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] outline-none ring-1 transition-[background-color,box-shadow] duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                on ? 'bg-background font-medium shadow-xs ring-primary/40' : 'ring-foreground/[0.08] hover:bg-foreground/[0.03]',
              )}
            >
              <ProviderTile provider={String(p.id)} size="sm" />
              <span className="truncate">{p.label}</span>
            </button>
          )
        })}
      </div>
      <ConnectionForm key={provider} view={s.view} provider={provider} bare onChanged={onChanged} onClose={onClose} onLock={lock} />
    </>
  )
}

function AllFiles({ onLoad, onPage }: { onLoad: (remote: string, file: string) => void; onPage: (r: Route) => void }) {
  const s = useStorage()
  const remotes = [...s.view.remotes.list].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <PaneHead
        mark={
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-(--icon-accent)">
            <Download className="size-4" />
          </span>
        }
        title={t('From a bucket file')}
      >
        {t('A new SQLite Store on this machine from the file, with all of its projects, linked to it.')}
      </PaneHead>
      {remotes.map((r) => (
        <Files key={r.name} remote={r} titled onLoad={onLoad} onPage={onPage} />
      ))}
    </>
  )
}

function BucketPane({ name, onLoad, onPage }: { name: string; onLoad: (remote: string, file: string) => void; onPage: (r: Route) => void }) {
  const s = useStorage()
  const r = s.view.remotes.list.find((x) => x.name === name)
  if (!r) return <Off title={name} reason={t('This connection is gone.')} />
  return (
    <>
      <PaneHead mark={<ProviderTile provider={r.provider} size="sm" />} title={r.name}>
        {providerLabel(r.provider)}
      </PaneHead>
      <Facts
        rows={[
          [t('Where'), <span className="font-mono text-[12px] break-all">{r.location}</span>],
          [t('Health'), <HealthDot health={r.health} />],
          [t('Keys'), r.hasSecret ? t('Kept in Connect') : <span className="text-warning">{t('no keys')}</span>],
        ]}
      />
      <Files remote={r} onLoad={onLoad} onPage={onPage} />
      <PageLink onClick={() => onPage({ view: 'location', id: r.name })}>{t('Open the bucket page')}</PageLink>
    </>
  )
}

function DatabasePane({ name, onPage }: { name: string; onPage: (r: Route) => void }) {
  const s = useStorage()
  const c = s.view.postgresql.connections.find((x) => x.name === name)
  if (!c) return <Off title={name} reason={t('This connection is gone.')} />
  const stores = s.view.stores.list.filter((x) => x.connection === c.name)
  return (
    <>
      <PaneHead mark={<FamilyTile family="postgresql" size="sm" />} title={c.name}>
        PostgreSQL{c.health.serverVersion ? ` ${c.health.serverVersion}` : ''}
      </PaneHead>
      <Facts
        rows={[
          [t('Where'), <span className="font-mono text-[12px] break-all">{[c.host, c.database].filter(Boolean).join(' / ') || '—'}</span>],
          [t('Health'), <HealthDot health={c.health} />],
          ['synchronous_commit', <span className="font-mono text-[12px]">{c.synchronousCommit}</span>],
        ]}
      />
      <section>
        <h3 className="px-2 pb-1 text-[11px] font-medium text-muted-foreground/80">{count(stores.length, 'Store')}</h3>
        {stores.length ? (
          stores.map((x) => (
            <button key={x.name} type="button" onClick={() => onPage({ view: 'store', id: x.name })} className={ROW}>
              <span className="min-w-0 flex-1 truncate text-[13px]">{x.name}</span>
              <span className="text-[11.5px] text-muted-foreground">{count(x.projects.length, 'project')}</span>
            </button>
          ))
        ) : (
          <p className="px-2 text-xs text-muted-foreground">{t('No Stores yet. Copy a SQLite Store in.')}</p>
        )}
      </section>
      <PageLink onClick={() => onPage({ view: 'connection', id: c.name })}>{t('Open the connection page')}</PageLink>
    </>
  )
}

/** A bucket's files: Load… one that isn't loaded; a loaded one opens its Store. */
function Files({ remote, titled, onLoad, onPage }: { remote: RemoteInfo; titled?: boolean; onLoad: (remote: string, file: string) => void; onPage: (r: Route) => void }) {
  const s = useStorage()
  const files = filesOf(remote, s.view.stores.list)
  return (
    <section aria-label={t('Files in {name}', { name: remote.name })}>
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80">
          {titled ? (
            <>
              <ProviderMark provider={remote.provider} className="size-3" />
              <span className="truncate">{remote.name}</span>
            </>
          ) : (
            t('Files')
          )}
        </h3>
        {s.view.supports.check && (
          <button
            type="button"
            onClick={() => void s.check({ remote: remote.name }).catch(() => undefined)}
            disabled={s.checking}
            className="inline-flex items-center gap-1 rounded-md text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={cn('size-3', s.checking && 'motion-safe:animate-spin')} /> {s.checking ? t('Checking…') : t('Check now')}
          </button>
        )}
      </div>
      {!remote.files && !files.length ? (
        <p className="px-2 text-xs text-muted-foreground">{t('Not listed yet. Check it to see its files.')}</p>
      ) : !files.length ? (
        <p className="px-2 text-xs text-muted-foreground">{t('No Store files yet: publish a Store to it.')}</p>
      ) : (
        files.map((f) => (
          <button key={f.file} type="button" onClick={() => (f.linkedBy ? onPage({ view: 'store', id: f.linkedBy }) : onLoad(remote.name, f.file))} className={ROW}>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{f.file}</span>
            {f.bytes !== null && <span className="text-[11.5px] text-muted-foreground tabular-nums">{bytes(f.bytes)}</span>}
            <span className={cn('shrink-0 text-xs', f.linkedBy ? 'text-muted-foreground' : 'text-primary')}>{f.linkedBy ? t('Loaded as {store}', { store: f.linkedBy }) : t('Load…')}</span>
          </button>
        ))
      )}
    </section>
  )
}

const ROW = 'flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring'

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-2xl border border-foreground/[0.06] bg-background/40 px-4 py-3.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function PageLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-auto inline-flex w-fit items-center gap-1.5 self-end rounded-md text-xs text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
      {children} <ExternalLink aria-hidden="true" className="size-3" />
    </button>
  )
}

function Off({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="m-auto max-w-xs text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{reason}</p>
    </div>
  )
}
