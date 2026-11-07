// Storage's Backups tab: one card per bucket, with the files of its last
// listing (backup.list), each against its Store, and Restore (always a new
// Store on native).
import { Archive, Database, HardDriveDownload, ListRestart, TriangleAlert, Unplug } from 'lucide-react'

import { Chip, type Tone } from '@/components/layerfs/Chips'
import { Notice } from '@/pages/storage/Notice'
import { Card } from '@/pages/storage/RowParts'
import { go } from '@/layerfs/go'
import { Button } from '@/components/ui/button'
import { ago, bytes, when } from '@/layerfs/format'
import type { BackupState, BucketRow } from '@/layerfs/host-api'

export const BACKUP: Record<BackupState, { tone: Tone; label: string; dashed?: boolean }> = {
  current: { tone: 'success', label: 'Backed up' },
  store_changed: { tone: 'warning', label: 'Store changed' },
  bucket_changed: { tone: 'warning', label: 'Bucket changed' },
  both_changed: { tone: 'danger', label: 'Both changed' },
  unknown: { tone: 'neutral', label: 'Unknown', dashed: true },
  unlinked: { tone: 'neutral', label: 'Not linked' },
  missing: { tone: 'danger', label: 'Missing' },
}

const PROVIDER: Record<string, string> = { minio: 'MinIO', r2: 'Cloudflare R2' }

interface BucketCardProps {
  bucket: BucketRow
  index: number
  listing: boolean
  onList: () => void
  onRestore: (file: string) => void
  onDisconnect: () => void
}

export function BucketCard({ bucket: b, index, listing, onList, onRestore, onDisconnect }: BucketCardProps) {
  return (
    <Card index={index} className="p-0">
      <header className="flex flex-wrap items-center gap-2 border-b border-foreground/[0.06] px-5 py-3">
        <Archive aria-hidden="true" className="size-4 text-(--icon-accent)" />
        <h3 className="font-mono text-base font-strong">{b.name}</h3>
        {b.provider && <span className="text-sm text-muted-foreground">{PROVIDER[b.provider] ?? b.provider}</span>}
        <span className="text-sm text-muted-foreground">· {b.listed ? `listed ${ago(b.listed)}` : 'not listed yet'}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 rounded-lg-plus px-2.5 text-sm" onClick={onList} disabled={listing}>
            <ListRestart className={listing ? 'motion-safe:animate-spin' : ''} />
            {'List files'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 rounded-lg-plus px-2.5 text-sm text-muted-foreground" onClick={onDisconnect}>
            <Unplug />
            {'Disconnect…'}
          </Button>
        </div>
      </header>
      {b.error && (
        <div className="px-5 pt-3">
          <Notice tone="danger" icon={TriangleAlert} title={'The bucket did not list'}>
            {b.error.code}: {b.error.message}
          </Notice>
        </div>
      )}
      {b.files === null ? (
        <p className="px-5 py-3 text-sm text-muted-foreground">{'List the bucket to see its files and their states (it is asked on each listing).'}</p>
      ) : b.files.length === 0 ? (
        <p className="px-5 py-3 text-sm text-muted-foreground">{'No backups in this bucket.'}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="px-5 py-2 font-medium">{'File'}</th>
              <th className="px-2 py-2 font-medium">{'Store'}</th>
              <th className="px-2 py-2 font-medium">{'State'}</th>
              <th className="px-2 py-2 text-right font-medium">{'Size'}</th>
              <th className="px-2 py-2 font-medium">{'Written'}</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/[0.05]">
            {b.files.map((f) => {
              const chip = BACKUP[f.state] ?? BACKUP.unknown
              return (
                <tr key={`${f.file}:${f.store ?? ''}`}>
                  <td className="px-5 py-2 font-mono">{f.file}</td>
                  <td className="px-2 py-2 font-mono text-muted-foreground">
                    {f.store ? (
                      <button type="button" className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-foreground hover:underline" title={`Show ${f.store} on Storage`} onClick={() => go.store(f.store!)}>
                        <Database aria-hidden="true" className="size-3 opacity-70" />
                        {f.store}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-2 py-2" title={f.reason ?? undefined}>
                    <Chip tone={chip.tone} dashed={chip.dashed}>
                      {chip.label}
                    </Chip>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{bytes(f.bytes)}</td>
                  <td className="px-2 py-2 text-muted-foreground" title={when(f.modified)}>
                    {f.modified ? ago(f.modified) : '—'}
                  </td>
                  <td className="px-5 py-2 text-right">
                    {f.state !== 'missing' && (
                      <Button size="sm" variant="ghost" className="h-7 rounded-lg-plus px-2 text-sm" onClick={() => onRestore(f.file)} title={'Saves it in the home'}>
                        <HardDriveDownload />
                        {'Restore…'}
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}
