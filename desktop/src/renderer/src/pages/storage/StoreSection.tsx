// Store identity, a compact project carousel, and the existing Store controls.
import { fill } from '@/lib/text'
import { Archive, ChevronDown, ChevronLeft, ChevronRight, FolderPlus, GitBranch, HardDriveDownload, RefreshCw, Settings2, Stethoscope } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { LfsProject } from '@/components/layerfs/LfsIcons'
import type { ProjectRowData } from '@/layerfs/project-rows'
import { host, onProjectsChanged } from '@/layerfs/client'
import { lastAnswer, useHostQuery } from '@/layerfs/use-host'
import { BACKUP } from '@/pages/storage/BucketCard'
import { Chip } from '@/components/layerfs/Chips'
import { StoreIcon } from '@/components/layerfs/identity/StoreIcon'
import { JobPanel, OpPanel } from '@/pages/storage/JobProgress'
import { attentionOf, canAddProject, Location, type StoreActions, StoreMenu } from '@/pages/storage/StoreCard'
import { go } from '@/layerfs/go'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes } from '@/layerfs/format'
import { clearingCall } from '@/layerfs/states'
import { cn } from '@/lib/utils'
import type { BucketRow, DoctorFinding, ProjectState, StorageJob, StorageView, StoreRow } from '@/layerfs/host-api'

export interface StoreProject {
  key: string
  name: string
  row: ProjectRowData | undefined
}

interface StoreSectionProps {
  store: StoreRow
  index: number
  machine: StorageView['machines'][number] | undefined
  buckets: BucketRow[]
  job: StorageJob | undefined
  projects: StoreProject[]
  searching: boolean
  now: number
  findings: DoctorFinding[]
  board?: boolean
  /** Observed Sandbox placements, not a PostgreSQL connection registry. */
  usedByMachines?: string[] | null
  on?: StoreActions
  onOpenProject?: (key: string) => void
  onOpen?: (newTab: boolean) => void
}

export function StoreSection({ store: s, machine, buckets, job, projects, findings, board, usedByMachines, on, onOpenProject, onOpen }: StoreSectionProps) {
  const pg = s.kind === 'postgresql'
  const attention = job?.ended && job.error ? 'danger' : attentionOf(s, machine, buckets)
  return (
    <section data-focus={`store:${s.name}`} aria-label={s.name}
      className={cn('store-carousel-card', board && 'store-carousel-card--board', attention === 'warning' && 'ring-1 ring-amber-500/45', attention === 'danger' && 'ring-1 ring-destructive/45')}>
      <header className="store-carousel-heading">
        <StoreIcon family={s.kind} size="sm" />
        <h3 className="min-w-0 flex-1 truncate text-lg font-strong tracking-tight" title={s.name}>
          {onOpen ? <button type="button" className="store-name-link" onClick={e => onOpen(e.metaKey || e.ctrlKey)} onAuxClick={e => e.button === 1 && onOpen(true)} title={`Open ${s.name}`}>{s.name}</button> : s.name}
        </h3>
        <span className="text-xs text-muted-foreground">{pg ? 'PostgreSQL' : 'SQLite'}</span>
        {on && <StoreMenu store={s} on={on} />}
      </header>
      <div className="store-carousel-location">
        <div className="store-location-row">
          <div className="min-w-0"><Location store={s} machine={machine} showState={false} /></div>
          {!pg && <span className="store-location-size" title={s.size ? `${bytes(s.size.file)} file, ${bytes(s.size.wal)} WAL` : undefined}>{s.size ? bytes(s.size.bytes) : 'Size unavailable'}</span>}
        </div>
        {pg && <div className="store-shared-machines">
          <span>Shared across machines</span>
          {!!usedByMachines?.length && <span className="store-machine-links" title="Machines with recorded Sandboxes using this Store; not an active database connection list">
            Used by {usedByMachines.map(name => <button key={name} type="button" className="store-name-link" onClick={() => go.machine(name)}>{name}</button>)}
          </span>}
        </div>}
      </div>
      <ProjectCarousel projects={projects} store={s.name} onOpen={onOpenProject} />
      <footer className="store-carousel-footer">
        {job ? <JobPanel job={job} onRetry={on?.retry && (() => on.retry!(job))} onDetails={onOpen && (() => onOpen(false))} />
          : s.state === 'busy' && s.op ? <OpPanel store={s} />
          : <>
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              {on ? !pg && <BackupsMenu store={s} buckets={buckets} on={on} /> : <span>{s.projects.length} {s.projects.length === 1 ? 'project' : 'projects'}</span>}
            </div>
            {on && <Button size="xs" variant="ghost" onClick={on.addProject} disabled={!canAddProject(s, on)}><FolderPlus /> Add project</Button>}
          </>}
        {s.down ? <p className="store-carousel-notice text-destructive">{s.down}</p>
          : s.state === 'unresolved' ? <p className="store-carousel-notice text-destructive">{fill('see {status} · clear: {clear}', clearingCall('store', s.name, s.op))}</p> : null}
        <Findings findings={findings} />
      </footer>
    </section>
  )
}

