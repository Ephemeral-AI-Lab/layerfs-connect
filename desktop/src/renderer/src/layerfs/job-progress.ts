import { fill } from '@/lib/text'
// A Storage job's progress, as the Store's card, its page and the chips draw it
// (docs/ui/storage.md): its steps as LayerFS reports them (on_progress
// phases), each step's state, the words for what it is doing, its speed and
// time left from the byte samples, and which job a card shows. No React here.
import type { StorageJob } from '@/layerfs/host-api'

type Kind = StorageJob['kind']

/**
 * The phases each call reports, in order (layerfs-control): push and pull
 * (and each half of a move) `store/transfer/phases.rs`; backup
 * `backup/create.rs` (send only from a machine's worker); restore
 * `backup/restore.rs`.
 */
export const STEPS: Record<Kind, readonly string[]> = {
  push: ['check', 'snapshot', 'send', 'verify', 'install', 'record', 'retire'],
  pull: ['check', 'snapshot', 'send', 'verify', 'install', 'record', 'retire'],
  move: ['check', 'snapshot', 'send', 'verify', 'install', 'record', 'retire'],
  backup: ['snapshot', 'send', 'upload'],
  restore: ['download', 'install'],
}

/** The steps that move the Store's bytes: drawn wide. */
const WIDE = new Set(['send', 'upload', 'download'])

/** A step's width in the bar: the byte steps take most of it. */
export const weightOf = (step: string) => (WIDE.has(step) ? 8 : 1)

export type StepState = 'done' | 'now' | 'failed' | 'todo'

export interface Segment {
  step: string
  weight: number
  state: StepState
  /** How much of a running step is done, when its call gives bytes. */
  share: number | null
}

/** A running job's share of its step done, when its call gives a total. */
export const stepShare = (j: StorageJob) => (j.total && !j.ended ? Math.min(1, Math.max(0, (j.done ?? 0) / j.total)) : null)

/** The bar's segments for one run of a call's steps (a move's half is one run). */
export function segmentsOf(j: StorageJob): Segment[] {
  const steps = STEPS[j.kind]
  const ok = j.ended !== null && j.error === null
  const at = j.error ? steps.indexOf(j.error.phase ?? '') : j.phase ? steps.indexOf(j.phase) : j.ended ? -1 : 0
  return steps.map((step, i) => {
    const state: StepState = ok || i < at ? 'done' : i === at ? (j.error ? 'failed' : 'now') : 'todo'
    return { step, weight: weightOf(step), state, share: state === 'now' ? stepShare(j) : null }
  })
}

/** Which half of a move it is in: 0 the pull, 1 the push; null for other kinds. */
export const halfOf = (j: StorageJob) => (j.kind !== 'move' ? null : j.half === 'push' ? 1 : 0)

/** The bar as groups of segments: one for most jobs, a move's pull then its push (the other half all done, or all to come). */
export function barOf(j: StorageJob): Segment[][] {
  const now = segmentsOf(j)
  const half = halfOf(j)
  if (half === null) return [now]
  const all = (state: StepState) => now.map((s) => ({ ...s, state, share: null }))
  return half === 0 ? [now, all('todo')] : [all('done'), now]
}

/** Where a running job is: "step 4 of 7", from its segments. */
export function stepCount(j: StorageJob) {
  const steps = STEPS[j.kind]
  return { at: Math.max(0, steps.indexOf(j.phase ?? '')) + 1, of: steps.length }
}

/** A step as words: "sending", "verifying". */
export function stepWords(step: string | null): string {
  const words: Record<string, string> = {
    check: 'checking',
    snapshot: 'taking a snapshot',
    send: 'sending',
    verify: 'verifying',
    install: 'installing',
    record: 'recording',
    retire: 'cleaning up',
    upload: 'uploading',
    download: 'downloading',
  }
  return fill(step ? (words[step] ?? step) : 'starting')
}

/** A place in words: `native` is the home. */
const place = (m: string | null | undefined) => (m === 'native' ? 'Home' : (m ?? '?'))

