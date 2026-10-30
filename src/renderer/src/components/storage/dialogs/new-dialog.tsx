// New (layerfs-storage.md region 1): one dialog, two tabs, one per kind of
// Store. Each tab says what that kind is, the ways to make one, then the
// connections it uses (grouped by provider, each with where it points and its
// health) and how to add another. Choosing a way opens its own dialog, which
// has a "‹ New" link back here. "From a bucket file" lists the files here.
import { ChevronRight, Database, Download, FolderInput, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Segmented } from '@/components/motion'
import { count, type NewTab, type Route, useStorage } from '@/components/storage/actions'
import { filesOf } from '@/components/storage/detail/bucket-detail'
import { BackLink, SHEET } from '@/components/storage/dialogs/fields'
import { PROVIDERS, providerInfos, providerLabel } from '@/components/storage/identity/providers'
import { ProviderMark } from '@/components/storage/identity/store-icon'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { RemoteInfo } from '@shared/host-api'

export type { NewTab }

/** Where a choice leads: another Storage dialog, with this tab to come back to. */
export type NewChoice =
  | { kind: 'new-store' }
  | { kind: 'load'; remote: string; file: string }
  | { kind: 'import' }
  | { kind: 'location'; provider: string }

interface NewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: NewTab
  onTab: (tab: NewTab) => void
  onChoose: (choice: NewChoice) => void
}