function ProjectCarousel({ projects, store, onOpen }: { projects: StoreProject[]; store: string; onOpen?: (key: string) => void }) {
  const track = useRef<HTMLUListElement>(null)
  const id = useId()
  const [edges, setEdges] = useState({ before: false, after: false })
  const measure = useCallback(() => {
    const el = track.current
    if (el) setEdges({ before: el.scrollLeft > 2, after: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    const el = track.current
    if (!el) return
    el.scrollLeft = 0
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [projects.map(p => p.key).join('|'), measure])
  const move = (direction: number) => {
    const el = track.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  return <div className="store-project-carousel">
    <div className="store-project-carousel-label">
      <h4>Projects <span className="text-muted-foreground">· {projects.length}</span></h4>
      {(edges.before || edges.after) && <div className="flex gap-1">
        <Button size="icon-xs" variant="ghost" aria-label={`Previous projects in ${store}`} aria-controls={id} disabled={!edges.before} onClick={() => move(-1)}><ChevronLeft /></Button>
        <Button size="icon-xs" variant="ghost" aria-label={`Next projects in ${store}`} aria-controls={id} disabled={!edges.after} onClick={() => move(1)}><ChevronRight /></Button>
      </div>}
    </div>
    {projects.length ? <ul id={id} ref={track} aria-label={`Projects in ${store}`} className="store-project-track" onScroll={measure}>
      {projects.map(p => <li key={p.key}><ProjectTile project={p} onOpen={onOpen} /></li>)}
    </ul> : <div className="store-project-empty">No projects yet</div>}
  </div>
}

export function ProjectTile({ project: p, onOpen }: { project: StoreProject; onOpen?: (key: string) => void }) {
  const tile = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '160px' })
    if (tile.current) observer.observe(tile.current)
    return () => observer.disconnect()
  }, [])
  const branches = useHostQuery(async () => {
    if (!visible) return lastAnswer<{ count: number | null; storage: ProjectState['storage'] }>(`project-tile-summary:${p.key}`) ?? null
    const state = await host.project(p.key)
    return { count: state.storage === null && (state.project.storeDown || state.project.refusal) ? null : state.branches.length, storage: state.storage }
  }, [visible, p.key], `project-tile-summary:${p.key}`)
  useEffect(() => onProjectsChanged(() => { if (visible) branches.reload() }), [visible, branches.reload])
  const count = (n: number | null | undefined, singular: string, plural: string) => `${n ?? '—'} ${n === 1 ? singular : plural}`
  const machines = p.row?.project.kind === 'postgresql' ? p.row.runs?.map(r => r.machine) : null
  const storage = branches.data?.storage
  return <button ref={tile} type="button" className="store-project-tile" aria-label={`Open ${p.key}`} disabled={!onOpen} onClick={() => onOpen?.(p.key)}>
    <span className="store-project-heading">
      <span className="store-project-identity">
        <LfsProject aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <span className="truncate" title={p.name}>{p.name}</span>
      </span>
      <span className="store-project-footprint" title={storage?.partial ? 'Compressed content from recorded history only. Excludes Init, main layers, earlier history and Store overhead.' : storage ? 'Reported compressed project content; excludes Store overhead.' : 'LayerFS has not reported a project storage footprint.'}>
        {storage ? `${bytes(storage.stored)} ${storage.partial ? 'in saved history' : 'stored'}` : 'Storage · —'}
      </span>
    </span>
    <span className="store-project-branches" title={branches.error || branches.data?.count === null ? 'Branch count unavailable' : 'Includes main'}>
      <GitBranch aria-hidden="true" className="size-3.5 shrink-0" />
      {branches.data?.count != null ? `${branches.data.count} ${branches.data.count === 1 ? 'branch' : 'branches'}` : '— branches'}
    </span>
    <span className="store-project-counts">
      <span>{count(p.row?.sandboxCount, 'sandbox', 'sandboxes')}</span>
      <span>{count(p.row?.workspaceCount, 'workspace', 'workspaces')}</span>
    </span>
    {!!machines?.length && <span className="store-project-machines" title={`Sandbox machines: ${machines.join(', ')}`}>{machines.join(' · ')}</span>}
  </button>
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
