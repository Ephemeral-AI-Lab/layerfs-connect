// Every removal (storage-redesign §3.12), and the pull and push-anyway
// confirmations: a title, what is lost and what stays, and, where data is
// lost, the name typed before the destructive button wakes up.
import { useEffect, useId, useState } from 'react'

import { FormError, message } from '@/components/storage/dialogs/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface ConfirmByNameProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: React.ReactNode
  /** The name to type; omit for a one-click confirmation. */
  name?: string
  /** "Type work to pull". */
  prompt?: string
  /** The confirm button's words. */
  action: string
  busyAction?: string
  /** Between the body and the field: a warning, a fact line. */
  children?: React.ReactNode
  /** Buttons before Cancel ("Pull first…"). */
  extra?: React.ReactNode
  /** Sends the request; a rejection shows under the form. `typed` is the name as typed. */
  onConfirm: (typed: string) => Promise<void>
}

export function ConfirmByName({ open, onOpenChange, title, body, name, prompt, action, busyAction, children, extra, onConfirm }: ConfirmByNameProps) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) setTyped(''), setError(undefined)
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
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-pretty">{body}</DialogDescription>
        </DialogHeader>
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
              <label htmlFor={id} className="text-[13px] font-medium">
                {prompt ?? (
                  <>
                    Type <span className="font-mono">{name}</span> to confirm
                  </>
                )}
              </label>
              <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} className="font-mono text-[13px]" autoFocus />
            </div>
          )}
          <FormError error={error} />
          <DialogFooter>
            {extra}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches || busy} autoFocus={name === undefined}>
              {busy ? (busyAction ?? `${action}…`) : action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
