import { fill } from '@/lib/text'
// The Storage page's dialogs on LayerFS 2.0: one small form per action. A
// secret is never typed here: buckets and PostgreSQL Stores take a reference
// (env:LAYERFS_… or file:/absolute/path) that LayerFS resolves.
import { Archive, ArrowRightLeft, Database, HardDriveDownload, HardDriveUpload, LoaderCircle, type LucideIcon, Plus, Power, TriangleAlert, Unplug } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { BTN, Field, SHEET, SheetFooter, SheetHeader } from '@/pages/storage/dialogs/Fields'
import { Refusal } from '@/components/layerfs/Refusal'
import { Mark, Tile } from '@/pages/storage/StorageIcons'
import { type FieldValues, isBrandMark, type ProviderEntry, PROVIDERS } from '@/components/layerfs/identity/providers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Notice } from '@/pages/storage/Notice'
import { bytes } from '@/layerfs/format'
import { host } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import type { MachinesView, StorageView, StoreRow } from '@/layerfs/host-api'

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
export function FormSheet({ open, onClose, icon, mark, title, description, action, valid, submit, left, hint, wide, children }: { open: boolean; onClose: () => void; icon: LucideIcon; mark?: React.ReactNode; title: string; description?: React.ReactNode; action: string; valid: boolean; submit: () => Promise<unknown>; left?: React.ReactNode; hint?: string; wide?: boolean; children: React.ReactNode }) {
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
      <DialogContent className={`${SHEET} ${wide ? 'sm:max-w-[680px]' : 'sm:max-w-[480px]'}`}>
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
          {error !== undefined && <Refusal error={error} className="rounded-lg-plus bg-destructive/[0.06] px-3.5 py-3 text-destructive" />}
          {hint && <p className="text-xs-plus text-muted-foreground">{hint}</p>}
          <SheetFooter left={left}>
            <Button type="button" variant="outline" size="sm" className={BTN} onClick={onClose} disabled={busy}>
              {'Cancel'}
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
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" spellCheck={false} className={`rounded-lg-plus text-md ${mono ? 'font-mono' : ''}`} />
    </Field>
  )
}

