// One subagent's conversation for its view: read, then read again (at most
// twice a second) while the chat changes, since a running child's
// conversation grows with it.
import { useEffect, useRef, useState } from 'react'
import { chatHost, type ChatMessage, type ChildRun } from '@/layerfs/agent-api'
import { onHostEvent } from '@/layerfs/client'

export function useChild(chatId: string, childId: string) {
  const [data, setData] = useState<{ child: ChildRun; messages: ChatMessage[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    let live = true
    const load = () => {
      timer.current = null
      void chatHost.child(chatId, childId).then(
        (next) => live && (setData(next), setError(null)),
        (cause: Error) => live && setError(cause.message),
      )
    }
    const off = onHostEvent((event) => {
      if (event.type === 'chat' && event.session.id === chatId && !timer.current) timer.current = setTimeout(load, 500)
    }, load)
    load()
    return () => {
      live = false
      off()
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [chatId, childId])

  return { data, error }
}
