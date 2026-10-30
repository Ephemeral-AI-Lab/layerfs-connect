// Publish and Send a copy (storage-links §3.5, layerfs#509): upload a SQLite
// Store to a new remote file on one of the bucket connections. Publish links
// the Store to the file; Send a copy links nothing and leaves the Store's link
// as it is. The engine refuses a file that exists (Exists, one HEAD before the
// upload): the dialog shows it under the file name. The job runs in the
// dialog and carries on in the tray after "Run in background".
import { CloudUpload, CopyPlus, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { BTN, Field, FormError, INSET, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { providerLabel } from '@/components/storage/identity/providers'
import { ProviderMark } from '@/components/storage/identity/store-icon'
import { isFailed, isRunning } from '@/components/storage/transfers/phases'
import { TransferRow } from '@/components/storage/transfers/transfer-row'
import { putJob, useTransfers } from '@/components/storage/transfers/use-transfers'
import { normalizeJob } from '@/components/storage/view'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import type { RemoteInfo, StorageView, StoreInfo } from '@shared/host-api'

/** A remote file's name: what the engine takes (the object <prefix>/<file>/store.sqlite). */
export const FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/

const HEALTH: Record<RemoteInfo['health']['state'], string> = { ok: 'Reachable', unreachable: 'Unreachable', denied: 'Keys refused', checking: 'Checking…', unknown: 'Not checked' }

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: StorageView
  store: StoreInfo
  /** publish: links the Store to the new file; send: links nothing. */
  mode: 'publish' | 'send'
  /** The connection to start with. */
  remote?: string
  /** The job ended well: the Store's name. */
  onDone: (store: string) => void
}

export function UploadDialog({ open, onOpenChange, view, store, mode, remote: preset, onDone }: UploadDialogProps) {
  useI18n()
  const ids = { remote: useId(), file: useId() }
  const remotes = view.remotes.list
  const fallback = mode === 'publish' ? store.name : `${store.name}-copy`
  const [remote, setRemote] = useState(preset ?? remotes[0]?.name ?? '')
  const [file, setFile] = useState(fallback)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [jobId, setJobId] = useState<string>()
  const transfers = useTransfers()
  const job = jobId ? transfers.all.find((j) => j.id === jobId) : undefined
  const running = !!job && isRunning(job)

  useEffect(() => {
    if (!open) return
    setRemote(preset ?? remotes[0]?.name ?? '')
    setFile(fallback)
    setError(undefined)
    setJobId(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset, store.name, mode])

  useEffect(() => {
    if (job && !isRunning(job) && !isFailed(job)) {
      onDone(job.store)
      onOpenChange(false)
    }
  }, [job, onDone, onOpenChange])

  const r = remotes.find((x) => x.name === remote)
  const listedBy = r?.files?.find((f) => f.file === file)
  // the engine's refusal is the rule; these say it before the request
  const problem = !file
    ? null
    : !FILE.test(file)
      ? t('Letters, digits, dots, hyphens and underscores, up to 128; not starting with a dot.')
      : listedBy
        ? listedBy.linkedBy
          ? t('{where} is linked to {store}; name another file.', { where: `${remote} / ${file}`, store: listedBy.linkedBy })
          : t(mode === 'publish' ? '{remote} already has a file named {file}; a publish never overwrites one.' : '{remote} already has a file named {file}; a send never overwrites one.', { remote, file })
        : job && isFailed(job) && job.error?.code === 'Exists'
          ? job.error.message
          : null
  const ready = !!remote && !!file && !problem && !busy && !running

  const start = async () => {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      const started = normalizeJob(mode === 'publish' ? await host.publish(store.name, remote, file) : await host.send(store.name, remote, file), remotes)
      putJob(started)
      setJobId(started.id)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const groups = [...new Set(remotes.map((x) => x.provider))].map((p) => ({ provider: p, list: remotes.filter((x) => x.provider === p).sort((a, b) => a.name.localeCompare(b.name)) }))
  const Icon = mode === 'publish' ? CloudUpload : CopyPlus

  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className={`${SHEET} sm:max-w-[520px]`}>
        <SheetHeader icon={Icon} title={t(mode === 'publish' ? 'Publish {store}' : 'Send a copy of {store}', { store: store.name })}>
          {mode === 'publish'
            ? t('Uploads {store} to a new file and links them: Push and Pull then go there.', { store: store.name })
            : store.link
              ? t('Uploads a copy to a new file that no Store links to. {store} stays linked to {where}.', { store: store.name, where: `${store.link.remote} / ${store.link.file}` })
              : t('Uploads a copy to a new file that no Store links to. {store} stays local only.', { store: store.name })}
        </SheetHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <fieldset className="flex flex-col gap-3.5" disabled={running}>
            <legend className="sr-only">{t('To')}</legend>
            <Field id={ids.remote} label={t('Connection')}>
              <Select value={remote} onValueChange={setRemote} disabled={running}>
                <SelectTrigger id={ids.remote} className="w-full rounded-xl">
                  <SelectValue placeholder={t('Choose a connection')} />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectGroup key={g.provider}>
                      <SelectLabel>{providerLabel(g.provider)}</SelectLabel>
                      {g.list.map((x) => (
                        <SelectItem key={x.name} value={x.name}>
                          <ProviderMark provider={x.provider} className="size-3.5" />
                          <span className="font-mono text-[13px]">{x.name}</span>
                          <span className="text-[12px] text-muted-foreground">{t(HEALTH[x.health.state])}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={ids.file} label={t('File name')} problem={problem} hint={r ? <span className="font-mono">{`${r.location}/${file || '<file>'}/store.sqlite`}</span> : undefined}>
              <Input id={ids.file} value={file} onChange={(e) => setFile(e.target.value)} spellCheck={false} autoComplete="off" className="rounded-xl font-mono text-[13px]" aria-invalid={!!problem} />
            </Field>
            {r && (r.health.state === 'unreachable' || r.health.state === 'denied') && (
              <p className="-mt-1 text-[11.5px] text-warning">
                {t(r.health.state === 'denied' ? '{remote} refused its keys at the last check' : '{remote} didn’t answer at the last check', { remote })}
                {r.health.message ? `: ${r.health.message}` : ''}
              </p>
            )}
          </fieldset>
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
            {!running && (
              <Button type="submit" size="sm" className={BTN} disabled={!ready}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
                {busy ? t('Starting…') : mode === 'publish' ? t('Publish') : t('Send')}
              </Button>
            )}
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Publish…: an unlinked Store to a new file, linked. */
export const PublishDialog = (props: Omit<UploadDialogProps, 'mode'>) => <UploadDialog {...props} mode="publish" />
