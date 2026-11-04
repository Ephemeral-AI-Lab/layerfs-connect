// One Store on the Storage board: a glass card with its mark, name, state,
// size and menu (every Store-wide action); its facts in rows: where it is (the
// home's file, the one machine it was pushed to with that machine's state, or
// the PostgreSQL database), for sqlite every backup location its record links
// (bucket/file, when last written, its state), for PostgreSQL whether its
// server answers; its projects (up to three, then "N more"), each opening the
// project, with the machines it runs on in words; and a footer with its main
// moves as buttons (Push to… or Pull to home or Start, then Back up now, Sync
// backup or Restore…), or its job (job-progress.tsx): running, just done, or
// failed until dismissed; or an operation another client runs on it. A Store
// that needs you (or whose job failed) gets a tinted ring. A sqlite Store moves as a whole: a push, pull or move carries
// every project in it. The card opens the Store's page.
import { Archive, ArrowRightLeft, Database, Folder, FolderPlus, HardDrive, HardDriveDownload, HardDriveUpload, House, type LucideIcon, Power, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { type CSSProperties, type ReactNode, useState } from 'react'

import { runsOn } from '@/components/projects/where-chips'
import { StateChip } from '@/components/state-chip'
import { BACKUP } from '@/components/storage/bucket-card'
import { Chip } from '@/components/storage/chips'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { JobPanel, OpPanel } from '@/components/storage/job-progress'
import { Card, MoreButton } from '@/components/storage/overview/row-parts'
import { go } from '@/components/tabs/go'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes } from '@/data/format'
import { clearingCall } from '@/data/states'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { BackupFile, BucketRow, MachineSandbox, StorageJob, StorageView, StoreBackupLink, StoreRow } from '@shared/host-api'

export interface StoreActions {
  push: () => void
  pull: () => void
  move: () => void
  backup: () => void
  /** Backs up again to one of its links, at once (no sheet). */
  backupTo: (link: StoreBackupLink) => void
  /** Opens Restore on a bucket's file. */
  restore: (bucket: string, file: string) => void
  remove: () => void
  disconnect: () => void
  start: () => void
  /** Opens New project with this Store chosen; absent when the app cannot. */
  addProject?: () => void
  /** Starts a failed job again (a move whose push half failed: that push). */
  retry?: (job: StorageJob) => void
}

type Machine = StorageView['machines'][number]

interface StoreCardProps {
  store: StoreRow
  index: number
  machine: Machine | undefined
  buckets: BucketRow[]
  /** The job it shows: running on it, ended well a moment ago, or failed and not dismissed (cardJob). */
  job: StorageJob | undefined
  /** Sandboxes by project key; null when the machines were not read (the column is left out). */
  sandboxes: Map<string, MachineSandbox[]> | null
  on: StoreActions
  onOpenProject?: (key: string) => void
  /** Opens the Store's page (⌘/Ctrl- or middle-click: in a new tab). */
  onOpen?: (newTab: boolean) => void
}

/** Projects a card lists before "N more". */
const SHOWN = 3

/** A link's file in its bucket's last listing, if it was listed. */
const listedOf = (s: StoreRow, l: StoreBackupLink, buckets: BucketRow[]): BackupFile | undefined => buckets.find((b) => b.name === l.bucket)?.files?.find((f) => f.file === l.file && f.store === s.name)

/** How much a Store needs you: down or unresolved, an unreachable server or a backup both sides changed (danger); a changed backup or a stopped machine (warning). */
export function attentionOf(s: StoreRow, machine: Machine | undefined, buckets: BucketRow[]): 'warning' | 'danger' | null {
  if (s.state === 'down' || s.state === 'unresolved' || s.postgresql?.reachable === false) return 'danger'
  const states = s.links.map((l) => listedOf(s, l, buckets)?.state)
  if (states.some((x) => x === 'both_changed' || x === 'missing')) return 'danger'
  if (states.some((x) => x === 'store_changed' || x === 'bucket_changed') || machine?.state === 'stopped') return 'warning'
  return null
}

