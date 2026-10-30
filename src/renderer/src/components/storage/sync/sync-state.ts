// Sync states as the page shows them (storage-links §4, storage-redesign
// §4.4): label, tone, icon and severity. The host decides each state
// (host/storage-sync.js) from the Store's one link; this file only names it,
// so nothing here re-derives a link's state.
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  CloudOff,
  HardDrive,
  LoaderCircle,
  type LucideIcon,
  Radio,
  Split,
} from 'lucide-react'

import type { Tone } from '@/components/storage/chips'
import type { StoreSyncState, SyncState } from '@shared/host-api'

export interface StateMeta {
  label: string
  /** The short label of compact pills (project cards, the New project dialog). */
  short: string
  tone: Tone
  icon: LucideIcon
  /** A dashed ring: not known now. */
  dashed?: boolean
  /** The icon turns. */
  spin?: boolean
  /** What it means, for tooltips. */
  means: string
}

export const SYNC: Record<StoreSyncState, StateMeta> = {
  in_sync: { label: 'In sync', short: 'In sync', tone: 'success', icon: CircleCheck, means: 'Both sides match the last push or pull, or have the same history.' },
  ahead: { label: 'Changes to push', short: 'To push', tone: 'info', icon: ArrowUp, means: 'This machine has Commits the linked file doesn’t; the file hasn’t moved.' },
  behind: { label: 'Remote newer', short: 'Remote newer', tone: 'warning', icon: ArrowDown, means: 'The linked file changed since the last push or pull.' },
  diverged: { label: 'Both changed', short: 'Both changed', tone: 'danger', icon: Split, means: 'Both sides moved since the last push or pull. A push is refused, and a pull loses local Commits.' },
  missing: { label: 'File missing', short: 'File missing', tone: 'warning', icon: CloudOff, means: 'The linked file was deleted from its bucket.' },
  checking: { label: 'Checking…', short: 'Checking…', tone: 'neutral', icon: LoaderCircle, spin: true, means: 'The first check of the linked file is running.' },
  unreachable: { label: 'Unreachable', short: 'Unreachable', tone: 'warning', icon: CloudOff, dashed: true, means: 'The connection didn’t answer the last check.' },
  unknown: { label: 'Sync unknown', short: 'Sync unknown', tone: 'neutral', icon: CircleDashed, dashed: true, means: 'One side can’t be read now.' },
  transferring: { label: 'Transferring', short: 'Transferring', tone: 'info', icon: LoaderCircle, spin: true, means: 'A push or pull runs on this Store.' },
  local_only: { label: 'Local only', short: 'Local only', tone: 'neutral', icon: HardDrive, means: 'Linked to no remote file.' },
  live: { label: 'Live', short: 'Live', tone: 'success', icon: Radio, means: 'Every Commit goes straight to the database. Nothing to sync.' },
}

/** Most urgent first (§4.4), for sorting and the aggregate. */
export const SEVERITY: StoreSyncState[] = ['diverged', 'behind', 'missing', 'ahead', 'unreachable', 'unknown', 'checking', 'transferring', 'in_sync', 'local_only', 'live']

export const severity = (s: StoreSyncState | null | undefined) => {
  const i = SEVERITY.indexOf(s ?? 'unknown')
  return i < 0 ? SEVERITY.indexOf('unknown') : i
}

/** States that ask the user to act: their cards come first, with a ring (overview/store-card.tsx). */
export const NEEDS_ACTION: StoreSyncState[] = ['ahead', 'behind', 'diverged', 'missing', 'unreachable']

export const isSyncState = (s: unknown): s is StoreSyncState => typeof s === 'string' && s in SYNC

/** States in which a push replaces a linked file that moved: Push asks first (the push-conflict dialog). */
export const PUSH_REPLACES: SyncState[] = ['behind', 'diverged', 'missing']
/** States in which a pull discards local changes (§3.10). */
export const PULL_DISCARDS: SyncState[] = ['ahead', 'diverged']
