// A hero header's mark: the page's icon in a lit tile. Classes (hero-tile) are in styles.css.
import type { ComponentType } from 'react'

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
