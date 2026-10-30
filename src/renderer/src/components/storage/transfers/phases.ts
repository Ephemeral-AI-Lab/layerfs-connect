// A job's phases and words (storage-redesign §5.1–5.2): the stepper's steps
// per kind, the verb for each moment, and rate, ETA and duration as text.
import { ArrowDown, ArrowUp, CloudUpload, CopyPlus, DatabaseZap, Download, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { bytes } from '@/data/format'
import type { SyncJob, SyncPhase } from '@shared/host-api'

export interface Step {
  label: string
  /** The phases this step covers: `hash` shows as Upload, with "Preparing". */
  phases: SyncPhase[]
  /** "Uploading", for the compact form. */
  doing: string
}

export const STEPS: Record<SyncJob['kind'], Step[]> = {
  push: [
    { label: 'Check', phases: ['check'], doing: 'Checking' },
    { label: 'Snapshot', phases: ['snapshot'], doing: 'Snapshotting' },
    { label: 'Upload', phases: ['hash', 'upload'], doing: 'Uploading' },
    { label: 'Finish', phases: ['record'], doing: 'Finishing' },
  ],
  publish: [
    { label: 'Check', phases: ['check'], doing: 'Checking' },
    { label: 'Snapshot', phases: ['snapshot'], doing: 'Snapshotting' },
    { label: 'Upload', phases: ['hash', 'upload'], doing: 'Uploading' },
    { label: 'Finish', phases: ['record'], doing: 'Finishing' },
  ],
  send: [
    { label: 'Check', phases: ['check'], doing: 'Checking' },
    { label: 'Snapshot', phases: ['snapshot'], doing: 'Snapshotting' },
    { label: 'Upload', phases: ['hash', 'upload'], doing: 'Uploading' },
  ],
  pull: [
    { label: 'Check', phases: ['check'], doing: 'Checking' },
    { label: 'Download', phases: ['download'], doing: 'Downloading' },
    { label: 'Verify', phases: ['verify'], doing: 'Verifying' },
    { label: 'Replace', phases: ['install'], doing: 'Replacing' },
    { label: 'Finish', phases: ['record'], doing: 'Finishing' },
  ],
  load: [
    { label: 'Download', phases: ['download'], doing: 'Downloading' },
    { label: 'Verify', phases: ['verify'], doing: 'Verifying' },
    { label: 'Install', phases: ['install'], doing: 'Installing' },
    { label: 'Finish', phases: ['record'], doing: 'Finishing' },
  ],
  import: [
    { label: 'Copy', phases: ['copy'], doing: 'Copying' },
    { label: 'Finish', phases: ['record'], doing: 'Finishing' },
  ],
}

export const KIND: Record<SyncJob['kind'], { verb: string; doing: string; did: string; icon: LucideIcon; toward: 'to' | 'from' | 'into' }> = {
  push: { verb: 'Push', doing: 'Pushing', did: 'Pushed', icon: ArrowUp, toward: 'to' },
  pull: { verb: 'Pull', doing: 'Pulling', did: 'Pulled', icon: ArrowDown, toward: 'from' },
  publish: { verb: 'Publish', doing: 'Publishing', did: 'Published', icon: CloudUpload, toward: 'to' },
  send: { verb: 'Send a copy', doing: 'Sending', did: 'Sent', icon: CopyPlus, toward: 'to' },
  load: { verb: 'Load', doing: 'Loading', did: 'Loaded', icon: Download, toward: 'from' },
  import: { verb: 'Import', doing: 'Importing', did: 'Imported', icon: DatabaseZap, toward: 'into' },
}

export const isRunning = (job: Pick<SyncJob, 'ended' | 'step'>) => job.ended === null && job.step !== 'done' && job.step !== 'failed'
export const isFailed = (job: Pick<SyncJob, 'ended' | 'step' | 'error'>) => job.step === 'failed' || (job.ended !== null && job.error !== null)

/** The step the current phase is in; -1 before the first phase is known. */
export function stepIndex(job: Pick<SyncJob, 'kind' | 'phase'>): number {
  if (!job.phase) return -1
  return (STEPS[job.kind] ?? []).findIndex((s) => s.phases.includes(job.phase!))
}

/** This phase's share done, or null when it has no size (an indeterminate bar). */
export function share(job: Pick<SyncJob, 'bytes' | 'total'>): number | null {
  if (job.total === null || job.total === undefined || job.total <= 0 || job.bytes === null || job.bytes === undefined) return null
  return Math.min(1, Math.max(0, job.bytes / job.total))
}

/** The phase label of the row form: "Upload", or "Preparing" while it hashes. */
export function phaseLabel(job: Pick<SyncJob, 'kind' | 'phase'>): string | null {
  if (job.phase === 'hash') return 'Preparing'
  const i = stepIndex(job)
  return i < 0 ? null : STEPS[job.kind][i].label
}

/** The compact form's words: "Uploading 41%", the phase word without a total, or the verb without a phase. */
export function compactLabel(job: SyncJob): string {
  const i = stepIndex(job)
  const word = job.phase === 'hash' ? 'Preparing' : i < 0 ? KIND[job.kind].doing : STEPS[job.kind][i].doing
  const s = share(job)
  return s === null ? `${word}…` : `${word} ${Math.floor(s * 100)}%`
}

/** "12.4 MB/s". */
export const rateText = (rate: number | null | undefined) => (rate && rate > 0 ? `${bytes(Math.round(rate))}/s` : null)

/** "about 47 s left", "about 3 min left", "less than 10 s left" (§5.2); null without one. */
export function etaText(eta: number | null | undefined): string | null {
  if (eta === null || eta === undefined || !Number.isFinite(eta) || eta < 0) return null
  if (eta < 10) return 'less than 10 s left'
  if (eta < 60) return `about ${Math.round(eta / 5) * 5} s left`
  if (eta < 3600) return `about ${Math.round(eta / 60)} min left`
  return `about ${Math.round(eta / 360) / 10} h left`
}

/** "47 seconds" for screen readers. */
export function etaSpoken(eta: number | null | undefined): string | null {
  const t = etaText(eta)
  return t && t.replace(/\bs\b/, 'seconds').replace(/\bmin\b/, 'minutes').replace(/\bh\b/, 'hours')
}

/** "1 min 12 s", "48 s", "2 h 3 min". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/** The place a job moves to or from, as the user named it: a remote, or `connection` for an import. */
export const targetName = (job: Pick<SyncJob, 'kind' | 'target'>) => (job.kind === 'import' ? job.target.split('/')[0] : job.target)

/** "Pushed work to r2-team", "Pulled team from minio-a", "Cloned team-old from r2", "Imported work into pg-local as work-pg". */
export function endedSentence(job: SyncJob): string {
  const k = KIND[job.kind]
  if (isFailed(job)) return `${k.verb} failed`
  if (job.kind === 'import') return `${k.did} ${job.store} into ${targetName(job)}${job.from ? ` as ${job.from}` : ''}`
  return `${k.did} ${job.store} ${k.toward} ${job.target}`
}
/** The current time, every `ms` while `on`. */
export function useNow(on: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [on, ms])
  return now
}

