// Staggered entrances. Three ways in, from least to most code:
//   className="stagger" on a list: every child rises in turn (by sibling index);
//   className="reveal" style={revealStyle(i)} on any element;
//   <Reveal index={i}>…</Reveal>.
// The stagger caps at 10 steps (~400 ms), so long lists never crawl. An element
// animates when it mounts, so keyed rows entering a live list rise on their own.
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** The `--i` that staggers a `.reveal` element (0 for the first). */
export const revealStyle = (i: number, style?: CSSProperties) => ({ ...style, '--i': i }) as CSSProperties

interface RevealProps {
  /** Its place in the stagger. */
  index?: number
  /** Scale from .98 instead of rising. */
  scale?: boolean
  as?: 'div' | 'li' | 'section' | 'span' | 'article'
  className?: string
  style?: CSSProperties
  children: ReactNode
}

export function Reveal({ index = 0, scale, as: Tag = 'div', className, style, children }: RevealProps) {
  return (
    <Tag className={cn(scale ? 'reveal-scale' : 'reveal', className)} style={revealStyle(index, style)}>
      {children}
    </Tag>
  )
}
