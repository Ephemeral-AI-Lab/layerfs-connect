// A bucket connection's page (storage-links §3.3, layerfs#509): one bucket on
// one provider, binding no Store. Its files (from the last listing): each
// linked to a Store of this machine (Open) or not loaded (Load…). Remove is
// refused while a Store links here. A connection can't be edited: remove it
// and add it again.
import { Download, ExternalLink, KeyRound, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { Chip } from '@/components/storage/chips'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Fact, Gone, Section, TABLE_HEAD } from '@/components/storage/detail/parts'
import { providerLabel } from '@/components/storage/identity/providers'
import { ProviderTile, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { Notice } from '@/components/storage/notice'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/data/format'
import { t, useI18n } from '@/i18n'
import type { RemoteFile, RemoteInfo } from '@shared/host-api'

const GRID = 'grid grid-cols-[minmax(0,1fr)_5.5rem_7rem_minmax(0,1.2fr)_minmax(6rem,auto)] items-center gap-x-4 @max-[759px]/storage:grid-cols-[minmax(0,1fr)_auto]'

/** One file in the bucket: linked to a Store of this machine, or not loaded. */
function FileRow({ remote, file }: { remote: RemoteInfo; file: RemoteFile }) {
  const s = useStorage()
  const store = file.linkedBy ? s.view.stores.list.find((x) => x.name === file.linkedBy) : undefined
  return (
    <div role="row" className={`${GRID} px-5 py-3 transition-colors hover:bg-foreground/[0.025]`}>
      <span role="rowheader" className="truncate font-mono text-[13px] font-semibold">
        {file.file}
      </span>
      <span role="cell" className="text-right text-[13px] tabular-nums @max-[759px]/storage:hidden">
        {file.bytes !== null ? bytes(file.bytes) : <span className="text-faint">—</span>}
      </span>
      <span role="cell" className="text-[13px] text-muted-foreground tabular-nums @max-[759px]/storage:hidden" title={when(file.modified)}>
        {file.modified ? ago(file.modified) : '—'}
      </span>
      <span role="cell" className="min-w-0 @max-[759px]/storage:hidden">
        {file.linkedBy ? (
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            {store && <StoreIcon family="sqlite" providers={storeProviders(store, s.view.remotes.list)} size="sm" />}
            <span className="truncate">
              {t('Linked to')} {file.linkedBy}
            </span>
            {store?.link && <SyncPill state={store.sync.state} copy={store.link} compact />}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">{t('Not loaded')}</span>
        )}
      </span>
      <span role="cell" className="flex justify-end gap-1.5">
        {file.linkedBy ? (
          <Button size="xs" variant="outline" className="rounded-lg" onClick={() => s.open({ view: 'store', id: file.linkedBy! })} aria-label={t('Open {name}', { name: file.linkedBy })}>
            <ExternalLink /> {t('Open')}
          </Button>
        ) : (
          <Button size="xs" variant="outline" className="rounded-lg" onClick={() => s.load({ remote: remote.name, file: file.file })} disabled={!remote.hasSecret} aria-label={t('Load {name}', { name: file.file })}>
            <Download /> {t('Load…')}
          </Button>
        )}
      </span>
    </div>
  )
}

/** The bucket's files: the last listing, plus linked files it doesn't name (not listed yet). */
export function filesOf(remote: RemoteInfo, stores: { name: string; link: { remote: string; file: string; check: { bytes: number | null; modified: number | null } | null } | null }[]): RemoteFile[] {
  const listed = remote.files ?? []
  const linked = stores.filter((x) => x.link?.remote === remote.name && !listed.some((f) => f.file === x.link!.file))
  return [...listed, ...linked.map((x) => ({ file: x.link!.file, bytes: x.link!.check?.bytes ?? null, modified: x.link!.check?.modified ?? null, linkedBy: x.name }))].sort((a, b) => a.file.localeCompare(b.file))
}

function FilesHere({ remote }: { remote: RemoteInfo }) {
  const s = useStorage()
  const files = filesOf(remote, s.view.stores.list)
  return (
    <Section
      index={2}
      title={t('Files in this bucket')}
      note={t('SQLite Store files. Each is linked to one Store of this machine, or not loaded.')}
      aside={
        s.view.supports.listCopies && (
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => void s.check({ remote: remote.name })} disabled={s.checking}>
            <RefreshCw className={s.checking ? 'motion-safe:animate-spin' : undefined} /> {t('Check now')}
          </Button>
        )
      }
    >
      <div role="table" aria-label={t('Files in {name}', { name: remote.name })} className="mt-3">
        <div role="rowgroup">
          <div role="row" className={`${GRID} ${TABLE_HEAD}`}>
            <span role="columnheader">{t('File')}</span>
            <span role="columnheader" className="text-right">
              {t('Size')}
            </span>
            <span role="columnheader">{t('Modified')}</span>
            <span role="columnheader">{t('On this machine')}</span>
            <span role="columnheader">
              <span className="sr-only">{t('Action')}</span>
            </span>
          </div>
        </div>
        <div role="rowgroup" className="stagger divide-y divide-foreground/[0.06]">
          {files.map((f) => (
            <FileRow key={f.file} remote={remote} file={f} />
          ))}
          {!files.length && remote.files !== null && <p className="px-5 py-6 text-[13px] text-muted-foreground">{t('No LayerFS Stores here yet. Publish a Store to this connection from its page.')}</p>}
        </div>
      </div>
      {remote.files === null && (
        <p className="border-t border-foreground/[0.06] px-5 py-3 text-xs text-muted-foreground">{remote.hasSecret ? t('Not listed yet: Check now lists the bucket.') : t('Connect has no keys to list this bucket.')}</p>
      )}
    </Section>
  )
}

