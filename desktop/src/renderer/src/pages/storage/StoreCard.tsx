import { fill } from '@/lib/text'
// One Store on the Storage board: a glass card with its mark, name, state,
// size and menu (every Store-wide action); its facts in rows: where it is (the
// home's file, the one machine it was pushed to with that machine's state, or
// the PostgreSQL database), for sqlite every backup location its record links
// (bucket/file, when last written, its state), for PostgreSQL whether its
// server answers; how many projects it holds and how many run now (the
// projects list on Storage's Projects tab and the Store's page); and a footer with its main
// moves as buttons (Push to… or Pull to home or Start, then Back up now, Sync
// backup or Restore…), or its job (job-progress.tsx): running, just done, or
// failed until dismissed; or an operation another client runs on it. A Store
// that needs you (or whose job failed) gets a tinted ring. A sqlite Store moves as a whole: a push, pull or move carries
// every project in it. The card opens the Store's page.
import { Archive, ArrowRightLeft, Database, Folder, FolderPlus, HardDrive, HardDriveDownload, HardDriveUpload, House, type LucideIcon, Power, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { type CSSProperties, type ReactNode } from 'react'

import { StateChip } from '@/components/layerfs/StateChip'
import { BACKUP } from '@/pages/storage/BucketCard'
import { Chip } from '@/components/layerfs/Chips'
import { StoreIcon } from '@/components/layerfs/identity/StoreIcon'
import { JobPanel, OpPanel } from '@/pages/storage/JobProgress'
import { Card, MoreButton } from '@/pages/storage/RowParts'
import { go } from '@/layerfs/go'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes } from '@/layerfs/format'
import { clearingCall } from '@/layerfs/states'
import { cn } from '@/lib/utils'
import type { BackupFile, BucketRow, MachineSandbox, StorageJob, StorageView, StoreBackupLink, StoreRow } from '@/layerfs/host-api'

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
  /** Opens Backup buckets (the modal of every bucket and its files). */
  buckets?: () => void
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
export const placeWords = (machine: string | null | undefined) => (machine === 'native' ? 'Home' : (machine ?? '?'))

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
  if (s.kind === 'postgresql') return [{ key: 'add', label: 'Add project', icon: FolderPlus, run: on.addProject, disabled: !canAddProject(s, on) }]
  const busy = s.state === 'busy'
  const down = s.state === 'down'
  const out: Move[] = []
  if (machine?.state === 'stopped') out.push({ key: 'start', label: `Start ${s.machine ?? ''}`, icon: Power, run: on.start, title: `${s.machine ?? ''} is stopped: nothing starts it for you.` })
  else if (inHome(s)) out.push({ key: 'push', label: 'Push to…', icon: HardDriveUpload, run: on.push, disabled: s.state !== 'idle', title: 'Send this Store to a machine; it leaves the home' })
  else if (!down) out.push({ key: 'pull', label: 'Pull to home', icon: HardDriveDownload, run: on.pull, disabled: busy, title: `Bring this Store back under the home; it leaves ${s.machine ?? ''}` })
  if (down || machine?.state === 'stopped') return out
  const listed = s.links.map((l) => ({ l, state: listedOf(s, l, buckets)?.state }))
  const sync = listed.find((x) => x.state === 'store_changed')
  const back = listed.find((x) => x.state === 'bucket_changed')
  const both = listed.some((x) => x.state === 'both_changed')
  if (sync) out.push({ key: 'sync', label: 'Sync backup', icon: RefreshCw, run: () => on.backupTo(sync.l), disabled: busy, title: `The Store changed since its backup: back it up again to ${sync.l.bucket}/${sync.l.file}` })
  else if (back) out.push({ key: 'restore', label: 'Restore…', icon: HardDriveDownload, run: () => on.restore(back.l.bucket, back.l.file), title: `${back.l.bucket}/${back.l.file} changed since this Store’s backup: restore it as a new Store in the home` })
  else if (s.links.length && !both) out.push({ key: 'backup', label: 'Back up now', icon: Archive, run: () => on.backupTo(s.links[0]), disabled: busy, title: `Back up to ${s.links[0].bucket}/${s.links[0].file}` })
  else out.push({ key: 'backup', label: 'Back up…', icon: Archive, run: on.backup, disabled: busy })
  return out
}

/** One fact of a card: a quiet label and its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-px text-xs text-muted-foreground/80">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-sm">{children}</dd>
    </>
  )
}

/** How many of the Store's projects have a Sandbox now. */
const running = (s: StoreRow, sandboxes: Map<string, MachineSandbox[]> | null) =>
  s.projects.filter((p) => (sandboxes?.get(`${s.name}/${p}`) ?? []).some((b) => b.state !== 'gone')).length