export function Choice({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string }) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="rounded-lg-plus text-md">
          <SelectValue placeholder={'Choose'} />
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
        <FormSheet open={open} onClose={close} icon={Plus} title={'New Store'} description={'An empty sqlite Store saved under the home. Add projects to it, then push it to any machine.'} action={'Create'} valid={!!a} submit={() => after(host.createStore(a))}>
          <TextField label={'Name'} value={a} onChange={setA} placeholder="work" autoFocus mono />
        </FormSheet>
      )
    case 'push':
    case 'move':
      return <PlaceSheet dialog={dialog} onClose={close} done={done} />
    case 'backup': {
      const buckets = (view?.buckets ?? []).map((x) => x.name)
      return (
        <FormSheet open={open} onClose={close} icon={Archive} title={`Back up ${dialog.store.name} to…`} description={'A snapshot of the whole Store, taken on its machine and sent through Connect to the bucket.'} action={'Back up'} valid={!!a} submit={() => after(host.backupStore(dialog.store.name, a, b || undefined))}>
          <Choice label={'Bucket'} value={a} onChange={setA} options={buckets.map((n) => ({ value: n, label: n }))} hint={buckets.length ? undefined : 'Connect a bucket first.'} />
          <TextField label={'File name'} value={b} onChange={setB} placeholder={dialog.store.links.find((l) => l.bucket === a)?.file ?? dialog.store.name} hint={'Leave empty for the Store’s link, else its name.'} mono />
        </FormSheet>
      )
    }
    case 'postgresql':
      return (
        <FormSheet open={open} onClose={close} icon={Database} title={'Connect a PostgreSQL Store'} description={'A database as a Store. It is never pushed or pulled; its projects’ Sandboxes run on any machine that supports PostgreSQL Sandboxes.'} action={'Connect'} valid={!!a && !!b && !!c} submit={() => after(host.connectPostgresql({ name: a, url: b, password: c, synchronousCommit: d || undefined }))}>
          <TextField label={'Name'} value={a} onChange={setA} placeholder="team" autoFocus mono />
          <TextField label={'URL, without the password'} value={b} onChange={setB} placeholder="postgresql://user@host:5432/db" mono hint={'A URL that holds a password is refused.'} />
          <TextField label={'Password'} value={c} onChange={setC} placeholder="file:/Users/me/.config/layerfs/team.password" mono hint={REFERENCE_HINT} />
          <Choice label={'synchronous_commit'} value={d} onChange={setD} options={['off', 'local', 'remote_write', 'on', 'remote_apply'].map((v) => ({ value: v, label: v }))} hint={'Left out: the database’s own setting.'} />
        </FormSheet>
      )
    case 'bucket':
      return <BucketSheet onClose={close} done={done} />
    case 'restore':
      return (
        <FormSheet open={open} onClose={close} icon={HardDriveDownload} title={`Restore ${dialog.file}`} description={'Saves the copy in the home as a new Store, with its projects. The Store the copy came from is not changed.'} action={'Restore'} valid={!!b} submit={() => after(host.restoreBackup(dialog.bucket, b, dialog.file))}>
          <TextField label={'New Store’s name'} value={b} onChange={setB} placeholder={`${dialog.file}-restored`} autoFocus mono />
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
  const s = dialog.store
  const machines = useHostQuery(() => host.machines(), [])
  const [target, setTarget] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<unknown>(null)
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
      title={fill(push ? 'Push {store} to…' : 'Move {store} to another machine', { store: s.name })}
      description={
        push
          ? `The whole Store goes, every project in it (${s.projects.length}); its Sandboxes then run on that machine. Pull brings it back to native.`
          : 'A pull to the home, then a push to the machine: two operations. If the push fails, the Store stays in the home and you can push it again.'
      }
      action={fill(push ? 'Push' : 'Move')}
      valid={!!target}
      submit={() => (push ? host.pushStore(s.name, target) : host.moveStore(s.name, target)).then(done)}
    >
      <Choice
        label={'Machine'}
        value={target}
        onChange={setTarget}
        options={targets.map((m) => ({ value: m.name, label: `${m.name} (${m.platform}) · ${m.state}` }))}
        hint={machines.loading && !view ? 'Reading the machines…' : targets.length ? undefined : 'No other machine holds sqlite Stores. Add one on Machines.'}
      />
      {chosen && (
        <p className="text-xs-plus leading-relaxed text-muted-foreground tabular-nums">
          {free !== null ? `${bytes(free)} free on ${chosen.name}; the Store is ${size !== null ? bytes(size) : 'of unknown size'}.` : `${chosen.name}’s free disk is not known until it runs.`}{' '}
          {chosen.state !== 'running' && `${chosen.name} is ${chosen.state}: nothing starts it for you.`}
        </p>
      )}
      {chosen?.state === 'stopped' && (
        <Button type="button" size="sm" variant="outline" className="h-7 self-start rounded-lg-plus px-2.5 text-sm" disabled={starting} onClick={() => { setStarting(true); host.startMachine(chosen.name).then(machines.reload, (e: unknown) => setStartError(e)).finally(() => setStarting(false)) }}>
          {starting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Power className="size-3.5" />} {`Start ${chosen.name}`}
        </Button>
      )}
      {startError !== null && <Refusal error={startError} className="text-destructive" />}
      {(s.holders > 0 || sandboxes.length > 0) && (
        <Notice tone="warning" icon={TriangleAlert} title={'Held now: the push is refused while these remain'}>
          {[s.holders > 0 && fill(s.holders === 1 ? '1 process has it open' : '{n} processes have it open', { n: s.holders }), ...sandboxes.map((b) => `Sandbox ${b.name} (${b.project ?? ''})`)].filter(Boolean).join(' · ')}
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

/** A sheet's header choice: one tile per option (its mark and name), the chosen one lit. */
export function TileChoice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; mark: React.ReactNode }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors ${value === o.value ? 'border-primary/40 bg-primary/[0.04] shadow-xs' : 'border-foreground/[0.08] bg-background/40 hover:bg-foreground/[0.03]'}`}>
          {o.mark}
          <span className="min-w-0 truncate text-md font-strong">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

const READY = PROVIDERS.filter((p) => p.request)
const KEY_FIELDS = new Set(['accessKey', 'secretKey'])
/** Every provider's fields, on one row; the provider's own (endpoint, account) go on the next. */
const SHARED_FIELDS = new Set(['name', 'bucket', 'prefix'])

/**
 * New bucket (the Backups tab's one way in): the providers LayerFS backs up
 * to (MinIO, Cloudflare R2) as a choice at the top, the chosen one's form
 * under it, in one sheet. The keys are written by the host to an owner-only
 * file, passed to LayerFS by reference.
 */
function BucketSheet({ onClose, done }: { onClose: () => void; done: () => void }) {
  const [entry, setEntry] = useState<ProviderEntry>(READY[0])
  const [values, setValues] = useState<FieldValues>(() => Object.fromEntries(READY[0].fields.map((f) => [f.key, f.default ?? ''])))
  const pick = (e: ProviderEntry) => {
    setEntry(e)
    setValues((v) => Object.fromEntries(e.fields.map((f) => [f.key, v[f.key] || (f.default ?? '')])))
  }
  const problems = Object.fromEntries(entry.fields.map((f) => [f.key, values[f.key] ? (f.validate?.(values[f.key]) ?? null) : null]))
  const missing = entry.fields.filter((f) => f.needed && !values[f.key]?.trim()).map((f) => f.needed!)
  const valid = !missing.length && Object.values(problems).every((p) => !p)
  return (
    <FormSheet open wide onClose={onClose} icon={Unplug} title={'New bucket'} description={'A bucket that holds SQLite Store backups. Connecting it links no Store; you can add as many as you like.'} action={'Connect bucket'} valid={valid} submit={() => host.connectBucket(entry.request!(values)).then(done)} hint={missing.length ? `Still needed: ${missing.join(', ')}` : undefined}>
      <TileChoice label={'Provider'} value={entry.id} onChange={(id) => pick(READY.find((e) => e.id === id)!)} options={READY.map((e) => ({ value: e.id, label: e.label, mark: <ProviderTile entry={e} size="sm" /> }))} />
      {[
        { title: 'Where', rows: [entry.fields.filter((f) => SHARED_FIELDS.has(f.key)), entry.fields.filter((f) => !SHARED_FIELDS.has(f.key) && !KEY_FIELDS.has(f.key))] },
        { title: 'Keys', rows: [entry.fields.filter((f) => KEY_FIELDS.has(f.key))] },
      ].map((g) => (
        <section key={g.title} className="flex flex-col gap-3 border-t border-foreground/[0.06] pt-4">
          <h3 className="text-xs font-strong tracking-wide text-muted-foreground uppercase">{g.title}</h3>
          {g.rows.filter((row) => row.length).map((row, r) => (
            <div key={r} className="flex flex-col gap-x-4 gap-y-3.5 sm:flex-row">
              {row.map((f) => (
                <div key={f.key} className={f.kind === 'select' ? 'shrink-0 sm:min-w-36' : 'min-w-0 flex-1'}>
                  {f.kind === 'select' ? (
                    <Choice label={f.label} value={values[f.key] || '__none'} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v === '__none' ? '' : v }))} options={(f.options ?? []).map((o) => ({ value: o.value || '__none', label: o.label }))} />
                  ) : f.kind === 'secret' ? (
                    <SecretField label={f.label} value={values[f.key] ?? ''} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />
                  ) : (
                    <TextField label={f.label} value={values[f.key] ?? ''} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} placeholder={f.placeholder ? f.placeholder : undefined} mono={f.mono} autoFocus={f.key === 'name'} hint={problems[f.key] ? problems[f.key]! : undefined} />
                  )}
                </div>
              ))}
            </div>
          ))}
          {entry.notes.filter((n) => g.rows.flat().some((f) => f.key === n.after)).map((n, k) => (
            <p key={k} className={`text-xs-plus leading-relaxed text-muted-foreground ${n.mono ? 'font-mono' : ''}`}>{n.text(values)}</p>
          ))}
        </section>
      ))}
    </FormSheet>
  )
}

export function SecretField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <Field id={id} label={label}>
      <Input id={id} type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} className="rounded-lg-plus font-mono text-md" />
    </Field>
  )
}