export function BucketDetail({ name }: { name: string }) {
  useI18n()
  const s = useStorage()
  const remote = s.view.remotes.list.find((r) => r.name === name)
  if (!remote)
    return (
      <>
        <Breadcrumb items={[{ label: t('Connections') }, { label: name }]} />
        <Gone what={name} />
      </>
    )
  const label = providerLabel(remote.provider)
  const h = remote.health
  const down = h.state === 'unreachable' || h.state === 'denied'
  const remove = () => s.remove({ kind: 'remote', name: remote.name })
  const where = [remote.endpoint, remote.bucket, remote.prefix].filter(Boolean).join(' / ')
  const linkedBy = remote.stores.length ? t('Linked by {stores}: unlink them first', { stores: remote.stores.join(', ') }) : undefined
  return (
    <>
      <Breadcrumb items={[{ label: t('Connections') }, { label: remote.name }]} />
      <DetailHeader
        icon={<ProviderTile provider={remote.provider} size="lg" />}
        eyebrow={`${t('Connection')} · ${label}`}
        title={remote.name}
        badges={
          <>
            {remote.hasSecret && <HealthDot health={h} />}
            <Chip tone={remote.hasSecret ? 'success' : 'warning'} icon={KeyRound}>
              {remote.hasSecret ? t('Keys saved') : t('No keys in Connect')}
            </Chip>
            {remote.jurisdiction && <Chip tone="neutral">{remote.jurisdiction.toUpperCase()}</Chip>}
          </>
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MoreButton label={t('More for {name}', { name: remote.name })} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-xl">
              {s.view.supports.listCopies && (
                <>
                  <DropdownMenuItem onSelect={() => void s.check({ remote: remote.name })}>
                    <RefreshCw className="text-muted-foreground" /> {t('Check now')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem variant="destructive" onSelect={remove} disabled={remote.stores.length > 0}>
                <Trash2 /> {t('Remove…')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <p className="truncate font-mono text-[12px]" title={where}>
          {where}
        </p>
        {remote.provider === 'minio' && remote.reachAs && remote.reachAs !== remote.endpoint && <p className="text-muted-foreground/90">{t('The LayerFS box reaches it as {host}', { host: remote.reachAs })}</p>}
        <p className="tabular-nums">
          {[
            remote.files ? count(remote.files.length, 'file') : t('files not listed yet'),
            remote.bytes !== null ? bytes(remote.bytes) : null,
            remote.stores.length ? t('{stores} linked here', { stores: count(remote.stores.length, 'Store') }) : t('no Store linked here'),
            h.at ? t('checked {ago}', { ago: ago(h.at) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </DetailHeader>

      {!remote.hasSecret && (
        <Notice tone="warning" icon={KeyRound} title={t('Connect has no keys for {name}', { name: remote.name })}>
          {t('So it can’t list, check, publish, push, pull or load. Remove it and add it again with keys.')}
        </Notice>
      )}
      {remote.hasSecret && down && (
        <Notice
          tone="warning"
          icon={TriangleAlert}
          title={t(h.state === 'denied' ? '{name} refused the keys' : '{name} is not answering', { name: remote.name })}
          actions={
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void s.check({ remote: remote.name })} disabled={s.checking}>
              <RefreshCw className={s.checking ? 'motion-safe:animate-spin' : undefined} /> {t('Check again')}
            </Button>
          }
        >
          {h.message ?? t('The last check failed.')} {t('Linked Stores keep their last known state.')}
        </Notice>
      )}

      <FilesHere remote={remote} />

      <Section index={3} title={t('Settings')} note={t('What LayerFS and Connect keep for this connection. It binds no Store. To change it, remove it and add it again.')}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 pt-4 pb-4 @min-[760px]/storage:grid-cols-4">
          <Fact label={t('Name')}>
            {remote.name}
          </Fact>
          <Fact label={t('Provider')}>{label}</Fact>
          {remote.provider === 'r2' ? (
            <>
              <Fact label={t('Account')} mono title={remote.account ?? undefined}>
                {remote.account ? `${remote.account.slice(0, 4)}…${remote.account.slice(-2)}` : '—'}
              </Fact>
              <Fact label={t('Jurisdiction')}>{remote.jurisdiction ? remote.jurisdiction.toUpperCase() : t('None')}</Fact>
            </>
          ) : (
            <Fact label={t('Endpoint')} mono title={remote.endpoint}>
              {remote.endpoint}
            </Fact>
          )}
          <Fact label={t('Bucket')}>
            {remote.bucket}
          </Fact>
          <Fact label={t('Prefix')} mono>
            {remote.prefix || '—'}
          </Fact>
        </dl>
        <div className="flex flex-wrap items-center gap-3 border-t border-foreground/[0.06] px-5 py-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{remote.hasSecret ? t('Keys saved in Connect, readable by your user only.') : t('No keys in Connect.')}</p>
          <Button size="sm" variant="outline" className="rounded-xl text-destructive hover:text-destructive" onClick={remove} disabled={remote.stores.length > 0} title={linkedBy}>
            <Trash2 /> {t('Remove…')}
          </Button>
        </div>
      </Section>
    </>
  )
}
