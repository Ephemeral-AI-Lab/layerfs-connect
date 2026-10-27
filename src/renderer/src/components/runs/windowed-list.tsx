// A long list that renders only the items near the viewport. Every item keeps
// a placeholder of its last measured height (or an estimate), so the scroll
// height stays right; an IntersectionObserver on the scroller swaps items in
// and out. No dependency, and the scroller keeps native scrolling.
import { ArrowDown } from 'lucide-react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

class Watcher {
  private readonly listeners = new Map<Element, (near: boolean) => void>()
  private readonly io: IntersectionObserver
  readonly heights = new Map<string, number>()
  constructor(root: Element | null, margin: number) {
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) this.listeners.get(e.target)?.(e.isIntersecting)
      },
      { root, rootMargin: `${margin}px 0px` },
    )
  }
  watch(el: Element, listener: (near: boolean) => void) {
    this.listeners.set(el, listener)
    this.io.observe(el)
    return () => {
      this.listeners.delete(el)
      this.io.unobserve(el)
    }
  }
  close() {
    this.io.disconnect()
  }
}

// undefined: no WindowedScroller around; null: its watcher is not ready yet.
const WatcherContext = createContext<Watcher | null | undefined>(undefined)

// Outside a WindowedScroller, items window against the viewport.
let viewportWatcher: Watcher | null = null
const viewport = () => (viewportWatcher ??= new Watcher(null, 1200))

/** One list item: its content near the viewport, a sized placeholder elsewhere. */
export function Windowed({ id, estimate, children }: { id: string; estimate: number; children: React.ReactNode }) {
  const context = useContext(WatcherContext)
  const watcher = context === undefined ? viewport() : context
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!watcher || !el) return
    return watcher.watch(el, setNear)
  }, [watcher])

  // Remember the rendered height, so the placeholder matches it later.
  useLayoutEffect(() => {
    const el = ref.current
    if (!near || !el || !watcher) return
    const save = () => el.offsetHeight > 0 && watcher.heights.set(id, el.offsetHeight)
    save()
    const ro = new ResizeObserver(save)
    ro.observe(el)
    return () => ro.disconnect()
  }, [near, watcher, id])

  const height = watcher?.heights.get(id) ?? estimate
  return (
    <div ref={ref} data-item={id} style={near ? undefined : { height }}>
      {near ? children : null}
    </div>
  )
}

interface ScrollerProps {
  /** Follow the end while true, unless the reader scrolled up. */
  follow: boolean
  /** Changes when the list changes, so a followed list jumps to its end. */
  version: unknown
  /** Start at the end rather than the top. */
  startAtEnd: boolean
  className?: string
  children: React.ReactNode
}

/** The scroll container for Windowed items: windowing, and follow-the-end autoscroll. */
export function WindowedScroller({ follow, version, startAtEnd, className, children }: ScrollerProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [watcher, setWatcher] = useState<Watcher | null>(null)
  const pinned = useRef(startAtEnd)
  const [away, setAway] = useState(false)
  const followRef = useRef(follow)
  followRef.current = follow

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const w = new Watcher(el, 1200)
    setWatcher(w)
    return () => w.close()
  }, [])

  const toEnd = () => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 96
      pinned.current = atEnd
      setAway(!atEnd)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Content grows as items arrive and render: keep the end in view while pinned.
  useEffect(() => {
    const el = content.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (pinned.current && (followRef.current || startAtEnd)) toEnd()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [startAtEnd])

  useLayoutEffect(() => {
    if (pinned.current && (follow || startAtEnd)) toEnd()
  }, [version, follow, startAtEnd])

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} className={className} style={{ overflowAnchor: 'auto' }}>
        <div ref={content}>
          <WatcherContext.Provider value={watcher}>{children}</WatcherContext.Provider>
        </div>
      </div>
      {follow && away && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            pinned.current = true
            setAway(false)
            toEnd()
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-card shadow-md"
        >
          <ArrowDown /> Follow the latest step
        </Button>
      )}
    </div>
  )
}
