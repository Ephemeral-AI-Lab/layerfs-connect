import { t, useI18n } from '@/i18n'
// Small measures shared by Storage and Compute: a bar that fills, and a
// free-space gauge with its low mark.
// Fills run on transform only; the global reduced-motion rule settles them.
import type { CSSProperties } from 'react'

import { CountBytes } from '@/components/projects/store-visuals'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

/** Free space under this is low: Init and Commits start to fail near a full disk. */
export const LOW_DISK = 20e9
/** A gauge reads full from here up. */
const GAUGE_TOP = 100e9

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
  brand: 'sc-bar-brand',
  success: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]',
  warning: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.4)]',
  danger: 'bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.4)]',
}

/** A thin track whose fill grows from the left when it first shows and eases when it changes. */
export function Bar({ share, tone = 'brand', wait = 0, className, live }: BarProps) {
  useI18n()
  const s = Math.min(1, Math.max(0, share))
  return (
    <span className={cn('relative block h-1.5 overflow-hidden rounded-full bg-muted/90 ring-1 ring-foreground/[0.06] ring-inset', className)}>
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
export function DiskGauge({
  label,
  free,
  unknown = 'Unknown',
  index = 0,
}: {
  label: string
  free: number | null
  unknown?: string
  index?: number
}) {
  useI18n()
  const low = free !== null && free < LOW_DISK
  const percent = free !== null ? Math.min(100, Math.round((free / GAUGE_TOP) * 100)) : 0
  return (
    <div className="reveal min-w-0 flex flex-col justify-between" style={{ '--i': index } as CSSProperties}>
      <div>
        <dt className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-foreground/90">{label}</span>
          {free !== null && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-tight ring-1 ring-inset',
                low ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25',
              )}
            >
              {low ? t("Low Space") : t("Healthy")}
            </span>
          )}
        </dt>
        <dd className="mt-2">
          <div className="flex items-baseline gap-2">
            <span className={cn('text-2xl font-bold tracking-tight tabular-nums', low ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
              {free === null ? (
                <span className="text-base font-medium text-muted-foreground">{unknown}</span>
              ) : (
                <CountBytes value={free} />
              )}
            </span>
            {free !== null && <span className="text-xs text-muted-foreground font-medium">{t("available")}</span>}
          </div>
          <div className="relative mt-3">
            <Bar share={free === null ? 0 : free / GAUGE_TOP} tone={low ? 'warning' : 'brand'} wait={200 + index * 120} className="h-2" />
            {/* the 20 GB low threshold line */}
            <span
              aria-hidden="true"
              title={t("20 GB low threshold")}
              className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground/35 shadow-xs"
              style={{ left: `${(LOW_DISK / GAUGE_TOP) * 100}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground/80 tabular-nums">
            <span>{t("0 GB")}</span>
            <span className="text-[10.5px] font-medium text-muted-foreground">
              {free !== null ? t("{value1}% of 100 GB cap", {value1: percent}) : t("Offline")}
            </span>
            <span>{t("100 GB+")}</span>
          </div>
        </dd>
      </div>
    </div>
  )
}
