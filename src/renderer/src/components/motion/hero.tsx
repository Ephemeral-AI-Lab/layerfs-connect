// Hero header parts: the page's mark in a lit tile, and small stat pills for
// its facts. Classes (hero-tile, stat-pill) are in styles.css.
import type { ComponentType, CSSProperties, ReactNode } from 'react'

import { revealStyle } from '@/components/motion/reveal'
import { cn } from '@/lib/utils'

interface HeroTileProps {
  icon: ComponentType<{ className?: string }>
  /** Something is playing: the tile's edge turns with brand light and its glow breathes. */
  live?: boolean
  className?: string
}

/** A page's mark on a lit layer, a soft brand glow behind it. */
export function HeroTile({ icon: Icon, live, className }: HeroTileProps) {
  return (
    <span className={cn('hero-tile', className)} data-live={live || undefined}>
      <span aria-hidden="true" className="hero-tile-glow" />
      <span className={cn('hero-tile-face', live && 'live-border')}>
        <Icon aria-hidden="true" className="size-6" />
      </span>
    </span>
  )
}

interface StatProps {
  icon?: ComponentType<{ className?: string }>
  /** What it counts: "Branches", "Store". Faint, after the value. */
  label?: ReactNode
  /** The value: a <CountUp>, a time. */
  children: ReactNode
  title?: string
  /** Its place in the entrance stagger. */
  index?: number
  /** Brand tint and a soft glow, for a fact that is changing right now. */
  live?: boolean
  className?: string
}

/** One fact as a small pill: icon, value, label. */
export function Stat({ icon: Icon, label, children, title, index = 0, live, className }: StatProps) {
  return (
    <span title={title} data-live={live || undefined} className={cn('stat-pill reveal', className)} style={revealStyle(index)}>
      {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      <span className="font-medium text-foreground tabular-nums">{children}</span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  )
}

/** A stat pill's placeholder while its value is read. */
export function StatSkeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cn('shimmer inline-block h-7 w-24 rounded-full', className)} style={style} />
}
