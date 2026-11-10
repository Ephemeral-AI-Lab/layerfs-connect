import type { CliActivity } from './activity-api'

export interface MachineStartup {
  id: string
  name: string
  kind: 'start' | 'create'
  platform: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'success' | 'failed' | 'uncertain'
  stages: { stage: string; state: 'started' | 'completed' | 'failed'; at: number; elapsedMs?: number }[]
  error?: unknown
  progressUnavailable?: boolean
}

/** A lost mutation response cannot establish whether the provider changed state. */
export function startupFailure(error: unknown): 'failed' | 'uncertain' {
  const value = error as { code?: string; transport?: string; status?: number } | null
  return value?.code === 'Unknown' || value?.code === 'no-host' || value?.status === 0 || value?.transport === 'uncertain' ? 'uncertain' : 'failed'
}

/** Rebuild observed stages only; image preparation is absent on some providers. */
export function mergeMachineActivity(snapshot: MachineStartup, activity: CliActivity): MachineStartup {
  if (activity.id !== snapshot.id) return snapshot
  const calls = activity.invocations.filter(call => call.argv?.[0] === 'machine' && call.argv[1] === snapshot.kind)
  const ids = new Set(calls.map(call => call.id))
  const stages = new Map(snapshot.stages.map(stage => [stage.stage, stage]))
  const events = (activity.events ?? []).filter(event => event.type === 'cli.progress' && event.invocationId && ids.has(event.invocationId)).sort((a, b) => a.at - b.at || a.seq - b.seq)
  const samples = events.length ? events.map(event => ({ at: event.at, progress: event.data.progress })) : calls.map(call => ({ at: call.ended ?? call.started ?? call.at, progress: call.progress }))
  for (const { at, progress } of samples) {
    if (!progress || typeof progress.stage !== 'string' || !['started', 'completed', 'failed'].includes(String(progress.state))) continue
    const previous = stages.get(progress.stage)
    // A delayed/partial activity read cannot undo an observed terminal stage.
    if (previous && previous.state !== 'started' && progress.state === 'started') continue
    if (previous?.state === 'failed' && progress.state !== 'failed') continue
    // Preserve stage start time when a completion supplies its duration.
    stages.set(progress.stage, { stage: progress.stage, state: progress.state as 'started' | 'completed' | 'failed', at: previous?.at ?? at, ...(typeof progress.elapsed_ms === 'number' && Number.isFinite(progress.elapsed_ms) && progress.elapsed_ms >= 0 ? { elapsedMs: progress.elapsed_ms } : {}) })
  }
  return { ...snapshot, stages: [...stages.values()], progressUnavailable: false }
}
