// The Storage tab's pictures: numbers that count up, the flow from raw
// history to the bytes on disk, history against disk Commit by Commit, and
// each Commit's added bytes. Motion stops under prefers-reduced-motion.
import type { CommitStorage, StoreStats } from '@shared/host-api'
import { useEffect, useRef, useState } from 'react'

import { bytes, shortId } from '@/data/format'
import { cn } from '@/lib/utils'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** "166×", "3.4×". */
export const times = (n: number | null) => (n === null ? '—' : `${n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(0) : n.toFixed(1)}×`)

/** `value`, eased from where it last was over `ms`. */
function useCountUp(value: number | null, ms = 900): number | null {
  const [shown, setShown] = useState<number | null>(value === null ? null : reducedMotion() ? value : 0)
  const at = useRef(shown ?? 0)
  useEffect(() => {
    if (value === null) return setShown(null)
    if (reducedMotion()) {
      at.current = value
      return setShown(value)
    }
    const from = at.current
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      at.current = from + (value - from) * (1 - (1 - k) ** 3)
      setShown(at.current)
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, ms])
  return shown
}

/** Bytes that count up to their value. */
export function CountBytes({ value, className }: { value: number | null; className?: string }) {
  const v = useCountUp(value)
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

// ---------- history to disk ----------

interface Stage {
  label: string
  sub: string
  value: number
  color: string
}

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
 * large), with the step between stages named on it and bytes flowing along.
 */
