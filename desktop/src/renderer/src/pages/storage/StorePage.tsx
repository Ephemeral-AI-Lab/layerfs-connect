import { fill } from '@/lib/text'
// One Store's page (docs/ui/storage.md), opened from its card, its heading on
// Storage's Projects tab or any Store link. Its crumbs (Back to where you came
// from, `Storage / <name>`), its header (family, name, state, where its file
// is, its size, the main move and the menu), why it needs you or its job's
// steps (job-progress.tsx), then four tabs: Projects (the machines each runs
// on, when it was made), Activity (this session's jobs on it), Backups
// (sqlite only) and Settings (its facts, each project's disk use, and the
// danger zone: Remove, or Disconnect for PostgreSQL). Where a Store's file
// is and where its projects run are different things: a project runs in
// Sandboxes on any machine. Every action is the Storage page's own: its
// dialogs open over this page.
import { Archive, ChevronRight, Database, FolderPlus, HardDrive, HardDriveDownload, HardDriveUpload, Power, Trash2, Unplug } from 'lucide-react'
import { useState } from 'react'

import { SectionTitle } from '@/pages/machines/TargetParts'
import { revealStyle } from '@/components/layerfs/motion/reveal'
import { Segmented, Tab, TabBar, TabCount, TabPanel } from '@/components/layerfs/motion/tabs'
import { ProjectStorageContent } from '@/pages/storage/ProjectStorage'
import { LoadError, Loading } from '@/components/layerfs/States'
import { storeFacts, useStorageView } from '@/components/layerfs/StoreFacts'
import { host } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import { Empty } from '@/components/layerfs/States'
import { runsOn, RunsOnChips } from '@/components/layerfs/WhereChips'
import { StateChip } from '@/components/layerfs/StateChip'
import { BACKUP } from '@/pages/storage/BucketCard'
import { Chip } from '@/components/layerfs/Chips'
import { StoreIcon } from '@/components/layerfs/identity/StoreIcon'
import { JobActivity, JobSteps, OpPanel } from '@/pages/storage/JobProgress'
import { Card } from '@/pages/storage/RowParts'
import { attentionOf, canAddProject, type StoreActions, StoreMenu } from '@/pages/storage/StoreCard'
import { Crumbs } from '@/components/layerfs/Crumbs'
import { go } from '@/layerfs/go'
import { Button } from '@/components/ui/button'
import { ago, bytes, when } from '@/layerfs/format'
import { clearingCall } from '@/layerfs/states'
import type { ProjectCatalog } from '@/layerfs/use-projects'
import { cn } from '@/lib/utils'
import type { MachineSandbox, StorageJob, StorageView, StoreRow } from '@/layerfs/host-api'

interface Props {
  name: string
  view: StorageView
  /** The job its steps show: running, ended well a moment ago, or failed and not dismissed (cardJob). */
  job: StorageJob | undefined
  /** Its jobs this window knows, newest first: the Activity list. */
  jobs: StorageJob[]
  /** Sandboxes by project key; null when the machines were not read (the column says —). */
  sandboxes: Map<string, MachineSandbox[]> | null
  catalog: ProjectCatalog
  /** The Storage page's actions on a Store (its dialogs open over this page). */
  actions: (store: StoreRow) => StoreActions
  /** The Storage board. */
  onBack: () => void
  /** Back where this tab came from (another page), when it came from one. */
  back?: { label: string; onBack: () => void }
  onOpenProject?: (key: string) => void
  /** The tab shown first: Projects unless asked. */
  initialTab?: StoreTab
}

export type StoreTab = 'projects' | 'activity' | 'backups' | 'settings'
const STORE_TABS: { id: StoreTab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'activity', label: 'Activity' },
  { id: 'backups', label: 'Backups' },
  { id: 'settings', label: 'Settings' },
]

/** Columns: Project, Runs on, Created, the opener. */
const COLS = '@min-[576px]/store:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_16px]'

