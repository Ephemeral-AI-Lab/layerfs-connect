import { useEffect, useRef, useState } from 'react'
import { chatHost, type ChatMessage, type ChildRun } from '@/layerfs/agent-api'
import { onHostEvent } from '@/layerfs/client'
import { chatRefresh } from './chat-refresh'
import { shareChildMessages } from './chat-sharing'

export function useChild(chatId: string, childId: string, visible = true, scripted = false) {
  const [data, setData] = useState<{ child: ChildRun; messages: ChatMessage[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<typeof data>(null)
  useEffect(() => { latest.current = null; setData(null); setError(null) }, [chatId, childId])
  useEffect(() => {
    if (!visible) return
    let live = true
    const refresh = chatRefresh(async () => {
      try {
        const next = await chatHost.child(chatId, childId)
        if (live) { const shared = { ...next, messages: scripted ? shareChildMessages(latest.current?.messages, next.messages) : next.messages }; latest.current = shared; setData(shared); setError(null) }
      } catch (cause) { if (live) setError((cause as Error).message) }
    }, 1500)
    const off = onHostEvent(event => {
      if ((event.type === 'chat' || event.type === 'chat-summary') && event.session.id === chatId) refresh.request()
    }, () => refresh.request(true))
    refresh.request(true)
    return () => { live = false; refresh.dispose(); off() }
  }, [chatId, childId, visible, scripted])
  return { data, error }
}
