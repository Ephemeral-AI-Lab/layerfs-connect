import { t, useI18n } from '@/i18n'
import { FolderClosed, LoaderCircle, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { projectKey, type ProjectSummary, type SandboxInfo } from '@shared/host-api'

import { StoreLine, storeFacts, useStorageView } from '@/components/projects/store-facts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { host, HostError } from '@/host/client'

interface DeleteProjectDialogProps {
  project: ProjectSummary
  onClose: () => void
  /** Deletes the project with this key (`<store>/<project>`). */
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
  // project.remove is refused InUse while any of its Sandbox records exists: list them first
  const [sandboxes, setSandboxes] = useState<SandboxInfo[] | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const readSandboxes = () => host.projectSandboxes(projectKey(project)).then(setSandboxes, () => setSandboxes([]))
  useEffect(() => { void readSandboxes() }, [project.key]) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(close: boolean, force = false) {
    if (inFlight.current) return
    inFlight.current = true
    setDeleting(true)
    setError('')
    try {
      if (close) {
        const closed = await host.closeSandboxes(projectKey(project), force)
        setUnknown(closed.flatMap((c) => c.unknown ?? []))
      }
      await onDelete(projectKey(project))
      onClose()
    } catch (cause) {
      const code = cause instanceof HostError ? cause.code : ''
      setError(code === 'InUse'
        ? 'A Sandbox of this project is still open. Close its Sandboxes, then delete.'
        : code === 'Unsupported' && store.family === 'postgresql'
          ? 'A project in a PostgreSQL Store cannot be deleted by LayerFS 2.0 yet. Disconnect the Store on Storage to drop it from this home.'
          : (cause as Error).message)
      void readSandboxes()
      inFlight.current = false
      setDeleting(false)
    }
  }
  const open = sandboxes ?? []

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
            {t("This permanently deletes the project and its history from the Store {store}. This cannot be undone.", { store: store.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3">
          <FolderClosed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{project.name}</p>
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{project.key}</p>
          </div>
        </div>
        {store.name && (
          <div className="min-w-0 space-y-2">
            <StoreLine facts={store} />
            {store.others.length > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t(store.others.length === 1 ? "The Store and its 1 other project stay." : "The Store and its {count} other projects stay.", { count: store.others.length })}
              </p>
            )}
          </div>
        )}
        {open.length > 0 && (
          <div className="min-w-0 space-y-1.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] px-3.5 py-3 text-xs">
            <p className="font-medium">{t(open.length === 1 ? 'It has 1 Sandbox, which must close first:' : 'It has {count} Sandboxes, which must close first:', { count: open.length })}</p>
            <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {open.map((s) => <li key={s.name}>{s.name} · {s.machine ?? '?'} · {t(s.state)}</li>)}
            </ul>
            {unknown.length > 0 && <p className="text-destructive">{t('Closed by force; Workspaces of unknown state: {list}', { list: unknown.join(', ') })}</p>}
          </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">{t("Your original source folder and saved conversations will stay in place.")}</p>
        {error && <p role="alert" className="break-words rounded-xl bg-destructive/[0.06] px-3.5 py-3 text-xs leading-relaxed text-destructive">{t(error)}</p>}
        <div className="flex justify-end gap-2">
          <Button ref={cancel} type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting} onClick={onClose}>{t("Cancel")}</Button>
          {open.length > 0 && error && (
            <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3.5 text-destructive" disabled={deleting} onClick={() => void remove(true, true)} title={t('Closes them even with Workspaces whose state LayerFS cannot learn')}>
              {t('Force close and delete')}
            </Button>
          )}
          <Button type="button" variant="destructive" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting || sandboxes === null} onClick={() => void remove(open.length > 0)}>
            {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {deleting ? t("Deleting…") : open.length ? t(open.length === 1 ? 'Close 1 Sandbox and delete' : 'Close {count} Sandboxes and delete', { count: open.length }) : t("Delete project")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
