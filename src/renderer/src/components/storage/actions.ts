// What every part of the Storage page can ask of it: move between views,
// start transfers and open its dialogs. StoragePage provides it; rows, cards
// and detail pages read it, so a dialog has one owner and one copy.
import { createContext, useContext } from 'react'

import { t } from '@/i18n'

import type { LocationFamily } from '@/components/storage/dialogs/add-location-dialog'
import type { RefusalActions } from '@/components/storage/transfers/refusal'
import type { Transfers } from '@/components/storage/transfers/use-transfers'
import type { HostStatus, StorageCheck, StorageView, StoreInfo, SyncJob } from '@shared/host-api'

/** Where the Storage page is (storage-redesign §1): kept in the URL hash. */
export type Route =
  | { view: 'overview' }
  | { view: 'store'; id: string }
  | { view: 'location'; id: string }
  | { view: 'connection'; id: string }
  | { view: 'machine' }

/** The New dialog's tabs: one per kind of Store. */
export type NewTab = 'sqlite' | 'postgresql'

export type RemoveTarget = { kind: 'store'; store: StoreInfo } | { kind: 'remote'; name: string } | { kind: 'connection'; name: string; stores: number }

export interface StorageActions {
  view: StorageView
  status: HostStatus | null
  transfers: Transfers
  open: (route: Route) => void
  /** Publish… an unlinked Store to a new remote file, linked (layerfs#509). */
  publish: (store: StoreInfo, remote?: string) => void
  /** Push to the Store's link; a linked file that moved (behind, diverged) opens the push-conflict dialog. Rejects when the host refuses to start. */
  push: (store: StoreInfo) => Promise<void>
  /** The push-conflict dialog: Pull first, or Overwrite. */
  pushAnyway: (store: StoreInfo) => void
  /** Pull from the Store's link; asks for the Store's name only when the pull discards local changes. */
  pull: (store: StoreInfo) => Promise<void>
  /** Send a copy… of any SQLite Store to a new, unlinked file. */
  send: (store: StoreInfo) => void
  /** Load… a remote file into a new local Store, linked to it. */
  load: (file: { remote: string; file: string }) => void
  /** Unlink…: the Store becomes local only; the file stays. */
  unlink: (store: StoreInfo) => void
  importInto: (options?: { store?: string; connection?: string }) => void
  addLocation: (options?: { family?: LocationFamily; provider?: string }) => void
  newStore: () => void
  /** The New dialog, on a tab (SQLite by default). */
  newDialog: (tab?: NewTab) => void
  addProject: (store: StoreInfo) => void
  remove: (target: RemoveTarget) => void
  /** Link checks, connection listings and PostgreSQL status; resolves when the host answers. */
  check: (body?: StorageCheck) => Promise<void>
  /** Checks run now (this window's Check now, or the host's). */
  checking: boolean
  /** The refusal block's buttons for a failed job. */
  refusalActions: (job: SyncJob) => RefusalActions
  /** A Store whose job just ended, to flash its row once; the token changes each time. */
  flash: { store: string; token: number } | null
  /** Opens a project's page; absent where the page can't. */
  openProject?: (store: string, project: string) => void
  /** Why SQLite sizes may be unknown: "Docker is not answering". */
  sizeReason: string | null
}

export const StorageContext = createContext<StorageActions | null>(null)

export function useStorage(): StorageActions {
  const ctx = useContext(StorageContext)
  if (!ctx) throw new Error('useStorage outside StoragePage')
  return ctx
}

/** "#storage/store/work" and back. */
export function routeHash(route: Route): string {
  return route.view === 'overview' ? '#storage' : route.view === 'machine' ? '#storage/machine' : `#storage/${route.view}/${encodeURIComponent(route.id)}`
}

/** The Storage view a hash names, or null when it is not a Storage hash. */
export function parseRoute(hash: string): Route | null {
  const [page, view, ...rest] = hash.replace(/^#/, '').split('/')
  if (page !== 'storage') return null
  const id = decodeURIComponent(rest.join('/'))
  if (view === 'machine') return { view: 'machine' }
  if ((view === 'store' || view === 'location' || view === 'connection') && id) return { view, id }
  return { view: 'overview' }
}

/** Middle-truncates a path or URL to `max` characters; the full value goes in `title`. */
export function middle(s: string, max = 44): string {
  if (s.length <= max) return s
  const keep = max - 1
  return `${s.slice(0, Math.ceil(keep / 2))}…${s.slice(s.length - Math.floor(keep / 2))}`
}

/** "1 Store", "3 projects", translated (the keys are "{n} Store" and "{n} Stores"). */
export const count = (n: number, one: string, many = `${one}s`) => t(`{n} ${n === 1 ? one : many}`, { n })
