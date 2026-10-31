import { useRef, useState } from 'react'
import { LoaderCircle, MessageSquare } from 'lucide-react'
import type { AgentSessionSummary } from '@shared/agent-api'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { chatLive } from '@/host/use-chat-sessions'
import { useI18n } from '@/i18n'

export type DeleteChatTarget = { chat: AgentSessionSummary; returnFocus: HTMLElement }

export function DeleteChatDialog({ target, onClose, onDelete }: {
  target: DeleteChatTarget
  onClose: () => void
  onDelete: (id: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const running = chatLive(target.chat)

  async function remove() {
    if (inFlight.current) return
    inFlight.current = true
    setDeleting(true)
    setError('')
    try {
      await onDelete(target.chat.id)
      onClose()
    } catch (cause) {
      setError((cause as Error).message)
      inFlight.current = false
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose() }}>
      <DialogContent
        role="alertdialog"
        showCloseButton={!deleting}
        className="max-h-[calc(100dvh-3rem)] gap-4 overflow-y-auto rounded-3xl [--dialog-inset:1.5rem] sm:max-w-[400px]"
        onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus() }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const trigger = target.returnFocus
          const next = trigger.isConnected ? trigger : document.querySelector<HTMLElement>('.sidebar-chat-open, .shell-new-chat')
          next?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center">{t('Delete conversation?')}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t('This conversation will be permanently deleted. Project files and LayerFS history are kept.')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3">
          <MessageSquare aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 text-sm leading-5 [overflow-wrap:anywhere]">{target.chat.title || t('New session')}</p>
        </div>
        {running && <p className="text-xs leading-relaxed text-muted-foreground">{t('The running agents will stop before deletion.')}</p>}
        {error && <p role="alert" className="break-words rounded-xl bg-destructive/[0.06] px-3.5 py-3 text-xs leading-relaxed text-destructive">{t(error)}</p>}
        <div className="flex justify-end gap-2">
          <Button ref={cancel} type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting} onClick={onClose}>{t('Cancel')}</Button>
          <Button type="button" variant="destructive" size="sm" className="h-8 rounded-xl px-3.5" disabled={deleting} onClick={() => void remove()}>
            {deleting && <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
            {t(deleting ? 'Deleting…' : running ? 'Stop & delete' : 'Delete conversation')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
