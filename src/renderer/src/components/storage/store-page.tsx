import { t, useI18n } from '@/i18n'
// One Store's page (docs/ui/storage.md), opened from its card on the
// Storage board or any Store link: one scrolling page. Its crumbs (Back to
// where you came from, `Storage / <name>`), its header (family, name, state,
// where its file is, its size, the main move and the menu), why it needs you
// or its job's steps (job-progress.tsx), then its projects (the page's main
// part: the machines each runs on, chats, last activity), this session's jobs
// on it (Activity), its backups and its facts with
// the danger zone (Remove, or Disconnect for PostgreSQL). Where a Store's file
// is and where its projects run are different things: a project runs in
// Sandboxes on any machine. Every action is the Storage page's own: its
// dialogs open over this page.
import { Archive, ChevronRight, Database, FolderPlus, HardDrive, HardDriveDownload, HardDriveUpload, Power, Trash2, Unplug } from 'lucide-react'
import { type CSSProperties, useMemo } from 'react'

import { SectionTitle } from '@/components/compute/target-parts'
import { revealStyle } from '@/components/motion/reveal'
import { Empty } from '@/components/projects/states'
import { runsOn, RunsOnChips } from '@/components/projects/where-chips'
import { StateChip } from '@/components/state-chip'
import { BACKUP } from '@/components/storage/bucket-card'
import { Chip } from '@/components/storage/chips'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { JobActivity, JobSteps, OpPanel } from '@/components/storage/job-progress'
import { Card } from '@/components/storage/overview/row-parts'
import { attentionOf, canAddProject, type StoreActions, StoreMenu } from '@/components/storage/store-card'
import { Crumbs } from '@/components/tabs/crumbs'
import { go } from '@/components/tabs/go'
import { Button } from '@/components/ui/button'
import { ago, bytes, when } from '@/data/format'
import { clearingCall } from '@/data/states'
import { chatLive, chatProject, useChatSessions } from '@/host/use-chat-sessions'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn } from '@/lib/utils'
import type { MachineSandbox, StorageJob, StorageView, StoreRow } from '@shared/host-api'

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
}

/** Columns: Project, Runs on, Chats, Last activity, the opener. */
const COLS = '@min-[36rem]/store:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_1rem]'

