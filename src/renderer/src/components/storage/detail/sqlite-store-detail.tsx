// A SQLite Store's page (storage-links §3.2): its state, Push and Pull (or
// Publish…), its running job, its Link card (both sides in words), its
// projects, its size and room to push, and its PostgreSQL imports.
import { DatabaseZap, FolderPlus, Plus, Trash2 } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { LinkCard } from '@/components/storage/detail/link-card'
import { DetailHeader, Fact, Gone, ProjectChips, Section } from '@/components/storage/detail/parts'
import { SizeCard } from '@/components/storage/detail/size-card'
import { FamilyTile, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { ContextAction, StoreMenu } from '@/components/storage/overview/sqlite-store-row'
import { SizeText } from '@/components/storage/size'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { JobCard } from '@/components/storage/transfers/job-card'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { Button } from '@/components/ui/button'
import { ago, when } from '@/data/format'
import type { StoreInfo } from '@shared/host-api'

/** The header's buttons: Push and Pull (or Publish…), then the menu. */
function HeaderActions({ store }: { store: StoreInfo }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ContextAction store={store} size="sm" />
      <StoreMenu store={store} />
    </div>
  )
}

function InPostgresql({ store, index }: { store: StoreInfo; index: number }) {
  const s = useStorage()
  const pg = s.view.postgresql
  if (!pg.available) return null
  const imports = s.view.stores.list.filter((x) => x.kind === 'postgresql' && (x.importedFrom?.store === store.name || store.imports.includes(x.name)))
  return (
    <Section
      index={index}
      title="In PostgreSQL"
      note="Copies made by import. They don’t sync with this Store."
      aside={
        pg.connections.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => s.importInto({ store: store.name })}>
            <DatabaseZap /> Import into PostgreSQL…
          </Button>
        )
      }
    >
      <div className="px-5 pt-2 pb-4">
        {!pg.connections.length ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-muted-foreground">Add a PostgreSQL connection to import this Store.</p>
            <Button size="sm" variant="outline" onClick={() => s.addLocation({ provider: 'postgresql' })}>
              <Plus /> Add connection
            </Button>
          </div>
        ) : !imports.length ? (
          <p className="text-[13px] text-muted-foreground">Not imported yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {imports.map((x) => (
              <li key={x.name}>
                <button type="button" onClick={() => s.open({ view: 'store', id: x.name })} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring">
                  <FamilyTile family="postgresql" size="sm" />
                  <span className="font-medium group-hover:text-primary">{x.name}</span>
                  <span className="text-muted-foreground">
                    on <span className="font-mono text-[12px]">{x.connection}</span>
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <SizeText store={x} className="text-muted-foreground" />
                  {x.importedFrom?.at && <span className="ml-auto text-xs text-faint">imported {ago(x.importedFrom.at)}</span>}
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
  return (
    <>
      <Breadcrumb items={[{ label: 'SQLite' }, { label: store.name }]} />
      <DetailHeader
        icon={<StoreIcon family="sqlite" providers={providers} size="lg" />}
        eyebrow="Store · SQLite"
        title={store.name}
        badges={running ? <TransferRow job={running} form="compact" /> : <SyncPill state={store.sync.state} copy={store.link} />}
        actions={<HeaderActions store={store} />}
      >
        <p className="flex flex-wrap items-center gap-x-1.5 tabular-nums">
          <span>{count(store.projects.length, 'project')}</span>
          <span aria-hidden="true">·</span>
          <SizeText store={store} reason={s.sizeReason} />
          <span>on this machine</span>
          {store.volume && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                volume <span className="font-mono text-[12px]">{store.volume}</span>
              </span>
            </>
          )}
          {store.created && (
            <>
              <span aria-hidden="true">·</span>
              <span title={when(store.created)}>created {new Date(store.created < 1e12 ? store.created * 1000 : store.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </>
          )}
        </p>
        {store.legacy && <p className="text-xs text-faint">A project’s own Store, from before Stores held several projects.</p>}
      </DetailHeader>

      {job && <JobCard job={job} actions={s.refusalActions(job)} />}

      <LinkCard store={store} index={2} />

      <Section
        index={3}
        title={
          <span className="flex items-center gap-2">
            Projects <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">{store.projects.length}</span>
          </span>
        }
        aside={
          <Button size="sm" variant="outline" onClick={() => s.addProject(store)}>
            <FolderPlus /> Add project
          </Button>
        }
      >
        <div className="px-5 pt-3 pb-4">
          {store.projects.length ? <ProjectChips store={store.name} projects={store.projects} /> : <p className="text-[13px] text-muted-foreground">No projects yet. Add one: empty, or a copy of a folder.</p>}
        </div>
      </Section>

      <SizeCard store={store} index={4} />

      <InPostgresql store={store} index={5} />

      <Section index={6} aria-label="Facts">
        <dl className="grid grid-cols-2 items-end gap-x-6 gap-y-3 px-5 py-4 @min-[760px]/storage:grid-cols-[1fr_1fr_auto]">
          <Fact label="Volume" mono>
            {store.volume ?? '—'}
          </Fact>
          <Fact label="Created" title={when(store.created)}>
            {store.created ? when(store.created) : '—'}
          </Fact>
          <div className="col-span-2 flex justify-end @min-[760px]/storage:col-span-1">
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => s.remove({ kind: 'store', store })} disabled={!!running}>
              <Trash2 /> Remove…
            </Button>
          </div>
        </dl>
      </Section>
    </>
  )
}
