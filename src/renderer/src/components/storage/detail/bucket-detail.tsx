// An S3 connection's page (storage-links §3.3, layerfs#509): one bucket on
// one provider, binding no Store. Its files (from remote.list_stores): each
// linked to a Store of this machine (Open) or not loaded (Load…). Remove is
// refused while a Store links here (InUse). A connection can't be edited:
// remove it and add it again.
import { Download, ExternalLink, KeyRound, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'

import { count, useStorage } from '@/components/storage/actions'
import { Chip } from '@/components/storage/chips'
import { Breadcrumb } from '@/components/storage/detail/breadcrumb'
import { DetailHeader, Fact, Gone, Section } from '@/components/storage/detail/parts'
import { providerLabel } from '@/components/storage/identity/providers'
import { ProviderTile, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { Notice } from '@/components/storage/notice'
import { MoreButton } from '@/components/storage/overview/row-parts'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ago, bytes, when } from '@/data/format'
import type { RemoteFile, RemoteInfo } from '@shared/host-api'

const GRID = 'grid grid-cols-[minmax(0,1fr)_5.5rem_7rem_minmax(0,1.2fr)_minmax(6rem,auto)] items-center gap-x-4 @max-[759px]/storage:grid-cols-[minmax(0,1fr)_auto]'

/** One file in the bucket: linked to a Store of this machine, or not loaded. */
function FileRow({ remote, file }: { remote: RemoteInfo; file: RemoteFile }) {
  const s = useStorage()
  const store = file.linkedBy ? s.view.stores.list.find((x) => x.name === file.linkedBy) : undefined
  return (
    <div role="row" className={`${GRID} px-5 py-2.5`}>
      <span role="rowheader" className="truncate font-mono text-[13px] font-medium">
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
              Linked to <span className="font-mono">{file.linkedBy}</span>
            </span>
            {store?.link && <SyncPill state={store.sync.state} copy={store.link} compact />}
          </span>
        ) : (
          <span className="text-[13px] text-faint">Not loaded</span>
        )}
      </span>
      <span role="cell" className="flex justify-end gap-1.5">
        {file.linkedBy ? (
          <Button size="xs" variant="outline" onClick={() => s.open({ view: 'store', id: file.linkedBy! })} aria-label={`Open ${file.linkedBy}`}>
            <ExternalLink /> Open
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={() => s.load({ remote: remote.name, file: file.file })} disabled={!remote.hasSecret} aria-label={`Load ${file.file}`}>
            <Download /> Load…
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
      title="Files in this bucket"
      note="SQLite Store files. Each is linked to one Store of this machine, or not loaded."
      aside={
        s.view.supports.listCopies && (
          <Button size="sm" variant="ghost" onClick={() => void s.check({ remote: remote.name })} disabled={s.checking}>
            <RefreshCw className={s.checking ? 'animate-spin' : undefined} /> Check now
          </Button>
        )
      }
    >
      <div role="table" aria-label={`Files in ${remote.name}`} className="mt-3">
        <div role="rowgroup">
          <div role="row" className={`${GRID} border-y bg-muted/25 px-5 py-2 text-[11px] font-medium tracking-[0.04em] text-faint uppercase @max-[759px]/storage:hidden`}>
            <span role="columnheader">File</span>
            <span role="columnheader" className="text-right">
              Size
            </span>
            <span role="columnheader">Modified</span>
            <span role="columnheader">On this machine</span>
            <span role="columnheader">
              <span className="sr-only">Action</span>
            </span>
          </div>
        </div>
        <div role="rowgroup" className="divide-y divide-border/70">
          {files.map((f) => (
            <FileRow key={f.file} remote={remote} file={f} />
          ))}
          {!files.length && remote.files !== null && <p className="px-5 py-5 text-[13px] text-muted-foreground">No LayerFS Stores here yet. Publish a Store to this connection from its page.</p>}
        </div>
      </div>
      {remote.files === null && <p className="border-t px-5 py-2.5 text-xs text-faint">{remote.hasSecret ? 'Not listed yet: Check now lists the bucket.' : 'Connect has no keys to list this bucket.'}</p>}
    </Section>
  )
}

export function BucketDetail({ name }: { name: string }) {
  const s = useStorage()
  const remote = s.view.remotes.list.find((r) => r.name === name)
  if (!remote)
    return (
      <>
        <Breadcrumb items={[{ label: 'Connections' }, { label: name, mono: true }]} />
        <Gone what={name} />
      </>
    )
  const label = providerLabel(remote.provider)
  const h = remote.health
  const down = h.state === 'unreachable' || h.state === 'denied'
  const remove = () => s.remove({ kind: 'remote', name: remote.name })
  const where = [remote.endpoint, remote.bucket, remote.prefix].filter(Boolean).join(' / ')
  return (
    <>
      <Breadcrumb items={[{ label: 'Connections' }, { label: remote.name, mono: true }]} />
      <DetailHeader
        icon={<ProviderTile provider={remote.provider} size="lg" />}
        eyebrow={`Connection · ${label}`}
        title={<span className="font-mono">{remote.name}</span>}
        badges={
          <>
            {remote.hasSecret ? <HealthDot health={h} /> : null}
            {remote.hasSecret ? (
              <Chip tone="success" icon={KeyRound}>
                Keys saved
              </Chip>
            ) : (
              <Chip tone="warning" icon={KeyRound}>
                No keys in Connect
              </Chip>
            )}
            {remote.jurisdiction && <Chip tone="neutral">{remote.jurisdiction.toUpperCase()}</Chip>}
          </>
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <MoreButton label={`More for ${remote.name}`} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {s.view.supports.listCopies && (
                  <DropdownMenuItem onSelect={() => void s.check({ remote: remote.name })}>
                    <RefreshCw className="text-muted-foreground" /> Check now
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={remove} disabled={remote.stores.length > 0}>
                  <Trash2 /> Remove…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      >
        <p className="truncate font-mono text-[12px]" title={where}>
          {where}
        </p>
        {remote.provider === 'minio' && remote.reachAs && remote.reachAs !== remote.endpoint && <p className="text-xs text-faint">The LayerFS box reaches it as {remote.reachAs}</p>}
        <p className="tabular-nums">
          {remote.files ? count(remote.files.length, 'file') : 'files not listed yet'}
          {remote.bytes !== null && ` · ${bytes(remote.bytes)}`}
          {` · ${remote.stores.length ? `${count(remote.stores.length, 'Store')} linked here` : 'no Store linked here'}`}
          {h.at && ` · checked ${ago(h.at)}`}
        </p>
      </DetailHeader>

      {!remote.hasSecret && (
        <Notice tone="warning" icon={KeyRound} title={`Connect has no keys for ${remote.name}`}>
          So it can’t list, check, publish, push, pull or load. Remove it and add it again with keys.
        </Notice>
      )}
      {remote.hasSecret && down && (
        <Notice
          tone="warning"
          icon={TriangleAlert}
          title={`${remote.name} ${h.state === 'denied' ? 'refused the keys' : 'is not answering'}`}
          actions={
            <Button size="sm" variant="outline" onClick={() => void s.check({ remote: remote.name })} disabled={s.checking}>
              <RefreshCw className={s.checking ? 'animate-spin' : undefined} /> Check again
            </Button>
          }
        >
          {h.message ?? 'The last check failed.'} Linked Stores keep their last known state.
        </Notice>
      )}

      <FilesHere remote={remote} />

      <Section index={3} title="Settings" note="What LayerFS and Connect keep for this connection. It binds no Store. To change it, remove it and add it again.">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 pt-3 pb-4 @min-[760px]/storage:grid-cols-4">
          <Fact label="Name" mono>
            {remote.name}
          </Fact>
          <Fact label="Provider">{label}</Fact>
          {remote.provider === 'r2' ? (
            <>
              <Fact label="Account" mono title={remote.account ?? undefined}>
                {remote.account ? `${remote.account.slice(0, 4)}…${remote.account.slice(-2)}` : '—'}
              </Fact>
              <Fact label="Jurisdiction">{remote.jurisdiction ? remote.jurisdiction.toUpperCase() : 'None'}</Fact>
            </>
          ) : (
            <Fact label="Endpoint" mono title={remote.endpoint}>
              {remote.endpoint}
            </Fact>
          )}
          <Fact label="Bucket" mono>
            {remote.bucket}
          </Fact>
          <Fact label="Prefix" mono>
            {remote.prefix || '—'}
          </Fact>
        </dl>
        <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{remote.hasSecret ? 'Keys saved in Connect, readable by your user only.' : 'No keys in Connect.'}</p>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={remove}
            disabled={remote.stores.length > 0}
            title={remote.stores.length ? `Linked by ${remote.stores.join(', ')}: unlink them first` : undefined}
          >
            <Trash2 /> Remove…
          </Button>
        </div>
      </Section>
    </>
  )
}
