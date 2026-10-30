import { useCallback, useEffect, useState } from 'react'
import type { AgentCapabilities, AgentCapabilityChange } from '@shared/agent-api'

import { agentHost } from '@/host/agent-client'

/**
 * Settings → Extensions, Tools, Hooks and Commands: the agents' setup, and
 * switching an extension or tool. The host refuses a change while a chat
 * works, and for the locked ones; `changeError` says why.
 */
export function useCapabilities() {
  const [data, setData] = useState<AgentCapabilities>()
  const [error, setError] = useState('')
  /** `kind:id` of the change in flight. */
  const [pending, setPending] = useState<string | null>(null)
  const [changeError, setChangeError] = useState('')
  const [saved, setSaved] = useState(false)
  const load = useCallback(async () => {
    setError('')
    try { setData(await agentHost.capabilities()) }
    catch (cause) { setError((cause as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])
  async function change(next: AgentCapabilityChange) {
    setPending(`${next.kind}:${next.id}`)
    setChangeError('')
    setSaved(false)
    try {
      setData(await agentHost.setCapability(next))
      setSaved(true)
    } catch (cause) {
      setChangeError((cause as Error).message)
      void load()
    } finally {
      setPending(null)
    }
  }
  return { data, error, reload: load, change, pending, changeError, saved }
}

export type Capabilities = ReturnType<typeof useCapabilities>
