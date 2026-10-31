// A PostgreSQL Store's page (storage-redesign §3.3): live in its database,
// where it came from, its projects, and a quiet card saying there is nothing
// to sync, so nobody looks for missing Push buttons.
import { CornerDownRight, Radio, RefreshCw, Trash2, TriangleAlert, Unplug } from 'lucide-react'
import type { CSSProperties } from 'react'

import { count, useStorage } from '@/components/storage/actions'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { CountBadge, DetailHeader, Fact, Gone, ProjectChips, Section } from '@/components/storage/detail/parts'
import { FamilyTile, StoreIcon } from '@/components/storage/identity/store-icon'
import { Notice } from '@/components/storage/notice'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { SizeText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/data/format'
import { t, useI18n } from '@/i18n'

export function PostgresqlStoreDetail({ name }: { name: string }) {
  useI18n()
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
  const reason = down ? t('{name} is not answering', { name: c!.name }) : undefined
  const from = store.importedFrom
  const source = from ? s.view.stores.list.find((x) => x.name === from.store && x.kind === 'sqlite') : undefined
  const remove = () => s.remove({ kind: 'store', store })
  return (
    <>
      <Breadcrumb
        items={[{ label: 'PostgreSQL' }, { label: store.connection ?? t('connection'), to: store.connection ? { view: 'connection', id: store.connection } : undefined }, { label: store.name }]}
      />
      <DetailHeader
        icon={<StoreIcon family="postgresql" size="lg" />}
        eyebrow={`${t('Store')} · PostgreSQL`}
        title={store.name}
        badges={<SyncPill state="live" />}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MoreButton label={t('More for {name}', { name: store.name })} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-xl">
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash2 /> {t('Remove…')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <p className="flex flex-wrap items-center gap-x-1.5 tabular-nums">
          {count(store.projects.length, 'project')} <span aria-hidden="true">·</span>
          <SizeText store={store} reason={reason} /> {t('in {where}', { where: store.connection ?? t('its database') })}
          {store.schema && (
            <>
              <span aria-hidden="true">·</span> {t('schema')} <span className="font-mono text-[12px]">{store.schema}</span>
            </>
          )}
        </p>
      </DetailHeader>

      {!c && store.connection && (
        <Notice tone="danger" icon={Unplug} title={t('Connect has no URL for {name}', { name: store.connection })}>
          {t('Add the connection again with the same name to open this Store.')}
        </Notice>
      )}
      {c && down && (
        <Notice
          tone="warning"
          icon={TriangleAlert}
          title={`${t('{name} is not answering', { name: c.name })}${h?.message ? `: ${h.message}` : ''}`}
          actions={
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void s.check({ connection: c.name })} disabled={s.checking}>
              <RefreshCw className={s.checking ? 'motion-safe:animate-spin' : undefined} /> {t('Check again')}
            </Button>
          }
        >
          {t('Projects in this Store can’t be opened until it is.')}
        </Notice>
      )}

      <Section index={2} aria-label={t('Facts')}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 @min-[760px]/storage:grid-cols-5">
          <Fact label={t('Connection')}>
            {c ? (
              <span className="flex flex-col gap-0.5">
                <button type="button" onClick={() => s.open({ view: 'connection', id: c.name })} className="w-fit rounded-md text-[13px] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {c.name}
                </button>
                <HealthDot health={c.health} />
              </span>
            ) : (
              <span className="text-[13px]">{store.connection ?? '—'}</span>
            )}
          </Fact>
          <Fact label={t('Schema')} mono>
            {store.schema ?? '—'}
          </Fact>
          <Fact label="synchronous_commit" mono>
            {store.synchronousCommit ?? c?.synchronousCommit ?? '—'}
          </Fact>
          <Fact label={t('Size in database')}>
            <span className="flex flex-col">
              <SizeText store={store} reason={reason} />
              {store.size?.at ? <span className="text-xs font-normal text-muted-foreground">{t('checked {ago}', { ago: ago(store.size.at) })}</span> : null}
            </span>
          </Fact>
          <Fact label={t('Created')} title={when(store.created)}>
            {store.created ? when(store.created) : '—'}
          </Fact>
        </dl>
        <div className="flex flex-wrap items-center gap-2 border-t border-foreground/[0.06] px-5 py-3 text-[13px] text-muted-foreground">
          <CornerDownRight aria-hidden="true" className="size-3.5 text-faint" />
          {!from ? (
            <span>{t('Origin not recorded')}</span>
          ) : (
            <>
              {t('Imported from')}
              {source ? (
                <button type="button" onClick={() => s.open({ view: 'store', id: source.name })} className="inline-flex items-center gap-1.5 rounded-lg px-1 font-semibold text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  <FamilyTile family="sqlite" size="sm" /> {source.name}
                </button>
              ) : (
                <span className="font-semibold text-foreground">{t('{store} (removed)', { store: from.store })}</span>
              )}
              <span>(SQLite)</span>
              {from.at && <span title={when(from.at)}>{when(from.at)}</span>}
              {from.bytes !== null && <span>· {bytes(from.bytes)}</span>}
            </>
          )}
        </div>
      </Section>

      <Section
        index={3}
        title={
          <span className="flex items-center gap-2">
            {t('Projects')} <CountBadge n={store.projects.length} />
          </span>
        }
      >
        <div className="px-5 pt-3 pb-4">
          {store.projects.length ? <ProjectChips store={store.name} projects={store.projects} /> : <p className="text-[13px] text-muted-foreground">{t('No projects. PostgreSQL Stores get projects by import.')}</p>}
        </div>
      </Section>

      <Section index={4} quiet aria-label={t('Nothing to sync')}>
        <div className="flex items-start gap-3 px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-dashed border-success/40 text-success">
            <Radio aria-hidden="true" className="size-4" />
          </span>
          <p className="text-[13px] text-muted-foreground text-pretty">
            {t('This Store lives in the database: every Commit goes straight there. It has no link to push or pull. To keep a file in a bucket, keep using the SQLite Store it came from. There is no way back from PostgreSQL to SQLite yet.')}
          </p>
        </div>
      </Section>

      <div className="reveal flex justify-end" style={{ '--i': 5 } as CSSProperties}>
        <Button size="sm" variant="outline" className="rounded-xl text-destructive hover:text-destructive" onClick={remove}>
          <Trash2 /> {t('Remove…')}
        </Button>
      </div>
    </>
  )
}
