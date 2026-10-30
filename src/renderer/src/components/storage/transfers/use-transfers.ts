// The window's sync jobs (storage-redesign §5, §8.4): seeded from each storage
// view, kept current by the host's `sync` events, and, only while the event
// stream is down (or a job has gone quiet on it), read once a second per job.
// One store for the window, so the tray and a Store's job card agree and a
// job keeps showing as the user moves between Storage pages.
import { useEffect, useSyncExternalStore } from 'react'

import { isRunning } from '@/components/storage/transfers/phases'
import { normalizeJob } from '@/components/storage/view'
import { HostError, host, hostEventsOpen, onHostEvent } from '@/host/client'
import type { SyncJob } from '@shared/host-api'

/** An ended job stays in the tray this long (the host's KEEP_ENDED_MS). */
export const KEEP_ENDED_MS = 10 * 60_000
const POLL_MS = 1000
/** A running job with no event for this long is read directly. */
const QUIET_MS = 3000

const jobs = new Map<string, SyncJob>()
const dismissed = new Set<string>()
const heard = new Map<string, number>()
const subscribers = new Set<() => void>()
const endedListeners = new Set<(job: SyncJob) => void>()
let snapshot: SyncJob[] = []
let unsubscribeEvents: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
const polling = new Set<string>()

/** Running first, then ended ones, newest first. */
const order = (a: SyncJob, b: SyncJob) => Number(isRunning(b)) - Number(isRunning(a)) || (b.ended ?? b.started) - (a.ended ?? a.started)

function emit() {
  snapshot = [...jobs.values()].sort(order)
  for (const s of [...subscribers]) s()
}

function take(next: SyncJob): boolean {
  if (!next.id) return false
  const prev = jobs.get(next.id)
  // a late sample never reopens an ended job
  if (prev?.ended && !next.ended) return false
  jobs.set(next.id, next)
  if (prev && !prev.ended && next.ended) for (const l of [...endedListeners]) l(next)
  return true
}

/** A job sample from anywhere: an event, a poll, a start, a view. */
export function putJob(job: SyncJob) {
  if (take(job)) emit()
  ensurePolling()
}

/** The view's jobs: new ones join, ones it no longer lists stay until they age out. */
export function seedJobs(list: SyncJob[]) {
  let changed = false
  for (const j of list) changed = take(j) || changed
  if (changed) emit()
  ensurePolling()
}

export function dismissJob(id: string) {
  dismissed.add(id)
  emit()
}

/** Calls `listener` when a job this window saw running ends. */
export function onJobEnded(listener: (job: SyncJob) => void): () => void {
  endedListeners.add(listener)
  return () => endedListeners.delete(listener)
}

function poll() {
  const now = Date.now()
  const open = hostEventsOpen()
  const running = [...jobs.values()].filter(isRunning)
  if (!running.length && timer) {
    clearInterval(timer)
    timer = null
    return
  }
  for (const job of running) {
    if (polling.has(job.id)) continue
    if (open && now - (heard.get(job.id) ?? job.started) < QUIET_MS) continue
    polling.add(job.id)
    host.syncJob(job.id).then(
      (next) => putJob(normalizeJob(next)),
      (e: unknown) => {
        // the host no longer knows it: it ended while this window wasn't looking
        if (e instanceof HostError && e.status === 404) putJob({ ...job, step: 'failed', ended: Date.now(), error: { code: 'Unknown', message: 'Connect lost track of this job. Check the remote file before trying again.' } })
      },
    ).finally(() => polling.delete(job.id))
  }
}

function ensurePolling() {
  if (timer || ![...jobs.values()].some(isRunning)) return
  timer = setInterval(poll, POLL_MS)
}

function subscribe(listener: () => void) {
  subscribers.add(listener)
  if (!unsubscribeEvents)
    unsubscribeEvents = onHostEvent((e) => {
      if (e.type !== 'sync') return
      heard.set(e.job.id, Date.now())
      putJob(normalizeJob(e.job))
    })
  return () => {
    subscribers.delete(listener)
    if (!subscribers.size && unsubscribeEvents) {
      unsubscribeEvents()
      unsubscribeEvents = null
    }
  }
}

const getSnapshot = () => snapshot

/** Whether an ended job still shows: within 10 minutes, or failed, and not dismissed in this window. */
export const shows = (job: SyncJob, now = Date.now()) =>
  !dismissed.has(job.id) && (isRunning(job) || job.step === 'failed' || now - (job.ended ?? now) < KEEP_ENDED_MS)

export interface Transfers {
  /** Every job this window knows, running first. */
  all: SyncJob[]
  running: SyncJob[]
  /** What the tray shows. */
  shown: SyncJob[]
  /** The running job on a Store, else its last shown one. */
  jobFor: (store: string) => SyncJob | undefined
  /** The running job on a Store, if any. */
  runningFor: (store: string) => SyncJob | undefined
}

/** The jobs, re-rendering on every sample; `seed` feeds a view's jobs in. */
export function useTransfers(seed?: SyncJob[]): Transfers {
  const all = useSyncExternalStore(subscribe, getSnapshot)
  useEffect(() => {
    if (seed) seedJobs(seed)
  }, [seed])
  const now = Date.now()
  const running = all.filter(isRunning)
  const shown = all.filter((j) => shows(j, now))
  // a load moves into its new Store; an import starts from its source Store
  const on = (store: string) => (j: SyncJob) => j.store === store
  return {
    all,
    running,
    shown,
    runningFor: (store) => running.find(on(store)),
    jobFor: (store) => running.find(on(store)) ?? shown.find(on(store)),
  }
}
