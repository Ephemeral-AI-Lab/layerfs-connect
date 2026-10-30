// What the linked LayerFS build can do with storage (storage-redesign §10.4):
// shown on the overview when any part of the storage view is unavailable.
// One glass card names each part (shared Stores, buckets, PostgreSQL), whether
// this build has it, and why not in the build's own words, then says what
// still works, so a missing button never looks like a fault.
import { CircleCheck, Clock, Cloud, Database, HardDrive, Layers, type LucideIcon } from 'lucide-react'

import { useStorage } from '@/components/storage/actions'
import { Chip } from '@/components/storage/chips'
import { Tile } from '@/components/storage/icons'
import { Card } from '@/components/storage/overview/row-parts'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface Part {
  icon: LucideIcon
  title: string
  gives: string
  available: boolean
  reason: string | null
}

function PartRow({ part }: { part: Part }) {
  const Icon = part.icon
  return (
    <li className="flex min-w-0 items-start gap-3.5 px-5 py-3.5">
      <span className={cn(!part.available && 'sc-soon-mark')}>
        <Tile size="md" className={part.available ? 'text-primary' : undefined}>
          <Icon aria-hidden="true" />
        </Tile>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-semibold tracking-tight">{t(part.title)}</h3>
          {part.available ? (
            <Chip tone="success" icon={CircleCheck}>
              {t('Available')}
            </Chip>
          ) : (
            <Chip tone="neutral" icon={Clock} dashed>
              {t('Not in this build')}
            </Chip>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{t(part.gives)}</p>
        {!part.available && part.reason && <p className="mt-1 font-mono text-[11px] break-words text-muted-foreground/90">{part.reason}</p>}
      </div>
    </li>
  )
}

export function Capabilities({ index = 0 }: { index?: number }) {
  useI18n()
  const { view } = useStorage()
  const parts: Part[] = [
    { icon: Layers, title: 'Shared Stores', gives: 'Several projects in one Store: New Store, Add project, Remove Store.', available: view.stores.available, reason: view.stores.reason },
    { icon: Cloud, title: 'Buckets (MinIO, Cloudflare R2)', gives: 'Publish, push, pull, send and load whole Store files; each Store links to at most one file.', available: view.remotes.available, reason: view.remotes.reason },
    { icon: Database, title: 'PostgreSQL', gives: 'Stores that live in a database: add connections and import SQLite Stores into them.', available: view.postgresql.available, reason: view.postgresql.reason },
  ]
  if (parts.every((p) => p.available)) return null
  const none = parts.every((p) => !p.available)
  return (
    <Card aria-labelledby="capabilities-h" index={index} className="overflow-hidden">
      <header className="flex items-start gap-3.5 px-5 pt-5 pb-4">
        <span className="glass-strong flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 text-primary shadow-xs">
          <HardDrive aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="capabilities-h" className="text-[15px] font-semibold tracking-tight">
            {none ? t('This LayerFS build keeps one Store per project') : t('Some storage features aren’t in this LayerFS build')}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground text-pretty">
            {t('Connect shows what the linked LayerFS build reports. The parts marked below arrive with a newer build; nothing is wrong with your projects or their history.')}
          </p>
        </div>
      </header>
      <ul className="divide-y divide-foreground/[0.06] border-y border-foreground/[0.06]">
        {parts.map((p) => (
          <PartRow key={p.title} part={p} />
        ))}
      </ul>
      <p className="flex items-start gap-2 px-5 py-3 text-xs text-muted-foreground">
        <CircleCheck aria-hidden="true" className="mt-px size-3.5 shrink-0 text-success" />
        <span className="text-pretty">{t('Works now: every project keeps its own SQLite Store in a Docker volume, listed below with this machine’s disk and the LayerFS box.')}</span>
      </p>
    </Card>
  )
}
