// New (restored from the 1.1.0 Storage page's layout, on LayerFS 2.0): a
// rail on the left (SQLite or PostgreSQL; New Store: Empty Store, From a
// bucket file; the buckets with their health; Add bucket connection) and the
// chosen item on the right. Empty Store is store.create on native; a bucket
// file is restored as a new Store on native (backup.restore); a bucket is
// connected with backup.connect, its keys written by the host to an
// owner-only file and passed to LayerFS by reference.
import { Database, Download, LoaderCircle, Plus, RefreshCw, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'

import { BTN, FormError, message } from '@/components/storage/dialogs/fields'
import { type FieldValues, PROVIDERS, type ProviderEntry } from '@/components/storage/identity/providers'
import { Choice, ProviderTile, SecretField, TextField } from '@/components/storage/storage-dialogs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { bytes } from '@/data/format'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { BucketRow, StorageView } from '@shared/host-api'

type Pane = { kind: 'empty' } | { kind: 'load' } | { kind: 'bucket'; name: string } | { kind: 'add' } | { kind: 'postgresql' }
const READY = PROVIDERS.filter((p) => p.request)
const entryOf = (id: string | null | undefined) => PROVIDERS.find((p) => p.id === id) ?? READY[0]

/** A bucket's health dot: listed fine, refused, or not listed yet. */
function Health({ bucket }: { bucket: BucketRow }) {
  const tone = bucket.error ? 'bg-destructive' : bucket.listed ? 'bg-emerald-500' : 'bg-idle'
  return <span aria-hidden="true" className={cn('size-2 rounded-full shadow-[0_0_0_3px_color-mix(in_oklab,currentColor_14%,transparent)]', tone)} />
}

function RailItem({ active, icon, children, onClick, after }: { active: boolean; icon: React.ReactNode; children: React.ReactNode; onClick: () => void; after?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[13.5px] transition-colors', active ? 'bg-background shadow-xs ring-1 ring-foreground/[0.08]' : 'hover:bg-foreground/[0.04]')}>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {after}
    </button>
  )
}

function PaneHeader({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5 pr-8">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-(--icon-accent) [&_svg]:size-4.5">{icon}</span>
      <div className="min-w-0">
        <DialogTitle className="text-[17px] font-semibold tracking-tight">{title}</DialogTitle>
        {children && <DialogDescription className="mt-1 text-[13px] leading-relaxed">{children}</DialogDescription>}
      </div>
    </div>
  )
}

/** A form's footer: what is still needed, Cancel and the action. */
function Footer({ missing, busy, valid, action, icon, onCancel }: { missing: string[]; busy: boolean; valid: boolean; action: string; icon: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="mt-auto flex flex-col items-end gap-3 pt-4">
      {missing.length > 0 && <p className="text-[12.5px] text-muted-foreground">{t('Still needed: {list}.', { list: missing.join(', ') })}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className={cn(BTN, 'rounded-full px-4')} onClick={onCancel} disabled={busy}>{t('Cancel')}</Button>
        <Button type="submit" size="sm" className={cn(BTN, 'rounded-full px-4')} disabled={!valid || busy}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}{action}</Button>
      </div>
    </div>
  )
}

export function NewDialog({ open, onOpenChange, view, onChanged, initial = 'empty' }: { open: boolean; onOpenChange: (open: boolean) => void; view: StorageView | undefined; onChanged: () => void; initial?: 'empty' | 'add' | 'postgresql' }) {
  useI18n()
  const [family, setFamily] = useState<'sqlite' | 'postgresql'>('sqlite')
  const [pane, setPane] = useState<Pane>({ kind: initial })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [f, setF] = useState<FieldValues>({})
  const [provider, setProvider] = useState<ProviderEntry>(READY[0])
  const [loading, setLoading] = useState<{ bucket: string; file: string } | null>(null)
  const [listing, setListing] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setPane({ kind: initial })
    setFamily(initial === 'postgresql' ? 'postgresql' : 'sqlite')
  }, [open, initial])
  useEffect(() => {
    setError(undefined)
    setLoading(null)
    setF(pane.kind === 'add' ? Object.fromEntries(provider.fields.map((x) => [x.key, x.default ?? ''])) : {})
  }, [pane.kind, provider])
  const buckets = view?.buckets ?? []
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const close = () => onOpenChange(false)
  const run = async (work: () => Promise<unknown>, after: () => void = close) => {
    setBusy(true)
    setError(undefined)
    try {
      await work()
      onChanged()
      after()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const check = async (name: string) => {
    setListing(name)
    try { await host.listBucket(name) } finally { setListing(null); onChanged() }
  }

  /** One bucket's files: a file a Store of this home holds is "Loaded as <store>", else Load… restores it as a new Store on native. */
  const files = (b: BucketRow) => (
    <section key={b.name} className="space-y-1">
      <div className="flex items-center gap-2 py-1.5">
        <ProviderTile entry={entryOf(b.provider)} size="sm" />
        <span className="font-mono text-[13px] text-muted-foreground">{b.name}</span>
        <button type="button" onClick={() => void check(b.name)} disabled={listing === b.name} className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('size-3.5', listing === b.name && 'motion-safe:animate-spin')} />{t('Check now')}
        </button>
      </div>
      {b.error && <p className="text-xs text-destructive">{b.error.code}: {b.error.message}</p>}
      {b.files === null ? <p className="py-1 text-xs text-muted-foreground">{t('Check the bucket to see its files.')}</p> : b.files.length === 0 ? <p className="py-1 text-xs text-muted-foreground">{t('No Store files in this bucket.')}</p> : (
        [...new Set(b.files.map((x) => x.file))].map((file) => {
          const rows = b.files!.filter((x) => x.file === file)
          const loaded = rows.filter((x) => x.store).map((x) => x.store)
          const open = loading?.bucket === b.name && loading.file === file
          return (
            <div key={file} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
              <span className="min-w-0 flex-1 font-mono text-[15px]">{file}</span>
              <span className="text-[13px] tabular-nums text-muted-foreground">{bytes(rows[0].bytes)}</span>
              {open ? (
                <form className="flex w-full items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => host.restoreBackup(b.name, f.restoreAs, file)) }}>
                  <Input autoFocus value={f.restoreAs ?? ''} onChange={(e) => set('restoreAs')(e.target.value)} placeholder={t('the new Store’s name')} className="h-8 flex-1 rounded-xl font-mono text-xs" />
                  <Button type="submit" size="sm" className="h-8 rounded-full" disabled={busy || !f.restoreAs}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{t('Restore')}</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => setLoading(null)}>{t('Cancel')}</Button>
                </form>
              ) : loaded.length ? (
                <span className="text-[13px] text-muted-foreground">{t('Restored as {store}', { store: loaded.join(', ') })}</span>
              ) : (
                <button type="button" className="text-[13px] text-primary hover:underline" onClick={() => { setLoading({ bucket: b.name, file }); setF({ restoreAs: file }) }}>{t('Restore…')}</button>
              )}
            </div>
          )
        })
      )}
    </section>
  )

  const addMissing = provider.fields.filter((x) => x.needed && !f[x.key]?.trim()).map((x) => t(x.needed!))
  const addProblems = provider.fields.map((x) => (f[x.key] ? x.validate?.(f[x.key]) : null)).filter(Boolean)
  const pgMissing = [!f.name && t('name'), !f.url && t('URL'), !f.password && t('password reference')].filter(Boolean) as string[]

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !busy ? close() : undefined)}>
      <DialogContent className="flex h-[min(760px,calc(100dvh-3rem))] max-w-[calc(100vw-3rem)] gap-0 overflow-hidden rounded-[2rem] p-0 sm:max-w-[920px]">
        <aside className="flex w-[300px] shrink-0 flex-col gap-1 border-r border-foreground/[0.06] bg-foreground/[0.02] px-4 py-7">
          <h2 className="px-2 pb-4 text-[19px] font-semibold tracking-tight">{t('New')}</h2>
          <div className="mb-3 flex gap-1 rounded-full bg-foreground/[0.04] p-1">
            {(['sqlite', 'postgresql'] as const).map((id) => (
              <button key={id} type="button" onClick={() => { setFamily(id); setPane({ kind: id === 'sqlite' ? 'empty' : 'postgresql' }) }} className={cn('flex-1 rounded-full py-1.5 text-[13.5px]', family === id ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground')}>
                {id === 'sqlite' ? 'SQLite' : 'PostgreSQL'}
              </button>
            ))}
          </div>
          {family === 'sqlite' ? (
            <>
              <p className="px-2 pb-4 text-[13px] leading-relaxed text-muted-foreground">{t('A Store file on a machine; it can be pushed to any machine and backed up to buckets.')}</p>
              <p className="px-2 pb-1 text-[12.5px] text-muted-foreground">{t('New Store')}</p>
              <RailItem active={pane.kind === 'empty'} icon={<Plus />} onClick={() => setPane({ kind: 'empty' })}>{t('Empty Store')}</RailItem>
              <RailItem active={pane.kind === 'load'} icon={<Download />} onClick={() => setPane({ kind: 'load' })}>{t('From a bucket file')}</RailItem>
              <p className="px-2 pt-4 pb-1 text-[12.5px] text-muted-foreground">{t('Buckets')}</p>
              {buckets.map((b) => (
                <RailItem key={b.name} active={pane.kind === 'bucket' && pane.name === b.name} icon={<ProviderTile entry={entryOf(b.provider)} size="sm" />} onClick={() => setPane({ kind: 'bucket', name: b.name })} after={<Health bucket={b} />}>
                  <span className="font-mono">{b.name}</span>
                </RailItem>
              ))}
              <RailItem active={pane.kind === 'add'} icon={<Plus />} onClick={() => setPane({ kind: 'add' })}>{t('Add bucket connection')}</RailItem>
            </>
          ) : (
            <>
              <p className="px-2 pb-4 text-[13px] leading-relaxed text-muted-foreground">{t('A database as a Store. It is never pushed or pulled; its projects’ Sandboxes run on any machine that supports PostgreSQL Sandboxes.')}</p>
              <RailItem active icon={<Database />} onClick={() => setPane({ kind: 'postgresql' })}>{t('Connect a database')}</RailItem>
            </>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-9 py-8">
          {pane.kind === 'empty' && (
            <form className="flex flex-1 flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void run(() => host.createStore(f.name)) }}>
              <PaneHeader icon={<Plus />} title={t('Empty Store')}>{t('A new SQLite Store on native, with no projects yet. Add projects to it, then push it to any machine.')}</PaneHeader>
              <TextField label={t('Name')} value={f.name ?? ''} onChange={set('name')} placeholder="work" autoFocus mono />
              <FormError error={error} />
              <Footer missing={f.name ? [] : [t('name')]} busy={busy} valid={!!f.name} action={t('Create Store')} icon={<Plus className="size-3.5" />} onCancel={close} />
            </form>
          )}
          {pane.kind === 'load' && (
            <div className="flex flex-col gap-4">
              <PaneHeader icon={<Download />} title={t('From a bucket file')}>{t('A new SQLite Store on native from the file, with all of its projects, linked to it.')}</PaneHeader>
              {buckets.length ? buckets.map(files) : <p className="text-sm text-muted-foreground">{t('No bucket connected yet.')}</p>}
              <FormError error={error} />
            </div>
          )}
          {pane.kind === 'bucket' && (() => {
            const b = buckets.find((x) => x.name === pane.name)
            if (!b) return null
            return (
              <div className="flex flex-col gap-4">
                <PaneHeader icon={<ProviderTile entry={entryOf(b.provider)} size="sm" />} title={b.name}>{t('{provider} bucket · {count} linked Stores', { provider: entryOf(b.provider).label, count: b.stores.length })}</PaneHeader>
                {files(b)}
                <FormError error={error} />
                <div className="mt-2">
                  <Button variant="outline" size="sm" className="rounded-full text-destructive" disabled={busy} onClick={() => void run(() => host.disconnectBucket(b.name), () => setPane({ kind: 'empty' }))}>
                    <Unplug className="size-3.5" />{t('Disconnect (every Store’s link to it goes too)')}
                  </Button>
                </div>
              </div>
            )
          })()}
          {pane.kind === 'add' && (
            <form className="flex flex-1 flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void run(() => host.connectBucket(provider.request!(f)), () => setPane({ kind: 'bucket', name: f.name })) }}>
              <PaneHeader icon={<Plus />} title={t('Add a bucket connection')}>{t('A bucket that holds SQLite Store backups. Adding it links no Store; you can add as many as you like.')}</PaneHeader>
              <div className="grid grid-cols-2 gap-3">
                {READY.map((p) => (
                  <button key={p.id} type="button" onClick={() => setProvider(p)} className={cn('flex items-center gap-3.5 rounded-full border px-4 py-3.5 text-left text-[15px] transition-colors', provider.id === p.id ? 'border-primary/40 bg-background shadow-xs' : 'border-foreground/[0.08] hover:bg-foreground/[0.03]')}>
                    <ProviderTile entry={p} size="sm" />{p.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                {provider.fields.map((x) => (
                  <div key={x.key} className={cn('flex flex-col gap-1.5', provider.notes.some((n) => n.after === x.key) && 'col-span-2 grid grid-cols-2 gap-x-5')}>
                    <div>
                      {x.kind === 'select' ? (
                        <Choice label={t(x.label)} value={f[x.key] || '__none'} onChange={(v) => set(x.key)(v === '__none' ? '' : v)} options={(x.options ?? []).map((o) => ({ value: o.value || '__none', label: t(o.label) }))} />
                      ) : x.kind === 'secret' ? (
                        <SecretField label={t(x.label)} value={f[x.key] ?? ''} onChange={set(x.key)} />
                      ) : (
                        <TextField label={t(x.label)} value={f[x.key] ?? ''} onChange={set(x.key)} placeholder={x.placeholder ? t(x.placeholder) : undefined} mono={x.mono} hint={(f[x.key] && x.validate?.(f[x.key])) || undefined} />
                      )}
                    </div>
                    {provider.notes.filter((n) => n.after === x.key).map((n, k) => (
                      <p key={k} className={cn('col-span-2 text-[13px] leading-relaxed text-muted-foreground', n.mono && 'font-mono')}>{n.text(f)}</p>
                    ))}
                  </div>
                ))}
              </div>
              <FormError error={error} />
              <Footer missing={addMissing} busy={busy} valid={!addMissing.length && !addProblems.length} action={t('Add connection')} icon={<Plus className="size-3.5" />} onCancel={close} />
            </form>
          )}
          {pane.kind === 'postgresql' && (
            <form className="flex flex-1 flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void run(() => host.connectPostgresql({ name: f.name, url: f.url, password: f.password, synchronousCommit: f.sync || undefined })) }}>
              <PaneHeader icon={<Database />} title={t('Connect a database')}>{t('A PostgreSQL database as a Store. The URL holds no password: give the password as a reference.')}</PaneHeader>
              <TextField label={t('Name')} value={f.name ?? ''} onChange={set('name')} placeholder="team" autoFocus mono />
              <TextField label={t('URL, without the password')} value={f.url ?? ''} onChange={set('url')} placeholder="postgresql://user@host:5432/db" mono />
              <TextField label={t('Password')} value={f.password ?? ''} onChange={set('password')} placeholder="file:/Users/me/.config/layerfs/team.password" mono hint={t('A reference: file:/absolute/path (readable by you only) or env:LAYERFS_<NAME>.')} />
              <Choice label="synchronous_commit" value={f.sync ?? ''} onChange={set('sync')} options={['off', 'local', 'remote_write', 'on', 'remote_apply'].map((v) => ({ value: v, label: v }))} />
              <FormError error={error} />
              <Footer missing={pgMissing} busy={busy} valid={!pgMissing.length} action={t('Connect')} icon={<Database className="size-3.5" />} onCancel={close} />
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
