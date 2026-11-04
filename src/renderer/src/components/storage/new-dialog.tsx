// New Store (the Stores tab's one way in), in the same sheet as New bucket:
// the family (SQLite or PostgreSQL) as tiles at the top, then the chosen
// one's form. SQLite: Empty Store (store.create on native) or Restore from a
// backup (lists a bucket's files and restores one as a new Store on native,
// backup.restore). PostgreSQL: a database as a Store (store.connect).
// Buckets are connected and managed on the Backups tab (New bucket,
// storage-dialogs.tsx), not here.
import { Database, Download, Plus, RefreshCw, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Segmented } from '@/components/motion'
import { message } from '@/components/storage/dialogs/fields'
import { FamilyTile } from '@/components/storage/identity/store-icon'
import { type FieldValues, PROVIDERS } from '@/components/storage/identity/providers'
import { Choice, FormSheet, TextField, TileChoice } from '@/components/storage/storage-dialogs'
import { Button } from '@/components/ui/button'
import { bytes } from '@/data/format'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { BucketRow, StorageView } from '@shared/host-api'

export type NewStorePane = 'empty' | 'restore' | 'postgresql'
const entryOf = (id: string | null | undefined) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
const REFERENCE_HINT = 'A reference: file:/absolute/path (readable by you only) or env:LAYERFS_<NAME>.'

