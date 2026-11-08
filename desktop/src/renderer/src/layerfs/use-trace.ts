// A chat's Trace for its tab: the newest page, read again (at most once a
// second) while the chat changes, and older pages added by Load earlier.
import { useCallback, useEffect, useRef, useState } from 'react'
import { onHostEvent } from '@/layerfs/client'
import { TRACE_PAGE, traceHost, type TracePage, type TraceRecord } from '@/layerfs/trace-api'

export function useTrace(id: string, childId?: string) {
  const [page, setPage] = useState<TracePage | null>(null)
  const [older, setOlder] = useState<TraceRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const last = useRef(0)

  useEffect(() => {
    setPage(null)
    setOlder([])
    setError(null)
    let live = true
    const load = () => {
      timer.current = null
      last.current = Date.now()
      void traceHost.page(id, null, TRACE_PAGE, childId).then(
        (next) => live && (setPage(next), setError(null)),
        (cause: Error) => live && setError(cause.message),
      )
    }
    // a busy chat sends many events: one read a second is enough
    const soon = () => {
      if (timer.current) return
      timer.current = setTimeout(load, Math.max(0, 1000 - (Date.now() - last.current)))
    }
    const off = onHostEvent((event) => {
      if (event.type === 'chat' && event.session.id === id) soon()
    }, load)
    load()
    return () => {
      live = false
      off()
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [id, childId])

  const from = page ? page.from - older.length : 0
  const loadEarlier = useCallback(async () => {
    if (!page || from <= 0) return
    setLoadingOlder(true)
    try {
      const prev = await traceHost.page(id, from, TRACE_PAGE, childId)
      setOlder((rows) => [...prev.records, ...rows])
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoadingOlder(false)
    }
  }, [id, page, from, childId])

  const records = page ? [...older, ...page.records] : []
  return { page, records, earlier: from, loadEarlier, loadingOlder, error }
}
