// Import into PostgreSQL (storage-redesign §3.9): copy a SQLite Store, all of
// its projects, into a new PostgreSQL Store. Both stay; they don't sync after.
import { ArrowRight, DatabaseZap } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { Field, FormError, message } from '@/components/storage/dialogs/fields'
import { NAME } from '@/components/storage/identity/providers'
import { FamilyTile, StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { totalText } from '@/components/storage/size'
import { HealthDot } from '@/components/storage/sync/health-dot'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { putJob, useTransfers } from '@/components/storage/transfers/use-transfers'
import { normalizeJob } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { host } from '@/host/client'
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
}

export function ImportDialog({ open, onOpenChange, view, store: fixedStore, connection: fixedConnection, onDone }: ImportDialogProps) {
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
  const problem = name && !NAME.test(name) ? 'Lower-case letters, digits and hyphens, up to 32.' : taken.has(name) ? `A Store named ${name} exists; pick another name.` : null
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
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import into PostgreSQL</DialogTitle>
          <DialogDescription>
            Copies a SQLite Store, all of its projects, into a new PostgreSQL Store. <span className="font-medium text-foreground">Both stay. They don’t sync after this.</span>
          </DialogDescription>
        </DialogHeader>
        <div aria-hidden="true" className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-muted/45 px-4 py-3 ring-1 ring-foreground/[0.04] ring-inset">
          <div className="flex min-w-0 items-center gap-2.5">
            {source ? <StoreIcon family="sqlite" providers={storeProviders(source, view.remotes.list)} size="md" /> : <FamilyTile family="sqlite" size="md" />}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{source?.name ?? 'SQLite Store'}</p>
              <p className="truncate text-[11.5px] text-muted-foreground">
                SQLite{source ? ` · ${source.projects.length === 1 ? '1 project' : `${source.projects.length} projects`} · ${totalText(source.size?.bytes ?? 0, source.size ? 0 : 1, 1)}` : ''}
              </p>
            </div>
          </div>
          <span className="sc-bridge flex items-center text-primary">
            <ArrowRight className="size-4" />
          </span>
          <div className="flex min-w-0 items-center justify-end gap-2.5 text-right">
            <div className="min-w-0">
              <p className="truncate font-mono text-[13px] font-medium">{target?.name ?? 'connection'}</p>
              <p className="truncate text-[11.5px] text-muted-foreground">new Store {name || '…'}</p>
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
          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2" disabled={!!job}>
            <legend className="sr-only">What to import, and where</legend>
            <Field id={ids.store} label="SQLite Store">
              <Select value={store} onValueChange={pickStore} disabled={!!fixedStore || !!job}>
                <SelectTrigger id={ids.store} className="w-full">
                  <SelectValue placeholder="Choose a Store" />
                </SelectTrigger>
                <SelectContent>
                  {sqlite.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      <span className="font-mono text-[13px]">{s.name}</span>
                      <span className="text-[12px] text-muted-foreground">{s.projects.length === 1 ? '1 project' : `${s.projects.length} projects`}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={ids.connection} label="Connection">
              <Select value={connection} onValueChange={setConnection} disabled={!!fixedConnection || !!job}>
                <SelectTrigger id={ids.connection} className="w-full">
                  <SelectValue placeholder="Choose a connection" />
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
            <Field id={ids.name} label="New Store" problem={problem} hint={<>Schema <span className="font-mono">{schemaFor(name || '…')}</span></>}>
              <Input
                id={ids.name}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNamed(true)
                }}
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-[13px]"
                aria-invalid={!!problem}
              />
            </Field>
          </fieldset>
          {target && (target.health.state === 'unreachable' || target.health.state === 'denied') && (
            <p className="-mt-1 text-[12px] text-warning">
              {target.name} is not answering{target.health.message ? `: ${target.health.message}` : ''}. The import may fail.
            </p>
          )}
          {connections.length === 0 && <p className="text-[12px] text-muted-foreground">Add a PostgreSQL connection first.</p>}
          {job && (
            <div className="@container/tray rounded-lg bg-muted/50 px-3 py-3 ring-1 ring-foreground/[0.05] ring-inset">
              <TransferRow job={job} form="card" />
            </div>
          )}
          <FormError error={error} />
          <DialogFooter>
            {running && (
              <Button type="button" variant="outline" className="sm:mr-auto" onClick={() => onOpenChange(false)}>
                Run in background
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {job ? 'Close' : 'Cancel'}
            </Button>
            {!job && (
              <Button type="submit" disabled={!ready}>
                <DatabaseZap /> {busy ? 'Starting…' : 'Import'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
