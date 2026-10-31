// Adds a project to a Store: Init, empty or from a folder, followed until it
// ends (host.createProject with `store`, then host.projectInit).
import { FolderPlus, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { BTN, Field, FormError, INSET, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { NAME } from '@/components/storage/identity/providers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'
import type { ProjectInitJob, StoreInfo } from '@shared/host-api'

const STEP: Record<ProjectInitJob['step'], string> = { scan: 'Scanning the folder', volume: 'Preparing the Store', import: 'Importing files', done: 'Done', failed: 'Failed' }

/** Inits a project into this Store, empty or from a folder, and follows the Init. */
export function AddProjectDialog({ store, open, onOpenChange, onDone }: { store: StoreInfo; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  useI18n()
  const ids = { name: useId(), folder: useId() }
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [job, setJob] = useState<ProjectInitJob>()
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const busy = starting || (!!job && !job.ended)
  useEffect(() => {
    if (!job || job.ended) return
    const timer = setTimeout(() => {
      host.projectInit(job.id).then(
        (next) => {
          setJob(next)
          if (next.ended) {
            if (next.step === 'failed') setError(next.error?.message ?? t('Init failed'))
            else {
              onDone()
              onOpenChange(false)
            }
          }
        },
        (e: unknown) => setError(message(e)),
      )
    }, 1000)
    return () => clearTimeout(timer)
  }, [job, onDone, onOpenChange])
  const problem = name && !NAME.test(name) ? t('Lower-case letters, digits and hyphens.') : store.projects.includes(name) ? t('{store} has a project named {name}.', { store: store.name, name }) : null
  const folderProblem = folder && !folder.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(folder) ? t('An absolute path.') : null
  const start = async () => {
    setError(undefined)
    setStarting(true)
    try {
      setJob(await host.createProject({ name, ...(folder ? { source: folder } : {}), store: store.name }))
    } catch (e) {
      setError(message(e))
    } finally {
      setStarting(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className={`${SHEET} sm:max-w-[460px]`}>
        <SheetHeader icon={FolderPlus} title={t('Add a project to {store}', { store: store.name })}>
          {t('Empty, or a copy of a folder. It shares this Store’s storage, writer and link.')}
        </SheetHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name && !problem && !folderProblem && !busy) void start()
          }}
        >
          <Field id={ids.name} label={t('Name')} problem={problem}>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" autoFocus disabled={busy} className="rounded-xl text-[13px]" aria-invalid={!!problem} />
          </Field>
          <Field
            id={ids.folder}
            label={
              <>
                {t('Folder')} <span className="font-normal text-muted-foreground">({t('optional')})</span>
              </>
            }
            problem={folderProblem}
          >
            <Input id={ids.folder} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/you/my-app" disabled={busy} className="rounded-xl font-mono text-[12.5px]" aria-invalid={!!folderProblem} />
          </Field>
          {job && !job.ended && (
            <div role="status" className={`${INSET} flex items-center gap-2 text-[13px]`}>
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary" />
              <span className="font-medium">{t(STEP[job.step] ?? job.step)}</span>
            </div>
          )}
          <FormError error={error} />
          <SheetFooter>
            <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" className={BTN} disabled={!name || !!problem || !!folderProblem || busy}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderPlus className="size-3.5" />}
              {busy ? t('Adding…') : t('Add project')}
            </Button>
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
