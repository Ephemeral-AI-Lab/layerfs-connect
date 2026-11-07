// The reader's motion setting. CSS already settles every animation under
// prefers-reduced-motion (styles.css); JS-driven motion asks here first.
import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** True when the system asks for less motion. Safe to call anywhere. */
export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** The same, kept current as the setting changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
