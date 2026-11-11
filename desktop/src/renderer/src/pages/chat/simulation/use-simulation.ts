import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { chatHost } from '@/layerfs/agent-api'
import { simulationHost, simulationEnded, type SimulationRun } from '@/layerfs/simulation-api'
import type { SimulationInput } from '@/layerfs/simulation-command'
import { upsertChat } from '@/layerfs/use-chats'

/** POST once; setup status polling never repeats a resource-creating request. */
export function useSimulationLaunch() {
  const navigate = useNavigate()
  const [run, setRun] = useState<SimulationRun | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [polling, setPolling] = useState(true)
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    if (!run || !polling) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const current = run
    async function check() {
      try {
        if (current.sessionId) {
          const chat = await chatHost.detail(current.sessionId)
          if (!disposed) { upsertChat(chat); navigate(`/chat/${encodeURIComponent(chat.id)}`); setRun(null) }
        } else if (!simulationEnded(current.state)) {
          const next = await simulationHost.get(current.id)
          if (!disposed) setRun(next)
        }
      } catch (cause) {
        if (!disposed) { setError(`Could not load simulation ${current.id}: ${(cause as Error).message}. Resume status to reconnect.`); setPolling(false) }
      }
    }
    timer = setTimeout(() => void check(), current.sessionId ? 0 : 1000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [run, polling, navigate])

  async function start(input: SimulationInput) {
    setCreating(true); setRun(null); setError(null); setPolling(true)
    try { setRun(await simulationHost.create(input)); return true }
    catch (cause) { setError(`Could not start simulation: ${(cause as Error).message}`); return false }
    finally { setCreating(false) }
  }
  async function stop() {
    if (!run) return
    setStopping(true); setError(null)
    try { setRun(await simulationHost.stop(run.id)); setPolling(true) }
    catch (cause) { setError(`Could not stop simulation ${run.id}: ${(cause as Error).message}. Try Stop again.`) }
    finally { setStopping(false) }
  }
  return { run, error, creating, busy: creating || (!!run && !simulationEnded(run.state)), polling, stopping, start, stop,
    resume: () => { setError(null); setPolling(true); setRun(current => current ? { ...current } : current) } }
}
