import { useSyncExternalStore } from 'react'
import type { CliAction } from '../../../../../shared/cli-activity'
import { activityApi } from './activity-api'
import { connectBridge } from './bridge'
import { mergeMachineActivity, startupFailure, type MachineStartup } from './machine-progress'

const operations = new Map<string, MachineStartup>()
const listeners = new Set<() => void>()
let snapshots: readonly MachineStartup[] = []
const notify = () => { snapshots = [...operations.values()]; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const publish = (snapshot: MachineStartup) => { operations.set(snapshot.name, snapshot); notify() }

/** A later Stop/Remove clears the retained result, but cannot hide active work. */
export function clearMachineProgress(name: string): void {
  if (operations.get(name)?.status === 'running') return
  if (operations.delete(name)) notify()
}

/** One stable snapshot per publication, for board ordering and operation counts. */
export function useMachineStartups(): readonly MachineStartup[] {
  return useSyncExternalStore(subscribe, () => snapshots)
}

/** Module storage keeps an in-flight operation visible across board/detail navigation. */
export function useMachineProgress(name: string): MachineStartup | undefined {
  return useSyncExternalStore(subscribe, () => operations.get(name))
}

export async function performMachineStartup(input: Pick<MachineStartup, 'kind' | 'name' | 'platform'>, request: (activity: CliAction) => Promise<unknown>): Promise<void> {
  if (operations.get(input.name)?.status === 'running') throw new Error('This machine already has a startup operation in progress.')
  const id = crypto.randomUUID()
  const activity: CliAction = { id, name: `machine.${input.kind}`, label: input.kind === 'start' ? 'Start machine' : 'Create machine', target: input.name, page: location.hash.split('?')[0].slice(1), origin: 'user' }
  publish({ ...input, id, startedAt: Date.now(), status: 'running', stages: [] })
  let timer: ReturnType<typeof setTimeout> | undefined
  let loading = false, again = false, disposed = false
  const update = (change: (snapshot: MachineStartup) => MachineStartup) => {
    const current = operations.get(input.name)
    if (current?.id === id) publish(change(current))
  }
  const refresh = async () => {
    if (loading) { again = true; return }
    loading = true
    try {
      const detail = await activityApi.get(id)
      if (detail && !('cleared' in detail)) update(snapshot => mergeMachineActivity(snapshot, detail))
      else update(snapshot => ({ ...snapshot, progressUnavailable: true }))
    } catch { update(snapshot => ({ ...snapshot, progressUnavailable: true })) }
    finally {
      loading = false
      if (again) { again = false; void refresh() }
    }
  }
  const schedule = () => {
    if (timer || disposed) return
    timer = setTimeout(() => { timer = undefined; void refresh() }, 100)
  }
  const unsubscribe = connectBridge.onStream(message => {
    if (message.kind === 'event') {
      const event = message.event as { type?: string; actionId?: string }
      if (event.type === 'cli-activity' && event.actionId === id) schedule()
    } else if (message.state === 'connected') schedule()
  })
  // Observe before sending. Failure of optional live updates must not replay or block the mutation.
  void connectBridge.subscribe().catch(() => update(snapshot => ({ ...snapshot, progressUnavailable: true })))
  const poll = setInterval(() => void refresh(), 1000)
  try {
    await request(activity)
    update(snapshot => ({ ...snapshot, status: 'success', endedAt: Date.now() }))
  } catch (error) {
    update(snapshot => ({ ...snapshot, status: startupFailure(error), endedAt: Date.now(), error }))
    throw error
  } finally {
    disposed = true
    unsubscribe(); clearInterval(poll); clearTimeout(timer)
    void refresh()
  }
}