export function DiskFlow({ t, onDisk }: { t: StoreStats; onDisk: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const stages: Stage[] = [
    { label: 'Every snapshot', sub: 'raw history', value: t.logical, color: 'var(--faint)' },
    { label: 'Unique', sub: 'after dedupe', value: t.canonical, color: 'var(--primary)' },
    { label: 'Compressed', sub: 'pack bytes', value: t.stored, color: 'var(--primary)' },
    { label: 'On disk', sub: 'the SQLite file', value: onDisk, color: 'var(--success)' },
  ]
  const steps = [`${times(t.dedupe)} dedupe`, `${times(t.compression)} compression`, `+ ${bytes(t.metadata)} metadata`]
  const H = 120
  const max = Math.max(1, ...stages.map((s) => s.value))
  const thick = (v: number) => Math.max(4, (v / max) * (H - 8))
  const cx = (i: number) => ((i + 0.5) / stages.length) * width
  const mid = H / 2
  return (
    <div>
      <div className="grid grid-cols-4 text-center">
        {stages.map((s, i) => (
          <div
            key={s.label}
            className="flex flex-col items-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both"
            style={{ animationDelay: `${i * 140}ms`, animationDuration: '500ms' }}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <CountBytes value={s.value} className="mt-0.5 text-[17px] font-semibold tracking-[-0.01em]" />
            <span className="text-[11px] text-faint">{s.sub}</span>
          </div>
        ))}
      </div>
      <div ref={ref} className="relative mt-2" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} className="reveal-x absolute inset-0" aria-hidden="true">
            <defs>
              {stages.slice(1).map((s, i) => (
                <linearGradient key={i} id={`flow-band-${i}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stopColor={stages[i].color} stopOpacity="0.28" />
                  <stop offset="1" stopColor={s.color} stopOpacity="0.28" />
                </linearGradient>
              ))}
            </defs>
            {stages.slice(1).map((s, i) => {
              const [x0, x1] = [cx(i) + 3, cx(i + 1) - 3]
              const [h0, h1] = [thick(stages[i].value), thick(s.value)]
              return (
                <g key={i}>
                  <path d={band(x0, x1, mid, mid, h0, h1)} fill={`url(#flow-band-${i})`} />
                  {[-0.28, 0, 0.28].map((o, k) => (
                    <path
                      key={k}
                      d={curve(x0, x1, mid + o * h0, mid + o * h1)}
                      fill="none"
                      stroke={s.color}
                      strokeOpacity={0.55}
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
              return <rect key={s.label} x={cx(i) - 3} y={mid - h / 2} width={6} height={h} rx={3} fill={s.color} />
            })}
          </svg>
        )}
        {width > 0 &&
          steps.map((step, i) => (
            <span
              key={step}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-card/95 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground shadow-xs backdrop-blur-sm tabular-nums motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in motion-safe:fill-mode-both"
              style={{ left: (cx(i) + cx(i + 1)) / 2, animationDelay: `${500 + i * 160}ms`, animationDuration: '400ms' }}
            >
              {step}
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
  const [ref, width] = useWidth<HTMLDivElement>()
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
  const H = 150
  const pad = { top: 10, bottom: 4, right: 4 }
  const top = Math.max(1, ...points.map((p) => Math.max(p.raw, p.packed)))
  const x = (i: number) => (points.length < 2 ? 0 : (i / (points.length - 1)) * (width - pad.right))
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom)
  const line = (key: 'raw' | 'packed') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const area = (key: 'raw' | 'packed') => `${line(key)} L${x(points.length - 1)},${H - pad.bottom} L0,${H - pad.bottom} Z`
  const picked = hover === null ? null : points[hover]
  const series = [
    { key: 'raw' as const, label: 'raw history', color: 'var(--faint)', fill: 0.14 },
    { key: 'packed' as const, label: 'compressed content', color: 'var(--primary)', fill: 0.2 },
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
            {s.label}
            <span className="font-mono text-foreground tabular-nums">{bytes(last[s.key])}</span>
          </span>
        ))}
        <span className="ml-auto text-faint">{t.commits.length ? 'Init → newest Commit' : 'only Init so far'}</span>
      </div>
      <div ref={ref} className="relative" style={{ height: H }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <span className="pointer-events-none absolute top-0 left-0 font-mono text-[10px] text-faint">{bytes(top)}</span>
        {width > 0 && (
          <svg width={width} height={H} className="absolute inset-0 overflow-visible" role="img" aria-label="Raw history and compressed content over the Commits">
            {[0.5, 1].map((f) => (
              <line key={f} x1={0} x2={width} y1={y(top * f)} y2={y(top * f)} stroke="var(--border)" strokeDasharray="2 4" />
            ))}
            <line x1={0} x2={width} y1={H - pad.bottom} y2={H - pad.bottom} stroke="var(--border)" />
            <g className="reveal-x">
              {series.map((s) => (
                <path key={s.key} d={area(s.key)} fill={s.color} fillOpacity={s.fill} />
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
              />
            ))}
            {series.map((s) => (
              <circle key={s.key} cx={x(points.length - 1)} cy={y(last[s.key])} r={3.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
            ))}
            {picked && (
              <g>
                <line x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={H - pad.bottom} stroke="var(--foreground)" strokeOpacity={0.25} />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover!)} cy={y(picked[s.key])} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {picked && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 w-64 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: Math.min(Math.max(0, x(hover!) - 128), Math.max(0, width - 256)) }}
          >
            <p className="truncate font-medium">{picked.commit ? picked.commit.message || shortId(picked.commit.id) : 'Init and the Layers'}</p>
            {picked.commit && <p className="truncate font-mono text-[11px] text-faint">{picked.commit.branch}</p>}
            <dl className="mt-1.5 grid grid-cols-2 gap-2">
              {series.map((s) => (
                <div key={s.key}>
                  <dt className="flex items-center gap-1 text-faint">
                    <span className="h-0.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
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

/** How a Commit was made, as the chart colours and names it. */
const KINDS: { kind: string; label: string; color: string }[] = [
  { kind: 'fs', label: 'fs write', color: 'var(--commit-fs)' },
  { kind: 'exec', label: 'Workspace commit', color: 'var(--commit-exec)' },
  { kind: 'merge', label: 'merge', color: 'var(--commit-merge)' },
]
const kindOf = (kind: string | null) => KINDS.find((k) => k.kind === kind) ?? { kind: kind ?? '', label: kind ?? 'Commit', color: 'var(--faint)' }

/** The newest Commits' added bytes, oldest left, coloured by how each was made. Bars grow in; a new Commit's bar grows as it lands. */
export function CommitBars({ commits }: { commits: CommitStorage[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const first = useRef(true)
  useEffect(() => {
    first.current = false
  }, [])
  const shown = commits.slice(-NEWEST)
  const max = Math.max(1, ...shown.map((c) => c.stored))
  const kinds = KINDS.filter((k) => shown.some((c) => c.kind === k.kind))
  const picked = hover === null ? null : shown[hover]
  return (
    <div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div role="img" aria-label={`Bytes each of the newest ${shown.length} Commits added`} className="flex h-[150px] items-end gap-[2px] border-b border-border">
          {shown.map((c, i) => (
            <div key={c.id} onMouseEnter={() => setHover(i)} className="flex h-full max-w-4 min-w-0 flex-1 items-end">
              <div
                className={cn('grow-up w-full rounded-t-[3px] transition-opacity duration-150', hover !== null && hover !== i && 'opacity-35')}
                style={{
                  height: `max(2px, ${((c.stored / max) * 100).toFixed(2)}%)`,
                  background: kindOf(c.kind).color,
                  animationDelay: first.current ? `${300 + i * 18}ms` : '0ms',
                }}
              />
            </div>
          ))}
        </div>
        {picked && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 w-80 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: `clamp(0px, calc(${((hover! + 0.5) / Math.max(shown.length, 1)) * 100}% - 10rem), calc(100% - 20rem))` }}
          >
            <div className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: kindOf(picked.kind).color }} />
              <span className="font-medium whitespace-nowrap">{kindOf(picked.kind).label}</span>
              <span className="font-mono text-faint">{shortId(picked.id)}</span>
              <span className="ml-auto min-w-0 truncate font-mono text-muted-foreground">{picked.branch}</span>
            </div>
            {picked.message && <p className="mt-1 line-clamp-2 text-muted-foreground">{picked.message}</p>}
            <dl className="mt-1.5 grid grid-cols-3 gap-2 tabular-nums">
              <div>
                <dt className="text-faint">added</dt>
                <dd className="font-mono">{bytes(picked.stored)}</dd>
              </div>
              <div>
                <dt className="text-faint">new unique</dt>
                <dd className="font-mono">{bytes(picked.canonical)}</dd>
              </div>
              <div>
                <dt className="text-faint">tree</dt>
                <dd className="font-mono">{bytes(picked.logical)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {kinds.map((k) => (
          <span key={k.kind} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: k.color }} />
            {k.label}
          </span>
        ))}
        <span className="text-faint">· {shown.length < commits.length ? `newest ${shown.length}, ` : ''}oldest left</span>
      </p>
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
