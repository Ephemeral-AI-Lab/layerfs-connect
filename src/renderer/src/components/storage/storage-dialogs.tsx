// The Storage page's dialogs on LayerFS 2.0: one small form per action. A
// secret is never typed here: buckets and PostgreSQL Stores take a reference
// (env:LAYERFS_… or file:/absolute/path) that LayerFS resolves.
import { Archive, ArrowRightLeft, Database, HardDriveDownload, HardDriveUpload, LoaderCircle, type LucideIcon, Plus, TriangleAlert, Unplug } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { BackLink, BTN, Field, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { Refusal } from '@/components/refusal'
import { Mark, Tile } from '@/components/storage/icons'
import { type FieldValues, isBrandMark, type ProviderEntry, PROVIDERS } from '@/components/storage/identity/providers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Notice } from '@/components/storage/notice'
import { bytes } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { t, useI18n } from '@/i18n'
import type { MachinesView, StorageView, StoreRow } from '@shared/host-api'

/** Which dialog is open, and on what. */
export type StorageDialog =
  | { kind: 'new-store' }
  | { kind: 'push'; store: StoreRow }
  | { kind: 'move'; store: StoreRow }
  | { kind: 'backup'; store: StoreRow }
  | { kind: 'postgresql' }
  | { kind: 'bucket' }
  | { kind: 'restore'; bucket: string; file: string }

const REFERENCE_HINT = 'A reference, never the secret: file:/absolute/path (readable by you only) or env:LAYERFS_<NAME>.'

/** A form in a sheet: its fields, one submit that may be refused (shown under the form). */
function FormSheet({ open, onClose, icon, mark, title, description, action, valid, submit, left, hint, children }: { open: boolean; onClose: () => void; icon: LucideIcon; mark?: React.ReactNode; title: string; description?: React.ReactNode; action: string; valid: boolean; submit: () => Promise<unknown>; left?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  useEffect(() => {
    if (open) setError(undefined)
  }, [open])
  const go = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await submit()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  const Icon = icon
  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent className={`${SHEET} sm:max-w-[480px]`}>
        <SheetHeader icon={icon} mark={mark} title={title}>
          {description}
        </SheetHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void go()
          }}
        >
          {children}
          {error !== undefined && <Refusal error={error} className="rounded-xl bg-destructive/[0.06] px-3.5 py-3 text-destructive" />}
          {hint && <p className="text-[11.5px] text-muted-foreground">{hint}</p>}
          <SheetFooter left={left}>
            <Button type="button" variant="outline" size="sm" className={BTN} onClick={onClose} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" className={BTN} disabled={!valid || busy}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
              {action}
            </Button>
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TextField({ label, value, onChange, hint, placeholder, autoFocus, mono }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; autoFocus?: boolean; mono?: boolean }) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" spellCheck={false} className={`rounded-xl text-[13px] ${mono ? 'font-mono' : ''}`} />
    </Field>
  )
}