/** A sqlite Store saved under the LayerFS home: `native`'s Stores are `<home>/store/<name>/store.sqlite`. */
export const inHome = (s: StoreRow) => s.kind === 'sqlite' && s.machine === 'native'
/** A place in words: `native` is the home, any other machine its name. */
export const placeWords = (machine: string | null | undefined) => (machine === 'native' ? t('Home') : (machine ?? '?'))

/** project.init goes into a Store on any machine (#537 §8.6), not while it is down or busy. */
export const canAddProject = (s: StoreRow, on: StoreActions) => !!on.addProject && (s.kind === 'postgresql' || (s.state !== 'down' && s.state !== 'busy'))

/** A button in a card's footer. */
interface Move {
  key: string
  label: string
  icon: LucideIcon
  run?: () => void
  disabled?: boolean
  title?: string
}

/**
 * A Store's main moves, at most two: where it goes (Push to… from the home,
 * Pull to home from a running machine, Start when its machine is stopped:
 * nothing starts one for you), then its backup (Sync backup when the Store
 * changed since, Restore… when the bucket's copy did, Back up now to its link,
 * else Back up…). PostgreSQL: Add project.
 */
export function movesOf(s: StoreRow, machine: Machine | undefined, buckets: BucketRow[], on: StoreActions): Move[] {
  if (s.kind === 'postgresql') return [{ key: 'add', label: t('Add project'), icon: FolderPlus, run: on.addProject, disabled: !canAddProject(s, on) }]
  const busy = s.state === 'busy'
  const down = s.state === 'down'
  const out: Move[] = []
  if (machine?.state === 'stopped') out.push({ key: 'start', label: t('Start {machine}', { machine: s.machine ?? '' }), icon: Power, run: on.start, title: t('{machine} is stopped: nothing starts it for you.', { machine: s.machine ?? '' }) })
  else if (inHome(s)) out.push({ key: 'push', label: t('Push to…'), icon: HardDriveUpload, run: on.push, disabled: s.state !== 'idle', title: t('Send this Store to a machine; it leaves the home') })
  else if (!down) out.push({ key: 'pull', label: t('Pull to home'), icon: HardDriveDownload, run: on.pull, disabled: busy, title: t('Bring this Store back under the home; it leaves {machine}', { machine: s.machine ?? '' }) })
  if (down || machine?.state === 'stopped') return out
  const listed = s.links.map((l) => ({ l, state: listedOf(s, l, buckets)?.state }))
  const sync = listed.find((x) => x.state === 'store_changed')
  const back = listed.find((x) => x.state === 'bucket_changed')
  const both = listed.some((x) => x.state === 'both_changed')
  if (sync) out.push({ key: 'sync', label: t('Sync backup'), icon: RefreshCw, run: () => on.backupTo(sync.l), disabled: busy, title: t('The Store changed since its backup: back it up again to {bucket}/{file}', { bucket: sync.l.bucket, file: sync.l.file }) })
  else if (back) out.push({ key: 'restore', label: t('Restore…'), icon: HardDriveDownload, run: () => on.restore(back.l.bucket, back.l.file), title: t('{bucket}/{file} changed since this Store’s backup: restore it as a new Store in the home', { bucket: back.l.bucket, file: back.l.file }) })
  else if (s.links.length && !both) out.push({ key: 'backup', label: t('Back up now'), icon: Archive, run: () => on.backupTo(s.links[0]), disabled: busy, title: t('Back up to {bucket}/{file}', { bucket: s.links[0].bucket, file: s.links[0].file }) })
  else out.push({ key: 'backup', label: t('Back up…'), icon: Archive, run: on.backup, disabled: busy })
  return out
}

