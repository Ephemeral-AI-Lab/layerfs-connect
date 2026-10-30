// Load… (storage-links §3.5, layerfs#509): a not-loaded remote file into a
// new local SQLite Store, linked to it, with all of its projects. A file a
// Store of this machine links to is refused before the call. The job runs in
// the dialog and carries on in the tray after "Run in background".
import { Download } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { Field, FormError, message } from '@/components/storage/dialogs/fields'
import { NAME } from '@/components/storage/identity/providers'
import { ProviderMark } from '@/components/storage/identity/store-icon'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { putJob, useTransfers } from '@/components/storage/transfers/use-transfers'
import { normalizeJob } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ago, bytes } from '@/data/format'
import { host } from '@/host/client'
import { cn } from '@/lib/utils'
import type { StorageView } from '@shared/host-api'

/** Free space under this after a load is a warning (the low-disk line). */
const LOW = 20e9

interface LoadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: StorageView
  remote: string
  file: string
  /** Free bytes in the Docker volumes, or null when unknown. */
  free: number | null
  /** The load ended well: the new Store's name. */
  onDone: (store: string) => void
  /** Opens a Store (the one a linked file belongs to). */
  onOpenStore: (store: string) => void
}

/** A file name as a Store name, when it can be one. */
const asStoreName = (file: string) => file.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

export function LoadDialog({ open, onOpenChange, view, remote, file, free, onDone, onOpenStore }: LoadDialogProps) {
  const id = useId()
  const taken = useMemo(() => new Set(view.stores.list.map((s) => s.name)), [view.stores.list])
  const r = view.remotes.list.find((x) => x.name === remote)
  const listed = r?.files?.find((f) => f.file === file)
  const linkedBy = listed?.linkedBy ?? view.stores.list.find((s) => s.link?.remote === remote && s.link.file === file)?.name ?? null
  const [into, setInto] = useState(asStoreName(file))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [jobId, setJobId] = useState<string>()
  const transfers = useTransfers()
  const job = jobId ? transfers.all.find((j) => j.id === jobId) : undefined
  const running = !!job && isRunning(job)

  useEffect(() => {
    if (!open) return
    setInto(asStoreName(file))
    setError(undefined)
    setJobId(undefined)
  }, [open, file])

  useEffect(() => {
    if (job && !isRunning(job) && !isFailed(job)) {
      onDone(job.store)
      onOpenChange(false)
    }
  }, [job, onDone, onOpenChange])

  const problem = into && !NAME.test(into) ? 'Lower-case letters, digits and hyphens, up to 32.' : taken.has(into) ? `A Store named ${into} exists here; pick another name.` : null
  const ready = !linkedBy && !!into && !problem && !busy && !running
  const left = listed?.bytes != null && free !== null ? free - listed.bytes : null

  const start = async () => {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      const started = normalizeJob(await host.load(remote, file, into), view.remotes.list)
      putJob(started)
      setJobId(started.id)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Load {file}</DialogTitle>
          <DialogDescription>A new SQLite Store on this machine from this file, with all of its projects, linked to it: Push and Pull then go there.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/45 px-3 py-2 text-[13px] ring-1 ring-foreground/[0.05] ring-inset">
            <ProviderMark provider={r?.provider} className="size-3.5" />
            <span className="font-mono">
              {remote} / {file}
            </span>
            <span className="text-muted-foreground">
              · {listed ? bytes(listed.bytes) : 'size unknown'}
              {listed?.modified ? ` · modified ${ago(listed.modified)}` : ''}
            </span>
          </p>
          {linkedBy ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-warning">
              Already linked as <span className="font-mono">{linkedBy}</span>.
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  onOpenStore(linkedBy)
                }}
              >
                Open
              </Button>
            </p>
          ) : (
            <fieldset disabled={running} className="flex flex-col gap-3">
              <Field id={id} label="New Store" problem={problem}>
                <Input id={id} value={into} onChange={(e) => setInto(e.target.value)} spellCheck={false} autoComplete="off" className="font-mono text-[13px]" aria-invalid={!!problem} autoFocus />
              </Field>
              <p className={cn('-mt-1 text-[12px]', left !== null && left < LOW ? 'text-warning' : 'text-muted-foreground')}>
                {listed?.bytes != null ? `Needs ${bytes(listed.bytes)} in the Docker volumes; ` : 'Needs about the file’s size in the Docker volumes; '}
                {free !== null ? `${bytes(free)} free.` : 'free space unknown.'}
              </p>
            </fieldset>
          )}
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
              {running ? 'Close' : 'Cancel'}
            </Button>
            {!running && !linkedBy && (
              <Button type="submit" disabled={!ready}>
                <Download /> {busy ? 'Starting…' : 'Load'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
