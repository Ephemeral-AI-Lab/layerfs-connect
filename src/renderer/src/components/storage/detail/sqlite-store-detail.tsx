// A SQLite Store's page (storage-links §3.2): its state, Push and Pull (or
// Publish…), its running job, its Link card (both sides in words), its
// projects, its size and room to push, and its PostgreSQL imports.
import { ArrowUpRight, DatabaseZap, FolderPlus, Plus, Trash2 } from 'lucide-react'

import { spotlight } from '@/components/motion'
import { count, useStorage } from '@/components/storage/actions'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { LinkCard } from '@/components/storage/detail/link-card'
import { CountBadge, DetailHeader, Fact, Gone, ProjectChips, Section } from '@/components/storage/detail/parts'
import { SizeCard } from '@/components/storage/detail/size-card'
import { FamilyTile, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { ContextAction, StoreMenu } from '@/components/storage/overview/sqlite-store-row'
import { SizeText } from '@/components/storage/size'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { JobCard } from '@/components/storage/transfers/job-card'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { ago, when } from '@/data/format'
import { t, useI18n } from '@/i18n'
import type { StoreInfo } from '@shared/host-api'

function InPostgresql({ store, index }: { store: StoreInfo; index: number }) {
  const s = useStorage()
  const pg = s.view.postgresql
  if (!pg.available) return null
  const imports = s.view.stores.list.filter((x) => x.kind === 'postgresql' && (x.importedFrom?.store === store.name || store.imports.includes(x.name)))
  return (
    <Section
      index={index}
      title={t('In PostgreSQL')}
      note={t('Copies made by import. They don’t sync with this Store.')}
      aside={
        pg.connections.length > 0 && (
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.importInto({ store: store.name })}>
            <DatabaseZap /> {t('Import into PostgreSQL…')}
          </Button>
        )
      }
    >
      <div className="px-5 pt-3 pb-4">
        {!pg.connections.length ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-muted-foreground">{t('Add a PostgreSQL connection to import this Store.')}</p>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.addLocation({ provider: 'postgresql' })}>
              <Plus /> {t('Add connection')}
            </Button>
          </div>
        ) : !imports.length ? (
          <p className="text-[13px] text-muted-foreground">{t('Not imported yet.')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 @min-[760px]/storage:grid-cols-2">
            {imports.map((x) => (
              <li key={x.name}>
                <button
                  type="button"
                  onClick={() => s.open({ view: 'store', id: x.name })}
                  onPointerMove={spotlight}
                  className="sc-card group glass-liquid card-hover spotlight flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FamilyTile family="postgresql" size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold group-hover:text-primary">{x.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="font-mono">{x.connection}</span> · <SizeText store={x} />
                      {x.importedFrom?.at ? ` · ${t('imported {ago}', { ago: ago(x.importedFrom.at) })}` : ''}
                    </span>
                  </span>
                  <ArrowUpRight aria-hidden="true" className="sc-arrow size-4 shrink-0 text-(--icon-accent)" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

export function SqliteStoreDetail({ name }: { name: string }) {
  useI18n()
  const s = useStorage()
  const store = s.view.stores.list.find((x) => x.name === name && x.kind === 'sqlite')
  if (!store)
    return (
      <>
        <Breadcrumb items={[{ label: 'SQLite' }, { label: name }]} />
        <Gone what={name} />
      </>
    )
  const job = s.transfers.jobFor(store.name)
  const running = s.transfers.runningFor(store.name)
  const providers = storeProviders(store, s.view.remotes.list)
  const on = s.view.stores.available
  const addProject = (
    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.addProject(store)} disabled={!on}>
      <FolderPlus /> {t('Add project')}
    </Button>
  )
  return (
    <>
      <Breadcrumb items={[{ label: 'SQLite' }, { label: store.name }]} />
      <DetailHeader
        icon={<StoreIcon family="sqlite" providers={providers} size="lg" />}
        eyebrow={`${t('Store')} · SQLite`}
        title={store.name}
        badges={running ? <TransferRow job={running} form="compact" /> : <SyncPill state={store.sync.state} copy={store.link} />}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ContextAction store={store} size="sm" />
            <StoreMenu store={store} />
          </div>
        }
      >
        <p className="flex flex-wrap items-center gap-x-1.5 tabular-nums">
          <span>{count(store.projects.length, 'project')}</span>
          <span aria-hidden="true">·</span>
          <SizeText store={store} reason={s.sizeReason} />
          <span>{t('on this machine')}</span>
          {store.volume && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {t('volume')} <span className="font-mono text-[12px]">{store.volume}</span>
              </span>
            </>
          )}
          {store.created && (
            <>
              <span aria-hidden="true">·</span>
              <span title={when(store.created)}>{t('created {ago}', { ago: ago(store.created) })}</span>
            </>
          )}
        </p>
        {store.legacy && <p className="text-muted-foreground/90">{t('A project’s own Store, from before Stores held several projects.')}</p>}
      </DetailHeader>

      {job && <JobCard job={job} actions={s.refusalActions(job)} />}

      <LinkCard store={store} index={2} />

      <Section
        index={3}
        title={
          <span className="flex items-center gap-2">
            {t('Projects')} <CountBadge n={store.projects.length} />
          </span>
        }
        aside={on ? addProject : <Unavailable reason={s.view.stores.reason ?? undefined}>{addProject}</Unavailable>}
      >
        <div className="px-5 pt-3 pb-4">
          {store.projects.length ? <ProjectChips store={store.name} projects={store.projects} /> : <p className="text-[13px] text-muted-foreground">{t('No projects yet. Add one: empty, or a copy of a folder.')}</p>}
        </div>
      </Section>

      <SizeCard store={store} index={4} />

      <InPostgresql store={store} index={5} />

      <Section index={6} aria-label={t('Facts')}>
        <dl className="grid grid-cols-2 items-end gap-x-6 gap-y-3 px-5 py-4 @min-[760px]/storage:grid-cols-[1fr_1fr_auto]">
          <Fact label={t('Volume')} mono>
            {store.volume ?? '—'}
          </Fact>
          <Fact label={t('Created')} title={when(store.created)}>
            {store.created ? when(store.created) : '—'}
          </Fact>
          {on && (
            <div className="col-span-2 flex justify-end @min-[760px]/storage:col-span-1">
              <Button size="sm" variant="outline" className="rounded-xl text-destructive hover:text-destructive" onClick={() => s.remove({ kind: 'store', store })} disabled={!!running}>
                <Trash2 /> {t('Remove…')}
              </Button>
            </div>
          )}
        </dl>
      </Section>
    </>
  )
}
