// The machine page's Stores tab (docs/connect/README.md, "Machine page"): the
// Stores its Sandboxes can use, as the Storage page's Store cards with their
// project tiles, bare (no Push, Pull, Back up, menu or Add project: those
// are on Storage). A sqlite Store pushed to its disk, and the PostgreSQL
// Stores its Sandboxes reach (every one, when the machine runs PostgreSQL
// Sandboxes; else LayerFS's reason, once, under them). Each card opens its
// Store; each tile its project. Until the Storage view is read, one list
// with each Store's projects as links.
import { ArrowRight, Ban } from 'lucide-react'
import type { ReactNode } from 'react'

import { LfsStore } from '@/components/layerfs/LfsIcons'
import { useProjectRows } from '@/layerfs/project-rows'
import { useStorageView } from '@/components/layerfs/StoreFacts'
import { StoreSection } from '@/pages/storage/StoreSection'
import { JobChip } from '@/pages/storage/JobProgress'
import { Card } from '@/pages/storage/RowParts'
import { go } from '@/layerfs/go'
import { bytes } from '@/layerfs/format'
import { useProjects } from '@/layerfs/use-projects'
import { useStorageJobs } from '@/layerfs/storage-jobs'
import { cn } from '@/lib/utils'
import type { MachineInfo, MachinePgStore, MachineStore, StorageJob } from '@/layerfs/host-api'

interface Props {
  m: MachineInfo
  sqlite: MachineStore[]
  postgresql: MachinePgStore[]
  /** Project keys with a Sandbox on this machine. */
  running: Set<string>
  onOpenProject?: (key: string, tab?: string) => void
}

/** How many Stores the machine's Sandboxes can use: its own sqlite ones and the PostgreSQL ones they reach. */
export function machineStoreCount(m: MachineInfo, sqlite: MachineStore[], postgresql: MachinePgStore[]): number {
  return sqlite.length + (m.supports?.postgresql_sandbox ? postgresql.length : 0)
}

export function MachineData({ m, sqlite, postgresql, running, onOpenProject }: Props) {
  const { jobs } = useStorageJobs()
  const liveStorage = useStorageView()
  const storage = liveStorage
  const rows = useProjectRows(useProjects())
  /** The job moving a Store onto or off this machine now. */
  const moving = (store: string) => jobs.find((j) => j.store === store && !j.ended && (j.target === m.name || j.from === m.name))
  const reach = m.supports?.postgresql_sandbox
  const pg = reach ? postgresql : []
  const open = (key: string) => (onOpenProject ? onOpenProject(key) : go.project(key))
  const note =
    reach === false
      ? (m.supports?.reason ?? 'This machine does not run PostgreSQL Sandboxes')
      : reach === undefined && postgresql.length > 0
        ? 'This LayerFS does not say whether Sandboxes here reach PostgreSQL.'
        : null
  const names = [...sqlite.map((s) => s.name), ...pg.map((s) => s.name)]
  // the Storage page's Store cards, bare: the Store and its projects, no moves (those are on Storage)
  const cards = storage ? names.flatMap((n) => storage.stores.filter((s) => s.name === n)) : null
  const noteLine = note && (
    <Blank icon={reach === false} className="text-sm">
      {`PostgreSQL Stores: ${note}`}
    </Blank>
  )

  if (names.length === 0)
    return (
      <Card index={1} className="flex flex-col p-1.5">
        <Blank>{'No Store files here. Push one here from Storage.'}</Blank>
        {noteLine && <div className="border-t border-foreground/[0.06]">{noteLine}</div>}
      </Card>
    )

  if (cards && cards.length === names.length)
    return (
      <div className="flex flex-col gap-4">
        {cards.map((s, i) => (
          <StoreSection
            key={s.name}
            index={Math.min(i + 1, 12)}
            store={s}
            machine={storage!.machines.find((x) => x.name === s.machine)}
            buckets={storage!.buckets}
            job={moving(s.name)}
            projects={s.projects.map((name) => ({ key: `${s.name}/${name}`, name, row: rows.byKey.get(`${s.name}/${name}`) }))}
            searching={false}
            now={rows.now}
            findings={[]}
            onOpenProject={open}
            onOpen={() => go.store(s.name)}
          />
        ))}
        {noteLine && <div className="px-1">{noteLine}</div>}
      </div>
    )

  // before the Storage view is read: one list, each Store with its projects as links
  return (
    <Card index={1} className="flex flex-col p-1.5">
      <ul className="flex flex-col divide-y divide-foreground/[0.06]">
        {sqlite.map((s) => (
          <StoreRow key={s.name} name={s.name} kind={'SQLite'} where={'on this disk'} size={s.size} names={s.names} running={running} onOpen={open} job={moving(s.name)} />
        ))}
        {pg.map((s) => (
          <StoreRow key={s.name} name={s.name} kind={'PostgreSQL'} where={'reached by its Sandboxes'} size={null} names={s.names} running={running} onOpen={open} />
        ))}
      </ul>
      {noteLine && <div className="border-t border-foreground/[0.06]">{noteLine}</div>}
    </Card>
  )
}

function Blank({ icon, className, children }: { icon?: boolean; className?: string; children: ReactNode }) {
  return (
    <p className={cn('flex min-w-0 items-start gap-2 px-2.5 py-2 text-md text-muted-foreground', className)}>
      {icon && <Ban aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-faint" />}
      <span className="break-words">{children}</span>
    </p>
  )
}

/** A Store as a row: its name (opens it on Storage), its kind and where it lives, its size; then its projects as links. */
function StoreRow({ name, kind, where, size, names, running, onOpen, job }: { name: string; kind: string; where: string; size: number | null; names?: string[]; running: Set<string>; onOpen: (key: string) => void; job?: StorageJob }) {
  return (
    <li className="group/row flex min-w-0 flex-col gap-1 px-2.5 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={() => go.store(name)} title={`Show ${name} on Storage`} className="group/name inline-flex min-w-0 items-center gap-1.5 rounded-sm text-md font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
          <LfsStore className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
          <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-faint opacity-0 transition group-hover/row:opacity-100 group-hover/name:translate-x-0.5 group-hover/name:text-primary" />
        </button>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {kind} · {where}
        </span>
        {size != null && <span className="ml-auto shrink-0 text-xs leading-chat text-muted-foreground tabular-nums">{bytes(size)}</span>}
      </span>
      {job && <JobChip job={job} className="pl-5" />}
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-sm text-muted-foreground">
        {names && names.length > 0 ? (
          names.map((p) => {
            const key = `${name}/${p}`
            const here = running.has(key)
            return (
              <button key={p} type="button" onClick={() => onOpen(key)} title={here ? `${p} runs here` : `Open ${p}`} className={cn('inline-flex items-center gap-1.5 rounded-xs underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring', here && 'text-foreground/85')}>
                {here && <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />}
                {p}
                {here && <span className="text-xs text-muted-foreground">{'Sandbox running'}</span>}
              </button>
            )
          })
        ) : (
          <span className="text-faint">{'No projects'}</span>
        )}
      </span>
    </li>
  )
}
