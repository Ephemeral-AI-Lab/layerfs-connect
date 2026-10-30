// A project's Store as the Projects screens show it (layerfs#506, #509): which
// Store holds it, its family, where it syncs, its sync state and its size.
// One cached Storage view feeds every card, header and dialog; it is read
// again when the host says Storage changed, a sync job ends, or a project
// or Store is made or removed. A LayerFS build without Stores answers no
// view (or one with stores unavailable): the facts then fall back to the
// project summary, and the badge reads "Local SQLite".
import { useSyncExternalStore } from 'react'
import { projectRef, type ProjectSummary, type RemoteProvider, type StorageView, type StoreFamily, type StoreInfo, type StoreLink, type StoreSyncState } from '@shared/host-api'

import { StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { bytes } from '@/data/format'
import { host, onHostEvent, onProjectsChanged } from '@/host/client'
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

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!detach) {
    const offEvents = onHostEvent((event) => {
      if (event.type === 'storage' || (event.type === 'sync' && event.job.ended)) load()
    })
    const offProjects = onProjectsChanged(load)
    detach = () => { offEvents(); offProjects() }
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

/** The local SQLite Stores a new project can go into, or null when the LayerFS build has no Stores. */
export function localStores(storage: StorageView | null | undefined): StoreInfo[] | null {
  return storage?.stores.available ? storage.stores.list.filter((store) => store.kind === 'sqlite') : null
}

/** Whether a summary is the project with this key; a host without keys matches by name. */
export function isProject(project: ProjectSummary, key: string): boolean {
  return project.key === undefined ? project.name === projectRef(key).name : project.key === key
}

// ---------- one project's Store ----------

export interface StoreFacts {
  /** The Store's name; null with a LayerFS build from before Stores. */
  name: string | null
  family: StoreFamily
  /** The provider of the Store's link, for StoreIcon. */
  providers: RemoteProvider[]
  sync: StoreSyncState | null
  /** Bytes on disk (SQLite file and WAL, or the PostgreSQL schema); null when unknown. */
  size: number | null
  link: StoreLink | null
  /** A PostgreSQL Store's connection. */
  connection: string | null
  /** Other projects share the Store. */
  shared: boolean
  /** The Store's other projects, when the view lists them. */
  others: string[]
}

export function storeFacts(project: ProjectSummary, storage: StorageView | null | undefined): StoreFacts {
  const info = project.store ? storage?.stores.list.find((store) => store.name === project.store) : undefined
  const family = info?.kind ?? project.kind ?? 'sqlite'
  const others = info?.projects.filter((name) => name !== project.name) ?? []
  return {
    name: project.store ?? null,
    family,
    providers: info ? storeProviders(info, storage?.remotes.list) : (project.storeProviders ?? []),
    sync: info?.sync.state ?? project.storeSync ?? null,
    size: info ? (info.size?.bytes ?? info.bytes ?? null) : null,
    link: info?.link ?? null,
    connection: info?.connection ?? project.connection ?? null,
    shared: !!project.shared || others.length > 0,
    others,
  }
}

/** Where the Store lives: its link (connection / file), "Local only", or its PostgreSQL connection. */
function storeWhere(facts: StoreFacts, t: (source: string, values?: Record<string, string>) => string): string | null {
  if (facts.family === 'postgresql') return facts.connection ? t('on {connection}', { connection: facts.connection }) : null
  if (facts.link) return `${facts.link.remote} / ${facts.link.file}`
  return facts.name ? t('Local only') : null
}

/** The Store's name as a title: its name, else its family. */
function storeTitle(facts: StoreFacts, t: (source: string) => string): string {
  return facts.name ?? (facts.family === 'postgresql' ? 'PostgreSQL' : t('Local SQLite'))
}

/** A project's Store in one line: its mark, its name, where it syncs and its size, then its sync state. */
export function StoreLine({ facts, className }: { facts: StoreFacts; className?: string }) {
  const { t } = useI18n()
  const where = storeWhere(facts, t)
  const detail = [where, facts.size !== null ? bytes(facts.size) : null].filter(Boolean).join(' · ')
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-2.5 rounded-xl bg-foreground/[0.03] px-2.5 py-2 ring-1 ring-foreground/[0.05] ring-inset', className)}>
      <StoreIcon family={facts.family} providers={facts.providers} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium" title={facts.name ?? undefined}>{storeTitle(facts, t)}</span>
        {detail && <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground" title={facts.link?.object ?? detail}>{detail}</span>}
      </span>
      {facts.sync && <SyncPill state={facts.sync} copy={facts.link} compact className="shrink-0" />}
    </span>
  )
}

/** A project's Store as a pill beside its title: mark, name and sync state. */
export function StoreBadge({ facts }: { facts: StoreFacts }) {
  const { t } = useI18n()
  return (
    <span className="glass-liquid inline-flex max-w-full min-w-0 items-center gap-2 rounded-full py-0.5 pr-1 pl-0.5 text-xs shadow-xs">
      <StoreIcon family={facts.family} providers={facts.providers} size="sm" className="[&>span]:size-6 [&>span]:rounded-full" />
      <span className="min-w-0 truncate font-medium" title={storeWhere(facts, t) ?? undefined}>{storeTitle(facts, t)}</span>
      {facts.sync ? <SyncPill state={facts.sync} copy={facts.link} compact className="shrink-0" /> : <span className="pr-1.5" />}
    </span>
  )
}
