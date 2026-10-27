import type { DemoSummary, RunSummary } from '@shared/host-api'
import { ArrowUpRight, LoaderCircle, Plus } from 'lucide-react'
import { type CSSProperties, useEffect } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsBranch, LfsCommit, LfsStore } from '@/components/lfs-icons'
import { CountUp } from '@/components/motion/count-up'
import { revealStyle } from '@/components/motion/reveal'
import { spotlight } from '@/components/motion/spotlight'
import { isLive, plural, runLabel } from '@/components/runs/run-format'
import { Chip } from '@/components/storage/chips'
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

interface ProjectCardProps {
  demo: DemoSummary
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
  const state = useHostQuery(() => host.project(demo.id), [demo.id, latest?.id, latest?.state])
  const s = state.data?.project.name === demo.id ? state.data : undefined
  const missing = state.error instanceof HostError && state.error.status === 404

  const commits = s?.commits
  const stored = s?.store.bytes ?? null
  useEffect(() => {
    if (commits !== undefined) onFacts?.(demo.id, { commits, bytes: stored })
  }, [demo.id, commits, stored, onFacts])

  const layers = s ? s.layers.length : 0
  const share = live && latest?.of ? latest.done / latest.of : 0

  return (
    <article
      data-flip={demo.id}
      data-live={live || undefined}
      onPointerMove={spotlight}
      style={revealStyle(index)}
      className={cn(
        'home-card surface card-hover spotlight reveal flex flex-col gap-3.5 rounded-xl p-5 has-[[data-open]:focus-visible]:ring-2 has-[[data-open]:focus-visible]:ring-ring',
        live && 'live-border',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="home-mark" data-live={live || undefined}>
          <LayerfsMark className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-open
            onClick={onOpen}
            className="flex max-w-full items-center gap-1 text-left text-[15px] leading-5 font-semibold tracking-[-0.01em] outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            <span className="truncate">{demo.title}</span>
            <ArrowUpRight aria-hidden="true" className="home-arrow size-3.5 shrink-0 text-primary" />
          </button>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-faint">
            <span className="truncate font-mono">{demo.id}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{plural(demo.agents.length, 'agent')}</span>
          </div>
        </div>
        {live && (
          <Chip tone="info" live className="shrink-0">
            {runLabel(latest!)} playing
          </Chip>
        )}
      </div>

      {demo.blurb && <p className="line-clamp-2 text-[13px] leading-5 text-pretty text-muted-foreground">{demo.blurb}</p>}

      <div className="flex items-center gap-3 rounded-lg bg-muted/55 px-3 py-2.5 ring-1 ring-foreground/[0.04] ring-inset dark:bg-muted/40">
        <LfsStore className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">
            Local SQLite{' '}
            <span className="font-normal text-muted-foreground">
              ·{' '}
              {s ? (
                <CountUp value={stored} format={bytes} placeholder="size unknown" />
              ) : missing ? (
                'not created yet'
              ) : (
                <span className="inline-block h-2.5 w-10 animate-pulse rounded-full bg-foreground/10 align-middle" />
              )}
            </span>
          </div>
          <div className="truncate text-xs text-faint tabular-nums">
            {s
              ? `main L${Math.max(0, layers - 1)} · ${s.branches.length} Branch${s.branches.length === 1 ? '' : 'es'} · ${plural(s.commits, 'Commit')}`
              : missing
                ? 'The first session Inits it from the fixture'
                : state.error
                  ? state.error.message
                  : 'Reading the project'}
          </div>
        </div>
        {s && layers > 0 && <LayerStack layers={layers} />}
      </div>

      {s?.last && (
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <LfsCommit className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={`${shortId(s.last.id)} · ${s.last.message || 'Commit'}`}>
            {s.last.message || 'Commit'}
          </span>
          <span className="shrink-0 text-faint tabular-nums">{ago(s.last.at)}</span>
          <span className="flex max-w-32 shrink-0 items-center gap-1 rounded-full bg-background/60 py-0.5 pr-2 pl-1.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border ring-inset">
            <LfsBranch className="size-3 shrink-0" />
            <span className="truncate">{s.last.branch}</span>
          </span>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2.5 border-t pt-3">
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
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground tabular-nums">
            {live && latest ? (
              <span className="block truncate">
                {plural(demo.runs, 'session')} · one playing since {ago(latest.started)}
              </span>
            ) : latest ? (
              <span className="block truncate">
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
