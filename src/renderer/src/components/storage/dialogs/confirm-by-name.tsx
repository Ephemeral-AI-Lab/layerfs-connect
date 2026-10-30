// Every removal (storage-redesign §3.12), and the pull and unlink
// confirmations: a title, what is lost and what stays, and, where data is
// lost, the name typed before the destructive button wakes up.
import { LoaderCircle, type LucideIcon, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { BTN, FormError, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t, useI18n } from '@/i18n'

interface ConfirmByNameProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: React.ReactNode
  icon?: LucideIcon
  /** The name to type; omit for a one-click confirmation. */
  name?: string
  /** "Type work to pull". */
  prompt?: string
  /** The confirm button's words. */
  action: string
  busyAction?: string
  /** Between the body and the field: a warning, a fact line. */
  children?: React.ReactNode
  /** Sends the request; a rejection shows under the form. `typed` is the name as typed. */
  onConfirm: (typed: string) => Promise<void>
}

export function ConfirmByName({ open, onOpenChange, title, body, icon = Trash2, name, prompt, action, busyAction, children, onConfirm }: ConfirmByNameProps) {
  useI18n()
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setTyped('')
      setError(undefined)
    }
  }, [open])
  const matches = name === undefined || typed === name
  const go = async () => {
    if (!matches || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm(typed)
      onOpenChange(false)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const Icon = icon
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className={`${SHEET} sm:max-w-[460px]`}>
        <SheetHeader icon={icon} tone="danger" title={title}>
          {body}
        </SheetHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void go()
          }}
        >
          {children}
          {name !== undefined && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-xs font-semibold text-foreground/90">
                {prompt ?? t('Type {name} to confirm', { name })}
              </label>
              <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} className="rounded-xl font-mono text-[13px]" autoFocus />
            </div>
          )}
          <FormError error={error} />
          <SheetFooter>
            <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="destructive" size="sm" className={BTN} disabled={!matches || busy} autoFocus={name === undefined}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
              {busy ? (busyAction ?? `${action}…`) : action}
            </Button>
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
