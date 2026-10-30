// A PostgreSQL Store's page (storage-redesign §3.3): live in its database,
// where it came from, its projects, and a quiet card saying there is nothing
// to sync, so nobody looks for missing Push buttons.
import { CornerDownRight, Radio, RefreshCw, Trash2, TriangleAlert, Unplug } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Fact, Gone, ProjectChips, Section } from '@/components/storage/detail/parts'
import { FamilyTile, StoreIcon } from '@/components/storage/identity/store-icon'
import { Notice } from '@/components/storage/notice'
import { SizeText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { ago, bytes, when } from '@/data/format'

export function PostgresqlStoreDetail({ name }: { name: string }) {
  const s = useStorage()
  const store = s.view.stores.list.find((x) => x.name === name && x.kind === 'postgresql')
  if (!store)
    return (
      <>
        <Breadcrumb items={[{ label: 'PostgreSQL' }, { label: name }]} />
        <Gone what={name} />
      </>
    )
  const c = s.view.postgresql.connections.find((x) => x.name === store.connection)
  const h = c?.health
  const down = h && (h.state === 'unreachable' || h.state === 'denied')
  const from = store.importedFrom
  const source = from ? s.view.stores.list.find((x) => x.name === from.store && x.kind === 'sqlite') : undefined
  const remove = () => s.remove({ kind: 'store', store })
  return (
    <>
      <Breadcrumb items={[{ label: 'PostgreSQL' }, { label: store.connection ?? 'connection', to: store.connection ? { view: 'connection', id: store.connection } : undefined, mono: true }, { label: store.name }]} />
      <DetailHeader
        icon={<StoreIcon family="postgresql" size="lg" />}
        eyebrow="Store · PostgreSQL"
        title={store.name}
        badges={<SyncPill state="live" />}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MoreButton label={`More for ${store.name}`} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash2 /> Remove…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <p className="flex flex-wrap items-center gap-x-1.5 tabular-nums">
          {count(store.projects.length, 'project')} <span aria-hidden="true">·</span>
          <SizeText store={store} reason={down ? `${c!.name} is not answering` : undefined} /> in {store.connection ?? 'its database'}
          {store.schema && (
            <>
              <span aria-hidden="true">·</span> schema <span className="font-mono text-[12px]">{store.schema}</span>
            </>
          )}
        </p>
      </DetailHeader>

      {!c && store.connection && (
        <Notice tone="danger" icon={Unplug} title={`Connect has no URL for ${store.connection}`}>
          Add the connection again with the same name to open this Store.
        </Notice>
      )}
      {c && down && (
        <Notice
          tone="warning"
          icon={TriangleAlert}
          title={`${c.name} is not answering${h?.message ? `: ${h.message}` : ''}`}
          actions={
            <Button size="sm" variant="outline" onClick={() => void s.check({ connection: c.name })} disabled={s.checking}>
              <RefreshCw className={s.checking ? 'animate-spin' : undefined} /> Check again
            </Button>
          }
        >
          Projects in this Store can’t be opened until it is.
        </Notice>
      )}

      <Section index={2} aria-label="Facts">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 @min-[760px]/storage:grid-cols-5">
          <Fact label="Connection">
            {c ? (
              <span className="flex flex-col gap-0.5">
                <button type="button" onClick={() => s.open({ view: 'connection', id: c.name })} className="w-fit rounded-sm font-mono text-[13px] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {c.name}
                </button>
                <HealthDot health={c.health} />
                {(c.health.serverVersion || c.health.latencyMs !== null) && (
                  <span className="text-xs text-faint">
                    {c.health.serverVersion && `PostgreSQL ${c.health.serverVersion}`}
                    {c.health.latencyMs !== null && ` · ${Math.round(c.health.latencyMs)} ms`}
                  </span>
                )}
              </span>
            ) : (
              <span className="font-mono text-[13px]">{store.connection ?? '—'}</span>
            )}
          </Fact>
          <Fact label="Schema" mono>
            {store.schema ?? '—'}
          </Fact>
          <Fact label="synchronous_commit" mono>
            {store.synchronousCommit ?? c?.synchronousCommit ?? '—'}
          </Fact>
          <Fact label="Size in database">
            <span className="flex flex-col">
              <SizeText store={store} reason={down ? `${c!.name} is not answering` : undefined} />
              {store.size?.at ? <span className="text-xs text-faint">checked {ago(store.size.at)}</span> : null}
            </span>
          </Fact>
          <Fact label="Created" title={when(store.created)}>
            {store.created ? when(store.created) : '—'}
          </Fact>
        </dl>
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3 text-[13px] text-muted-foreground">
          <CornerDownRight aria-hidden="true" className="size-3.5 text-faint" />
          {!from ? (
            <span className="text-faint">Origin not recorded</span>
          ) : (
            <>
              Imported from
              {source ? (
                <button type="button" onClick={() => s.open({ view: 'store', id: source.name })} className="inline-flex items-center gap-1.5 rounded-md px-1 font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  <FamilyTile family="sqlite" size="sm" /> {source.name}
                </button>
              ) : (
                <span className="font-medium text-foreground">{from.store} (removed)</span>
              )}
              <span>(SQLite)</span>
              {from.at && <span title={when(from.at)}>on {when(from.at)}</span>}
              {from.bytes !== null && <span>· {bytes(from.bytes)}</span>}
            </>
          )}
        </div>
      </Section>

      <Section
        index={3}
        title={
          <span className="flex items-center gap-2">
            Projects <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{store.projects.length}</span>
          </span>
        }
      >
        <div className="px-5 pt-3 pb-4">
          {store.projects.length ? <ProjectChips store={store.name} projects={store.projects} /> : <p className="text-[13px] text-muted-foreground">No projects. PostgreSQL Stores get projects by import.</p>}
        </div>
      </Section>

      <Section index={4} quiet aria-label="Nothing to sync">
        <div className="flex items-start gap-3 px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-dashed text-success">
            <Radio aria-hidden="true" className="size-4" />
          </span>
          <p className="text-[13px] text-muted-foreground text-pretty">
            This Store lives in the database: every Commit goes straight there. It has no link to push or pull. To keep a file in a bucket, keep using the SQLite Store it came from. There is no way back from PostgreSQL to SQLite yet.
          </p>
        </div>
      </Section>

      <div className="reveal flex justify-end" style={{ '--i': 5 } as React.CSSProperties}>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={remove}>
          <Trash2 /> Remove…
        </Button>
      </div>
    </>
  )
}
