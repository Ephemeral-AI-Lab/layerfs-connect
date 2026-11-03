// A project's Store as the Projects screens show it (LayerFS 2.0): which
// Store holds it, its family, the machine it is on, its state and its size.
// One cached Storage view feeds every card, header and dialog; it is read
// again when the host says Storage changed, a job ends, or a project or
// Store is made or removed. Without a view the facts fall back to the
// project summary.
import { useSyncExternalStore } from 'react'
import { type ProjectSummary, type SdkOperation, type StorageView, type StoreFamily, type StoreRow } from '@shared/host-api'

import { go } from '@/components/tabs/go'
import { StoreIcon } from '@/components/storage/identity/store-icon'
import { bytes } from '@/data/format'
import { stateLook } from '@/data/states'
import { host, onHostEvent, onProjectsChanged } from '@/host/client'
import { POLL_MS } from '@/host/use-host'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

// ---------- the shared Storage view ----------

/** undefined before the first answer; null when the host has no Storage view. */
let view: StorageView | null | undefined
let version = 0
const listeners = new Set<() => void>()
let detach: (() => void) | null = null

function load() {
  const asked = ++version
  host.storage().then(
    (answer) => {
      if (asked !== version) return
      view = answer
      listeners.forEach((listener) => listener())
    },
    () => {
      if (asked !== version) return
      view = null
      listeners.forEach((listener) => listener())
    },
  )
}

/** Reads the Storage view again (after a start the page asked for). */
export const reloadStorageView = () => load()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!detach) {
    const offEvents = onHostEvent((event) => {
      if (event.type === 'storage' || (event.type === 'storage-job' && event.job.ended)) load()
    })
    const offProjects = onProjectsChanged(load)
    // the list calls carry state and op: re-read while shown, so a project's banner follows work started elsewhere (§8.9)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    detach = () => { offEvents(); offProjects(); clearInterval(timer) }
    load()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detach) {
      detach()
      detach = null
    }
  }
}

/** The host's Storage view, shared by every reader; null when the host has none. */
export function useStorageView(): StorageView | null | undefined {
  return useSyncExternalStore(subscribe, () => view)
}

/**
 * The Stores a new project can go into: every Store, sqlite on any machine
 * and PostgreSQL (#537 §8.6). project.init reads the folder on this Mac and
 * writes through the Store's machine (a VM's worker); a Store that is down or
 * busy refuses it in LayerFS's words. Null before the view.
 */
export function initStores(storage: StorageView | null | undefined): StoreRow[] | null {
  return storage ? storage.stores : null
}

/** Whether a summary is the project with this key. */
export const isProject = (project: ProjectSummary, key: string): boolean => project.key === key

// ---------- one project's Store ----------

export interface StoreFacts {
  name: string
  family: StoreFamily
  /** A sqlite Store's machine. */
  machine: string | null
  /** The SDK's state (idle, in_use, busy, down, unresolved); null when unknown. */
  state: string | null
  /** An operation in flight on it (a push or pull), with its phase. */
  op: SdkOperation | null
  /** Bytes on disk (the sqlite file and WAL); null when unknown or PostgreSQL. */
  size: number | null
  /** Other projects share the Store. */
  shared: boolean
  /** The Store's other projects, when the view lists them. */
  others: string[]
}

export function storeFacts(project: ProjectSummary, storage: StorageView | null | undefined): StoreFacts {
  const info = storage?.stores.find((store) => store.name === project.store)
  const others = info?.projects.filter((name) => name !== project.name) ?? []
  return {
    name: project.store,
    family: info?.kind ?? project.kind ?? 'sqlite',
    machine: info?.machine ?? project.machine ?? null,
    state: info?.state ?? project.storeState ?? null,
    op: info?.op ?? project.storeOp ?? null,
    size: info?.size?.bytes ?? null,
    shared: others.length > 0,
    others,
  }
}

/** Where the Store lives: its machine, or "in its database". */
function storeWhere(facts: StoreFacts, t: (source: string, values?: Record<string, string>) => string): string | null {
  if (facts.family === 'postgresql') return t('in its database')
  return facts.machine ? t('on {machine}', { machine: facts.machine }) : null
}

const storeTitle = (facts: StoreFacts) => facts.name

/** A project's Store in one line: its mark, its name, its machine and its size. */
export function StoreLine({ facts, className }: { facts: StoreFacts; className?: string }) {
  const { t } = useI18n()
  const where = storeWhere(facts, t)
  const detail = [where, facts.size !== null ? bytes(facts.size) : null, facts.state ? t(stateLook('store', facts.state).label).toLowerCase() : null].filter(Boolean).join(' · ')
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-2.5 rounded-xl bg-foreground/[0.03] px-2.5 py-2 ring-1 ring-foreground/[0.05] ring-inset', className)}>
      <StoreIcon family={facts.family} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium" title={facts.name}>{storeTitle(facts)}</span>
        {detail && <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground" title={detail}>{detail}</span>}
      </span>
    </span>
  )
}

/** A project's Store as a pill beside its title: its mark and name (a Store of its own named like `project` leaves the name out). */
export function StoreBadge({ facts, project }: { facts: StoreFacts; project?: string }) {
  const { t } = useI18n()
  const named = !(!facts.shared && facts.name === project)
  // the badge opens the Store's row on Storage (#537 §7)
  return (
    <button type="button" onClick={() => go.store(facts.name)} title={t('Show {store} on Storage', { store: facts.name })} className={cn('glass-liquid inline-flex max-w-full min-w-0 items-center gap-2 rounded-full py-0.5 pl-0.5 text-xs shadow-xs outline-none hover:ring-1 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring', named ? 'pr-2.5' : 'pr-0.5')}>
      <span className="inline-flex shrink-0" title={named ? undefined : t('Store {value1}', { value1: storeTitle(facts) })}>
        <StoreIcon family={facts.family} size="sm" className="[&>span]:size-6 [&>span]:rounded-full" />
      </span>
      {named && <span className="min-w-0 truncate font-medium" title={storeWhere(facts, t) ?? undefined}>{storeTitle(facts)}</span>}
    </button>
  )
}
