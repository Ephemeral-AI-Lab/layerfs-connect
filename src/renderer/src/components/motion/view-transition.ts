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
  // The update runs once: from the transition, or from a timer when the page
  // gets no frame to capture (an occluded or throttled window), so a click never waits on a frame.
  let done = false
  const run = () => {
    if (done) return
    done = true
    flushSync(update)
  }
  const late = setTimeout(run, LATE_MS)
  let t: ViewTransition
  try {
    t = document.startViewTransition({ update: run, types: [kind] })
  } catch {
    // Chromium before typed transitions takes only the callback.
    t = document.startViewTransition(run)
  }
  void t.updateCallbackDone.finally(() => clearTimeout(late)).catch(() => {})
  // a skipped transition (a newer one, a hidden page) is fine: the update still ran
  t.ready.catch(() => {})
  t.finished.catch(() => {})
}

/** How long an update may wait for the transition's first frame before it runs anyway. */
const LATE_MS = 120
