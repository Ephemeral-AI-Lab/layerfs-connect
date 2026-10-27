// Page and tab switches through the View Transitions API. styles.css names the
// parts: <main> is `page` (cross-fades and rises), a tab's body is `panel`
// (add the `vt-panel` class). Falls back to a plain update where the API is
// missing, the page is hidden or the reader asks for less motion.
import { flushSync } from 'react-dom'

import { prefersReducedMotion } from '@/components/motion/reduced-motion'

/** 'page': the whole canvas moves. 'tab': only the `panel` moves; the page header stays still. */
export type TransitionKind = 'page' | 'tab'

/** Runs `update` (a React state change) inside a view transition. */
export function viewTransition(update: () => void, kind: TransitionKind = 'page') {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion() || document.visibilityState === 'hidden') {
    update()
    return
  }
  const run = () => flushSync(update)
  try {
    document.startViewTransition({ update: run, types: [kind] })
  } catch {
    // Chromium before typed transitions takes only the callback.
    document.startViewTransition(run)
  }
}
