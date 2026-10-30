import { t as tr, useI18n } from '@/i18n'
// The Storage tab's pictures: numbers that count up, the flow from raw
// history to the bytes on disk (each stage arriving in turn), the share of
// history saved, history against disk Commit by Commit, each Commit's added
// bytes and how they split by kind. Motion settles under prefers-reduced-motion.
import type { CommitStorage, StoreStats } from '@shared/host-api'
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'

import { prefersReducedMotion, useCountUp } from '@/components/motion'
import { bytes, shortId } from '@/data/format'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

/** "166×", "3.4×". */
export const times = (n: number | null) => (n === null ? '—' : `${n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(0) : n.toFixed(1)}×`)

/** A share of the raw history: "29%", or "20×" past it (a small Store's SQLite pages can outweigh its history). */
const pct = (n: number) => (n > 1.05 ? times(n) : n >= 0.995 ? '100%' : n >= 0.1 ? `${Math.round(n * 100)}%` : n >= 0.001 ? `${(n * 100).toFixed(1)}%` : '<0.1%')

/** A CSS delay for the classes in storage.css. */
const delay = (ms: number, style?: CSSProperties) => ({ ...style, '--d': `${ms}ms` }) as CSSProperties

/** False until `ms` has passed (at once under reduced motion), so a number can wait for its part of the picture. */
function useArrived(ms: number) {
  const [on, setOn] = useState(() => ms <= 0 || prefersReducedMotion())
  useEffect(() => {
    if (on) return
    const t = setTimeout(() => setOn(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on
}

/** An id safe inside an SVG `url(#…)`. */
const useSvgId = () => `sv${useId().replace(/[^\w-]/g, '')}`

/** Bytes that count up to their value, after `wait` ms. */
export function CountBytes({ value, wait = 0, className }: { value: number | null; wait?: number; className?: string }) {
  useI18n()
  const arrived = useArrived(wait)
  const v = useCountUp(value === null ? null : arrived ? value : 0)
  return <span className={cn('tabular-nums', className)}>{bytes(v === null ? null : Math.round(v))}</span>
}

/** The element's width in CSS pixels, so SVG draws at 1:1 and strokes and dashes keep their shape. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** A tooltip over a chart: a raised, frosted layer. */
const TIP = 'pointer-events-none absolute bottom-full z-10 mb-2 rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-elev-3 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150'

// ---------- saved ----------

/** A ring of how much of the raw history the disk did not need, drawn in brand light. */
export function SavedRing({ saved, wait = 0 }: { saved: number; wait?: number }) {
  useI18n()
  const id = useSvgId()
  const arrived = useArrived(wait)
  const shown = useCountUp(arrived ? saved * 100 : 0, { ms: 1100 })
  const R = 30
  return (
    <div className="relative size-[76px] shrink-0" role="img" aria-label={tr("{value1} of the raw history saved on disk", {value1: pct(saved)})}>
      <svg viewBox="0 0 76 76" className="size-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand-1)" />
            <stop offset="0.55" stopColor="var(--brand-2)" />
            <stop offset="1" stopColor="var(--brand-3)" />
          </linearGradient>
        </defs>
        <circle cx="38" cy="38" r={R} fill="none" stroke="var(--muted)" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          stroke={`url(#${id}-g)`}
          strokeWidth="7"
          strokeLinecap="round"
          pathLength={1}
          className="sc-ring"
          style={delay(wait, { strokeDashoffset: 1 - saved, filter: 'drop-shadow(0 0 5px var(--glow))' })}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[15px] font-semibold tabular-nums">{Math.round(shown ?? 0)}%</span>
        <span className="mt-0.5 text-[10px] text-faint">{tr("saved")}</span>
      </span>
    </div>
  )
}

// ---------- history to disk ----------

interface Stage {
  label: string
  sub: string
  value: number
  color: string
}

/** Each stage of the flow arrives this long after the one before it. */
const STEP_MS = 280
const FLOW_START = 150

/** A band's top and bottom edge from one stage to the next, as cubic curves. */
function band(x0: number, x1: number, y0: number, y1: number, h0: number, h1: number) {
  const m = (x0 + x1) / 2
  return `M${x0},${y0 - h0 / 2} C${m},${y0 - h0 / 2} ${m},${y1 - h1 / 2} ${x1},${y1 - h1 / 2} L${x1},${y1 + h1 / 2} C${m},${y1 + h1 / 2} ${m},${y0 + h0 / 2} ${x0},${y0 + h0 / 2} Z`
}
const curve = (x0: number, x1: number, y0: number, y1: number) => {
  const m = (x0 + x1) / 2
  return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1}`
}

/**
 * Raw history → unique → compressed → on disk, as one ribbon whose
 * thickness is each stage's bytes (linear, so a large dedupe really looks
 * large). The stages arrive left to right: a pillar grows, its number counts
 * up, the band to the next stage wipes in and the step between them is named.
 * Bytes keep flowing along the bands.
 */
export function DiskFlow({ t, onDisk }: { t: StoreStats; onDisk: number }) {
  useI18n()
  const [ref, width] = useWidth<HTMLDivElement>()
  const id = useSvgId()
  const stages: Stage[] = [
    { label: 'Every snapshot', sub: 'raw history', value: t.logical, color: 'var(--faint)' },
    { label: 'Unique', sub: 'after dedupe', value: t.canonical, color: 'var(--brand-1)' },
    { label: 'Compressed', sub: 'pack bytes', value: t.stored, color: 'var(--brand-2)' },
    { label: 'On disk', sub: 'the SQLite file', value: onDisk, color: 'var(--brand-3)' },
  ]
  const steps: [string, string][] = [
    [times(t.dedupe), 'dedupe'],
    [times(t.compression), 'compression'],
    [`+ ${bytes(t.metadata)}`, 'metadata'],
  ]
  const at = (i: number) => FLOW_START + i * STEP_MS
  const H = 132
  const max = Math.max(1, ...stages.map((s) => s.value))
  const thick = (v: number) => Math.max(4, (v / max) * (H - 12))
  const cx = (i: number) => ((i + 0.5) / stages.length) * width
  const mid = H / 2
  return (
    <div>
      <div className="grid grid-cols-4 text-center">
        {stages.map((s, i) => (
          <div key={s.label} className="sc-fade flex flex-col items-center px-1" style={delay(at(i))}>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: s.color, boxShadow: i ? `0 0 6px ${s.color}` : undefined }} />
              {tr(s.label)}
            </span>
            <CountBytes value={s.value} wait={at(i)} className="mt-1 text-xl font-semibold tracking-[-0.02em]" />
            <span className="text-[11px] text-faint tabular-nums">
              {tr(s.sub)}
              {i > 0 && t.logical > 0 && <> · {pct(s.value / t.logical)}</>}
            </span>
          </div>
        ))}
      </div>
      <div ref={ref} className="relative mt-3" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} className="absolute inset-0 overflow-visible" aria-hidden="true">
            <defs>
              {stages.slice(1).map((s, i) => (
                <linearGradient key={i} id={`${id}-band-${i}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor={stages[i].color} stopOpacity={i ? 0.42 : 0.26} />
                  <stop offset="1" stopColor={s.color} stopOpacity="0.42" />
                </linearGradient>
              ))}
            </defs>
            {/* a faint centre line, the axis the ribbon narrows around */}
            <line x1={cx(0)} x2={cx(stages.length - 1)} y1={mid} y2={mid} stroke="var(--border)" strokeDasharray="2 5" />
            {stages.slice(1).map((s, i) => {
              const [x0, x1] = [cx(i) + 4, cx(i + 1) - 4]
              const [h0, h1] = [thick(stages[i].value), thick(s.value)]
              return (
                <g key={i} className="sc-wipe" style={delay(at(i) + 120)}>
                  <path d={band(x0, x1, mid, mid, h0, h1)} fill={`url(#${id}-band-${i})`} />
                  {[-0.3, 0, 0.3].map((o, k) => (
                    <path
                      key={k}
                      d={curve(x0, x1, mid + o * h0, mid + o * h1)}
                      fill="none"
                      stroke={s.color}
                      strokeOpacity={0.65}
                      strokeWidth={1.5}
                      className="flow-along"
                      style={{ animationDuration: `${1.1 + k * 0.35}s`, display: Math.min(h0, h1) < 14 && o !== 0 ? 'none' : undefined }}
                    />
                  ))}
                </g>
              )
            })}
            {stages.map((s, i) => {
              const h = thick(s.value)
              return (
                <rect
                  key={s.label}
                  x={cx(i) - 4}
                  y={mid - h / 2}
                  width={8}
                  height={h}
                  rx={4}
                  fill={s.color}
                  className="sc-node"
                  style={delay(at(i), i ? { filter: `drop-shadow(0 0 6px ${s.color})` } : undefined)}
                />
              )
            })}
          </svg>
        )}
        {width > 0 &&
          steps.map(([n, what], i) => (
            <span
              key={what}
              className="sc-pop absolute top-1/2 flex items-baseline gap-1 rounded-full border bg-card/90 px-2.5 py-1 text-[11px] whitespace-nowrap shadow-elev-2 backdrop-blur-sm tabular-nums"
              style={delay(at(i) + 420, { left: (cx(i) + cx(i + 1)) / 2, transform: 'translate(-50%, -50%)' })}
            >
              <span className="font-semibold text-foreground">{n}</span>
              <span className="text-muted-foreground">{tr(what)}</span>
            </span>
          ))}
      </div>
    </div>
  )
}