export function StoreCard({ store: s, index, machine, buckets, job, sandboxes, on, onOpen }: StoreCardProps) {
  const pg = s.kind === 'postgresql'
  const canAdd = canAddProject(s, on)
  const attention = job?.ended && job.error ? 'danger' : attentionOf(s, machine, buckets)
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
          <h3 className="truncate font-mono text-base font-strong tracking-tight" title={s.name}>
            {onOpen ? (
              // the name stretches over the card: a click anywhere opens the Store, its own controls sit above
              <button type="button" onClick={(e) => onOpen(e.metaKey || e.ctrlKey)} onAuxClick={(e) => e.button === 1 && onOpen(true)} title={`Open ${s.name}`} className="rounded-sm text-left font-mono outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover/card:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                {s.name}
              </button>
            ) : s.name}
          </h3>
          <div className="relative z-10 mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <StateChip entity="store" state={s.state} op={s.op} className="shrink" />
            {!pg && (
              <span className="shrink-0 tabular-nums" title={s.size ? `${bytes(s.size.file)} file, ${bytes(s.size.wal)} WAL` : undefined}>
                {s.size ? bytes(s.size.bytes) : 'size unknown'}
              </span>
            )}
          </div>
        </div>
        <span className="relative z-10">
          <StoreMenu store={s} on={on} className="-mt-1 -mr-1" />
        </span>
      </header>

      <dl className="relative z-10 grid grid-cols-[76px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5">
        <Fact label={'Location'}>
          <Location store={s} machine={machine} />
        </Fact>
        {pg ? (
          <Fact label={'Server'}>
            <PgState store={s} />
          </Fact>
        ) : (
          <Fact label={'Backup'}>
            <Backups store={s} buckets={buckets} />
          </Fact>
        )}
      </dl>

      {s.projects.length === 0 ? (
        <div className="relative z-10 flex items-center justify-between gap-2 text-md text-muted-foreground">
          <span>{'No projects yet'}</span>
          {/* a PostgreSQL Store's footer has Add project already */}
          {!pg && (
            <Button size="xs" variant="ghost" className="rounded-md" onClick={on.addProject} disabled={!canAdd}>
              <FolderPlus /> {'Add project'}
            </Button>
          )}
        </div>
      ) : (
        // the projects themselves list on Storage's Projects tab and the Store's page: here, how many
        <button type="button" onClick={() => onOpen?.(false)} disabled={!onOpen} title={`Projects in ${s.name}`} className="relative z-10 -mx-1.5 flex min-w-0 items-center gap-2 self-start rounded-md px-1.5 py-1 text-md outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
          <Folder aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span>{fill(s.projects.length === 1 ? '{count} project' : '{count} projects', { count: s.projects.length })}</span>
          {running(s, sandboxes) > 0 && <span className="text-sm text-muted-foreground">{`${running(s, sandboxes)} running`}</span>}
        </button>
      )}

      <footer className="relative z-10 mt-auto flex min-h-11 min-w-0 flex-col gap-2 border-t border-foreground/[0.06] pt-3">
        {job ? (
          <JobPanel job={job} onRetry={on.retry && (() => on.retry!(job))} onDetails={onOpen && (() => onOpen(false))} />
        ) : s.state === 'busy' && s.op ? (
          <OpPanel store={s} />
        ) : (
          <>
            {s.down ? (
              <p className="truncate text-sm text-destructive" title={s.down}>{s.down}</p>
            ) : s.state === 'unresolved' ? (
              <p className="truncate font-mono text-xs text-destructive" title={fill('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}>
                {fill('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}
              </p>
            ) : null}
            {moves.length > 0 && (
              <div className="flex min-w-0 flex-wrap gap-2">
                {moves.map((m, i) => (
                  <Button key={m.key} size="xs" variant={i === 0 ? 'outline' : 'ghost'} className={cn('min-w-0 flex-1 rounded-md', i > 0 && 'ring-1 ring-foreground/[0.08] ring-inset')} onClick={m.run} disabled={m.disabled || !m.run} title={m.title}>
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
export function Location({ store: s, machine, showState = true }: { store: StoreRow; machine: Machine | undefined; showState?: boolean }) {
  if (s.kind === 'postgresql')
    return s.postgresql?.target ? (
      <span className="inline-flex min-w-0 items-center gap-1.5" title={`Its database: ${s.postgresql.target}`}>
        <Database aria-hidden="true" className="size-3 shrink-0 text-(--icon-accent)" />
        <span className="truncate font-mono text-xs-plus">{s.postgresql.target}</span>
      </span>
    ) : (
      <span className="text-muted-foreground">{'PostgreSQL · its database'}</span>
    )
  if (inHome(s))
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5" title={`Saved under the LayerFS home (store/${s.name}/store.sqlite); push it to run its projects on a machine`}>
        <House aria-hidden="true" className="size-3 shrink-0 text-(--icon-accent)" />
        <span className="shrink-0">{'LayerFS Home'}</span>
        <span className="truncate font-mono text-3xs text-faint">store/{s.name}</span>
      </span>
    )
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {/* a Store's machine → its card on Machines (#537 §7) */}
      <button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-sm font-mono outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" title={`Its file is on ${s.machine ?? ''}: open the machine`} onClick={() => s.machine && go.machine(s.machine)}>
        <HardDrive aria-hidden="true" className="size-3 shrink-0 text-(--icon-accent)" />
        <span className="truncate">{s.machine ?? '?'}</span>
      </button>
      {machine?.platform && <span className="text-xs text-muted-foreground">{machine.platform}</span>}
      {showState && <StateChip entity="machine" state={machine?.state ?? 'missing'} />}
    </span>
  )
}

/** Whether a PostgreSQL Store's server answered store.status: its version and latency, or why not. */
export function PgState({ store: s }: { store: StoreRow }) {
  const server = s.postgresql
  if (server?.reachable === true)
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Chip tone="success">{'Connected'}</Chip>
        <span className="truncate text-xs tabular-nums text-muted-foreground">{[server.version && `PostgreSQL ${server.version}`, server.latencyMs != null && `${Math.round(server.latencyMs)} ms`].filter(Boolean).join(' · ')}</span>
      </span>
    )
  if (server?.reachable === false || server?.error)
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <Chip tone="danger" className="self-start">{'Not reachable'}</Chip>
        {server.error && <span className="truncate text-xs text-destructive" title={server.error}>{server.error}</span>}
      </span>
    )
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Chip tone="neutral" dashed>{'Unknown'}</Chip>
      <span className="truncate text-xs text-muted-foreground">{'usable from every machine'}</span>
    </span>
  )
}

/** A Store's menu: every Store-wide action, by its family and where it is. */
export function StoreMenu({ store: s, on, className }: { store: StoreRow; on: StoreActions; className?: string }) {
  const pg = s.kind === 'postgresql'
  const native = s.machine === 'native'
  const canAdd = canAddProject(s, on)
  const moves = s.projects.length ? `Moves ${s.projects.join(', ')}` : 'Moves the Store (no projects yet)'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={`${s.name}’s actions`} className={className} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {pg ? (
          <>
            <DropdownMenuItem onSelect={on.addProject} disabled={!canAdd}>
              <FolderPlus /> {'Add project'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={on.disconnect}>
              <Unplug /> {'Disconnect…'}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {native ? (
              <DropdownMenuItem onSelect={on.push} disabled={s.state !== 'idle'}>
                <HardDriveUpload /> <Described label={'Push to…'} note={moves} />
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={on.pull} disabled={s.state === 'busy'}>
                  <HardDriveDownload /> <Described label={'Pull to home'} note={moves} />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={on.move} disabled={s.state === 'busy'}>
                  <ArrowRightLeft /> <Described label={'Move to another machine…'} note={moves} />
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={on.backup} disabled={s.state === 'down' || s.state === 'busy'}>
              <Archive /> {'Back up to…'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={on.addProject} disabled={!canAdd}>
              <FolderPlus /> {'Add project'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={on.remove}>
              <Trash2 /> {'Remove…'}
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
  return [...by].map(([m, n]) => fill(n === 1 ? '1 Sandbox on {machine}' : '{n} Sandboxes on {machine}', { n, machine: m })).join(', ')
}

/** A menu item's label with a quiet line under it. */
function Described({ label, note }: { label: string; note: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span className="max-w-60 truncate text-xs text-muted-foreground">{note}</span>
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
  if (!s.links.length)
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground/70">
        <Archive aria-hidden="true" className="size-3" /> {'No backup location'}
      </span>
    )
  return (
    <ul aria-label={`Backup locations of ${s.name}`} className="flex min-w-0 flex-col gap-1">
      {s.links.map((l) => {
        const listed = listedOf(s, l, buckets)
        const chip = listed ? (BACKUP[listed.state] ?? BACKUP.unknown) : null
        return (
          <li key={l.bucket} className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <Archive aria-hidden="true" className="size-3 shrink-0" />
              <span className="min-w-0 truncate font-mono text-xs-plus text-foreground/85" title={`Backed up to the bucket ${l.bucket} as ${l.file}`}>
                {l.bucket}/{l.file}
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={listed?.reason ?? (listed ? undefined : `${l.bucket} not listed yet`)}>
              {chip ? (
                <Chip tone={chip.tone} dashed={chip.dashed} className="h-[18px] px-2 text-3xs">
                  {chip.label}
                </Chip>
              ) : (
                <span className="text-muted-foreground/70">{'not listed'}</span>
              )}
              {l.last?.at != null && <span className="truncate tabular-nums text-faint">{ago(l.last.at)}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
