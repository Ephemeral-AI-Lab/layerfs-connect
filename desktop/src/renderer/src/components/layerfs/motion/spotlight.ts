// A light that follows the pointer across a card. Give the card the
// `spotlight` class (and `card-hover` to lift it) and onPointerMove={spotlight}.
// It writes two CSS variables; no React state, no renders.
import type { PointerEvent } from 'react'

export function spotlight(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}
