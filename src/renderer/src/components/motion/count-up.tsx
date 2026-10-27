// Numbers that count up when they first show and ease to each new value.
// One rAF loop per number while it moves, none at rest; none under reduced motion.
import { useEffect, useRef, useState } from 'react'

import { prefersReducedMotion } from '@/components/motion/reduced-motion'
import { cn } from '@/lib/utils'

interface CountUpOptions {
  /** Duration of each move. Default 800 ms (--dur-xslow). */
  ms?: number
  /** Where the first count starts. Default 0. */
  from?: number
}

/** `value`, eased (out-cubic) from where it last was; null stays null. */
export function useCountUp(value: number | null, { ms = 800, from = 0 }: CountUpOptions = {}): number | null {
  const [shown, setShown] = useState<number | null>(value === null ? null : prefersReducedMotion() ? value : from)
  const at = useRef(shown ?? from)
  useEffect(() => {
    if (value === null) return setShown(null)
    if (prefersReducedMotion() || at.current === value) {
      at.current = value
      return setShown(value)
    }
    const start = at.current
    const t0 = performance.now()
    let frame = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      at.current = start + (value - start) * (1 - (1 - k) ** 3)
      setShown(at.current)
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, ms])
  return shown
}

interface CountUpProps extends CountUpOptions {
  value: number | null
  /** How to print it. Default: a rounded, grouped integer. */
  format?: (n: number) => string
  /** Shown while the value is null. */
  placeholder?: string
  className?: string
}

const grouped = (n: number) => Math.round(n).toLocaleString()

/** A number that counts up, in tabular figures. */
export function CountUp({ value, format = grouped, placeholder = '—', className, ...options }: CountUpProps) {
  const v = useCountUp(value, options)
  return <span className={cn('tabular-nums', className)}>{v === null ? placeholder : format(v)}</span>
}
