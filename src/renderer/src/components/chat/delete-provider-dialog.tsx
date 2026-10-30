import { useI18n } from '@/i18n'
import { LoaderCircle, LogOut, PlugZap, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function DeleteProviderDialog({ provider, modelCount, signOut, onClose, onDelete }: {
  provider: string
  modelCount: number
  /** Its credential is a subscription sign-in: removing the provider signs out. */
  signOut?: boolean
  onClose: () => void
  onDelete: (provider: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  const Icon = signOut ? LogOut : Trash2

  async function remove() {
    if (inFlight.current) return
    inFlight.current = true
    setDeleting(true)
    setError('')
    try {
      await onDelete(provider)
      onClose()
    } catch (cause) {
      setError((cause as Error).message)
      inFlight.current = false
      setDeleting(false)
    }
  }

  return <Dialog open onOpenChange={(next) => { if (!next && !inFlight.current) onClose() }}>
    <DialogContent
      role="alertdialog"
      showCloseButton={!deleting}
      className="max-h-[calc(100dvh-3rem)] gap-5 overflow-y-auto rounded-3xl p-6 [--dialog-inset:1.5rem] sm:max-w-[420px]"
      onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus() }}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        const target = returnFocus.current?.isConnected ? returnFocus.current : document.getElementById('agent-add-provider')
        target?.focus({ preventScroll: true })
      }}
    >
      <DialogHeader className="gap-3">
        <DialogTitle className="flex min-h-7 items-center gap-2.5 pr-8 text-base font-semibold">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-destructive/[0.07] text-destructive"><Icon className="size-4" /></span>
          {signOut ? t("Sign out of this provider?") : t("Delete provider?")}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{signOut ? t("Remove Connect’s subscription sign-in for this provider, with its saved connection and model settings? Other apps on this machine stay signed in.") : t("Remove this provider’s saved connection, credentials and model settings?")}</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3">
        <PlugZap className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{provider}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{modelCount} {modelCount === 1 ? t("model") : t("models")}</p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{signOut ? t("Saved conversations stay in your history. You can sign in again later.") : t("Saved conversations stay in your history. You can add the provider again later.")}</p>
      {error && <p role="alert" className="break-words rounded-xl bg-destructive/[0.06] px-3.5 py-3 text-xs leading-relaxed text-destructive">{t(error)}</p>}
      <div className="flex justify-end gap-2">
        <Button ref={cancel} type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting} onClick={onClose}>{t("Cancel")}</Button>
        <Button type="button" variant="destructive" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting} onClick={() => void remove()}>
          {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
          {signOut ? (deleting ? t("Signing out…") : t("Sign out")) : deleting ? t("Deleting…") : t("Delete provider")}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
}
