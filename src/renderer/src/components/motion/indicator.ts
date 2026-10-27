// A sliding indicator: one absolutely placed element that follows whichever
// child is active, gliding when the active child changes and snapping when the
// layout merely moves (a resize, a folder opening above it). It writes styles
// straight to the element, so following it costs no React renders.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { prefersReducedMotion } from '@/components/motion/reduced-motion'

export interface IndicatorOptions {
  /** Which child is active. Default: `[data-active="true"]`. */
  selector?: string
  /** 'x' follows left and width only (an underline); 'both' also top and height (a pill). */
  axis?: 'x' | 'both'
}

/**
 * Where `el` sits in `c`, by layout offsets: transforms (an entrance still
 * rising) do not count, and the indicator scrolls with the content.
 */
function offsetWithin(el: HTMLElement, c: HTMLElement) {
  let x = 0
  let y = 0
  let n: HTMLElement | null = el
  while (n && n !== c) {
    x += n.offsetLeft
    y += n.offsetTop
    n = n.offsetParent as HTMLElement | null
    // offsets start inside a parent's border
    if (n && n !== c) {
      x += n.clientLeft
      y += n.clientTop
    }
  }
  if (n === c) return { x, y }
  // `c` is not positioned: fall back to the boxes on screen.
  const cr = c.getBoundingClientRect()
  const er = el.getBoundingClientRect()
  return { x: er.left - cr.left + c.scrollLeft, y: er.top - cr.top + c.scrollTop }
}

/** How long a glide keeps its transition while layout keeps moving under it. */
const GLIDE_MS = 320

/**
 * Returns refs for the container (a positioned element: `relative`) and the indicator
 * (give it the `indicator` class). Re-measures on every render of the owner,
 * and whenever the container or the active child resizes.
 */
export function useIndicator<C extends HTMLElement = HTMLElement, I extends HTMLElement = HTMLSpanElement>({
  selector = '[data-active="true"]',
  axis = 'both',
}: IndicatorOptions = {}) {
  const container = useRef<C>(null)
  const indicator = useRef<I>(null)
  const last = useRef<Element | null>(null)
  const glideUntil = useRef(0)
  const observed = useRef<ResizeObserver | null>(null)

  const place = useCallback(() => {
    const c = container.current
    const i = indicator.current
    if (!c || !i) return
    const el = c.querySelector<HTMLElement>(selector)
    // an active child in a closed <Collapse> (inert) is out of sight: no ghost highlight over the rows below
    if (!el || el.closest('[inert]')) {
      i.removeAttribute('data-placed')
      last.current = null
      return
    }
    const now = performance.now()
    if (last.current && last.current !== el && !prefersReducedMotion()) glideUntil.current = now + GLIDE_MS
    if (last.current !== el) {
      observed.current?.disconnect()
      observed.current?.observe(c)
      observed.current?.observe(el)
    }
    last.current = el
    if (now < glideUntil.current) i.setAttribute('data-glide', '')
    else i.removeAttribute('data-glide')
    const { x, y } = offsetWithin(el, c)
    i.style.width = `${el.offsetWidth}px`
    if (axis === 'both') {
      i.style.height = `${el.offsetHeight}px`
      i.style.transform = `translate(${x}px, ${y}px)`
    } else i.style.transform = `translateX(${x}px)`
    i.setAttribute('data-placed', '')
  }, [selector, axis])

  // every render: the active child may have changed
  useLayoutEffect(place)

  useEffect(() => {
    const ro = new ResizeObserver(() => place())
    observed.current = ro
    if (container.current) ro.observe(container.current)
    if (last.current) ro.observe(last.current)
    void document.fonts?.ready.then(place)
    return () => {
      ro.disconnect()
      observed.current = null
    }
  }, [place])

  return { container, indicator, place }
}