/** One fact of a card: a quiet label and its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-px text-[11px] text-muted-foreground/80">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-xs">{children}</dd>
    </>
  )
}

export function StoreCard({ store: s, index, machine, buckets, job, sandboxes, on, onOpenProject, onOpen }: StoreCardProps) {
  useI18n()
  const [all, setAll] = useState(false)
  const pg = s.kind === 'postgresql'
  const canAdd = canAddProject(s, on)
  const attention = job?.ended && job.error ? 'danger' : attentionOf(s, machine, buckets)
  const shown = all ? s.projects : s.projects.slice(0, SHOWN)
  const more = s.projects.length - SHOWN
  const moves = movesOf(s, machine, buckets, on)
  return (
    <Card
      index={index}
      data-focus={`store:${s.name}`}
      aria-label={s.name}
      className={cn('group/card relative flex scroll-mt-24 flex-col gap-3 p-4', onOpen && 'transition-shadow hover:shadow-md', attention === 'warning' && 'ring-1 ring-amber-500/45', attention === 'danger' && 'ring-1 ring-destructive/45')}
      style={{ '--i': index, '--flash': 'var(--primary)' } as CSSProperties}
    >
      <header className="flex min-w-0 items-start gap-3">
        <StoreIcon family={s.kind} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-mono text-[14.5px] font-semibold tracking-tight" title={s.name}>
            {onOpen ? (
              // the name stretches over the card: a click anywhere opens the Store, its own controls sit above
              <button type="button" onClick={(e) => onOpen(e.metaKey || e.ctrlKey)} onAuxClick={(e) => e.button === 1 && onOpen(true)} title={t('Open {name}', { name: s.name })} className="rounded-md text-left font-mono outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover/card:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                {s.name}
              </button>
            ) : s.name}
          </h3>
          <div className="relative z-10 mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <StateChip entity="store" state={s.state} op={s.op} className="shrink" />
            {!pg && (
              <span className="shrink-0 tabular-nums" title={s.size ? t('{file} file, {wal} WAL', { file: bytes(s.size.file), wal: bytes(s.size.wal) }) : undefined}>
                {s.size ? bytes(s.size.bytes) : t('size unknown')}
              </span>
            )}
          </div>
        </div>
        <span className="relative z-10">
          <StoreMenu store={s} on={on} className="-mt-1 -mr-1" />
        </span>
      </header>

      <dl className="relative z-10 grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Fact label={t('Location')}>
          <Location store={s} machine={machine} />
        </Fact>
        {pg ? (
          <Fact label={t('Server')}>
            <PgState store={s} />
          </Fact>
        ) : (
          <Fact label={t('Backup')}>
            <Backups store={s} buckets={buckets} />
          </Fact>
        )}
      </dl>

      {s.projects.length === 0 ? (
        <div className="relative z-10 flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span>{t('No projects yet')}</span>
          {/* a PostgreSQL Store's footer has Add project already */}
          {!pg && (
            <Button size="xs" variant="ghost" className="rounded-lg" onClick={on.addProject} disabled={!canAdd}>
              <FolderPlus /> {t('Add project')}
            </Button>
          )}
        </div>
      ) : (
        <ul aria-label={t('Projects in {store}', { store: s.name })} className="relative z-10 -mx-1.5 flex flex-col">
          {shown.map((p) => {
            const key = `${s.name}/${p}`
            const boxes = sandboxes?.get(key) ?? []
            return (
              <li key={p} className="group/project flex min-w-0 items-center rounded-lg hover:bg-foreground/[0.04]">
                <button type="button" onClick={() => onOpenProject?.(key)} disabled={!onOpenProject} title={t('Open project')} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] outline-none group-hover/project:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{p}</span>
                </button>
                {boxes.length > 0 && (
                  // where it runs, in words: the row's one target stays the project
                  <span title={sandboxWords(boxes)} className="mr-1.5 max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">
                    {t('runs on {machines}', { machines: runsOn(boxes).map((r) => r.machine).join(', ') })}
                  </span>
                )}
              </li>
            )
          })}
          {more > 0 && (
            <li>
              <button type="button" onClick={() => setAll(!all)} className="rounded-lg px-1.5 py-1 text-xs text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                {all ? t('Show fewer') : t('{n} more', { n: more })}
              </button>
            </li>
          )}
        </ul>
      )}

      <footer className="relative z-10 mt-auto flex min-h-11 min-w-0 flex-col gap-2 border-t border-foreground/[0.06] pt-3">
        {job ? (
          <JobPanel job={job} onRetry={on.retry && (() => on.retry!(job))} onDetails={onOpen && (() => onOpen(false))} />
        ) : s.state === 'busy' && s.op ? (
          <OpPanel store={s} />
        ) : (
          <>
            {s.down ? (
              <p className="truncate text-xs text-destructive" title={s.down}>{s.down}</p>
            ) : s.state === 'unresolved' ? (
              <p className="truncate font-mono text-[11px] text-destructive" title={t('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}>
                {t('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}
              </p>
            ) : null}
            {moves.length > 0 && (
              <div className="flex min-w-0 flex-wrap gap-2">
                {moves.map((m, i) => (
                  <Button key={m.key} size="xs" variant={i === 0 ? 'outline' : 'ghost'} className={cn('min-w-0 flex-1 rounded-lg', i > 0 && 'ring-1 ring-foreground/[0.08] ring-inset')} onClick={m.run} disabled={m.disabled || !m.run} title={m.title}>
                    <m.icon /> <span className="truncate">{m.label}</span>
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </footer>
    </Card>
  )
}

/** Where a Store is: the home's file, the machine it was pushed to (opens it on Machines) with its state, or its PostgreSQL database. */
function Location({ store: s, machine }: { store: StoreRow; machine: Machine | undefined }) {
  useI18n()
  if (s.kind === 'postgresql')
    return s.postgresql?.target ? (
      <span className="inline-flex min-w-0 items-center gap-1.5" title={t('Its database: {target}', { target: s.postgresql.target })}>
        <Database aria-hidden="true" className="size-3 shrink-0 text-(--icon-accent)" />
        <span className="truncate font-mono text-[11.5px]">{s.postgresql.target}</span>
      </span>
    ) : (
      <span className="text-muted-foreground">{t('PostgreSQL · its database')}</span>
    )
  if (inHome(s))
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5" title={t('Saved under the LayerFS home (store/{name}/store.sqlite); push it to run its projects on a machine', { name: s.name })}>
        <House aria-hidden="true" className="size-3 shrink-0 text-(--icon-accent)" />
        <span className="shrink-0">{t('LayerFS Home')}</span>
        <span className="truncate font-mono text-[10.5px] text-faint">store/{s.name}</span>
      </span>
    )
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {/* a Store's machine → its card on Machines (#537 §7) */}
      <button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-md font-mono outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" title={t('Its file is on {machine}: open the machine', { machine: s.machine ?? '' })} onClick={() => s.machine && go.machine(s.machine)}>
        <HardDrive aria-hidden="true" className="size-3 shrink-0 text-(--icon-accent)" />
        <span className="truncate">{s.machine ?? '?'}</span>
      </button>
      {machine?.platform && <span className="text-[11px] text-muted-foreground">{machine.platform}</span>}
      <StateChip entity="machine" state={machine?.state ?? 'missing'} />
    </span>
  )
}

/** Whether a PostgreSQL Store's server answered store.status: its version and latency, or why not. */
function PgState({ store: s }: { store: StoreRow }) {
  useI18n()
  const server = s.postgresql
  if (server?.reachable === true)
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Chip tone="success">{t('Connected')}</Chip>
        <span className="truncate text-[11px] tabular-nums text-muted-foreground">{[server.version && `PostgreSQL ${server.version}`, server.latencyMs != null && `${Math.round(server.latencyMs)} ms`].filter(Boolean).join(' · ')}</span>
      </span>
    )
  if (server?.reachable === false || server?.error)
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <Chip tone="danger" className="self-start">{t('Not reachable')}</Chip>
        {server.error && <span className="truncate text-[11px] text-destructive" title={server.error}>{server.error}</span>}
      </span>
    )
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Chip tone="neutral" dashed>{t('Unknown')}</Chip>
      <span className="truncate text-[11px] text-muted-foreground">{t('usable from every machine')}</span>
    </span>
  )
}

/** A Store's menu: every Store-wide action, by its family and where it is. */
export function StoreMenu({ store: s, on, className }: { store: StoreRow; on: StoreActions; className?: string }) {
  useI18n()
  const pg = s.kind === 'postgresql'
  const native = s.machine === 'native'
  const canAdd = canAddProject(s, on)
  const moves = s.projects.length ? t('Moves {list}', { list: s.projects.join(', ') }) : t('Moves the Store (no projects yet)')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={t('{store}’s actions', { store: s.name })} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {pg ? (
          <>
            <DropdownMenuItem onSelect={on.addProject} disabled={!canAdd}>
              <FolderPlus /> {t('Add project')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={on.disconnect}>
              <Unplug /> {t('Disconnect…')}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {native ? (
              <DropdownMenuItem onSelect={on.push} disabled={s.state !== 'idle'}>
                <HardDriveUpload /> <Described label={t('Push to…')} note={moves} />
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={on.pull} disabled={s.state === 'busy'}>
                  <HardDriveDownload /> <Described label={t('Pull to home')} note={moves} />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={on.move} disabled={s.state === 'busy'}>
                  <ArrowRightLeft /> <Described label={t('Move to another machine…')} note={moves} />
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={on.backup} disabled={s.state === 'down' || s.state === 'busy'}>
              <Archive /> {t('Back up to…')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={on.addProject} disabled={!canAdd}>
              <FolderPlus /> {t('Add project')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={on.remove}>
              <Trash2 /> {t('Remove…')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A project's Sandboxes in words: `2 on native`. */
export function sandboxWords(list: MachineSandbox[]): string {
  const by = new Map<string, number>()
  for (const b of list) by.set(b.machine ?? '?', (by.get(b.machine ?? '?') ?? 0) + 1)
  return [...by].map(([m, n]) => t(n === 1 ? '1 Sandbox on {machine}' : '{n} Sandboxes on {machine}', { n, machine: m })).join(', ')
}

/** A menu item's label with a quiet line under it. */
function Described({ label, note }: { label: string; note: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span className="max-w-60 truncate text-[11px] text-muted-foreground">{note}</span>
    </span>
  )
}

/**
 * A sqlite Store's backup locations, from its record (no bucket is contacted):
 * one row per bucket link, `bucket/file`, when it was last written, and the
 * state of the bucket's last listing once there is one. A Store not in the
 * home lists as `unknown` until LayerFS reads its heads through its worker.
 */
export function Backups({ store: s, buckets }: { store: StoreRow; buckets: BucketRow[] }) {
  useI18n()
  if (!s.links.length)
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground/70">
        <Archive aria-hidden="true" className="size-3" /> {t('No backup location')}
      </span>
    )
  return (
    <ul aria-label={t('Backup locations of {store}', { store: s.name })} className="flex min-w-0 flex-col gap-1">
      {s.links.map((l) => {
        const listed = listedOf(s, l, buckets)
        const chip = listed ? (BACKUP[listed.state] ?? BACKUP.unknown) : null
        return (
          <li key={l.bucket} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <Archive aria-hidden="true" className="size-3 shrink-0" />
              <span className="min-w-0 truncate font-mono text-[11.5px] text-foreground/85" title={t('Backed up to the bucket {bucket} as {file}', { bucket: l.bucket, file: l.file })}>
                {l.bucket}/{l.file}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground" title={listed?.reason ?? (listed ? undefined : t('{bucket} not listed yet', { bucket: l.bucket }))}>
              {chip ? (
                <Chip tone={chip.tone} dashed={chip.dashed} className="h-[18px] px-2 text-[10.5px]">
                  {t(chip.label)}
                </Chip>
              ) : (
                <span className="text-muted-foreground/70">{t('not listed')}</span>
              )}
              {l.last?.at != null && <span className="truncate tabular-nums text-faint">{ago(l.last.at)}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
