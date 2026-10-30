import { useI18n } from '@/i18n'
import { Check, Copy, GitFork, LoaderCircle, MoreHorizontal, Pencil, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import type { AgentSessionSummary, ChatMessage } from '@shared/agent-api'

import { Button } from '@/components/ui/button'
import { AttachmentList } from '@/components/chat/attachments'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export type ConversationAction = 'rollback' | 'edit' | 'fork' | 'duplicate'
export interface ConversationActionTarget {
  action: ConversationAction
  session: AgentSessionSummary
  message?: ChatMessage
  returnFocus?: HTMLElement | null
}

export function MessageActions({ message, disabled, running, onAction }: {
  message: ChatMessage
  disabled: boolean
  running: boolean
  onAction: (action: Exclude<ConversationAction, 'duplicate'>, message: ChatMessage, returnFocus: HTMLElement | null) => void
}) {
  const { t } = useI18n()
  const trigger = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const reason = running ? 'Stop the agent before changing this conversation.' : disabled ? 'Wait for the current action to finish.' : !message.entryId || !message.canRestore ? 'A saved restore point is not available for this message.' : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopied(true)
      setCopyError('')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopyError('Could not copy. Select the message text and copy it manually.')
    }
  }

  return <div className="mt-1 flex min-h-7 flex-col items-end pr-1">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-xs" aria-label={t("Message actions")} title={t("Message actions")} className="size-7 rounded-xl text-muted-foreground transition-opacity hover:bg-foreground/[0.05] hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:group-focus-within/message:opacity-100">
          {copied ? <Check className="size-3.5 text-success" /> : <MoreHorizontal className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="chat-popover w-64">
        <DropdownMenuItem className="text-xs" onSelect={() => void copy()}><Copy className="size-3.5" />{t("Copy text")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" disabled={!!reason} onSelect={() => onAction('edit', message, trigger.current)}><Pencil className="size-3.5" />{t("Edit & resend")}</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" disabled={!!reason} onSelect={() => onAction('rollback', message, trigger.current)}><RotateCcw className="size-3.5" />{t("Revert before this message")}</DropdownMenuItem>
        <DropdownMenuItem className="text-xs" disabled={!!reason} onSelect={() => onAction('fork', message, trigger.current)}><GitFork className="size-3.5" />{t("Copy before this message")}</DropdownMenuItem>
        {reason && <p className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">{t(reason)}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
    {copied && <span role="status" className="text-[10px] text-muted-foreground">{t("Copied")}</span>}
    {copyError && <span role="alert" className="max-w-64 text-right text-[11px] text-destructive">{t(copyError)}</span>}
  </div>
}

export function ConversationActionDialog({ target, unavailable, hasDraft, onClose, onConfirm }: {
  target: ConversationActionTarget
  unavailable?: string
  hasDraft?: boolean
  onClose: () => void
  onConfirm: (text: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [text, setText] = useState(target.message?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const completed = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const edit = target.action === 'edit'
  const copy = target.action === 'fork' || target.action === 'duplicate'
  const title = edit ? 'Edit & resend' : target.action === 'rollback' ? 'Revert before this message?' : target.action === 'fork' ? 'Copy before this message?' : 'Duplicate chat?'
  const label = edit ? 'Restore & send' : target.action === 'rollback' ? 'Revert conversation' : target.action === 'fork' ? 'Create copy' : 'Duplicate chat'
  const context = copy
    ? target.action === 'duplicate' ? 'Create a separate conversation with this saved context. The original conversation stays as it is.' : 'Copy only the context before this message into a new conversation. This message becomes its unsent draft. The original conversation stays as it is.'
    : 'This conversation will keep only the context before this message. This message and all later replies will leave its active context.'
  const files = target.session.project
    ? copy ? 'The copy gets an independent LayerFS branch at the matching file state. The original branch is kept.' : 'LayerFS will restore the files to the checkpoint before this message on a new revision branch. The previous file history is kept.'
    : 'This is a local-folder conversation. Only conversation context changes; local files are not copied or restored.'

  async function confirm() {
    if (inFlight.current || unavailable || (edit && !text.trim() && !target.message?.attachments?.length)) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm(text)
      completed.current = true
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose() }}>
    <DialogContent
      role={edit ? 'dialog' : 'alertdialog'}
      showCloseButton={!busy}
      className="max-h-[calc(100svh-2rem)] gap-4 overflow-y-auto rounded-3xl [--dialog-inset:1.5rem] sm:max-w-lg"
      onOpenAutoFocus={(event) => { if (!edit) { event.preventDefault(); cancel.current?.focus() } }}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        if (inFlight.current && !completed.current) return
        const focus = completed.current
          ? document.querySelector<HTMLTextAreaElement>('textarea[data-chat-composer]')
          : target.returnFocus?.isConnected ? target.returnFocus : document.querySelector<HTMLElement>('[data-session-history]')
        focus?.focus()
      }}
      onEscapeKeyDown={(event) => { if (inFlight.current) event.preventDefault() }}
      onInteractOutside={(event) => { if (inFlight.current) event.preventDefault() }}
    >
      <DialogHeader>
        <DialogTitle className="font-semibold">{t(title)}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{t(context)}</DialogDescription>
      </DialogHeader>
      {edit ? <label className="grid gap-2 text-xs font-medium">
        {t("Message")}<textarea aria-label={t("Edit message")} value={text} disabled={busy} onChange={(event) => setText(event.target.value)} rows={5} className="max-h-60 min-h-28 w-full resize-y rounded-2xl border border-foreground/[0.1] bg-background/40 px-3.5 py-3 text-sm leading-relaxed font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label> : target.message ? <p className="max-h-32 overflow-y-auto rounded-2xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3 text-xs leading-relaxed whitespace-pre-wrap break-words">{target.message.text}</p> : <p className="truncate rounded-2xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3 text-sm font-medium" title={target.session.title}>{target.session.title}</p>}
      {!!target.message?.attachments?.length && <AttachmentList attachments={target.message.attachments} />}
      <p className="text-xs leading-relaxed text-muted-foreground">{t(files)}</p>
      {target.action === 'rollback' && <p className="text-xs text-muted-foreground">{t("The original message will return to the composer without sending.")}</p>}
      {hasDraft && !edit && <p className="text-xs leading-relaxed text-muted-foreground">{target.action === 'duplicate' ? t("Opening the copy will clear the unsent draft currently in your composer.") : t("The original message will replace the unsent draft currently in your composer.")}</p>}
      {(error || unavailable) && <p role="alert" className="rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-xs leading-relaxed break-words text-destructive">{t(error || unavailable || "")}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancel} variant="outline" size="sm" className="rounded-xl" disabled={busy} onClick={onClose}>{t("Cancel")}</Button>
        <Button variant={target.action === 'rollback' ? 'destructive' : 'default'} size="sm" className="rounded-xl" disabled={busy || !!unavailable || (edit && !text.trim() && !target.message?.attachments?.length)} onClick={() => void confirm()}>
          {busy && <LoaderCircle className="size-3.5 animate-spin" />}
          {busy ? edit ? t("Restoring & sending…") : copy ? t("Copying…") : t("Reverting…") : error ? t("Try again") : t(label)}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
}
