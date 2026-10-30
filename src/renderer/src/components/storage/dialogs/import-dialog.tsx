// Import into PostgreSQL (storage-redesign §3.9): copy a SQLite Store, all of
// its projects, into a new PostgreSQL Store. Both stay; they don't sync after.
import { ArrowRight, DatabaseZap, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { count } from '@/components/storage/actions'
import { BackLink, BTN, Field, FormError, INSET, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { NAME } from '@/components/storage/identity/providers'
import { FamilyTile, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { totalText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { putJob, useTransfers } from '@/components/storage/transfers/use-transfers'
import { normalizeJob } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import type { StorageView } from '@shared/host-api'

/** The schema the host makes for a Store name. */
export const schemaFor = (name: string) => `lfc_${name.replace(/-/g, '_')}`

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: StorageView
  /** Fixed when opened from a Store. */
  store?: string
  /** Fixed when opened from a connection. */
  connection?: string
  /** The import ended well: the new PostgreSQL Store's name. */
  onDone: (store: string) => void
  /** Opened from New: a link back to it. */
  onBack?: () => void
}

export function ImportDialog({ open, onOpenChange, view, store: fixedStore, connection: fixedConnection, onDone, onBack }: ImportDialogProps) {
  useI18n()
  const ids = { store: useId(), connection: useId(), name: useId() }
  const sqlite = useMemo(() => view.stores.list.filter((s) => s.kind === 'sqlite').sort((a, b) => a.name.localeCompare(b.name)), [view.stores.list])
  const connections = view.postgresql.connections
  const taken = useMemo(() => new Set(view.stores.list.map((s) => s.name)), [view.stores.list])
  const [store, setStore] = useState(fixedStore ?? sqlite[0]?.name ?? '')
  const [connection, setConnection] = useState(fixedConnection ?? connections[0]?.name ?? '')
  const [name, setName] = useState('')
  const [named, setNamed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [jobId, setJobId] = useState<string>()
  const transfers = useTransfers()
  const job = jobId ? transfers.all.find((j) => j.id === jobId) : undefined
  const running = !!job && isRunning(job)

  useEffect(() => {
    if (!open) return
    const s = fixedStore ?? sqlite[0]?.name ?? ''
    setStore(s)
    setConnection(fixedConnection ?? connections[0]?.name ?? '')
    setName(s ? `${s}-pg` : '')
    setNamed(false)
    setError(undefined)
    setJobId(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixedStore, fixedConnection])

  useEffect(() => {
    if (job && !isRunning(job) && !isFailed(job)) {
      onDone(job.from ?? name)
      onOpenChange(false)
    }
  }, [job, name, onDone, onOpenChange])

  const source = sqlite.find((s) => s.name === store)
  const target = connections.find((c) => c.name === connection)
  const problem = name && !NAME.test(name) ? t('Lower-case letters, digits and hyphens, up to 32.') : taken.has(name) ? t('A Store named {name} exists; pick another name.', { name }) : null
  const ready = !!source && !!target && !!name && !problem && !busy && !job
  const pickStore = (v: string) => {
    setStore(v)
    if (!named) setName(`${v}-pg`)
  }

  const start = async () => {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      const started = normalizeJob(await host.importPostgresql(store, connection, name))
      putJob({ ...started, from: started.from ?? name, provider: 'postgresql' })
      setJobId(started.id)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className={`${SHEET} sm:max-w-[560px]`}>
        <SheetHeader icon={DatabaseZap} title={t('Import into PostgreSQL')}>
          {t('Copies a SQLite Store, all of its projects, into a new PostgreSQL Store.')} <span className="font-semibold text-foreground">{t('Both stay. They don’t sync after this.')}</span>
        </SheetHeader>
        {onBack && <BackLink onBack={onBack} />}
        <div aria-hidden="true" className={`${INSET} grid grid-cols-[1fr_auto_1fr] items-center gap-3`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {source ? <StoreIcon family="sqlite" providers={storeProviders(source, view.remotes.list)} size="md" /> : <FamilyTile family="sqlite" size="md" />}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{source?.name ?? t('SQLite Store')}</p>
              <p className="truncate text-[11.5px] text-muted-foreground">SQLite{source ? ` · ${count(source.projects.length, 'project')} · ${totalText(source.size?.bytes ?? 0, source.size ? 0 : 1, 1)}` : ''}</p>
            </div>
          </div>
          <span className="sc-bridge flex items-center text-primary">
            <ArrowRight className="size-4" />
          </span>
          <div className="flex min-w-0 items-center justify-end gap-2.5 text-right">
            <div className="min-w-0">
              <p className="truncate font-mono text-[13px] font-semibold">{target?.name ?? t('connection')}</p>
              <p className="truncate text-[11.5px] text-muted-foreground">{t('new Store {name}', { name: name || '…' })}</p>
            </div>
            <FamilyTile family="postgresql" size="md" />
          </div>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <fieldset className="grid grid-cols-1 gap-3.5 sm:grid-cols-2" disabled={!!job}>
            <legend className="sr-only">{t('What to import, and where')}</legend>
            <Field id={ids.store} label={t('SQLite Store')}>
              <Select value={store} onValueChange={pickStore} disabled={!!fixedStore || !!job}>
                <SelectTrigger id={ids.store} className="w-full rounded-xl">
                  <SelectValue placeholder={t('Choose a Store')} />
                </SelectTrigger>
                <SelectContent>
                  {sqlite.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      <span className="font-mono text-[13px]">{s.name}</span>
                      <span className="text-[12px] text-muted-foreground">{count(s.projects.length, 'project')}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={ids.connection} label={t('Connection')}>
              <Select value={connection} onValueChange={setConnection} disabled={!!fixedConnection || !!job}>
                <SelectTrigger id={ids.connection} className="w-full rounded-xl">
                  <SelectValue placeholder={t('Choose a connection')} />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      <span className="font-mono text-[13px]">{c.name}</span>
                      <HealthDot health={c.health} quiet />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id={ids.name}
              label={t('New Store')}
              problem={problem}
              hint={
                <>
                  {t('Schema')} <span className="font-mono">{schemaFor(name || '…')}</span>
                </>
              }
            >
              <Input
                id={ids.name}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNamed(true)
                }}
                spellCheck={false}
                autoComplete="off"
                className="rounded-xl font-mono text-[13px]"
                aria-invalid={!!problem}
              />
            </Field>
          </fieldset>
          {target && (target.health.state === 'unreachable' || target.health.state === 'denied') && (
            <p className="-mt-1 text-[11.5px] text-warning">
              {t('{name} is not answering', { name: target.name })}
              {target.health.message ? `: ${target.health.message}` : ''}. {t('The import may fail.')}
            </p>
          )}
          {connections.length === 0 && <p className="text-xs text-muted-foreground">{t('Add a PostgreSQL connection first.')}</p>}
          {job && (
            <div className={INSET}>
              <TransferRow job={job} form="card" />
            </div>
          )}
          <FormError error={error} />
          <SheetFooter
            left={
              running && (
                <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)}>
                  {t('Run in background')}
                </Button>
              )
            }
          >
            <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)} disabled={busy}>
              {job ? t('Close') : t('Cancel')}
            </Button>
            {!job && (
              <Button type="submit" size="sm" className={BTN} disabled={!ready}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <DatabaseZap className="size-3.5" />}
                {busy ? t('Starting…') : t('Import')}
              </Button>
            )}
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