export function StorePage({ name, view, job, jobs, sandboxes, catalog, actions, onBack, back: backTo, onOpenProject, initialTab = 'projects' }: Props) {
  const [tab, setTab] = useState<StoreTab>(initialTab)
  const s = view.stores.find((x) => x.name === name)
  const back = <Crumbs back={backTo} items={[{ label: 'Storage', onClick: onBack, title: 'All Stores' }, { label: name }]} />
  if (!s)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Empty icon={HardDrive} title={`No Store named ${name}`} className="glass-liquid rounded-2xl border-solid">
          {'It was removed or disconnected, or this home never had it.'}
        </Empty>
      </div>
    )

  const on = actions(s)
  const pg = s.kind === 'postgresql'
  const native = s.machine === 'native'
  const machine = view.machines.find((m) => m.name === s.machine)
  const attention = attentionOf(s, machine, view.buckets)
  const canAdd = canAddProject(s, on)
  const calls = clearingCall('store', s.name, s.op)
  const stopped = machine?.state === 'stopped'
  const now = Date.now()

  const family = <span className="shrink-0 rounded-full bg-foreground/[0.05] px-2 py-px text-xs font-medium text-muted-foreground">{pg ? 'PostgreSQL' : 'SQLite'}</span>
  const facts = (
    <>
      {pg ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          <Database aria-hidden="true" className="size-3.5 shrink-0" />
          {s.postgresql?.target ? <span className="truncate font-mono text-xs-plus">{s.postgresql.target}</span> : 'PostgreSQL · its database'}
        </span>
      ) : (
        <>
          {s.machine && (
            <span className="inline-flex min-w-0 shrink-0 items-center gap-1">
              {native ? 'in the Home' : 'file on'}
              {!native && (
                <button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" title={`Its file is on ${s.machine}: open the machine`} onClick={() => go.machine(s.machine!)}>
                  <HardDrive aria-hidden="true" className="size-3.5 shrink-0 text-(--icon-accent)" />
                  {s.machine}
                </button>
              )}
            </span>
          )}
          <span aria-hidden="true" className="text-faint">·</span>
          <span className="shrink-0">{s.size ? bytes(s.size.bytes) : 'size unknown'}</span>
        </>
      )}
      {s.created && (
        <>
          <span aria-hidden="true" className="text-faint">·</span>
          <span className="truncate" title={when(s.created)}>{`created ${ago(s.created, now)}`}</span>
        </>
      )}
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* one thin row, as a project's page: back, Storage / the Store, its facts, its moves */}
        <header className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Crumbs back={backTo ?? { label: 'Storage', onBack }} items={[{ label: 'Storage', onClick: onBack, title: 'All Stores' }]} />
          <span aria-hidden="true" className="shrink-0 text-faint">/</span>
          <StoreIcon family={s.kind} size="sm" className="[&>span]:size-4 [&>span]:rounded-3xs [&_svg]:size-2.5" />
          <h1 className="min-w-0 truncate font-mono text-base-plus leading-6 font-strong tracking-tight">{s.name}</h1>
          {family}
          <StateChip entity="store" state={s.state} op={s.op} className="shrink" />
          <span className="ml-1 flex min-w-0 flex-1 items-center gap-x-1.5 overflow-hidden text-sm whitespace-nowrap text-muted-foreground tabular-nums">{facts}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {!pg &&
              (native ? (
                <Button size="sm" variant="outline" className="h-7 rounded-md px-2.5" onClick={on.push} disabled={s.state !== 'idle'}>
                  <HardDriveUpload className="size-3.5" /> {'Push to…'}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-7 rounded-md px-2.5" onClick={on.pull} disabled={s.state === 'busy'}>
                  <HardDriveDownload className="size-3.5" /> {'Pull to home'}
                </Button>
              ))}
            <StoreMenu store={s} on={on} />
          </span>
        </header>
        {(s.down || s.state === 'unresolved' || stopped) && (
          <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg-plus px-3.5 py-2.5 text-sm', attention === 'danger' ? 'bg-destructive/[0.06] text-destructive' : 'bg-muted/60')}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {s.down && <p className="break-words">{s.down}</p>}
              {s.state === 'unresolved' && <p className="font-mono text-xs-plus">{fill('see {status} · clear: {clear}', calls)}</p>}
              {stopped && !s.down && <p>{`${s.machine ?? ''} is stopped: nothing starts it for you.`}</p>}
            </div>
            {/* U3: nothing starts a machine by being looked at; Start is asked for */}
            {stopped && (
              <Button size="xs" variant="outline" className="rounded-md" onClick={on.start}>
                <Power /> {`Start ${s.machine ?? ''}`}
              </Button>
            )}
          </div>
        )}
        {job ? (
          <JobSteps job={job} onRetry={on.retry && (() => on.retry!(job))} />
        ) : (
          s.state === 'busy' &&
          s.op && (
            <div className="glass-liquid rounded-2xl p-4">
              <OpPanel store={s} />
            </div>
          )
        )}
        <TabBar
          aria-label={'Store'}
          variant="line"
          end={
            tab === 'projects' && (
              <Button size="xs" variant="ghost" className="rounded-md text-muted-foreground hover:text-foreground" onClick={on.addProject} disabled={!canAdd} title={!pg && s.projects.length > 1 ? 'A push, pull or move carries them all' : undefined}>
                <FolderPlus /> {'Add project'}
              </Button>
            )
          }
        >
          {STORE_TABS.filter((x) => !(pg && x.id === 'backups')).map((x) => (
            <Tab key={x.id} active={tab === x.id} onClick={() => setTab(x.id)}>
              {x.label}
              {x.id === 'projects' && s.projects.length > 0 && <TabCount>{s.projects.length}</TabCount>}
              {x.id === 'activity' && jobs.length > 0 && <TabCount>{jobs.length}</TabCount>}
            </Tab>
          ))}
        </TabBar>
      </div>

      <TabPanel id={tab}>
      {tab === 'projects' && <section aria-label={`Projects in ${s.name}`} className="flex flex-col gap-2">
        {s.projects.length === 0 ? (
          <Card index={1} className="px-4 py-5 text-md text-muted-foreground">
            {'No projects yet'}
          </Card>
        ) : (
          <div role="table" aria-label={`Projects in ${s.name}`} className="@container/store glass-liquid overflow-hidden rounded-2xl">
            <div role="row" className={cn('hidden gap-x-3 border-b px-4 py-2 text-xs font-medium text-faint @min-[576px]/store:grid', COLS)}>
              <span role="columnheader">{'Project'}</span>
              <span role="columnheader">{'Runs on'}</span>
              <span role="columnheader">{'Created'}</span>
              <span />
            </div>
            {s.projects.map((p, i) => {
              const key = `${s.name}/${p}`
              const boxes = sandboxes?.get(key) ?? []
              const activity = catalog.data?.find((x) => x.key === key)?.created || null
              const open = () => onOpenProject?.(key)
              return (
                <div
                  key={p}
                  role="row"
                  tabIndex={onOpenProject ? 0 : -1}
                  aria-label={`Open ${key}`}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      open()
                    }
                  }}
                  style={revealStyle(i)}
                  className={cn(
                    'reveal group/row grid grid-cols-[minmax(0,1fr)_16px] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    onOpenProject && 'cursor-pointer hover:bg-foreground/[0.03]',
                    i > 0 && 'border-t',
                    COLS,
                  )}
                >
                  <span role="cell" className="min-w-0 truncate text-md-plus font-strong tracking-tight" title={key}>{p}</span>
                  {/* narrow: one second line; wide: two cells of the grid */}
                  <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @min-[576px]/store:contents">
                    <span role="cell" className="min-w-0 max-w-full">
                      <RunsOnChips runs={sandboxes ? runsOn(boxes) : null} />
                    </span>
                    <span role="cell" className="min-w-0 truncate text-sm tabular-nums text-muted-foreground" title={activity ? when(activity) : undefined}>
                      {activity ? ago(activity, now) : '—'}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className={cn('col-start-2 row-start-1 size-4 text-faint transition-transform @min-[576px]/store:col-start-auto @min-[576px]/store:row-start-auto', onOpenProject ? 'group-hover/row:translate-x-0.5 group-hover/row:text-foreground' : 'invisible')} />
                </div>
              )
            })}
          </div>
        )}
      </section>}

      {tab === 'activity' && (jobs.length ? <JobActivity jobs={jobs} /> : (
        <Card index={1} className="px-4 py-5 text-md text-muted-foreground">{`No push, pull, move or backup on ${s.name} in this session yet.`}</Card>
      ))}

      {tab === 'backups' && !pg && (
        <section aria-labelledby="store-backups" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle id="store-backups">{'Backups'}</SectionTitle>
            <Button size="sm" variant="ghost" className="h-7 rounded-md px-2.5 text-sm" onClick={on.backup} disabled={s.state === 'down' || s.state === 'busy'}>
              <Archive className="size-3.5" /> {'Back up to…'}
            </Button>
          </div>
          <Card index={2} className="flex flex-col p-1.5">
            {s.links.length === 0 ? (
              <p className="px-2.5 py-3 text-md text-muted-foreground">{'Not backed up. Back it up to a bucket from here or from its menu.'}</p>
            ) : (
              s.links.map((l, i) => {
                const listed = view.buckets.find((b) => b.name === l.bucket)?.files?.find((f) => f.file === l.file && f.store === s.name)
                const chip = listed ? (BACKUP[listed.state] ?? BACKUP.unknown) : null
                const at = listed?.modified ?? l.last?.at ?? null
                const size = listed?.bytes ?? l.last?.bytes ?? null
                return (
                  <div key={l.bucket} className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-md', i > 0 && 'border-t border-foreground/[0.06]')}>
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                      <Archive aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                      {l.bucket}
                    </span>
                    <span className="min-w-0 truncate font-mono text-sm text-muted-foreground">{l.file}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-3 text-sm tabular-nums text-muted-foreground">
                      {size !== null && <span>{bytes(size)}</span>}
                      {at !== null && <span title={when(at)}>{ago(at, now)}</span>}
                      {chip ? (
                        <span title={listed?.reason ?? undefined}>
                          <Chip tone={chip.tone} dashed={chip.dashed}>{chip.label}</Chip>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/80">{'not listed yet'}</span>
                      )}
                    </span>
                  </div>
                )
              })
            )}
          </Card>
        </section>
      )}

      {tab === 'settings' && <section aria-labelledby="store-details" className="flex flex-col gap-2">
        <SectionTitle id="store-details">{'Details'}</SectionTitle>
        <Card index={3} className="flex flex-col gap-4 p-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label={'Family'}>{pg ? 'PostgreSQL' : 'SQLite'}</Fact>
            <Fact label={'File on'}>
              {pg ? 'its database' : s.machine ? (
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => go.machine(s.machine!)}>{s.machine}</button>
              ) : '—'}
            </Fact>
            {!pg && <Fact label={'File'}>{s.size ? bytes(s.size.file) : '—'}</Fact>}
            {!pg && <Fact label={'WAL'}>{s.size ? bytes(s.size.wal) : '—'}</Fact>}
            <Fact label={'Created'}>{s.created ? when(s.created) : '—'}</Fact>
            <Fact label={'Open now'}>{s.holders > 0 ? fill(s.holders === 1 ? '1 process has it open' : '{n} processes have it open', { n: s.holders }) : 'nothing'}</Fact>
          </dl>
          <div className="flex flex-wrap items-center gap-3 border-t border-destructive/15 pt-3 text-sm">
            <span className="font-medium text-destructive">{'Danger zone'}</span>
            <Button size="sm" variant="outline" className="h-7 rounded-md border-destructive/30 px-2.5 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={pg ? on.disconnect : on.remove}>
              {pg ? <Unplug className="size-3.5" /> : <Trash2 className="size-3.5" />}
              {fill(pg ? 'Disconnect {name}…' : 'Remove {name}…', { name: s.name })}
            </Button>
            <span className="text-muted-foreground">
              {pg ? 'This home forgets the Store; the database stays.' : 'The Store and every project in it go; backups in buckets stay.'}
            </span>
          </div>
        </Card>
      </section>}

      {tab === 'settings' && s.projects.length > 0 && <StoreUsage store={s.name} projects={s.projects} />}
      </TabPanel>
    </div>
  )
}

/** Disk use, one project at a time: what each project's history costs in this Store's file. */
function StoreUsage({ store, projects }: { store: string; projects: string[] }) {
  const [project, setProject] = useState(projects[0])
  const key = `${store}/${project}`
  const state = useHostQuery(() => host.project(key), [key], `project:${key}`)
  const storage = useStorageView()
  const s = state.data
  return (
    <section aria-labelledby="store-usage" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id="store-usage">{'Disk use'}</SectionTitle>
        {projects.length > 1 && (
          <Segmented aria-label={'Project'} value={project} onChange={setProject} options={projects.map((p) => ({ value: p, label: p }))} />
        )}
      </div>
      {s ? <ProjectStorageContent state={s} store={storeFacts(s.project, storage)} /> : state.error ? <LoadError error={state.error} what={key} onRetry={state.reload} /> : <Loading label={`Reading ${key}`} />}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-faint uppercase">{label}</dt>
      <dd className="mt-1 truncate text-base tabular-nums">{children}</dd>
    </div>
  )
}
