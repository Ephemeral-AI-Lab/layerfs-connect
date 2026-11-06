import { t, useI18n } from '@/i18n'
// The Stores a machine's Sandboxes can use (docs/ui/machines.md), one
// section with two tabs: the sqlite Stores pushed to its disk, and the
// PostgreSQL Stores its Sandboxes reach (every one, when the machine supports
// PostgreSQL Sandboxes; else LayerFS's reason). Each Store is a tile that
// opens on Storage, each project on its page; a project with a Sandbox here is
// marked. Nothing here pushes, pulls, moves or connects a Store.
import { ArrowRight, Ban } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { LfsStore } from '@/components/lfs-icons'
import { Segmented } from '@/components/motion/tabs'
import { JobChip } from '@/components/storage/job-progress'
import { Card } from '@/components/storage/overview/row-parts'
import { go } from '@/components/tabs/go'
import { bytes } from '@/data/format'
import { useStorageJobs } from '@/host/storage-jobs'
import { cn } from '@/lib/utils'
import type { MachineInfo, MachinePgStore, MachineStore, StorageJob, StoreFamily } from '@shared/host-api'

interface Props {
  /** The section heading's id. */
  id: string
  m: MachineInfo
  sqlite: MachineStore[]
  postgresql: MachinePgStore[]
  /** Project keys with a Sandbox on this machine. */
  running: Set<string>
  onOpenProject?: (key: string, tab?: string) => void
}

export function MachineData({ id, m, sqlite, postgresql, running, onOpenProject }: Props) {
  useI18n()
  const { jobs } = useStorageJobs()
  /** The job moving a Store onto or off this machine now. */
  const moving = (store: string) => jobs.find((j) => j.store === store && !j.ended && (j.target === m.name || j.from === m.name))
  const reach = m.supports?.postgresql_sandbox
  const [tab, setTab] = useState<StoreFamily>(sqlite.length === 0 && reach && postgresql.length > 0 ? 'postgresql' : 'sqlite')
  const open = (key: string) => (onOpenProject ? onOpenProject(key) : go.project(key))
  const pg = tab === 'postgresql'
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
        <h2 id={id} className="text-[13px] font-semibold tracking-tight">
          {t('Stores')}
        </h2>
        <Segmented
          role="tablist"
          aria-label={t('Store families')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sqlite', label: t('SQLite'), count: sqlite.length },
            { value: 'postgresql', label: t('PostgreSQL'), count: reach ? postgresql.length : undefined },
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground">{pg ? t('reachable from its Sandboxes') : t('pushed to this disk')}</span>
      </div>
      <Card index={1} role="tabpanel" aria-label={pg ? t('PostgreSQL') : t('SQLite')} className="p-2">
        {pg ? (
          reach === false || reach === undefined ? (
            <Blank icon={reach === false}>{reach === false ? (m.supports?.reason ?? t('This machine does not run PostgreSQL Sandboxes')) : t('This LayerFS does not say whether Sandboxes here reach PostgreSQL.')}</Blank>
          ) : postgresql.length === 0 ? (
            <Blank>{t('No PostgreSQL Store connected. Connect one from Storage.')}</Blank>
          ) : (
            <Tiles>
              {postgresql.map((s) => (
                <StoreTile key={s.name} name={s.name} size={null} names={s.names} running={running} onOpen={open} />
              ))}
            </Tiles>
          )
        ) : sqlite.length === 0 ? (
          <Blank>{t('No Store files here. Push one here from Storage.')}</Blank>
        ) : (
          <Tiles>
            {sqlite.map((s) => (
              <StoreTile key={s.name} name={s.name} size={s.size} names={s.names} running={running} onOpen={open} job={moving(s.name)} />
            ))}
          </Tiles>
        )}
      </Card>
    </section>
  )
}

function Tiles({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-1.5">{children}</ul>
}

function Blank({ icon, children }: { icon?: boolean; children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-start gap-2 px-2 py-1.5 text-[13px] text-muted-foreground">
      {icon && <Ban aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-faint" />}
      <span className="break-words">{children}</span>
    </p>
  )
}

/** A Store as a tile: its name (opens it on Storage) and size, then its projects, a dot on each with a Sandbox here. */
function StoreTile({ name, size, names, running, onOpen, job }: { name: string; size: number | null; names?: string[]; running: Set<string>; onOpen: (key: string) => void; job?: StorageJob }) {
  useI18n()
  return (
    <li className="group/row flex min-w-0 flex-col gap-0.5 rounded-xl bg-card/60 px-2.5 py-1.5 ring-1 ring-foreground/[0.06] transition-colors hover:bg-card hover:ring-foreground/10">
      <span className="flex min-w-0 items-center gap-2">
        <button type="button" onClick={() => go.store(name)} title={t('Show {store} on Storage', { store: name })} className="group/name inline-flex min-w-0 items-center gap-1.5 rounded-md text-[13px] font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
          <LfsStore className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
          <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-faint opacity-0 transition group-hover/row:opacity-100 group-hover/name:translate-x-0.5 group-hover/name:text-primary" />
        </button>
        {size != null && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{bytes(size)}</span>}
      </span>
      {job && <JobChip job={job} className="pl-5" />}
      {names && names.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[11.5px] text-muted-foreground">
          {names.map((p) => {
            const key = `${name}/${p}`
            const here = running.has(key)
            return (
              <button key={p} type="button" onClick={() => onOpen(key)} title={here ? t('{project} runs here', { project: p }) : t('Open {project}', { project: p })} className={cn('inline-flex items-center gap-1 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring', here && 'text-foreground/85')}>
                {here && <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />}
                {p}
              </button>
            )
          })}
        </span>
      )}
    </li>
  )
}
