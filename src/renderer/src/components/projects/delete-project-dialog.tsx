import { t, useI18n } from '@/i18n'
import { FolderClosed, LoaderCircle, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { projectKey, type ProjectSummary } from '@shared/host-api'

import { StoreLine, storeFacts, useStorageView } from '@/components/projects/store-facts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { HostError } from '@/host/client'

interface DeleteProjectDialogProps {
  project: ProjectSummary
  onClose: () => void
  /** Deletes the project with this key (projectKey: `store/name` in a shared Store). */
  onDelete: (key: string) => Promise<void>
}

export function DeleteProjectDialog({ project, onClose, onDelete }: DeleteProjectDialogProps) {
  useI18n()
  const store = storeFacts(project, useStorageView())
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(document.activeElement as HTMLElement | null)

  async function remove() {
    if (inFlight.current) return
    inFlight.current = true
    setDeleting(true)
    setError('')
    try {
      await onDelete(projectKey(project))
      onClose()
    } catch (cause) {
      setError(cause instanceof HostError && cause.code === 'Busy'
        ? 'This project is still in use. Close its sandboxes, then try again.'
        : (cause as Error).message)
      inFlight.current = false
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose() }}>
      <DialogContent
        role="alertdialog"
        showCloseButton={!deleting}
        className="max-h-[calc(100dvh-3rem)] gap-5 overflow-y-auto rounded-3xl [--dialog-inset:1.5rem] sm:max-w-[420px]"
        onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus() }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>('[data-slot="sidebar-menu-button"][data-active="true"]')
          target?.focus()
        }}
      >
        <DialogHeader className="gap-3">
          <DialogTitle className="flex items-start gap-2.5 text-base font-semibold">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-destructive/[0.07] text-destructive"><Trash2 className="size-4" /></span>
            <span className="min-w-0">{t("Delete project?")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {store.name
              ? t("This permanently deletes the project and its history from the Store {store}. This cannot be undone.", { store: store.name })
              : t("This permanently deletes the project’s storage and history. This cannot be undone.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3">
          <FolderClosed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{project.name}</p>
            {project.source && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={project.source}>{project.source}</p>}
          </div>
        </div>
        {store.name && (
          <div className="min-w-0 space-y-2">
            <StoreLine facts={store} />
            {store.others.length > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(store.others.length === 1 ? "The Store and its 1 other project stay." : "The Store and its {count} other projects stay.", { count: store.others.length })}
                {store.link && ` ${t("The linked copy on {remote} keeps the project until the Store’s next push.", { remote: store.link.remote })}`}
              </p>
            )}
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">{t("Your original source folder and saved conversations will stay in place.")}</p>
        {error && <p role="alert" className="break-words rounded-xl bg-destructive/[0.06] px-3.5 py-3 text-xs leading-relaxed text-destructive">{t(error)}</p>}
        <div className="flex justify-end gap-2">
          <Button ref={cancel} type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting} onClick={onClose}>{t("Cancel")}</Button>
          <Button type="button" variant="destructive" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting} onClick={() => void remove()}>
            {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {deleting ? t("Deleting…") : t("Delete project")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
