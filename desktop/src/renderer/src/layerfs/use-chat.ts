// Only the selected main Chat view refreshes a growing simulation transcript.
// Other tabs keep lightweight header/child metadata, preserving their local UI.
import { useCallback, useEffect, useRef, useState } from 'react'
import { chatHost, type ChatDetail, type ChatSummary, type ChildRun } from '@/layerfs/agent-api'
import { onHostEvent } from '@/layerfs/client'
import { upsertChat } from '@/layerfs/use-chats'
import { chatRefresh } from './chat-refresh'
import { mergeChatDetail } from './chat-sharing'

export function useChat(id: string, transcriptVisible = true) {
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<ChatDetail | null>(null)
  const selectedId = useRef(id); selectedId.current = id
  const fullVersion = useRef({ id: '', updated: 0 })
  const metadata = useRef<{ session: ChatSummary; children?: ChildRun[] } | null>(null)
  const take = useCallback((next: ChatDetail) => {
    if (next.id !== selectedId.current || (fullVersion.current.id === id && next.updated < fullVersion.current.updated)) return
    fullVersion.current = { id, updated: next.updated }
    const shared = mergeChatDetail(latest.current, next, metadata.current)
    latest.current = shared
    setChat(shared); setError(null)
    upsertChat(shared)
  }, [id])
  useEffect(() => { latest.current = null; metadata.current = null; fullVersion.current = { id, updated: 0 }; setChat(null); setError(null) }, [id])
  useEffect(() => {
    let live = true
    const refresh = chatRefresh(async () => {
      try { const detail = await chatHost.detail(id); if (live) take(detail) }
      catch (cause) { if (live) setError((cause as Error).message) }
    }, 1500)
    const off = onHostEvent(event => {
      if ((event.type !== 'chat' && event.type !== 'chat-summary') || event.session.id !== id) return
      if (event.type === 'chat-summary' && (!metadata.current || event.session.updated >= metadata.current.session.updated)) metadata.current = { session: event.session, children: event.children }
      if (event.type === 'chat' && transcriptVisible) take(event.session as ChatDetail)
      else {
        const previous = latest.current
        if (previous?.id === id && event.session.updated >= previous.updated) {
          const next = { ...previous, ...event.session, messages: previous.messages, children: event.type === 'chat-summary' ? event.children ?? previous.children : (event.session as ChatDetail).children }
          latest.current = next; setChat(next)
        }
        if (transcriptVisible) refresh.request()
      }
    }, () => refresh.request(true))
    if (transcriptVisible || latest.current?.id !== id) refresh.request(true)
    return () => { live = false; refresh.dispose(); off() }
  }, [id, take, transcriptVisible])
  return { chat, error, take }
}
