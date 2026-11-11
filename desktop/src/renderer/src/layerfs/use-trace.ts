// A selected Trace/History pane refreshes at most once every 1.5 seconds.
// Hidden mounted tabs retain their pages without querying or rebuilding them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onHostEvent } from '@/layerfs/client'
import { TRACE_PAGE, traceHost, type TracePage, type TraceRecord } from '@/layerfs/trace-api'
import { chatRefresh } from './chat-refresh'

export function useTrace(id: string, childId?: string, visible = true) {
  const [page, setPage] = useState<TracePage | null>(null)
  const [older, setOlder] = useState<TraceRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const identity = useRef(0), readingOlder = useRef(false)
  useEffect(() => {
    identity.current++; readingOlder.current = false
    setPage(null); setOlder([]); setError(null); setLoadingOlder(false)
  }, [id, childId])
  useEffect(() => {
    if (!visible) return
    let live = true
    const refresh = chatRefresh(async () => {
      try { const next = await traceHost.page(id, null, TRACE_PAGE, childId); if (live) { setPage(next); setError(null) } }
      catch (cause) { if (live) setError((cause as Error).message) }
    }, 1500)
    const off = onHostEvent(event => {
      if ((event.type === 'chat' || event.type === 'chat-summary') && event.session.id === id) refresh.request()
    }, () => refresh.request(true))
    refresh.request(true)
    return () => { live = false; refresh.dispose(); off() }
  }, [id, childId, visible])
  const from = page ? page.from - older.length : 0
  const loadEarlier = useCallback(async () => {
    if (!visible || !page || from <= 0 || readingOlder.current) return
    const requestIdentity = identity.current
    readingOlder.current = true; setLoadingOlder(true)
    try { const prev = await traceHost.page(id, from, TRACE_PAGE, childId); if (identity.current === requestIdentity) setOlder(rows => [...prev.records, ...rows]) }
    catch (cause) { if (identity.current === requestIdentity) setError((cause as Error).message) }
    finally { if (identity.current === requestIdentity) { readingOlder.current = false; setLoadingOlder(false) } }
  }, [id, page, from, childId, visible])
  const records = useMemo(() => page ? [...older, ...page.records] : [], [page, older])
  return { page, records, earlier: from, loadEarlier, loadingOlder, error }
}
