// A PostgreSQL connection's page (storage-redesign §3.5): its health, its
// Stores, and synchronous_commit. The URL, password included, stays in Connect.
import { DatabaseZap, RefreshCw, TriangleAlert, Unplug } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Gone, Section, TABLE_HEAD } from '@/components/storage/detail/parts'
import { SYNC } from '@/components/storage/dialogs/provider-forms'
import { FamilyTile, StoreIcon } from '@/components/storage/identity/store-icon'
import { Notice } from '@/components/storage/notice'
import { FromLink } from '@/components/storage/overview/postgresql-store-row'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { SizeText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/data/format'
import { t, useI18n } from '@/i18n'

const GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_5.5rem_minmax(0,1fr)_6rem] items-center gap-x-4 @max-[759px]/storage:grid-cols-[minmax(0,1fr)_auto]'

export function ConnectionDetail({ name }: { name: string }) {
  useI18n()
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
  const notAnswering = down ? t('{name} is not answering', { name: c.name }) : undefined
  return (
    <>
      <Breadcrumb items={[{ label: 'PostgreSQL' }, { label: c.name, mono: true }]} />
      <DetailHeader
        icon={<FamilyTile family="postgresql" size="lg" />}
        eyebrow={t('PostgreSQL connection')}
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
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => s.importInto({ connection: c.name })}>
              <DatabaseZap /> {t('Import a SQLite Store…')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <MoreButton label={t('More for {name}', { name: c.name })} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-xl">
                {s.view.supports.postgresqlStatus && (
                  <>
                    <DropdownMenuItem onSelect={check}>
                      <RefreshCw className="text-muted-foreground" /> {t('Check now')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem variant="destructive" onSelect={forget}>
                  <Unplug /> {t('Forget…')}
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
          {[count(stores.length, 'Store'), c.bytes !== null ? bytes(c.bytes) : null, `synchronous_commit ${c.synchronousCommit}`, h.at ? t('checked {ago}', { ago: ago(h.at) }) : null].filter(Boolean).join(' · ')}
        </p>
      </DetailHeader>

      {down && (
        <Notice
          tone={h.state === 'denied' ? 'danger' : 'warning'}
          icon={h.state === 'denied' ? Unplug : TriangleAlert}
          title={`${t(h.state === 'denied' ? '{name} refused Connect' : '{name} is not answering', { name: c.name })}${h.message ? `: ${h.message}` : ''}`}
          actions={
            <Button size="sm" variant="outline" className="rounded-xl" onClick={check} disabled={s.checking}>
              <RefreshCw className={s.checking ? 'motion-safe:animate-spin' : undefined} /> {t('Check again')}
            </Button>
          }
        >
          {h.state === 'denied' ? t('Forget it and add it again to change the URL.') : t('Its {stores} can’t be opened until it is.', { stores: count(stores.length, 'Store') })}
        </Notice>
      )}

      <Section index={2} title={t('Stores here')}>
        <div role="table" aria-label={t('Stores in {name}', { name: c.name })} className="mt-3">
          <div role="rowgroup">
            <div role="row" className={`${GRID} ${TABLE_HEAD}`}>
              <span role="columnheader">{t('Store')}</span>
              <span role="columnheader">{t('Schema')}</span>
              <span role="columnheader">{t('Projects')}</span>
              <span role="columnheader" className="text-right">
                {t('Size')}
              </span>
              <span role="columnheader">{t('From')}</span>
              <span role="columnheader">{t('Created')}</span>
            </div>
          </div>
          <div role="rowgroup" className="stagger divide-y divide-foreground/[0.06]">
            {stores.map((x) => (
              <div key={x.name} role="row" className={`${GRID} px-5 py-3 transition-colors hover:bg-foreground/[0.025]`}>
                <span role="rowheader" className="flex min-w-0 items-center gap-3">
                  <StoreIcon family="postgresql" size="sm" />
                  <button type="button" onClick={() => s.open({ view: 'store', id: x.name })} className="truncate rounded-md text-[13.5px] font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
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
                  <SizeText store={x} reason={notAnswering} />
                </span>
                <span role="cell" className="min-w-0 @max-[759px]/storage:hidden">
                  <FromLink store={x} />
                </span>
                <span role="cell" className="text-[13px] text-muted-foreground tabular-nums @max-[759px]/storage:hidden" title={when(x.created)}>
                  {x.created ? ago(x.created) : '—'}
                </span>
              </div>
            ))}
            {!stores.length && <p className="px-5 py-6 text-[13px] text-muted-foreground">{t('No Stores yet. Import a SQLite Store into it.')}</p>}
          </div>
        </div>
      </Section>

      <Section index={3} title={t('Settings')}>
        <div className="px-5 pt-3 pb-4 text-[13px]">
          <p>
            <span className="font-mono">synchronous_commit</span> <span className="font-mono font-semibold">{c.synchronousCommit}</span>
            <span className="text-muted-foreground"> · {t(SYNC.find((x) => x.value === c.synchronousCommit)?.about ?? '')}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('Set when the connection is added. To change it, forget the connection and add it again.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.06] px-5 py-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('The URL, password included, stays in Connect (your user only). On macOS the LayerFS box reaches this machine’s localhost as host.docker.internal.')}</p>
          <Button size="sm" variant="outline" className="rounded-xl text-destructive hover:text-destructive" onClick={forget}>
            <Unplug /> {t('Forget…')}
          </Button>
        </div>
      </Section>
    </>
  )
}
