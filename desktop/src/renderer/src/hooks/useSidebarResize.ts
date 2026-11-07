import { useCallback, useEffect, useState } from 'react'

// Cindy's sidebar geometry: 260 default, 180 to 480, saved per machine.
const DEFAULT_WIDTH = 260
const MIN_WIDTH = 180
const MAX_WIDTH = 480
const KEY = 'sidebar-width'

const clamp = (n: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))

function load(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return n ? clamp(n) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

export function useSidebarResize() {
  const [width, setWidth] = useState(load)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width))
    } catch {
      // Width just won't persist.
    }
  }, [width])

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      setDragging(true)
      const move = (ev: PointerEvent) => setWidth(clamp(startWidth + ev.clientX - startX))
      const up = () => {
        setDragging(false)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [width],
  )

  return { width, dragging, startDrag }
}