// ---------- history against disk ----------

interface Point {
  raw: number
  packed: number
  commit: CommitStorage | null
}

/**
 * Cumulative raw history (every Commit as a full tree) against cumulative
 * compressed content, Commit by Commit, oldest left. Both start from what
 * Init and the Layers left, so each line ends at the Store's own total.
 */
export function GrowthChart({ t }: { t: StoreStats }) {
  useI18n()
  const [ref, width] = useWidth<HTMLDivElement>()
  const id = useSvgId()
  const [hover, setHover] = useState<number | null>(null)
  const points: Point[] = []
  let raw = Math.max(0, t.logical - t.commits.reduce((a, c) => a + c.logical, 0))
  let packed = Math.max(0, t.stored - t.commits.reduce((a, c) => a + c.stored, 0))
  points.push({ raw, packed, commit: null })
  for (const c of t.commits) {
    raw += c.logical
    packed += c.stored
    points.push({ raw, packed, commit: c })
  }
  const H = 156
  const pad = { top: 12, bottom: 4, right: 6 }
  const top = Math.max(1, ...points.map((p) => Math.max(p.raw, p.packed)))
  const x = (i: number) => (points.length < 2 ? 0 : (i / (points.length - 1)) * (width - pad.right))
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom)
  const line = (key: 'raw' | 'packed') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const area = (key: 'raw' | 'packed') => `${line(key)} L${x(points.length - 1)},${H - pad.bottom} L0,${H - pad.bottom} Z`
  const picked = hover === null ? null : points[hover]
  const series = [
    { key: 'raw' as const, label: 'raw history', color: 'var(--faint)', fill: 0.22 },
    { key: 'packed' as const, label: 'compressed content', color: 'var(--brand-2)', fill: 0.34 },
  ]
  const last = points[points.length - 1]

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = Math.round(((e.clientX - r.left) / Math.max(1, width - pad.right)) * (points.length - 1))
    setHover(Math.min(points.length - 1, Math.max(0, k)))
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            {tr(s.label)}
            <CountBytes value={last[s.key]} className="font-mono text-foreground" />
          </span>
        ))}
        <span className="ml-auto text-faint">{t.commits.length ? tr("Init → newest Commit") : tr("only Init so far")}</span>
      </div>
      <div ref={ref} className="relative" style={{ height: H }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <span className="pointer-events-none absolute top-0 left-0 font-mono text-[10px] text-faint">{bytes(top)}</span>
        {width > 0 && (
          <svg width={width} height={H} className="absolute inset-0 overflow-visible" role="img" aria-label={tr("Raw history and compressed content over the Commits")}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity={s.fill} />
                  <stop offset="1" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {[0.5, 1].map((f) => (
              <line key={f} x1={0} x2={width} y1={y(top * f)} y2={y(top * f)} stroke="var(--border)" strokeDasharray="2 4" />
            ))}
            <line x1={0} x2={width} y1={H - pad.bottom} y2={H - pad.bottom} stroke="var(--border)" />
            <g className="reveal-x">
              {series.map((s) => (
                <path key={s.key} d={area(s.key)} fill={`url(#${id}-${s.key})`} />
              ))}
            </g>
            {series.map((s) => (
              <path
                key={s.key}
                d={line(s.key)}
                pathLength={1}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="draw-line"
                style={s.key === 'packed' ? { filter: 'drop-shadow(0 0 4px var(--glow))' } : undefined}
              />
            ))}
            {series.map((s) => (
              <circle
                key={s.key}
                cx={x(points.length - 1)}
                cy={y(last[s.key])}
                r={3.5}
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={2}
                className="sc-node"
                style={delay(1000)}
              />
            ))}
            {picked && (
              <g>
                <line x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={H - pad.bottom} stroke="var(--foreground)" strokeOpacity={0.2} strokeDasharray="3 3" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover!)} cy={y(picked[s.key])} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {picked && (
          <div className={cn(TIP, 'w-64')} style={{ left: Math.min(Math.max(0, x(hover!) - 128), Math.max(0, width - 256)) }}>
            <p className="truncate font-medium">{picked.commit ? picked.commit.message || shortId(picked.commit.id) : tr("Init and the Layers")}</p>
            {picked.commit && <p className="truncate font-mono text-[11px] text-faint">{picked.commit.branch}</p>}
            <dl className="mt-1.5 grid grid-cols-2 gap-2">
              {series.map((s) => (
                <div key={s.key}>
                  <dt className="flex items-center gap-1 text-faint">
                    <span className="h-0.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {tr(s.label)}
                  </dt>
                  <dd className="font-mono tabular-nums">{bytes(picked[s.key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- each Commit ----------

/** Commits drawn in the per-Commit chart, the newest. */
const NEWEST = 60

/** How a Commit was made, as the charts colour and name it. */
const KINDS: { kind: string; label: string; color: string }[] = [
  { kind: 'fs', label: 'fs write', color: 'var(--commit-fs)' },
  { kind: 'exec', label: 'Workspace commit', color: 'var(--commit-exec)' },
  { kind: 'merge', label: 'merge', color: 'var(--commit-merge)' },
]
const kindOf = (kind: string | null) => KINDS.find((k) => k.kind === kind) ?? { kind: kind ?? '', label: kind ?? 'Commit', color: 'var(--faint)' }

/** The newest Commits' added bytes, oldest left, coloured by how each was made. Bars grow in; a new Commit's bar grows as it lands. */
export function CommitBars({ commits }: { commits: CommitStorage[] }) {
  useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const first = useRef(true)
  useEffect(() => {
    first.current = false
  }, [])
  const shown = commits.slice(-NEWEST)
  const max = Math.max(1, ...shown.map((c) => c.stored))
  const picked = hover === null ? null : shown[hover]
  return (
    <div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div
          role="img"
          aria-label={tr("Bytes each of the newest {value1} Commits added", {value1: shown.length})}
          className="flex h-[156px] items-end gap-[3px] border-b border-border bg-[linear-gradient(to_top,var(--border)_1px,transparent_1px)] bg-[size:100%_50%]"
        >
          {shown.map((c, i) => {
            const color = kindOf(c.kind).color
            return (
              <div key={c.id} onMouseEnter={() => setHover(i)} className="flex h-full max-w-6 min-w-0 flex-1 items-end">
                <div
                  className={cn(
                    'grow-up w-full rounded-t-[4px] transition-[opacity,filter] duration-150',
                    hover !== null && hover !== i && 'opacity-30',
                    hover === i && 'brightness-110',
                  )}
                  style={{
                    height: `max(2px, ${((c.stored / max) * 100).toFixed(2)}%)`,
                    background: `linear-gradient(to top, color-mix(in oklab, ${color} 55%, transparent), ${color})`,
                    boxShadow: hover === i ? `0 0 12px -2px ${color}` : undefined,
                    animationDelay: first.current ? `${300 + Math.min(i, 40) * 16}ms` : '0ms',
                  }}
                />
              </div>
            )
          })}
        </div>
        {picked && (
          <div
            className={cn(TIP, 'w-80')}
            style={{ left: `clamp(0px, calc(${((hover! + 0.5) / Math.max(shown.length, 1)) * 100}% - 10rem), calc(100% - 20rem))` }}
          >
            <div className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: kindOf(picked.kind).color }} />
              <span className="font-medium whitespace-nowrap">{tr(kindOf(picked.kind).label)}</span>
              <span className="font-mono text-faint">{shortId(picked.id)}</span>
              <span className="ml-auto min-w-0 truncate font-mono text-muted-foreground">{picked.branch}</span>
            </div>
            {picked.message && <p className="mt-1 line-clamp-2 text-muted-foreground">{picked.message}</p>}
            <dl className="mt-1.5 grid grid-cols-3 gap-2 tabular-nums">
              <div>
                <dt className="text-faint">{tr("added")}</dt>
                <dd className="font-mono">{bytes(picked.stored)}</dd>
              </div>
              <div>
                <dt className="text-faint">{tr("new unique")}</dt>
                <dd className="font-mono">{bytes(picked.canonical)}</dd>
              </div>
              <div>
                <dt className="text-faint">{tr("tree")}</dt>
                <dd className="font-mono">{bytes(picked.logical)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-faint">{shown.length < commits.length ? tr("Newest {value1}, ", {value1: shown.length}) : ''}{tr("oldest left · hover a bar for its Commit")}</p>
    </div>
  )
}

/**
 * Every Commit's added bytes split by how it was made (fs write, Workspace
 * commit, merge): one bar whose parts fill in turn, and a legend with each
 * kind's Commits and bytes.
 */
export function CommitKinds({ commits }: { commits: CommitStorage[] }) {
  useI18n()
  const total = commits.reduce((a, c) => a + c.stored, 0)
  const kinds = [...KINDS, ...[...new Set(commits.map((c) => c.kind ?? ''))].filter((k) => !KINDS.some((x) => x.kind === k)).map((k) => kindOf(k || null))]
    .map((k) => {
      const mine = commits.filter((c) => (c.kind ?? '') === k.kind)
      return { ...k, count: mine.length, stored: mine.reduce((a, c) => a + c.stored, 0) }
    })
    .filter((k) => k.count > 0)
  if (kinds.length === 0) return null
  return (
    <div className="mt-4">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-muted" role="img" aria-label={tr("Added bytes by kind of Commit")}>
        {kinds.map((k, i) => (
          <span
            key={k.kind}
            className="sc-fill-x h-full transition-[flex-grow] duration-(--dur-slow) ease-out-expo first:rounded-l-full last:rounded-r-full"
            style={delay(500 + i * 160, {
              flex: `${total > 0 ? k.stored / total : k.count / commits.length} 1 0`,
              minWidth: 4,
              background: k.color,
              boxShadow: `0 0 8px -1px ${k.color}`,
            })}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-col gap-1.5 text-xs">
        {kinds.map((k, i) => (
          <li key={k.kind} className="sc-fade flex min-w-0 items-baseline gap-1.5" style={delay(600 + i * 160)}>
            <span className="size-2 shrink-0 translate-y-px rounded-[2px]" style={{ background: k.color }} />
            <span className="truncate text-muted-foreground">{tr(k.label)}</span>
            <span className="ml-auto font-mono tabular-nums">{bytes(k.stored)}</span>
            <span className="w-[4.5rem] shrink-0 text-right text-faint tabular-nums">
              {k.count} {tr(k.count === 1 ? "Commit" : "Commits")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A Commit that just landed: its added bytes rise and fade beside the headline. */
export function useLanded(commits: CommitStorage[]): CommitStorage | null {
  const newest = commits[commits.length - 1] ?? null
  const seen = useRef(newest?.id ?? null)
  const [landed, setLanded] = useState<CommitStorage | null>(null)
  useEffect(() => {
    if (!newest || newest.id === seen.current) return
    seen.current = newest.id
    setLanded(newest)
    const t = setTimeout(() => setLanded(null), 2600)
    return () => clearTimeout(t)
  }, [newest])
  return landed
}
