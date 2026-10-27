// Animated expand and collapse: the height eases through a grid row from 0fr
// to 1fr (the `collapsible` class in styles.css), so content needs no measuring.
// Closed content is inert, then unmounted once the motion ends.
import { type ReactNode, useEffect, useState } from 'react'

import { prefersReducedMotion } from '@/components/motion/reduced-motion'
import { cn } from '@/lib/utils'

interface CollapseProps {
  open: boolean
  children: ReactNode
  /** Classes for the inner element, which holds the children. */
  className?: string
  /** Keep the children mounted while closed (keeps their state). */
  keepMounted?: boolean
  /** Animate the first open too, when mounted open. Default true. */
  appear?: boolean
  id?: string
}

/** Animates its children's height in and out as `open` changes. */
export function Collapse({ open, children, className, keepMounted, appear = true, id }: CollapseProps) {
  const [mounted, setMounted] = useState(open)
  const [first, setFirst] = useState(true)
  useEffect(() => {
    setFirst(false)
    if (open) return setMounted(true)
    const t = setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : 300)
    return () => clearTimeout(t)
  }, [open])
  if (!open && !mounted && !keepMounted) return null
  return (
    <div
      id={id}
      className="collapsible"
      data-open={open}
      inert={!open}
      style={first && !appear ? { transition: 'none' } : undefined}
    >
      <div className={cn(className)}>{children}</div>
    </div>
  )
}