export function StorePage({ name, view, job, jobs, sandboxes, catalog, actions, onBack, back: backTo, onOpenProject }: Props) {
  useI18n()
  const s = view.stores.find((x) => x.name === name)
  const { sessions } = useChatSessions(name)
  // each project's chats that are not archived: how many, how many work, the newest activity
  const chats = useMemo(() => {
    const by = new Map<string, { count: number; working: number; updated: number }>()
    for (const c of sessions ?? []) {
      const key = chatProject(c)
      if (!key || c.archived) continue
      const n = by.get(key) ?? { count: 0, working: 0, updated: 0 }
      by.set(key, { count: n.count + 1, working: n.working + (chatLive(c) ? 1 : 0), updated: Math.max(n.updated, c.updated) })
    }
    return by
  }, [sessions])
  const back = <Crumbs back={backTo} items={[{ label: t('Storage'), onClick: onBack, title: t('All Stores') }, { label: name }]} />
  if (!s)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Empty icon={HardDrive} title={t('No Store named {name}', { name })} className="glass-liquid rounded-2xl border-solid">
          {t('It was removed or disconnected, or this home never had it.')}
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {back}
        <header className="reveal flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3" style={{ '--i': 0 } as CSSProperties}>
          <StoreIcon family={s.kind} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate font-mono text-xl font-semibold tracking-tight">{s.name}</h1>
              <span className="text-[13px] text-muted-foreground">{t('{family} Store', { family: pg ? 'PostgreSQL' : 'SQLite' })}</span>
              <StateChip entity="store" state={s.state} op={s.op} />
            </div>
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
              {pg ? (
                <span className="inline-flex items-center gap-1">
                  <Database aria-hidden="true" className="size-3.5" /> {s.postgresql?.target ? <span className="font-mono">{s.postgresql.target}</span> : t('PostgreSQL · its database')}
                </span>
              ) : (
                <>
                  {s.machine && (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      {t('file on')}
                      <button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-md outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" title={t('Its file is on {machine}: open the machine', { machine: s.machine })} onClick={() => go.machine(s.machine!)}>
                        <HardDrive aria-hidden="true" className="size-3.5 shrink-0 text-(--icon-accent)" />
                        {s.machine}
                      </button>
                    </span>
                  )}
                  <span aria-hidden="true" className="text-faint">·</span>
                  <span>{s.size ? bytes(s.size.bytes) : t('size unknown')}</span>
                </>
              )}
              {s.created && (
                <>
                  <span aria-hidden="true" className="text-faint">·</span>
                  <span title={when(s.created)}>{t('created {ago}', { ago: ago(s.created, now) })}</span>
                </>
              )}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {!pg &&
              (native ? (
                <Button size="sm" variant="outline" className="h-8 rounded-xl px-3" onClick={on.push} disabled={s.state !== 'idle'}>
                  <HardDriveUpload /> {t('Push to…')}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-8 rounded-xl px-3" onClick={on.pull} disabled={s.state === 'busy'}>
                  <HardDriveDownload /> {t('Pull to home')}
                </Button>
              ))}
            <StoreMenu store={s} on={on} />
          </span>
        </header>
        {(s.down || s.state === 'unresolved' || stopped) && (
          <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3.5 py-2.5 text-xs', attention === 'danger' ? 'bg-destructive/[0.06] text-destructive' : 'bg-muted/60')}>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {s.down && <p className="break-words">{s.down}</p>}
              {s.state === 'unresolved' && <p className="font-mono text-[11.5px]">{t('see {status} · clear: {clear}', calls)}</p>}
              {stopped && !s.down && <p>{t('{machine} is stopped: nothing starts it for you.', { machine: s.machine ?? '' })}</p>}
            </div>
            {/* U3: nothing starts a machine by being looked at; Start is asked for */}
            {stopped && (
              <Button size="xs" variant="outline" className="rounded-lg" onClick={on.start}>
                <Power /> {t('Start {machine}', { machine: s.machine ?? '' })}
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
      </div>

      <section aria-labelledby="store-projects" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle id="store-projects" aside={!pg && s.projects.length > 1 ? t('A push, pull or move carries them all') : undefined}>
            {t('Projects')} <span className="font-normal text-muted-foreground tabular-nums">{s.projects.length}</span>
          </SectionTitle>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs" onClick={on.addProject} disabled={!canAdd}>
            <FolderPlus className="size-3.5" /> {t('Add project')}
          </Button>
        </div>
        {s.projects.length === 0 ? (
          <Card index={1} className="px-4 py-5 text-[13px] text-muted-foreground">
            {t('No projects yet')}
          </Card>
        ) : (
          <div role="table" aria-label={t('Projects in {store}', { store: s.name })} className="@container/store glass-liquid overflow-hidden rounded-2xl">
            <div role="row" className={cn('hidden gap-x-3 border-b px-4 py-2 text-[11px] font-medium text-faint @min-[36rem]/store:grid', COLS)}>
              <span role="columnheader">{t('Project')}</span>
              <span role="columnheader">{t('Runs on')}</span>
              <span role="columnheader">{t('Chats')}</span>
              <span role="columnheader">{t('Last activity')}</span>
              <span />
            </div>
            {s.projects.map((p, i) => {
              const key = `${s.name}/${p}`
              const boxes = sandboxes?.get(key) ?? []
              const c = chats.get(key)
              const activity = c?.updated || catalog.data?.find((x) => x.key === key)?.created || null
              const open = () => onOpenProject?.(key)
              return (
                <div
                  key={p}
                  role="row"
                  tabIndex={onOpenProject ? 0 : -1}
                  aria-label={t('Open {name}', { name: key })}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      open()
                    }
                  }}
                  style={revealStyle(i)}
                  className={cn(
                    'reveal group/row grid grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    onOpenProject && 'cursor-pointer hover:bg-foreground/[0.03]',
                    i > 0 && 'border-t',
                    COLS,
                  )}
                >
                  <span role="cell" className="min-w-0 truncate text-[13.5px] font-semibold tracking-tight" title={key}>{p}</span>
                  {/* narrow: one second line; wide: three cells of the grid */}
                  <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @min-[36rem]/store:contents">
                    <span role="cell" className="min-w-0 max-w-full">
                      <RunsOnChips runs={sandboxes ? runsOn(boxes) : null} />
                    </span>
                    <span role="cell" className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
                      {!c?.count ? '—' : (
                        <>
                          <span className="text-foreground/85">{c.count}</span>
                          {c.working > 0 && (
                            <span className="ml-1.5 inline-flex items-center gap-1 text-primary">
                              <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />
                              {t('{n} working', { n: c.working })}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                    <span role="cell" className="min-w-0 truncate text-xs tabular-nums text-muted-foreground" title={activity ? when(activity) : undefined}>
                      {activity ? ago(activity, now) : '—'}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className={cn('col-start-2 row-start-1 size-4 text-faint transition-transform @min-[36rem]/store:col-start-auto @min-[36rem]/store:row-start-auto', onOpenProject ? 'group-hover/row:translate-x-0.5 group-hover/row:text-foreground' : 'invisible')} />
                </div>
              )
            })}
          </div>
        )}
      </section>

      <JobActivity jobs={jobs} />

      {!pg && (
        <section aria-labelledby="store-backups" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle id="store-backups">{t('Backups')}</SectionTitle>
            <Button size="sm" variant="ghost" className="h-7 rounded-lg px-2.5 text-xs" onClick={on.backup} disabled={s.state === 'down' || s.state === 'busy'}>
              <Archive className="size-3.5" /> {t('Back up to…')}
            </Button>
          </div>
          <Card index={2} className="flex flex-col p-1.5">
            {s.links.length === 0 ? (
              <p className="px-2.5 py-3 text-[13px] text-muted-foreground">{t('Not backed up. Back it up to a bucket from here or from its menu.')}</p>
            ) : (
              s.links.map((l, i) => {
                const listed = view.buckets.find((b) => b.name === l.bucket)?.files?.find((f) => f.file === l.file && f.store === s.name)
                const chip = listed ? (BACKUP[listed.state] ?? BACKUP.unknown) : null
                const at = listed?.modified ?? l.last?.at ?? null
                const size = listed?.bytes ?? l.last?.bytes ?? null
                return (
                  <div key={l.bucket} className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-[13px]', i > 0 && 'border-t border-foreground/[0.06]')}>
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                      <Archive aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                      {l.bucket}
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{l.file}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
                      {size !== null && <span>{bytes(size)}</span>}
                      {at !== null && <span title={when(at)}>{ago(at, now)}</span>}
                      {chip ? (
                        <span title={listed?.reason ?? undefined}>
                          <Chip tone={chip.tone} dashed={chip.dashed}>{t(chip.label)}</Chip>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/80">{t('not listed yet')}</span>
                      )}
                    </span>
                  </div>
                )
              })
            )}
          </Card>
        </section>
      )}

      <section aria-labelledby="store-details" className="flex flex-col gap-2">
        <SectionTitle id="store-details">{t('Details')}</SectionTitle>
        <Card index={3} className="flex flex-col gap-4 p-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label={t('Family')}>{pg ? 'PostgreSQL' : 'SQLite'}</Fact>
            <Fact label={t('File on')}>
              {pg ? t('its database') : s.machine ? (
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => go.machine(s.machine!)}>{s.machine}</button>
              ) : '—'}
            </Fact>
            {!pg && <Fact label={t('File')}>{s.size ? bytes(s.size.file) : '—'}</Fact>}
            {!pg && <Fact label={t('WAL')}>{s.size ? bytes(s.size.wal) : '—'}</Fact>}
            <Fact label={t('Created')}>{s.created ? when(s.created) : '—'}</Fact>
            <Fact label={t('Open now')}>{s.holders > 0 ? t(s.holders === 1 ? '1 process has it open' : '{n} processes have it open', { n: s.holders }) : t('nothing')}</Fact>
          </dl>
          <div className="flex flex-wrap items-center gap-3 border-t border-destructive/15 pt-3 text-xs">
            <span className="font-medium text-destructive">{t('Danger zone')}</span>
            <Button size="sm" variant="outline" className="h-7 rounded-lg border-destructive/30 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={pg ? on.disconnect : on.remove}>
              {pg ? <Unplug className="size-3.5" /> : <Trash2 className="size-3.5" />}
              {t(pg ? 'Disconnect {name}…' : 'Remove {name}…', { name: s.name })}
            </Button>
            <span className="text-muted-foreground">
              {pg ? t('This home forgets the Store; the database stays.') : t('The Store and every project in it go; backups in buckets stay.')}
            </span>
          </div>
        </Card>
      </section>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-faint uppercase">{label}</dt>
      <dd className="mt-1 truncate text-sm tabular-nums">{children}</dd>
    </div>
  )
}
