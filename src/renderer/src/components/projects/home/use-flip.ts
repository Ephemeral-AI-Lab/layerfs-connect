// FLIP for a grid that filters: snapshot() where the children are before the
// change, play() after it commits; each child that stays glides from where it
// was. Children are matched by `data-flip`. Transform only, no React state.
import { useCallback, useRef } from 'react'

import { prefersReducedMotion } from '@/components/motion/reduced-motion'

export function useFlip<T extends HTMLElement = HTMLDivElement>(ms = 400) {
  const container = useRef<T>(null)
  const before = useRef<Map<string, DOMRect> | null>(null)

  const items = () => [...(container.current?.querySelectorAll<HTMLElement>(':scope > [data-flip]') ?? [])]

  const snapshot = useCallback(() => {
    if (prefersReducedMotion()) return
    before.current = new Map(items().map((el) => [el.dataset.flip!, el.getBoundingClientRect()]))
  }, [])

  const play = useCallback(() => {
    const was = before.current
    before.current = null
    if (!was) return
    for (const el of items()) {
      const from = was.get(el.dataset.flip!)
      if (!from) continue
      const to = el.getBoundingClientRect()
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: ms,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      })
    }
  }, [ms])

  return { container, snapshot, play }
}