/** A bucket's health dot: listed fine, refused, or not listed yet. */
function Health({ bucket }: { bucket: BucketRow }) {
  const tone = bucket.error ? 'bg-destructive' : bucket.listed ? 'bg-emerald-500' : 'bg-idle'
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', tone)} />
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-foreground/[0.06] pt-4">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

export function NewDialog({ open, onOpenChange, view, onChanged, onNewBucket, initial = 'empty' }: { open: boolean; onOpenChange: (open: boolean) => void; view: StorageView | undefined; onChanged: () => void; onNewBucket: () => void; initial?: NewStorePane }) {
  useI18n()
  const [pane, setPane] = useState<NewStorePane>(initial)
  const [f, setF] = useState<FieldValues>({})
  const [listing, setListing] = useState(false)
  const [listError, setListError] = useState<string>()
  const buckets = view?.buckets ?? []
  useEffect(() => {
    if (open) setPane(initial)
  }, [open, initial])
  useEffect(() => {
    setListError(undefined)
    setF(pane === 'restore' ? { bucket: buckets[0]?.name ?? '' } : {})
  }, [pane, open])
  if (!open) return null
  const family = pane === 'postgresql' ? 'postgresql' : 'sqlite'
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const close = () => onOpenChange(false)
  const list = async (name: string) => {
    setListing(true)
    setListError(undefined)
    try { await host.listBucket(name) } catch (e) { setListError(message(e)) } finally { setListing(false); onChanged() }
  }

  const bucket = buckets.find((b) => b.name === f.bucket)
  /** Choosing a file names the new Store after it, with "-restored" when that name is taken. */
  const choose = (file: string) => {
    const base = file.replace(/\.[^.]+$/, '')
    setF((x) => ({ ...x, file, name: view?.stores.some((s) => s.name === base) ? `${base}-restored` : base }))
  }
  const files = bucket?.files ? [...new Set(bucket.files.map((x) => x.file))].map((file) => {
    const rows = bucket.files!.filter((x) => x.file === file)
    return { file, bytes: rows[0].bytes, stores: rows.map((x) => x.store).filter(Boolean) as string[] }
  }) : null

  const missing = (pane === 'empty' ? [!f.name && t('name')] : pane === 'restore' ? (buckets.length ? [!f.bucket && t('bucket'), !f.file && t('file'), !f.name && t('name')] : []) : [!f.name && t('name'), !f.url && t('URL'), !f.password && t('password reference')]).filter(Boolean) as string[]
  const form = {
    empty: { icon: Plus, action: t('Create Store'), description: t('A new SQLite Store saved under the home, with no projects yet. Add projects to it, then push it to any machine.'), submit: () => host.createStore(f.name) },
    restore: { icon: Download, action: t('Restore Store'), description: t('A new SQLite Store saved under the home from a bucket file, with all of its projects. The Store the file came from is not changed.'), submit: () => host.restoreBackup(f.bucket, f.name, f.file) },
    postgresql: { icon: Database, action: t('Connect'), description: t('A database as a Store. It is never pushed or pulled; its projects’ Sandboxes run on any machine that supports PostgreSQL Sandboxes.'), submit: () => host.connectPostgresql({ name: f.name, url: f.url, password: f.password, synchronousCommit: f.sync || undefined }) },
  }[pane]

  return (
    <FormSheet
      open
      wide
      onClose={close}
      icon={form.icon}
      title={t('New Store')}
      description={form.description}
      action={form.action}
      valid={buckets.length > 0 || pane !== 'restore' ? !missing.length : false}
      submit={() => form.submit().then(onChanged)}
      hint={missing.length ? t('Still needed: {list}', { list: missing.join(', ') }) : undefined}
    >
      <TileChoice
        label={t('Kind of Store')}
        value={family}
        onChange={(v) => setPane(v === 'sqlite' ? 'empty' : 'postgresql')}
        options={[
          { value: 'sqlite', label: 'SQLite', mark: <FamilyTile family="sqlite" size="sm" /> },
          { value: 'postgresql', label: 'PostgreSQL', mark: <FamilyTile family="postgresql" size="sm" /> },
        ]}
      />

      {family === 'sqlite' && (
        <Segmented
          aria-label={t('SQLite')}
          className="self-start"
          value={pane as 'empty' | 'restore'}
          onChange={setPane}
          options={[
            { value: 'empty', label: t('Empty Store'), icon: Plus },
            { value: 'restore', label: t('Restore from a backup'), icon: Download },
          ]}
        />
      )}

      {pane === 'empty' && (
        <Section title={t('Store')}>
          <TextField label={t('Name')} value={f.name ?? ''} onChange={set('name')} placeholder="work" autoFocus mono />
        </Section>
      )}

      {pane === 'restore' && (buckets.length === 0 ? (
        <div className="flex items-center gap-4 rounded-2xl border border-dashed border-foreground/[0.1] px-4 py-4">
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-muted-foreground">{t('No bucket connected yet. Backups live in buckets; connect one on the Backups tab.')}</p>
          <Button type="button" size="sm" variant="outline" className="shrink-0 rounded-full px-3.5" onClick={() => { close(); onNewBucket() }}>
            <Unplug className="size-3.5" />{t('New bucket…')}
          </Button>
        </div>
      ) : (
        <>
          <Section title={t('Source')}>
            <div className="flex items-end gap-2">
              <div className="min-w-0">
                <Choice label={t('Bucket')} value={f.bucket ?? ''} onChange={(v) => setF({ bucket: v })} options={buckets.map((b) => ({ value: b.name, label: `${b.name} · ${entryOf(b.provider).label}` }))} />
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8.5 rounded-xl px-3" disabled={!bucket || listing} onClick={() => bucket && void list(bucket.name)}>
                <RefreshCw className={cn('size-3.5', listing && 'motion-safe:animate-spin')} />{t('List files')}
              </Button>
              {bucket && (
                <span className="ml-auto flex h-8.5 items-center gap-2 text-xs text-muted-foreground">
                  <Health bucket={bucket} />{bucket.error ? t('refused') : bucket.listed ? t('listed') : t('not listed yet')}
                </span>
              )}
            </div>
            {(listError || bucket?.error) && <p className="text-xs text-destructive">{listError ?? `${bucket!.error!.code}: ${bucket!.error!.message}`}</p>}
            <div role="radiogroup" aria-label={t('File')} className="max-h-48 overflow-y-auto rounded-2xl border border-foreground/[0.08] bg-background/40">
              {files === null ? (
                <p className="px-4 py-3.5 text-[12.5px] text-muted-foreground">{t('List the bucket’s files to choose one.')}</p>
              ) : files.length === 0 ? (
                <p className="px-4 py-3.5 text-[12.5px] text-muted-foreground">{t('No Store files in this bucket.')}</p>
              ) : (
                files.map((x) => (
                  <button key={x.file} type="button" role="radio" aria-checked={f.file === x.file} onClick={() => choose(x.file)} className={cn('flex w-full items-center gap-3 border-b border-foreground/[0.05] px-4 py-2.5 text-left last:border-b-0 hover:bg-foreground/[0.03]', f.file === x.file && 'bg-primary/[0.05]')}>
                    <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', f.file === x.file ? 'border-primary' : 'border-foreground/25')}>
                      {f.file === x.file && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{x.file}</span>
                    {x.stores.length > 0 && <span className="truncate text-xs text-muted-foreground">{t('from {store}', { store: x.stores.join(', ') })}</span>}
                    <span className="text-xs tabular-nums text-muted-foreground">{x.bytes !== null ? bytes(x.bytes) : '—'}</span>
                  </button>
                ))
              )}
            </div>
          </Section>
          <Section title={t('Store')}>
            <TextField label={t('New Store’s name')} value={f.name ?? ''} onChange={set('name')} placeholder={f.file ? `${f.file.replace(/\.[^.]+$/, '')}-restored` : 'work-restored'} mono />
          </Section>
        </>
      ))}

      {pane === 'postgresql' && (
        <>
          <Section title={t('Store')}>
            <div className="flex flex-col gap-x-4 gap-y-3.5 sm:flex-row">
              <div className="min-w-0 flex-1"><TextField label={t('Name')} value={f.name ?? ''} onChange={set('name')} placeholder="team" autoFocus mono /></div>
              <div className="shrink-0 sm:min-w-44"><Choice label="synchronous_commit" value={f.sync ?? ''} onChange={set('sync')} options={['off', 'local', 'remote_write', 'on', 'remote_apply'].map((v) => ({ value: v, label: v }))} hint={t('Left out: the database’s own setting.')} /></div>
            </div>
          </Section>
          <Section title={t('Database')}>
            <div className="flex flex-col gap-x-4 gap-y-3.5 sm:flex-row">
              <div className="min-w-0 flex-1"><TextField label={t('URL, without the password')} value={f.url ?? ''} onChange={set('url')} placeholder="postgresql://user@host:5432/db" mono hint={t('A URL that holds a password is refused.')} /></div>
              <div className="min-w-0 flex-1"><TextField label={t('Password')} value={f.password ?? ''} onChange={set('password')} placeholder="file:/Users/me/.config/layerfs/team.password" mono hint={t(REFERENCE_HINT)} /></div>
            </div>
          </Section>
        </>
      )}
    </FormSheet>
  )
}
