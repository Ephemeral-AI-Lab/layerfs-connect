// Cross-links between pages (#537 §7): a Store badge opens its Storage row, a
// Store's machine or a Sandbox's opens its Machines row, a Sandbox or Store row
// opens its project. App registers the handler; a component deep in a page
// calls `go.*` without threading callbacks. A page's row is reached through
// the tab's `location.focus` (`store:<name>`, `machine:<name>`), which the
// page scrolls to and marks once.
import { useEffect } from 'react'

export type GoPlace = { page: 'storage' | 'machines'; focus?: string } | { project: string; tab?: string }
type Handler = (place: GoPlace) => void

let handler: Handler | null = null

/** App's handler; answers the call that removes it. */
export function setGo(h: Handler): () => void {
  handler = h
  return () => {
    if (handler === h) handler = null
  }
}

// a nonce, so asking for the same row twice marks it twice
let n = 0
const focus = (kind: string, name: string) => `${kind}:${name}#${++n}`

export const go = {
  /** A board: Storage's or Machines'. */
  page: (page: 'storage' | 'machines') => handler?.({ page }),
  /** Store `name`'s page on Storage. */
  store: (name: string) => handler?.({ page: 'storage', focus: focus('store', name) }),
  /** Machine `name`'s page on Machines. */
  machine: (name: string) => handler?.({ page: 'machines', focus: focus('machine', name) }),
  /** A project's page, at one of its tabs (`sandboxes`, `storage`, …). */
  project: (key: string, tab?: string) => handler?.({ project: key, tab }),
  get ready() {
    return handler !== null
  },
}

/** `store:app#3` → { kind: 'store', name: 'app' }. */
export function focusOf(focus: string | undefined): { kind: string; name: string } | null {
  const m = focus ? /^([a-z]+):(.+?)(?:#\d+)?$/.exec(focus) : null
  return m ? { kind: m[1], name: m[2] } : null
}

/** Scrolls to the element with `data-focus="<kind>:<name>"` once `ready`, and rings it. */
export function useFocusRow(focus: string | undefined, ready: boolean, then?: (name: string) => void) {
  useEffect(() => {
    const f = focusOf(focus)
    if (!f || !ready) return
    then?.(f.name)
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(`${f.kind}:${f.name}`)}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('live-flash')
      void el.offsetWidth
      el.classList.add('live-flash')
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready])
}
