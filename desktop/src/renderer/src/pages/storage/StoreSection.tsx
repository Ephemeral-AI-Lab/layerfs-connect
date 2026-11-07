import { fill } from '@/lib/text'
// One Store on the Storage page, as a wide card that holds its projects
// (docs/connect README, "Storage and projects"). Header: the Store's mark,
// name (opens its page), family, state, where it is and its size, its main
// moves and its menu (every Store-wide action). Body: a tile per project
// (the machines it runs on and when it was made) and a
// dashed Add project tile; past SHOWN tiles it folds. Footer: its backups (a
// menu of the backup moves) or its PostgreSQL server, what doctor finds on it,
// or its job while one runs. A Store that needs you gets a tinted ring.
import { Archive, ChevronDown, FolderPlus, HardDriveDownload, RefreshCw, Settings2, Stethoscope } from 'lucide-react'
import { type CSSProperties, type KeyboardEvent, useState } from 'react'

import { LfsProject } from '@/components/layerfs/LfsIcons'
import type { ProjectRowData } from '@/layerfs/project-rows'
import { RunsOnChips } from '@/components/layerfs/WhereChips'
import { StateChip } from '@/components/layerfs/StateChip'
import { BACKUP } from '@/pages/storage/BucketCard'
import { Chip } from '@/components/layerfs/Chips'
import { StoreIcon } from '@/components/layerfs/identity/StoreIcon'
import { JobPanel, OpPanel } from '@/pages/storage/JobProgress'
import { Card } from '@/pages/storage/RowParts'
import { attentionOf, canAddProject, Location, movesOf, PgState, type StoreActions, StoreMenu } from '@/pages/storage/StoreCard'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/layerfs/format'
import { clearingCall } from '@/layerfs/states'
import { cn } from '@/lib/utils'
import type { BucketRow, DoctorFinding, StorageJob, StorageView, StoreRow } from '@/layerfs/host-api'

/** Tiles a card shows before "Show all". */
const SHOWN = 8

type Machine = StorageView['machines'][number]

/** One project in a Store: its row when the catalog has it, else just its name. */
export interface StoreProject {
  key: string
  name: string
  row: ProjectRowData | undefined
}

interface StoreSectionProps {
  store: StoreRow
  index: number
  machine: Machine | undefined
  buckets: BucketRow[]
  job: StorageJob | undefined
  /** The projects to show (all, or those the search matches). */
  projects: StoreProject[]
  /** A search is on: no folding, and no Add project tile. */
  searching: boolean
  now: number
  /** What `layerfs doctor` finds on this Store. */
  findings: DoctorFinding[]
  /** Its moves, menu, Add project and backups; absent: a bare card (the machine page), the Store and its projects only. */
  on?: StoreActions
  onOpenProject?: (key: string) => void
  /** Opens the Store's page (⌘/Ctrl- or middle-click: in a new tab). */
  onOpen?: (newTab: boolean) => void
}

