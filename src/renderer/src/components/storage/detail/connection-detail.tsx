// A PostgreSQL connection's page (storage-redesign §3.5): its health, its
// Stores, and synchronous_commit. The URL, password included, stays in Connect.
import { DatabaseZap, RefreshCw, TriangleAlert, Unplug } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Gone, Section } from '@/components/storage/detail/parts'
import { SYNC } from '@/components/storage/dialogs/provider-forms'
import { FamilyTile, StoreIcon } from '@/components/storage/identity/store-icon'
import { Notice } from '@/components/storage/notice'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { FromLink } from '@/components/storage/overview/postgresql-store-row'
import { SizeText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/data/format'

const GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_5.5rem_minmax(0,1fr)_6rem] items-center gap-x-4 @max-[759px]/storage:grid-cols-[minmax(0,1fr)_auto]'

export function ConnectionDetail({ name }: { name: string }) {
  const s = useStorage()
  const c = s.view.postgresql.connections.find((x) => x.name === name)
  if (!c)
    return (
      <>
        <Breadcrumb items={[{ label: 'PostgreSQL' }, { label: name, mono: true }]} />
        <Gone what={name} />
      </>
    )
  const h = c.health
  const down = h.state === 'unreachable' || h.state === 'denied'
  const stores = s.view.stores.list.filter((x) => x.kind === 'postgresql' && x.connection === c.name).sort((a, b) => a.name.localeCompare(b.name))
  const forget = () => s.remove({ kind: 'connection', name: c.name, stores: stores.length })
  const check = () => void s.check({ connection: c.name })
  return (
    <>
      <Breadcrumb items={[{ label: 'PostgreSQL' }, { label: c.name, mono: true }]} />
      <DetailHeader
        icon={<FamilyTile family="postgresql" size="lg" />}
        eyebrow="PostgreSQL connection"
        title={<span className="font-mono">{c.name}</span>}
        badges={
          <span className="flex flex-wrap items-center gap-x-2.5 text-xs text-muted-foreground">
            <HealthDot health={h} />
            {h.serverVersion && <span>PostgreSQL {h.serverVersion}</span>}
            {h.latencyMs !== null && <span className="tabular-nums">{Math.round(h.latencyMs)} ms</span>}
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => s.importInto({ connection: c.name })}>
              <DatabaseZap /> Import a SQLite Store…
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <MoreButton label={`More for ${c.name}`} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {s.view.supports.postgresqlStatus && (
                  <DropdownMenuItem onSelect={check}>
                    <RefreshCw className="text-muted-foreground" /> Check now
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={forget}>
                  <Unplug /> Forget…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <p className="truncate font-mono text-[12px]" title={c.url}>
          {c.url}
        </p>
        <p className="tabular-nums">
          {count(stores.length, 'Store')}
          {c.bytes !== null && ` · ${bytes(c.bytes)}`} · synchronous_commit {c.synchronousCommit}
          {h.at && ` · checked ${ago(h.at)}`}
        </p>
      </DetailHeader>

      {down && (
        <Notice
          tone={h.state === 'denied' ? 'danger' : 'warning'}
          icon={h.state === 'denied' ? Unplug : TriangleAlert}
          title={h.state === 'denied' ? `${c.name} refused Connect${h.message ? `: ${h.message}` : ''}` : `${c.name} is not answering${h.message ? `: ${h.message}` : ''}`}
          actions={
            <Button size="sm" variant="outline" onClick={check} disabled={s.checking}>
              <RefreshCw className={s.checking ? 'animate-spin' : undefined} /> Check again
            </Button>
          }
        >
          {h.state === 'denied' ? 'Forget it and add it again to change the URL.' : `Its ${count(stores.length, 'Store')} can’t be opened until it is.`}
        </Notice>
      )}

      <Section index={2} title="Stores here">
        <div role="table" aria-label={`Stores in ${c.name}`} className="mt-3">
          <div role="rowgroup">
            <div role="row" className={`${GRID} border-y bg-muted/25 px-5 py-2 text-[11px] font-medium tracking-[0.04em] text-faint uppercase @max-[759px]/storage:hidden`}>
              <span role="columnheader">Store</span>
              <span role="columnheader">Schema</span>
              <span role="columnheader">Projects</span>
              <span role="columnheader" className="text-right">
                Size
              </span>
              <span role="columnheader">From</span>
              <span role="columnheader">Created</span>
            </div>
          </div>
          <div role="rowgroup" className="divide-y divide-border/70">
            {stores.map((x) => (
              <div key={x.name} role="row" className={`${GRID} px-5 py-2.5`}>
                <span role="rowheader" className="flex min-w-0 items-center gap-2.5">
                  <StoreIcon family="postgresql" size="sm" />
                  <button type="button" onClick={() => s.open({ view: 'store', id: x.name })} className="truncate rounded-sm text-[13.5px] font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                    {x.name}
                  </button>
                </span>
                <span role="cell" className="truncate font-mono text-[12px] text-muted-foreground @max-[759px]/storage:hidden">
                  {x.schema ?? '—'}
                </span>
                <span role="cell" className="text-[13px] text-muted-foreground tabular-nums @max-[759px]/storage:hidden">
                  {x.projects.length}
                </span>
                <span role="cell" className="text-right text-[13px]">
                  <SizeText store={x} reason={down ? `${c.name} is not answering` : undefined} />
                </span>
                <span role="cell" className="min-w-0 @max-[759px]/storage:hidden">
                  <FromLink store={x} />
                </span>
                <span role="cell" className="text-[13px] text-muted-foreground tabular-nums @max-[759px]/storage:hidden" title={when(x.created)}>
                  {x.created ? ago(x.created) : '—'}
                </span>
              </div>
            ))}
            {!stores.length && <p className="px-5 py-5 text-[13px] text-muted-foreground">No Stores yet. Import a SQLite Store into it.</p>}
          </div>
        </div>
      </Section>

      <Section index={3} title="Settings">
        <div className="px-5 pt-3 pb-4 text-[13px]">
          <p>
            <span className="font-mono">synchronous_commit</span> <span className="font-mono font-medium">{c.synchronousCommit}</span>
            <span className="text-muted-foreground"> · {SYNC.find((x) => x.value === c.synchronousCommit)?.about}</span>
          </p>
          <p className="mt-1 text-xs text-faint">Set when the connection is added. To change it, forget the connection and add it again.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">The URL, password included, stays in Connect (your user only). On macOS the LayerFS box reaches this machine’s localhost as host.docker.internal.</p>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={forget}>
            <Unplug /> Forget…
          </Button>
        </div>
      </Section>
    </>
  )
}