export function NewDialog({ open, onOpenChange, tab, onTab, onChoose }: NewDialogProps) {
  useI18n()
  const s = useStorage()
  const [files, setFiles] = useState(false)
  useEffect(() => {
    if (open) setFiles(false)
  }, [open, tab])
  const page = (route: Route) => {
    onOpenChange(false)
    s.open(route)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${SHEET} gap-4 sm:max-w-[460px]`}>
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-semibold">{files ? t('From a bucket file') : t('New')}</DialogTitle>
          <DialogDescription className="sr-only">{t('Make a SQLite or PostgreSQL Store, or connect a bucket or a database.')}</DialogDescription>
        </DialogHeader>
        {files ? (
          <BucketFiles onBack={() => setFiles(false)} onLoad={(remote, file) => onChoose({ kind: 'load', remote, file })} onPage={page} />
        ) : (
          <>
            <Segmented<NewTab>
              aria-label={t('Kind of Store')}
              role="tablist"
              value={tab}
              onChange={onTab}
              className="w-fit"
              options={[
                { value: 'sqlite', label: 'SQLite' },
                { value: 'postgresql', label: 'PostgreSQL' },
              ]}
            />
            <div key={tab} role="tabpanel" className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-(--dur-base)">
              {tab === 'sqlite' ? <SqliteTab onChoose={onChoose} onFiles={() => setFiles(true)} onPage={page} /> : <PostgresqlTab onChoose={onChoose} onPage={page} />}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SqliteTab({ onChoose, onFiles, onPage }: { onChoose: (c: NewChoice) => void; onFiles: () => void; onPage: (r: Route) => void }) {
  const s = useStorage()
  const { stores, remotes } = s.view
  const providers = providerInfos(s.view)
  const addable = PROVIDERS.filter((p) => p.family === 'copy' && p.fields.length > 0 && providers.find((i) => i.id === p.id)?.available)
  const byProvider = groupBy([...remotes.list].sort((a, b) => a.name.localeCompare(b.name)), (r) => r.provider)
  return (
    <>
      <About>{t('A Store file on this machine. Link it to one file in a MinIO or R2 bucket to publish, push and pull.')}</About>
      <Label>{t('New Store')}</Label>
      <Way
        icon={<Plus />}
        title={t('Empty Store')}
        about={t('Name it, then add projects')}
        off={stores.available ? null : (stores.reason ?? t('Not in this LayerFS build'))}
        onClick={() => onChoose({ kind: 'new-store' })}
      />
      <Way
        icon={<Download />}
        title={t('From a bucket file')}
        about={t('Load it here, linked to the file')}
        off={!remotes.available ? (remotes.reason ?? t('Not in this LayerFS build')) : !remotes.list.length ? t('Add a bucket first') : null}
        onClick={onFiles}
      />
      {remotes.available && (
        <>
          <Label aside={<CheckNow body={{}} />}>{t('Buckets')}</Label>
          {[...byProvider].map(([provider, list]) => (
            <div key={provider ?? '?'} className="mb-1">
              <p className="mt-1 mb-0.5 text-[11px] text-muted-foreground">{providerLabel(provider)}</p>
              {list.map((r) => (
                <Connection
                  key={r.name}
                  mark={<ProviderMark provider={r.provider} className="size-3.5" />}
                  name={r.name}
                  where={r.location}
                  health={<HealthDot health={r.health} quiet className="text-[11px]" />}
                  fact={r.files ? count(filesOf(r, stores.list).length, 'file') : null}
                  onClick={() => onPage({ view: 'location', id: r.name })}
                />
              ))}
            </div>
          ))}
          <Adds>
            {addable.map((p) => (
              <Add key={String(p.id)} onClick={() => onChoose({ kind: 'location', provider: String(p.id) })}>
                {t('{provider} bucket', { provider: p.label })}
              </Add>
            ))}
          </Adds>
        </>
      )}
    </>
  )
}

function PostgresqlTab({ onChoose, onPage }: { onChoose: (c: NewChoice) => void; onPage: (r: Route) => void }) {
  const s = useStorage()
  const { postgresql: pg, stores } = s.view
  const sqlite = stores.list.filter((x) => x.kind === 'sqlite' && x.projects.length)
  const connections = [...pg.connections].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <About>{t('A Store that lives in a database, one schema each. Every Commit goes straight in, so there’s nothing to sync.')}</About>
      <Label>{t('New Store')}</Label>
      <Way
        icon={<FolderInput />}
        title={t('Copy a SQLite Store in')}
        about={t('Pick a Store and a database; both stay')}
        off={!pg.available ? (pg.reason ?? t('Not in this LayerFS build')) : !connections.length ? t('Add a database first') : !sqlite.length ? t('No SQLite Store with projects yet') : null}
        onClick={() => onChoose({ kind: 'import' })}
      />
      {pg.available && (
        <>
          <Label aside={connections.length > 0 && <CheckNow body={{}} />}>{t('Databases')}</Label>
          {connections.map((c) => (
            <Connection
              key={c.name}
              mark={<Database aria-hidden="true" className="size-3.5 text-muted-foreground" />}
              name={c.name}
              where={[c.host, c.database].filter(Boolean).join(' / ') || t('PostgreSQL')}
              health={<HealthDot health={c.health} quiet className="text-[11px]" />}
              fact={count(stores.list.filter((x) => x.connection === c.name).length, 'Store')}
              onClick={() => onPage({ view: 'connection', id: c.name })}
            />
          ))}
          <Adds>
            <Add onClick={() => onChoose({ kind: 'location', provider: 'postgresql' })}>{t('PostgreSQL database')}</Add>
          </Adds>
        </>
      )}
    </>
  )
}

/** The files in every bucket, by bucket: Load… a file that isn't loaded; a linked one opens its Store. */
function BucketFiles({ onBack, onLoad, onPage }: { onBack: () => void; onLoad: (remote: string, file: string) => void; onPage: (r: Route) => void }) {
  const s = useStorage()
  const remotes = [...s.view.remotes.list].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <BackLink onBack={onBack} />
      <About>{t('A new SQLite Store on this machine from the file, with all of its projects, linked to it.')}</About>
      {remotes.map((r) => (
        <BucketGroup key={r.name} remote={r} onLoad={onLoad} onPage={onPage} />
      ))}
    </>
  )
}

function BucketGroup({ remote, onLoad, onPage }: { remote: RemoteInfo; onLoad: (remote: string, file: string) => void; onPage: (r: Route) => void }) {
  const s = useStorage()
  const files = filesOf(remote, s.view.stores.list)
  return (
    <section aria-label={remote.name}>
      <Label aside={<CheckNow body={{ remote: remote.name }} />}>
        <span className="inline-flex items-center gap-1.5 normal-case">
          <ProviderMark provider={remote.provider} className="size-3" />
          <span className="font-mono">{remote.name}</span>
        </span>
      </Label>
      {!remote.files && !files.length ? (
        <p className="py-1.5 text-xs text-muted-foreground">{t('Not listed yet. Check it to see its files.')}</p>
      ) : !files.length ? (
        <p className="py-1.5 text-xs text-muted-foreground">{t('No Store files yet: publish a Store to it.')}</p>
      ) : (
        files.map((f) => (
          <button
            key={f.file}
            type="button"
            onClick={() => (f.linkedBy ? onPage({ view: 'store', id: f.linkedBy }) : onLoad(remote.name, f.file))}
            className={cn(ROW, 'py-1.5')}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{f.file}</span>
            {f.bytes !== null && <span className="text-[11.5px] text-muted-foreground tabular-nums">{bytes(f.bytes)}</span>}
            <span className={cn('w-24 text-right text-xs', f.linkedBy ? 'text-muted-foreground' : 'text-primary')}>{f.linkedBy ? t('Loaded as {store}', { store: f.linkedBy }) : t('Load…')}</span>
          </button>
        ))
      )}
    </section>
  )
}

// ---------- parts ----------

const ROW = '-mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring'

function About({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">{children}</p>
}

function Label({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mt-4 mb-1 flex min-h-5 items-center justify-between gap-2">
      <h3 className="text-[11px] font-medium text-muted-foreground/80">{children}</h3>
      {aside}
    </div>
  )
}

/** A way to make a Store: a soft tile, a title and one line; when it can't be used, the line says why. */
function Way({ icon, title, about, off, onClick }: { icon: React.ReactNode; title: string; about: string; off: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!!off} className={cn(ROW, 'group py-2 disabled:cursor-default disabled:hover:bg-transparent')}>
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.045] text-muted-foreground [&_svg]:size-4', off && 'opacity-50')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13.5px] font-medium', off && 'text-muted-foreground')}>{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{off ?? about}</span>
      </span>
      {!off && <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />}
    </button>
  )
}

/** A connection: mark, name, where it points, a fact and its health; opens its page. */
function Connection({ mark, name, where, health, fact, onClick }: { mark: React.ReactNode; name: string; where: string; health: React.ReactNode; fact: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(ROW, 'py-1.5')} title={t('Open {name}', { name })}>
      <span className="flex w-4 shrink-0 justify-center">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[13px]">{name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{where}</span>
      </span>
      {fact && <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{fact}</span>}
      <span className="shrink-0">{health}</span>
    </button>
  )
}

function Adds({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">{children}</div>
}

function Add({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-md py-1 text-xs text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
      <Plus aria-hidden="true" className="size-3.5" /> {children}
    </button>
  )
}

/** "Check now" for the connections under a label: reads their health and files again. */
function CheckNow({ body }: { body: { remote?: string } }) {
  const s = useStorage()
  if (!s.view.supports.check && !s.view.supports.postgresqlStatus) return null
  return (
    <button
      type="button"
      onClick={() => void s.check(body).catch(() => undefined)}
      disabled={s.checking}
      className="inline-flex items-center gap-1 rounded-md text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <RefreshCw aria-hidden="true" className={cn('size-3', s.checking && 'motion-safe:animate-spin')} />
      {s.checking ? t('Checking…') : t('Check now')}
    </button>
  )
}

function groupBy<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const x of list) out.set(key(x), [...(out.get(key(x)) ?? []), x])
  return out
}
