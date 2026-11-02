// The Storage page's dialogs on LayerFS 2.0: one small form per action. A
// secret is never typed here: buckets and PostgreSQL Stores take a reference
// (env:LAYERFS_… or file:/absolute/path) that LayerFS resolves.
import { Archive, Database, HardDriveDownload, LoaderCircle, type LucideIcon, MoveRight, Plus, Unplug } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { BTN, Field, FormError, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import type { StorageView, StoreRow } from '@shared/host-api'

/** Which dialog is open, and on what. */
export type StorageDialog =
  | { kind: 'new-store' }
  | { kind: 'move'; store: StoreRow }
  | { kind: 'backup'; store: StoreRow }
  | { kind: 'postgresql' }
  | { kind: 'bucket' }
  | { kind: 'restore'; bucket: string; file: string }

const REFERENCE_HINT = 'A reference, never the secret: file:/absolute/path (readable by you only) or env:LAYERFS_<NAME>.'

/** A form in a sheet: its fields, one submit that may be refused (shown under the form). */
function FormSheet({ open, onClose, icon, title, description, action, valid, submit, children }: { open: boolean; onClose: () => void; icon: LucideIcon; title: string; description?: React.ReactNode; action: string; valid: boolean; submit: () => Promise<unknown>; children: React.ReactNode }) {
  useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
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
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const Icon = icon
  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent className={`${SHEET} sm:max-w-[480px]`}>
        <SheetHeader icon={icon} title={title}>
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
          <FormError error={error} />
          <SheetFooter>
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

function TextField({ label, value, onChange, hint, placeholder, autoFocus, mono }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; autoFocus?: boolean; mono?: boolean }) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" spellCheck={false} className={`rounded-xl text-[13px] ${mono ? 'font-mono' : ''}`} />
    </Field>
  )
}

function Choice({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string }) {
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
    case 'move': {
      const machines = (view?.machines ?? []).filter((m) => m.name !== dialog.store.machine)
      return (
        <FormSheet open={open} onClose={close} icon={MoveRight} title={t('Move {store} to…', { store: dialog.store.name })} description={t('The whole Store moves, every project in it ({n}). It must be idle: no Sandbox open on it. Its Sandboxes then run on the new machine.', { n: dialog.store.projects.length })} action={t('Move')} valid={!!a} submit={() => after(host.moveStore(dialog.store.name, a))}>
          <Choice label={t('Machine')} value={a} onChange={setA} options={machines.map((m) => ({ value: m.name, label: `${m.name} (${m.platform})` }))} />
        </FormSheet>
      )
    }
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
      return (
        <FormSheet open={open} onClose={close} icon={Unplug} title={t('Connect a bucket')} description={t('An r2 or MinIO bucket for backups. One listing proves the bucket answers with this key.')} action={t('Connect')} valid={!!a && !!b && !!c} submit={() => after(host.connectBucket({ name: a, url: b, key: c, region: d || undefined }))}>
          <TextField label={t('Name')} value={a} onChange={setA} placeholder="backups" autoFocus mono />
          <TextField label={t('URL')} value={b} onChange={setB} placeholder="http://127.0.0.1:9000/bucket/prefix" mono hint={t('MinIO: http(s)://<host>/<bucket>/<prefix>. R2: r2://<account>/<bucket>/<prefix>.')} />
          <TextField label={t('Key')} value={c} onChange={setC} placeholder="file:/Users/me/.config/layerfs/backups.key" mono hint={t('A file with lines access_key=… and secret_key=…, readable by you only, or env:LAYERFS_BUCKET_<NAME> (its _ACCESS_KEY and _SECRET_KEY set before Connect starts).')} />
          <TextField label={t('Region')} value={d} onChange={setD} placeholder="us-east-1" mono />
        </FormSheet>
      )
    case 'restore':
      return (
        <FormSheet open={open} onClose={close} icon={HardDriveDownload} title={t('Restore {file}', { file: dialog.file })} description={t('Installs the copy as a new Store on native, with its projects. The Store the copy came from is not changed.')} action={t('Restore')} valid={!!b} submit={() => after(host.restoreBackup(dialog.bucket, b, dialog.file))}>
          <TextField label={t('New Store’s name')} value={b} onChange={setB} placeholder={`${dialog.file}-restored`} autoFocus mono />
        </FormSheet>
      )
  }
}
