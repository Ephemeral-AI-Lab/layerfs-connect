// Adds a project to a Store: Init, empty or from a folder, followed until it
// ends. Lifted unchanged out of the old store-detail.tsx.
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { host } from '@/host/client'
import type { InitJob, StoreInfo } from '@shared/host-api'

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Inits a project into this Store, empty or from a folder, and follows the Init. */
export function AddProjectDialog({ store, open, onOpenChange, onDone }: { store: StoreInfo; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const ids = { name: useId(), folder: useId() }
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [job, setJob] = useState<InitJob>()
  const [error, setError] = useState<string>()
  const busy = !!job && !job.ended
  useEffect(() => {
    if (!job || job.ended) return
    const timer = setTimeout(() => {
      host.initJob(job.id).then(
        (next) => {
          setJob(next)
          if (next.ended) {
            if (next.step === 'failed') setError(next.error?.message ?? 'Init failed')
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
  const problem = name && !NAME.test(name) ? 'Lower-case letters, digits and hyphens.' : store.projects.includes(name) ? `${store.name} has a project named ${name}.` : null
  const folderProblem = folder && !folder.startsWith('/') ? 'An absolute path.' : null
  const start = async () => {
    setError(undefined)
    try {
      setJob(await host.createProject(name, folder || undefined, store.name))
    } catch (e) {
      setError(message(e))
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add a project to {store.name}</DialogTitle>
          <DialogDescription>Empty, or a copy of a folder. It shares this Store’s storage, writer and copies.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name && !problem && !folderProblem) void start()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className="text-[13px] font-medium">
              Name
            </label>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" autoFocus disabled={busy} className="font-mono text-[13px]" aria-invalid={!!problem} />
            {problem && <p className="text-[12px] text-destructive">{problem}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.folder} className="text-[13px] font-medium">
              Folder <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input id={ids.folder} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/you/my-app" disabled={busy} className="font-mono text-[12.5px]" aria-invalid={!!folderProblem} />
            {folderProblem && <p className="text-[12px] text-destructive">{folderProblem}</p>}
          </div>
          {job && !job.ended && (
            <div role="status" className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px]">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary" />
              <span className="font-medium">Init: {job.step}</span>
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name || !!problem || !!folderProblem || busy}>
              {busy ? 'Adding…' : 'Add project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
