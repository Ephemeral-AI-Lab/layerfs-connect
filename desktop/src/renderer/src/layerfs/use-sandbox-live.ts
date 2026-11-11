import { useEffect, useRef, useState } from 'react'
import { chatHost, type ChatDetail, type ChatSummary } from './agent-api'
import { call, onHostEvent } from './client'
import type { ConversationLive, SandboxLive } from './sandbox-live'

/** A compact, single-flight feed, read only while this sandbox pane is visible. */
export function useSandboxLive(project: string, chat?: ChatDetail, enabled = true) {
  const [feeds, setFeeds] = useState<ConversationLive[]>([])
  const [error, setError] = useState<string | null>(null)
  const current = useRef(chat); current.current = chat
  useEffect(() => {
    if (!enabled) return
    let disposed = false, timer: ReturnType<typeof setTimeout>, records: ChatSummary[] = [], dirty = true
    const off = onHostEvent(event => {
      if ((event.type === 'chat' || event.type === 'chat-summary') && event.session.project === project) dirty = true
    })
    const read = async () => {
      if (disposed) return
      if (document.hidden) { timer = setTimeout(read, 1000); return }
      let active = false
      try {
        const detail = current.current
        if (detail) records = [detail]
        else if (dirty) records = (await chatHost.list()).filter(row => row.project === project)
        dirty = false
        const next = await Promise.all(records.map(async row => ({ chat: row, ...(detail ? { detail } : {}), value: await call<SandboxLive>('GET', `/api/agent/sessions/${encodeURIComponent(row.id)}/live`) })))
        active = next.some(feed => feed.chat.state === 'running' || feed.value.live.running.length > 0)
        if (!disposed) { setFeeds(next); setError(null) }
      } catch (cause) { if (!disposed) setError((cause as Error).message) }
      if (!disposed) timer = setTimeout(read, active ? 250 : 1500)
    }
    setFeeds([]); setError(null); void read()
    return () => { disposed = true; clearTimeout(timer); off() }
  }, [project, chat?.id, enabled])
  return { feeds, error }
}

/** Render elapsed activity cheaply; SVG motion itself runs independently of React. */
export function useSandboxClock(enabled: boolean) {
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now() / 1000)
    const timer = setInterval(() => { if (!document.hidden) setNow(Date.now() / 1000) }, 100)
    return () => clearInterval(timer)
  }, [enabled])
  return Math.max(now, Date.now() / 1000)
}
