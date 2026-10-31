import { t as tr, useI18n } from '@/i18n'
import type { CommitStorage, StoreStats } from '@shared/host-api'
import { useEffect, useId, useRef, useState } from 'react'

import { bytes, shortId } from '@/data/format'
import { cn } from '@/lib/utils'

export const times = (n: number | null) => n === null ? '—' : `${n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(0) : n.toFixed(1)}×`

/** Storage values update directly, without rolling from zero on every visit. */
export function CountBytes({ value, className }: { value: number | null; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{bytes(value)}</span>
}

const useSvgId = () => `sv${useId().replace(/[^\w-]/g, '')}`

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

const TIP = 'pointer-events-none absolute bottom-full z-10 mb-2 rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-elev-3 backdrop-blur-md'

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
            <CountBytes value={last[s.key]} className="text-foreground" />
          </span>
        ))}
        <span className="ml-auto text-faint">{t.commits.length ? tr("Init → newest Commit") : tr("only Init so far")}</span>
      </div>
      <div ref={ref} className="relative" style={{ height: H }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <span className="pointer-events-none absolute top-0 left-0 text-[10px] text-faint">{bytes(top)}</span>
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
            <g>
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
                  <dd className="tabular-nums">{bytes(picked[s.key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}

/** Exact per-commit sizes remain readable without animated bars or a colour legend. */
export function CommitStorageTable({ commits }: { commits: CommitStorage[] }) {
  const { t } = useI18n()
  const [all, setAll] = useState(false)
  const ordered = commits.toReversed()
  const shown = all ? ordered : ordered.slice(0, 12)
  if (!commits.length) return <p className="py-3 text-xs text-muted-foreground">{t('No Commits yet.')}</p>
  return <div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs tabular-nums">
        <thead className="border-b text-muted-foreground">
          <tr><th className="min-w-44 pb-2 font-medium">{t('Commit')}</th><th className="px-3 pb-2 text-right font-medium">{t('added')}</th><th className="px-3 pb-2 text-right font-medium">{t('new unique')}</th><th className="pl-3 pb-2 text-right font-medium">{t('Snapshot')}</th></tr>
        </thead>
        <tbody>
          {shown.map((commit) => <tr key={commit.id} className="border-b border-border/60 last:border-0">
            <td className="max-w-64 py-2.5 pr-3">
              <p className="truncate font-medium" title={commit.message}>{commit.message || shortId(commit.id)}</p>
              <p className="mt-0.5 truncate text-muted-foreground" title={`${commit.id} · ${commit.branch} · ${commit.kind ?? ''}`}><span className="font-mono text-[11px]">{shortId(commit.id)}</span> · {commit.branch}</p>
            </td>
            <td className="whitespace-nowrap px-3 text-right">{bytes(commit.stored)}</td>
            <td className="whitespace-nowrap px-3 text-right">{bytes(commit.canonical)}</td>
            <td className="whitespace-nowrap pl-3 text-right">{bytes(commit.logical)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {commits.length > 12 && <button type="button" onClick={() => setAll(!all)} className="mt-3 rounded-lg px-2 py-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      {all ? t('Show fewer') : t('Show all {count} commits', { count: commits.length })}
    </button>}
  </div>
}