/** What the job does, in words, while it runs: "Pushing to docker". */
export function doingWords(j: StorageJob): string {
  if (j.kind === 'push') return `Pushing to ${place(j.target)}`
  if (j.kind === 'pull') return `Pulling from ${place(j.from)}`
  if (j.kind === 'move') return `Moving to ${place(j.target)}`
  if (j.kind === 'backup') return `Backing up to ${j.target}`
  return `Restoring from ${j.file ? `${j.target}/${j.file}` : j.target}`
}

/** How it ended, in words: "Pushed to docker", "Push to docker failed in verify". */
export function endedWords(j: StorageJob): string {
  const to = j.kind === 'pull' ? place(j.from) : j.kind === 'backup' || j.kind === 'restore' ? j.target : place(j.target)
  if (j.error) {
    const what = { push: 'Push to {place}', pull: 'Pull from {place}', move: 'Move to {place}', backup: 'Backup to {place}', restore: 'Restore from {place}' }[j.kind]
    return `${fill(what, { place: to })} failed in ${j.error.phase ?? 'an unknown phase'}`
  }
  const done = { push: 'Pushed to {place}', pull: 'Pulled from {place}', move: 'Moved to {place}', backup: 'Backed up to {place}', restore: 'Restored from {place}' }[j.kind]
  return fill(done, { place: to })
}

/** A byte sample: when, and how many bytes were done. */
export interface Sample {
  at: number
  done: number
}

/** Samples older than this do not count toward the speed. */
export const RATE_WINDOW_MS = 10_000
/** The speed needs at least this much time between its samples. */
const RATE_MIN_MS = 2_000

/** Bytes a second over the last RATE_WINDOW_MS of samples, or null while there is too little to tell. */
export function rateOf(samples: Sample[], now = samples.at(-1)?.at ?? 0): number | null {
  const recent = samples.filter((s) => now - s.at <= RATE_WINDOW_MS)
  if (recent.length < 2) return null
  const first = recent[0]
  const last = recent[recent.length - 1]
  const span = last.at - first.at
  if (span < RATE_MIN_MS || last.done <= first.done) return null
  return ((last.done - first.done) / span) * 1000
}

/** Seconds left at `rate`, or null. */
export const secondsLeft = (j: StorageJob, rate: number | null) => (rate && j.total && j.done !== null && !j.ended ? Math.max(0, (j.total - j.done) / rate) : null)

/** Time left in words: "under a minute", "about 3 min left". */
export function leftWords(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const m = Math.round(seconds / 60)
  if (m < 90) return `about ${m} min left`
  return `about ${Math.round(m / 6) / 10} h left`
}

/** A speed in words: "42 MB/s". */
export function rateWords(rate: number): string {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = rate
  let u = 0
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u++
  }
  return `${v >= 10 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

/** A duration in words: "58 s", "1 min 32 s", "2 h 5 min". */
export function tookWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/** How long a job that ended well stays on its card. */
export const SHOW_DONE_MS = 60_000

/**
 * The job a Store's card shows: the one running on it; else its newest ended
 * job, while it failed (until dismissed) or ended well in the last minute.
 */
export function cardJob(jobs: StorageJob[], store: string, dismissed: ReadonlySet<string>, now = Date.now()): StorageJob | undefined {
  const mine = jobs.filter((j) => j.store === store)
  const running = mine.find((j) => !j.ended)
  if (running) return running
  const last = mine.filter((j) => j.ended).sort((a, b) => b.ended! - a.ended!)[0]
  if (!last || dismissed.has(last.id)) return undefined
  return last.error || now - last.ended! < SHOW_DONE_MS ? last : undefined
}

/** How many jobs run, and how many failed and are not dismissed: the header's and the sidebar's marks. */
export function jobCounts(jobs: StorageJob[], dismissed: ReadonlySet<string>) {
  const latest = new Map<string, StorageJob>()
  for (const j of jobs) if (!latest.has(j.store) || j.started > latest.get(j.store)!.started) latest.set(j.store, j)
  const last = [...latest.values()]
  return { running: last.filter((j) => !j.ended).length, failed: last.filter((j) => j.ended && j.error && !dismissed.has(j.id)).length }
}
