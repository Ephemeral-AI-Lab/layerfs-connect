// Load… (storage-links §3.5, layerfs#509): a not-loaded remote file into a
// new local SQLite Store, linked to it, with all of its projects. A file a
// Store of this machine links to is refused before the call. The job runs in
// the dialog and carries on in the tray after "Run in background".
import { Download, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'

import { BackLink, BTN, Field, FormError, INSET, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { NAME } from '@/components/storage/identity/providers'
import { ProviderMark } from '@/components/storage/identity/store-icon'
import { LOW_DISK } from '@/components/storage/meters'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { putJob, useTransfers } from '@/components/storage/transfers/use-transfers'
import { normalizeJob } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ago, bytes } from '@/data/format'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StorageView } from '@shared/host-api'

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
  /** Opened from New: a link back to it. */
  onBack?: () => void
}

/** A file name as a Store name, when it can be one. */
const asStoreName = (file: string) =>
  file
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)

export function LoadDialog({ open, onOpenChange, view, remote, file, free, onDone, onOpenStore, onBack }: LoadDialogProps) {
  useI18n()
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

  const problem = into && !NAME.test(into) ? t('Lower-case letters, digits and hyphens, up to 32.') : taken.has(into) ? t('A Store named {name} exists here; pick another name.', { name: into }) : null
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
      <DialogContent className={`${SHEET} sm:max-w-[520px]`}>
        <SheetHeader icon={Download} title={t('Load {file}', { file })}>
          {t('A new SQLite Store on this machine from this file, with all of its projects, linked to it: Push and Pull then go there.')}
        </SheetHeader>
        {onBack && <BackLink onBack={onBack} />}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <p className={`${INSET} flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]`}>
            <ProviderMark provider={r?.provider} className="size-3.5" />
            <span className="font-mono font-medium">
              {remote} / {file}
            </span>
            <span className="text-xs text-muted-foreground">
              · {listed ? bytes(listed.bytes) : t('size unknown')}
              {listed?.modified ? ` · ${t('modified {ago}', { ago: ago(listed.modified) })}` : ''}
            </span>
          </p>
          {linkedBy ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-warning">
              {t('Already linked as')} <span className="font-mono">{linkedBy}</span>.
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="rounded-lg"
                onClick={() => {
                  onOpenChange(false)
                  onOpenStore(linkedBy)
                }}
              >
                {t('Open')}
              </Button>
            </p>
          ) : (
            <fieldset disabled={running} className="flex flex-col gap-3">
              <Field id={id} label={t('New Store')} problem={problem}>
                <Input id={id} value={into} onChange={(e) => setInto(e.target.value)} spellCheck={false} autoComplete="off" className="rounded-xl font-mono text-[13px]" aria-invalid={!!problem} autoFocus />
              </Field>
              <p className={cn('-mt-1 text-[11.5px]', left !== null && left < LOW_DISK ? 'text-warning' : 'text-muted-foreground')}>
                {listed?.bytes != null ? t('Needs {size} in the Docker volumes;', { size: bytes(listed.bytes) }) : t('Needs about the file’s size in the Docker volumes;')}{' '}
                {free !== null ? t('{size} free.', { size: bytes(free) }) : t('free space unknown.')}
              </p>
            </fieldset>
          )}
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
              {running ? t('Close') : t('Cancel')}
            </Button>
            {!running && !linkedBy && (
              <Button type="submit" size="sm" className={BTN} disabled={!ready}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                {busy ? t('Starting…') : t('Load')}
              </Button>
            )}
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
