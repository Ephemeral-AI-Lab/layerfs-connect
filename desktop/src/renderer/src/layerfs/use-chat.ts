// One chat's whole state for its page: read once, then replaced by each
// `chat` event the host sends for it (the event carries the whole chat,
// streaming reply included).
import { useCallback, useEffect, useState } from 'react'
import { chatHost, type ChatDetail } from '@/layerfs/agent-api'
import { onHostEvent } from '@/layerfs/client'
import { upsertChat } from '@/layerfs/use-chats'

export function useChat(id: string) {
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const take = useCallback(
    (next: ChatDetail) => {
      if (next.id !== id) return
      setChat(next)
      upsertChat(next)
    },
    [id],
  )

  useEffect(() => {
    setChat(null)
    setError(null)
    let live = true
    const load = () =>
      void chatHost.detail(id).then(
        (detail) => live && take(detail),
        (cause: Error) => live && setError(cause.message),
      )
    const off = onHostEvent((event) => {
      if (event.type === 'chat' && event.session.id === id) take(event.session as ChatDetail)
    }, load)
    load()
    return () => {
      live = false
      off()
    }
  }, [id, take])

  return { chat, error, take }
}