export function StoreSection({ store: s, index, machine, buckets, job, projects, searching, now, findings, on, onOpenProject, onOpen }: StoreSectionProps) {
  const [all, setAll] = useState(false)
  const pg = s.kind === 'postgresql'
  const attention = job?.ended && job.error ? 'danger' : attentionOf(s, machine, buckets)
  // PostgreSQL's one move is Add project: its tile says it already
  const moves = on ? movesOf(s, machine, buckets, on).filter((m) => m.key !== 'add') : []
  const folded = !searching && !all && projects.length > SHOWN
  const shown = folded ? projects.slice(0, SHOWN) : projects
  return (
    <Card
      index={index}
      data-focus={`store:${s.name}`}
      aria-label={s.name}
      className={cn('relative flex scroll-mt-24 flex-col overflow-hidden', attention === 'warning' && 'ring-1 ring-amber-500/45', attention === 'danger' && 'ring-1 ring-destructive/45')}
      style={{ '--i': index, '--flash': 'var(--primary)' } as CSSProperties}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5 pb-3">
        <StoreIcon family={s.kind} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate font-mono text-base font-strong tracking-tight" title={s.name}>
              {onOpen ? (
                <button type="button" onClick={(e) => onOpen(e.metaKey || e.ctrlKey)} onAuxClick={(e) => e.button === 1 && onOpen(true)} title={`Open ${s.name}`} className="rounded-sm text-left font-mono outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                  {s.name}
                </button>
              ) : s.name}
            </h3>
            <span className="shrink-0 rounded-full bg-foreground/[0.05] px-2 py-px text-xs font-medium text-muted-foreground">{pg ? 'PostgreSQL' : 'SQLite'}</span>
            <StateChip entity="store" state={s.state} op={s.op} className="shrink" />
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="flex min-w-0 items-center"><Location store={s} machine={machine} /></span>
            {!pg && (
              <>
                <span aria-hidden="true" className="text-faint">·</span>
                <span className="shrink-0 tabular-nums" title={s.size ? `${bytes(s.size.file)} file, ${bytes(s.size.wal)} WAL` : undefined}>
                  {s.size ? bytes(s.size.bytes) : 'size unknown'}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!job &&
            moves.map((m) => (
              <Button key={m.key} size="xs" variant="outline" className="rounded-md" onClick={m.run} disabled={m.disabled || !m.run} title={m.title}>
                <m.icon /> {m.label}
              </Button>
            ))}
          {on && <StoreMenu store={s} on={on} />}
        </div>
      </header>

      <div className="flex flex-col gap-2 px-4 pb-4">
        <ul aria-label={`Projects in ${s.name}`} className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
          {shown.map((p, i) => (
            <li key={p.key} className="flex">
              <ProjectTile project={p} index={i} now={now} onOpen={onOpenProject} />
            </li>
          ))}
          {!searching && on && (
            <li className="flex">
              <AddTile store={s} on={on} />
            </li>
          )}
          {!searching && projects.length === 0 && (
            <li className="flex items-center px-1 text-sm text-muted-foreground">{'No projects yet'}</li>
          )}
        </ul>
        {projects.length > SHOWN && !searching && (
          <button type="button" onClick={() => setAll(!all)} className="self-start rounded-sm px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            {all ? 'Show fewer' : `Show all (${projects.length})`}
          </button>
        )}
      </div>

      {(on || job || s.op || s.down || s.state === 'unresolved') && (
      <footer className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-foreground/[0.06] bg-foreground/[0.015] px-4 py-2 text-sm text-muted-foreground">
        {job ? (
          <div className="min-w-0 flex-1">
            <JobPanel job={job} onRetry={on?.retry && (() => on.retry!(job))} onDetails={onOpen && (() => onOpen(false))} />
          </div>
        ) : s.state === 'busy' && s.op ? (
          <div className="min-w-0 flex-1">
            <OpPanel store={s} />
          </div>
        ) : (
          <>
            {on && (pg ? <PgState store={s} /> : <BackupsMenu store={s} buckets={buckets} on={on} />)}
            {s.down ? (
              <span className="min-w-0 truncate text-destructive" title={s.down}>{s.down}</span>
            ) : s.state === 'unresolved' ? (
              <span className="min-w-0 truncate font-mono text-xs text-destructive">{fill('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}</span>
            ) : null}
            <Findings findings={findings} />
          </>
        )}
      </footer>
      )}
    </Card>
  )
}

/** A project: its name, where it runs and when it was made. Opens its Store's page. */
function ProjectTile({ project: p, index, now, onOpen }: { project: StoreProject; index: number; now: number; onOpen?: (key: string) => void }) {
  const activity = p.row?.activity ?? null
  const open = () => onOpen?.(p.key)
  return (
    // a div that opens, so the machine chips inside stay buttons of their own
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${p.key}`}
      onClick={open}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }}
      style={{ '--i': Math.min(index, 10) } as CSSProperties}
      className="reveal group/tile flex min-h-[84px] w-full cursor-pointer flex-col gap-1.5 rounded-xl bg-background/70 p-3 outline-none ring-1 ring-inset ring-foreground/[0.07] transition-[background-color,box-shadow,transform] duration-(--dur-fast) hover:-translate-y-px hover:bg-card hover:shadow-sm hover:ring-foreground/[0.14] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <LfsProject className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-md-plus font-strong tracking-tight" title={p.key}>{p.name}</span>
      </span>
      <RunsOnChips runs={p.row ? p.row.runs : null} max={2} />
      <span className="mt-auto flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
        {activity !== null && <span className="truncate" title={when(activity)}>{`made ${ago(activity, now)}`}</span>}
      </span>
    </div>
  )
}

/** The last tile: a new project in this Store. */
function AddTile({ store: s, on }: { store: StoreRow; on: StoreActions }) {
  const can = canAddProject(s, on)
  return (
    <button
      type="button"
      onClick={on.addProject}
      disabled={!can}
      title={`Add a project to ${s.name}`}
      className="flex min-h-[84px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/15 text-sm text-muted-foreground outline-none transition-colors duration-(--dur-fast) hover:border-foreground/30 hover:bg-foreground/[0.02] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <FolderPlus className="size-4" />
      {'Add project'}
    </button>
  )
}

/** A sqlite Store's backups in one line, a menu of the backup moves. */
function BackupsMenu({ store: s, buckets, on }: { store: StoreRow; buckets: BucketRow[]; on: StoreActions }) {
  const busy = s.state === 'busy' || s.state === 'down'
  const latest = s.links.reduce<number | null>((n, l) => (l.last?.at != null && (n === null || l.last.at > n) ? l.last.at : n), null)
  const listed = (bucket: string, file: string) => buckets.find((b) => b.name === bucket)?.files?.find((f) => f.file === file && f.store === s.name)
  const words = !s.links.length
    ? 'No backup yet'
    : [fill(s.links.length === 1 ? '1 backup' : '{n} backups', { n: s.links.length }), latest !== null && ago(latest)].filter(Boolean).join(' · ')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="-mx-1.5 inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" title={`Backups of ${s.name}`}>
          <Archive aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate tabular-nums">{words}</span>
          <ChevronDown aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        {s.links.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">{`Backups of ${s.name}`}</DropdownMenuLabel>}
        {s.links.map((l) => {
          const file = listed(l.bucket, l.file)
          const chip = file ? (BACKUP[file.state] ?? BACKUP.unknown) : null
          return (
            <DropdownMenuItem key={l.bucket} disabled={busy} onSelect={() => (file?.state === 'bucket_changed' ? on.restore(l.bucket, l.file) : on.backupTo(l))}>
              {file?.state === 'bucket_changed' ? <HardDriveDownload /> : file?.state === 'store_changed' ? <RefreshCw /> : <Archive />}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-xs-plus">{l.bucket}/{l.file}</span>
                <span className="text-xs text-muted-foreground">
                  {file?.state === 'bucket_changed' ? 'Restore…' : file?.state === 'store_changed' ? 'Sync backup' : 'Back up now'}
                  {l.last?.at != null && ` · ${ago(l.last.at)}`}
                </span>
              </span>
              {chip && <Chip tone={chip.tone} dashed={chip.dashed} className="h-[18px] px-2 text-3xs">{chip.label}</Chip>}
            </DropdownMenuItem>
          )
        })}
        {s.links.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem disabled={busy} onSelect={on.backup}>
          <Archive /> {'Back up to…'}
        </DropdownMenuItem>
        {on.buckets && (
          <DropdownMenuItem onSelect={on.buckets}>
            <Settings2 /> {'Manage buckets…'}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What doctor finds on this Store: a quiet count, its first finding beside it. */
function Findings({ findings }: { findings: DoctorFinding[] }) {
  if (!findings.length) return null
  const error = findings.some((f) => f.severity === 'error')
  return (
    <span className={cn('ml-auto inline-flex min-w-0 items-center gap-1.5', error ? 'text-destructive' : 'text-amber-600')} title={findings.map((f) => `${f.message}${f.fix ? ` (fix: ${f.fix})` : ''}`).join('\n')}>
      <Stethoscope aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{findings.length === 1 ? findings[0].message : `${findings.length} doctor findings`}</span>
    </span>
  )
}
