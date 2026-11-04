// The Storage jobs this window knows (docs/ui/layerfs-storage.md), shared by
// the Storage page, a Store's page, the sidebar and the Machines page: what the
// host's `storage-job` events said, seeded from each Storage read; the byte
// samples each running job sent (for its speed); and the ended jobs dismissed
// from their cards (remembered across reloads).
import { useSyncExternalStore } from 'react'

import { RATE_WINDOW_MS, type Sample } from '@/data/job-progress'
import { onHostEvent } from '@/host/client'
import type { StorageJob } from '@shared/host-api'

const DISMISSED_KEY = 'layerfs-connect.storage.dismissed-jobs'

const jobs = new Map<string, StorageJob>()
const samples = new Map<string, Sample[]>()
/** When this window first saw each job's steps (a move's halves apart): `<half>:<phase>` → ms. */
const seen = new Map<string, Map<string, number>>()
const dismissed = new Set<string>(readDismissed())
const listeners = new Set<() => void>()
let snapshot: { jobs: StorageJob[]; dismissed: ReadonlySet<string> } = { jobs: [], dismissed: new Set(dismissed) }
let subscribed = false

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function changed() {
  snapshot = { jobs: [...jobs.values()].sort((a, b) => b.started - a.started), dismissed: new Set(dismissed) }
  listeners.forEach((l) => l())
}

/** A job as an event or a read gave it: its byte sample kept for the speed. */
function take(j: StorageJob, at = Date.now()) {
  const had = jobs.get(j.id)
  // a read may be older than the events: an ended job stays ended
  if (had?.ended && !j.ended) return
  jobs.set(j.id, j)
  if (j.phase) {
    const steps = seen.get(j.id) ?? new Map<string, number>()
    const key = `${j.half ?? ''}:${j.phase}`
    if (!steps.has(key)) steps.set(key, at)
    seen.set(j.id, steps)
  }
  if (j.ended || j.done === null) return
  const list = (samples.get(j.id) ?? []).filter((s) => at - s.at <= RATE_WINDOW_MS && s.done <= j.done!)
  // a new step (a move's second half) starts its bytes again
  if (had && (had.phase !== j.phase || had.half !== j.half)) list.length = 0
  if (list.at(-1)?.done !== j.done) list.push({ at, done: j.done })
  samples.set(j.id, list)
}

function subscribe(listener: () => void) {
  if (!subscribed) {
    subscribed = true
    onHostEvent((e) => {
      if (e.type !== 'storage-job') return
      take(e.job)
      changed()
    })
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The jobs a Storage read answered: merged with what events said. */
export function seedJobs(list: StorageJob[]) {
  let any = false
  for (const j of list) {
    const had = jobs.get(j.id)
    if (had && had.ended === j.ended && had.phase === j.phase && had.done === j.done) continue
    take(j)
    any = true
  }
  if (any) changed()
}

/** A job's recent byte samples (oldest first). */
export const samplesOf = (id: string): Sample[] => samples.get(id) ?? []

/** When this window first saw a job's step (in a move's current half), if it did. */
export const stepSeen = (j: StorageJob, phase: string): number | undefined => seen.get(j.id)?.get(`${j.half ?? ''}:${phase}`)

/** Takes an ended job off its card, the header and the sidebar. */
export function dismissJob(id: string) {
  dismissed.add(id)
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed].slice(-100)))
  } catch {
    /* the dismissal just isn't remembered */
  }
  changed()
}

/** The jobs this window knows (newest first) and the dismissed ones. */
export function useStorageJobs() {
  return useSyncExternalStore(subscribe, () => snapshot)
}