export function Choice({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string }) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="rounded-xl text-[13px]">
          <SelectValue placeholder={t('Choose')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/** The open dialog, if any. `done` reloads the page's view. */
export function StorageDialogs({ dialog, view, onClose, done }: { dialog: StorageDialog | null; view: StorageView | undefined; onClose: () => void; done: () => void }) {
  useI18n()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [c, setC] = useState('')
  const [d, setD] = useState('')
  useEffect(() => {
    setA(dialog?.kind === 'restore' ? dialog.file : '')
    setB('')
    setC('')
    setD('')
  }, [dialog])
  const close = onClose
  const after = <T,>(p: Promise<T>) => p.then((v) => (done(), v))
  if (!dialog) return null
  const open = true
  switch (dialog.kind) {
    case 'new-store':
      return (
        <FormSheet open={open} onClose={close} icon={Plus} title={t('New Store')} description={t('An empty sqlite Store on native. Add projects to it, then move it to any machine.')} action={t('Create')} valid={!!a} submit={() => after(host.createStore(a))}>
          <TextField label={t('Name')} value={a} onChange={setA} placeholder="work" autoFocus mono />
        </FormSheet>
      )
    case 'push':
    case 'move':
      return <PlaceSheet dialog={dialog} onClose={close} done={done} />
    case 'backup': {
      const buckets = (view?.buckets ?? []).map((x) => x.name)
      return (
        <FormSheet open={open} onClose={close} icon={Archive} title={t('Back up {store} to…', { store: dialog.store.name })} description={t('A snapshot of the whole Store, taken on its machine and sent through Connect to the bucket.')} action={t('Back up')} valid={!!a} submit={() => after(host.backupStore(dialog.store.name, a, b || undefined))}>
          <Choice label={t('Bucket')} value={a} onChange={setA} options={buckets.map((n) => ({ value: n, label: n }))} hint={buckets.length ? undefined : t('Connect a bucket first.')} />
          <TextField label={t('File name')} value={b} onChange={setB} placeholder={dialog.store.links.find((l) => l.bucket === a)?.file ?? dialog.store.name} hint={t('Leave empty for the Store’s link, else its name.')} mono />
        </FormSheet>
      )
    }
    case 'postgresql':
      return (
        <FormSheet open={open} onClose={close} icon={Database} title={t('Connect a PostgreSQL Store')} description={t('A database as a Store. It never moves; its projects’ Sandboxes run on native or docker.')} action={t('Connect')} valid={!!a && !!b && !!c} submit={() => after(host.connectPostgresql({ name: a, url: b, password: c, synchronousCommit: d || undefined }))}>
          <TextField label={t('Name')} value={a} onChange={setA} placeholder="team" autoFocus mono />
          <TextField label={t('URL, without the password')} value={b} onChange={setB} placeholder="postgresql://user@host:5432/db" mono hint={t('A URL that holds a password is refused.')} />
          <TextField label={t('Password')} value={c} onChange={setC} placeholder="file:/Users/me/.config/layerfs/team.password" mono hint={t(REFERENCE_HINT)} />
          <Choice label={t('synchronous_commit')} value={d} onChange={setD} options={['off', 'local', 'remote_write', 'on', 'remote_apply'].map((v) => ({ value: v, label: v }))} hint={t('Left out: the database’s own setting.')} />
        </FormSheet>
      )
    case 'bucket':
      return <BucketSheet onClose={close} done={done} />
    case 'restore':
      return (
        <FormSheet open={open} onClose={close} icon={HardDriveDownload} title={t('Restore {file}', { file: dialog.file })} description={t('Installs the copy as a new Store on native, with its projects. The Store the copy came from is not changed.')} action={t('Restore')} valid={!!b} submit={() => after(host.restoreBackup(dialog.bucket, b, dialog.file))}>
          <TextField label={t('New Store’s name')} value={b} onChange={setB} placeholder={`${dialog.file}-restored`} autoFocus mono />
        </FormSheet>
      )
  }
}

/**
 * Push a Store on native to a machine, or move one between two machines (a
 * pull, then a push: two operations, U5). The targets are the machines whose
 * `supports.sqlite` is true; each shows its state and free disk against the
 * Store's size. What holds the Store (open processes, its projects' Sandbox
 * records) is listed before it is sent: the push is refused `InUse` while any
 * remain, its refusal naming them.
 */
function PlaceSheet({ dialog, onClose, done }: { dialog: { kind: 'push' | 'move'; store: StoreRow }; onClose: () => void; done: () => void }) {
  useI18n()
  const s = dialog.store
  const machines = useHostQuery(() => host.machines(), [])
  const [target, setTarget] = useState('')
  const view: Extract<MachinesView, { available: true }> | null = machines.data?.available ? machines.data : null
  const targets = (view?.machines ?? []).filter((m) => m.name !== 'native' && m.name !== s.machine && m.supports?.sqlite !== false)
  const chosen = targets.find((m) => m.name === target)
  const free = chosen ? (view?.status[chosen.name]?.freeDisk ?? null) : null
  const size = s.size?.bytes ?? null
  const sandboxes = (view?.sandboxes ?? []).filter((b) => b.project?.startsWith(`${s.name}/`))
  const push = dialog.kind === 'push'
  return (
    <FormSheet
      open
      onClose={onClose}
      icon={push ? HardDriveUpload : ArrowRightLeft}
      title={t(push ? 'Push {store} to…' : 'Move {store} to another machine', { store: s.name })}
      description={
        push
          ? t('The whole Store goes, every project in it ({n}); its Sandboxes then run on that machine. Pull brings it back to native.', { n: s.projects.length })
          : t('A pull to native, then a push to the machine: two operations. If the push fails, the Store stays on native and you can push it again.')
      }
      action={t(push ? 'Push' : 'Move')}
      valid={!!target}
      submit={() => (push ? host.pushStore(s.name, target) : host.moveStore(s.name, target)).then(done)}
    >
      <Choice
        label={t('Machine')}
        value={target}
        onChange={setTarget}
        options={targets.map((m) => ({ value: m.name, label: `${m.name} (${m.platform}) · ${t(m.state)}` }))}
        hint={machines.loading && !view ? t('Reading the machines…') : targets.length ? undefined : t('No other machine holds sqlite Stores. Add one on Compute.')}
      />
      {chosen && (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground tabular-nums">
          {free !== null ? t('{free} free on {machine}; the Store is {size}.', { free: bytes(free), machine: chosen.name, size: size !== null ? bytes(size) : t('of unknown size') }) : t('{machine}’s free disk is not known until it runs.', { machine: chosen.name })}{' '}
          {chosen.state !== 'running' && t('{machine} is {state}: start it on Compute first; nothing starts it for you.', { machine: chosen.name, state: t(chosen.state) })}
        </p>
      )}
      {(s.holders > 0 || sandboxes.length > 0) && (
        <Notice tone="warning" icon={TriangleAlert} title={t('Held now: the push is refused while these remain')}>
          {[s.holders > 0 && t(s.holders === 1 ? '1 process has it open' : '{n} processes have it open', { n: s.holders }), ...sandboxes.map((b) => t('Sandbox {name} ({project})', { name: b.name, project: b.project ?? '' }))].filter(Boolean).join(' · ')}
        </Notice>
      )}
    </FormSheet>
  )
}

/** A provider's mark on a lit tile. */
export function ProviderTile({ entry, size = 'md' }: { entry: ProviderEntry; size?: 'sm' | 'md' | 'lg' }) {
  const mark = entry.mark
  return <Tile size={size}>{isBrandMark(mark) ? <Mark icon={mark} /> : (() => { const Icon = mark; return <Icon aria-hidden="true" className="text-muted-foreground" /> })()}</Tile>
}

/**
 * Connect a bucket, as the 1.1.0 Storage page had it: pick MinIO or
 * Cloudflare R2 from the provider tiles, then fill its form. The keys are
 * written by the host to an owner-only file, passed to LayerFS by reference.
 */
function BucketSheet({ onClose, done }: { onClose: () => void; done: () => void }) {
  useI18n()
  const [entry, setEntry] = useState<ProviderEntry | null>(null)
  const [values, setValues] = useState<FieldValues>({})
  const pick = (e: ProviderEntry) => {
    setEntry(e)
    setValues(Object.fromEntries(e.fields.map((f) => [f.key, f.default ?? ''])))
  }
  if (!entry) {
    return (
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent className={`${SHEET} sm:max-w-[520px]`}>
          <SheetHeader icon={Unplug} title={t('Connect a bucket')}>
            {t('Where Store backups go. LayerFS 2.0 backs up to MinIO and Cloudflare R2.')}
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2.5">
            {PROVIDERS.map((e) => {
              const ready = !!e.request
              return (
                <button key={e.id} type="button" disabled={!ready} onClick={() => pick(e)} className="flex min-w-0 items-center gap-3 rounded-2xl border border-foreground/[0.08] bg-background/40 px-3.5 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.04] disabled:cursor-default disabled:opacity-50 disabled:hover:border-foreground/[0.08] disabled:hover:bg-background/40">
                  <ProviderTile entry={e} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{e.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{ready ? t(e.about) : t('comes with a later LayerFS')}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    )
  }
  const problems = Object.fromEntries(entry.fields.map((f) => [f.key, values[f.key] ? (f.validate?.(values[f.key]) ?? null) : null]))
  const missing = entry.fields.filter((f) => f.needed && !values[f.key]?.trim()).map((f) => t(f.needed!))
  const valid = !missing.length && Object.values(problems).every((p) => !p)
  return (
    <FormSheet open onClose={onClose} mark={<ProviderTile entry={entry} size="sm" />} icon={Unplug} title={t('Connect {provider}', { provider: entry.label })} description={t(entry.about)} action={t('Connect')} valid={valid} submit={() => host.connectBucket(entry.request!(values)).then(done)} left={<BackLink onBack={() => setEntry(null)} label={t('Providers')} />} hint={missing.length ? t('Still needed: {list}', { list: missing.join(', ') }) : undefined}>
      {entry.fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          {f.kind === 'select' ? (
            <Choice label={t(f.label)} value={values[f.key] || '__none'} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v === '__none' ? '' : v }))} options={(f.options ?? []).map((o) => ({ value: o.value || '__none', label: t(o.label) }))} />
          ) : f.kind === 'secret' ? (
            <SecretField label={t(f.label)} value={values[f.key] ?? ''} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />
          ) : (
            <TextField label={t(f.label)} value={values[f.key] ?? ''} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} placeholder={f.placeholder ? t(f.placeholder) : undefined} mono={f.mono} autoFocus={f.key === 'name'} hint={problems[f.key] ? t(problems[f.key]!) : undefined} />
          )}
          {entry.notes.filter((n) => n.after === f.key).map((n, k) => (
            <p key={k} className={`text-[11.5px] leading-relaxed text-muted-foreground ${n.mono ? 'font-mono' : ''}`}>{n.text(values)}</p>
          ))}
        </div>
      ))}
    </FormSheet>
  )
}

export function SecretField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <Field id={id} label={label}>
      <Input id={id} type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} className="rounded-xl font-mono text-[13px]" />
    </Field>
  )
}
