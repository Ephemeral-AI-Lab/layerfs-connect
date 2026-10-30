import { projectRef, type RunSummary } from '@shared/host-api'
import { ArrowUpRight, LoaderCircle, Plus } from 'lucide-react'
import { type CSSProperties, useEffect } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsBranch, LfsCommit } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion/count-up'
import { revealStyle } from '@/components/motion/reveal'
import { spotlight } from '@/components/motion/spotlight'
import { isLive, plural, runLabel } from '@/components/runs/run-format'
import { Chip } from '@/components/storage/chips'
import { StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { useTransfers } from '@/components/storage/transfers/use-transfers'
import { findStore, useStorageView } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { ago, bytes, shortId } from '@/data/format'
import { HostError, host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

/** What a card read about its project, for the home's totals. */
export interface CardFacts {
  commits: number
  bytes: number | null
}

/** A LayerFS project as its card shows it; a scenario's project has its title, blurb and agents. */
export interface CardProject {
  id: string
  title: string
  blurb: string | null
  /** The scenario's agents; null for a project no scenario names. */
  agents: number | null
  /** Its sessions. */
  runs: number
  /** The kind of Store that holds it (layerfs#506); a build before it has local SQLite only. */
  kind?: 'sqlite' | 'postgresql' | null
}

interface ProjectCardProps {
  demo: CardProject
  latest: RunSummary | null
  starting: boolean
  /** Its place in the grid's entrance. */
  index: number
  onOpen: () => void
  onNewSession: () => void
  onFacts?: (demo: string, facts: CardFacts) => void
}

/** At most this many Layers drawn in the Store well's stack. */
const STACK = 5

/** The project's Layers as a small stack of sheets, the newest lit and on top. */
function LayerStack({ layers }: { layers: number }) {
  const n = Math.min(layers, STACK)
  const top = 4
  const h = top + (n - 1) * 3 + 5
  return (
    <svg aria-hidden="true" viewBox={`0 0 22 ${h}`} width="22" height={h} className="home-layers shrink-0 overflow-visible">
      <title>{plural(layers, 'Layer')}</title>
      {/* bottom sheet first, so the newest is drawn last, on top */}
      {Array.from({ length: n }, (_, k) => {
        const y = top + (n - 1 - k) * 3
        return (
          <path
            key={k}
            d={`M11 ${y - 4} L21 ${y} L11 ${y + 4} L1 ${y} Z`}
            style={{ '--i': k } as CSSProperties}
            className={k === n - 1 ? 'home-sheet-top' : undefined}
          />
        )
      })}
    </svg>
  )
}

/** A demo's LayerFS project: its state now, its Store and last Commit, and its sessions. */
export function ProjectCard({ demo, latest, starting, index, onOpen, onNewSession, onFacts }: ProjectCardProps) {
  const live = latest ? isLive(latest.state) : false
  // reread as sessions start and end; a demo never played has no project yet (404)
  const state = useHostQuery(() => host.project(demo.id), [demo.id, latest?.id, latest?.state], `project:${demo.id}`)
  // the card's id is the project key: `store/name` in a shared Store (layerfs#506)
  const s = (state.data?.project.key ?? state.data?.project.name) === demo.id ? state.data : undefined
  const postgresql = demo.kind === 'postgresql'
  const missing = state.error instanceof HostError && state.error.status === 404

  const commits = s?.commits
  const stored = s?.store.bytes ?? null
  useEffect(() => {
    if (commits !== undefined) onFacts?.(demo.id, { commits, bytes: stored })
  }, [demo.id, commits, stored, onFacts])

  // the Store well (storage-links §3.6): one mark for where the Store syncs, the size and the sync pill, from the cached storage view
  const storage = useStorageView()
  const storeName = s?.project.store ?? projectRef(demo.id).store
  const info = findStore(storage.data, storeName)
  const family = info?.kind ?? (postgresql ? 'postgresql' : 'sqlite')
  const providers = info ? storeProviders(info, storage.data?.remotes.list) : (s?.project.storeProviders ?? [])
  const sync = info?.sync.state ?? s?.project.storeSync ?? null
  const job = useTransfers().runningFor(storeName ?? '')
  const shared = s?.project.shared ?? !!projectRef(demo.id).store
  const connection = info?.connection ?? s?.project.connection ?? null
  const size = info?.size?.bytes ?? stored
  const layers = s ? s.layers.length : 0
  const share = live && latest?.of ? latest.done / latest.of : 0

  const storeLabel = family === 'postgresql' ? (storeName ?? 'PostgreSQL') : shared && storeName ? storeName : 'SQLite'
  const where = family === 'postgresql' ? (connection ? `on ${connection}` : null) : info?.link ? `${info.link.remote} / ${info.link.file}` : info ? 'Local only' : null

  return (
    <article
      data-flip={demo.id}
      data-live={live || undefined}
      onPointerMove={spotlight}
      style={revealStyle(index)}
      className={cn(
        'home-card surface card-hover spotlight reveal flex flex-col gap-4 rounded-xl p-6 has-[[data-open]:focus-visible]:ring-2 has-[[data-open]:focus-visible]:ring-ring',
        live && 'live-border',
      )}
    >
      <div className="flex items-start gap-3.5">
        <span className="home-mark" data-live={live || undefined}>
          <LayerfsMark className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-open
            onClick={onOpen}
            className="flex max-w-full items-start gap-1 text-left text-[16px] leading-6 font-semibold tracking-[-0.01em] outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            <span className="break-words">{demo.title}</span>
            <ArrowUpRight aria-hidden="true" className="home-arrow mt-1 size-3.5 shrink-0 text-primary" />
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-faint">
            <span className="font-mono break-all">{demo.id}</span>
            {demo.agents !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>{plural(demo.agents, 'agent')}</span>
              </>
            )}
          </div>
        </div>
        {live && (
          <Chip tone="info" live className="shrink-0">
            {runLabel(latest!)} playing
          </Chip>
        )}
      </div>

      {demo.blurb && <p className="line-clamp-3 text-[13px] leading-5 text-pretty break-words text-muted-foreground">{demo.blurb}</p>}

      <section aria-label="Store" className="flex flex-col gap-3 rounded-lg bg-muted/55 p-4 ring-1 ring-foreground/[0.04] ring-inset dark:bg-muted/40">
        <div className="flex items-start gap-3">
          <StoreIcon family={family} providers={providers} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-5 font-medium break-words">{storeLabel}</p>
            {where && <p className="mt-0.5 font-mono text-[11.5px] break-all text-muted-foreground">{where}</p>}
          </div>
          {!job && sync && <SyncPill state={sync} compact className="shrink-0" />}
        </div>
        {job && <TransferRow job={job} form="compact" />}
        {s ? (
          <dl className="grid grid-cols-4 gap-2 border-t border-foreground/[0.06] pt-3">
            <Stat label="Size">
              <CountUp value={size} format={bytes} placeholder="unknown" />
            </Stat>
            <Stat label="Branches">{s.branches.length}</Stat>
            <Stat label="Commits">{s.commits}</Stat>
            <Stat label="Layer on main" aside={layers > 0 ? <LayerStack layers={layers} /> : null}>
              L{Math.max(0, layers - 1)}
            </Stat>
          </dl>
        ) : (
          <p className="border-t border-foreground/[0.06] pt-3 text-xs text-faint">
            {missing ? 'Not created yet. The first session Inits it from the fixture.' : state.error ? state.error.message : 'Reading the project…'}
          </p>
        )}
      </section>

      {s?.last && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2 text-[13px] leading-5">
            <LfsCommit className="mt-0.5 size-4 shrink-0" />
            <span className="line-clamp-2 min-w-0 flex-1 break-words" title={`${shortId(s.last.id)} · ${s.last.message || 'Commit'}`}>
              {s.last.message || 'Commit'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-xs text-faint tabular-nums">
            <span className="flex max-w-full items-center gap-1 rounded-full bg-background/60 py-0.5 pr-2 pl-1.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border ring-inset">
              <LfsBranch className="size-3 shrink-0" />
              <span className="break-all">{s.last.branch}</span>
            </span>
            <span>{ago(s.last.at)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{shortId(s.last.id)}</span>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3 border-t pt-4">
        {live && latest && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{latest.phase ?? 'Playing'}</span>
              <span>
                <span className="font-medium text-foreground">{latest.done}</span>/{latest.of} steps
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`${runLabel(latest)} progress`}
              aria-valuemin={0}
              aria-valuemax={latest.of}
              aria-valuenow={latest.done}
              className="home-progress"
            >
              <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, share))})` }} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="text-xs text-muted-foreground tabular-nums">
            {live && latest ? (
              <span>
                {plural(demo.runs, 'session')} · one playing since {ago(latest.started)}
              </span>
            ) : latest ? (
              <span>
                {plural(demo.runs, 'session')} · last {ago(latest.ended ?? latest.started)}
              </span>
            ) : (
              <span className="text-faint">No sessions yet</span>
            )}
          </div>
          <Button size="sm" variant="outline" className="home-new relative z-10" disabled={starting || live} onClick={onNewSession}>
            {starting ? <LoaderCircle className="animate-spin" /> : <Plus className="home-plus" />}
            {starting ? 'Starting…' : 'New session'}
          </Button>
        </div>
      </div>
    </article>
  )
}

/** One fact of the Store well: the value over its label. */
function Stat({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="flex items-center gap-1.5 text-[14px] leading-5 font-medium tabular-nums">
        {children}
        {aside}
      </dd>
    </div>
  )
}
