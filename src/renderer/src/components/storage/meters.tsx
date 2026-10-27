// Small measures shared by Storage and Compute: a stat tile whose number
// counts up, a bar that fills, and a free-space gauge with its low mark.
// Fills run on transform only; the global reduced-motion rule settles them.
import type { CSSProperties, ReactNode } from 'react'

import { CountUp } from '@/components/motion'
import { CountBytes } from '@/components/projects/store-visuals'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

/** Free space under this is low: Init and Commits start to fail near a full disk. */
export const LOW_DISK = 20e9
/** A gauge reads full from here up. */
const GAUGE_TOP = 100e9

interface StatProps {
  label: string
  /** A number to count up to; or pass children. */
  value?: number | null
  /** Draw `value` as bytes. */
  bytes?: boolean
  hint?: ReactNode
  tone?: 'brand' | 'warning'
  index?: number
  className?: string
  children?: ReactNode
}

/** A labelled number on a lit tile. */
export function Stat({ label, value, bytes: asBytes, hint, tone, index = 0, className, children }: StatProps) {
  return (
    <div className={cn('surface reveal min-w-0 rounded-xl px-4 py-3', className)} style={{ '--i': index } as CSSProperties}>
      <dt className="truncate text-xs text-faint">{label}</dt>
      <dd
        className={cn(
          'mt-1 truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums',
          tone === 'brand' && 'text-brand',
          tone === 'warning' && 'text-warning',
        )}
      >
        {children ?? (asBytes ? <CountBytes value={value ?? null} /> : <CountUp value={value ?? null} />)}
      </dd>
      {hint && <p className="mt-0.5 truncate text-[11px] text-faint">{hint}</p>}
    </div>
  )
}

interface BarProps {
  /** 0 to 1. */
  share: number
  tone?: 'brand' | 'success' | 'warning' | 'danger'
  /** Delay before it fills, in ms. */
  wait?: number
  className?: string
  /** Glow and shimmer, for a live measure. */
  live?: boolean
}

const FILL = {
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
}

/** A thin track whose fill grows from the left when it first shows and eases when it changes. */
export function Bar({ share, tone = 'brand', wait = 0, className, live }: BarProps) {
  const s = Math.min(1, Math.max(0, share))
  return (
    <span className={cn('relative block h-1.5 overflow-hidden rounded-full bg-muted ring-1 ring-foreground/[0.04] ring-inset', className)}>
      <span
        className={cn('sc-fill-x absolute inset-y-0 left-0 w-full rounded-full transition-transform duration-(--dur-slow) ease-out-expo', FILL[tone])}
        style={{ '--d': `${wait}ms`, transform: `scaleX(${s})`, boxShadow: live ? '0 0 10px 0 var(--glow)' : undefined } as CSSProperties}
      />
    </span>
  )
}

/**
 * Free space as a gauge: full from 100 GB up, with a mark at the 20 GB low
 * line. `null` reads as unknown, with `unknown` as its words.
 */
export function DiskGauge({ label, free, unknown = 'Unknown', index = 0 }: { label: string; free: number | null; unknown?: string; index?: number }) {
  const low = free !== null && free < LOW_DISK
  return (
    <div className="reveal min-w-0" style={{ '--i': index } as CSSProperties}>
      <dt className="flex items-baseline justify-between gap-2 text-xs text-faint">
        <span className="truncate">{label}</span>
        {low && <span className="shrink-0 font-medium text-warning">Low</span>}
      </dt>
      <dd className="mt-1">
        <span className={cn('block text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums', low && 'text-warning')}>
          {free === null ? <span className="text-base font-medium text-muted-foreground">{unknown}</span> : <CountBytes value={free} />}
        </span>
        <span className="relative mt-2 block">
          <Bar share={free === null ? 0 : free / GAUGE_TOP} tone={low ? 'warning' : 'brand'} wait={200 + index * 120} className="h-2" />
          {/* the low line */}
          <span aria-hidden="true" className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground/35" style={{ left: `${(LOW_DISK / GAUGE_TOP) * 100}%` }} />
        </span>
        <span aria-hidden="true" className="relative mt-1 block h-3.5 text-[10px] text-faint tabular-nums">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(LOW_DISK / GAUGE_TOP) * 100}%` }}>
            20 GB low
          </span>
          <span className="absolute right-0">100 GB+</span>
        </span>
      </dd>
    </div>
  )
}
