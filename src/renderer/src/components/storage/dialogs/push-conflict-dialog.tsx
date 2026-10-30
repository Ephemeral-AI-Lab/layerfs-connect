// Push conflict (storage-links §3.5): the linked file changed since this
// machine's last push or pull, so a push is refused (Conflict). Pull first,
// or Overwrite (force: true), which replaces what is there.
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { useEffect, useState } from 'react'

import { FormError, message } from '@/components/storage/dialogs/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ago, bytes } from '@/data/format'
import type { StoreInfo } from '@shared/host-api'

interface PushConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: StoreInfo
  onOverwrite: () => Promise<void>
  onPullFirst: () => void
}

export function PushConflictDialog({ open, onOpenChange, store, onOverwrite, onPullFirst }: PushConflictDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) setError(undefined)
  }, [open])
  const link = store.link
  if (!link) return null
  const c = link.check
  const missing = link.sync === 'missing'
  const overwrite = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onOverwrite()
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
          <DialogTitle>{missing ? `${link.remote} / ${link.file} is gone` : `${link.remote} changed since your last ${link.last?.direction ?? 'push'}.`}</DialogTitle>
          <DialogDescription>
            {missing
              ? `The linked file was deleted. Overwrite writes ${store.name} there as it is here.`
              : `${link.file} is not what this machine last pushed or pulled${c?.present ? ` (now ${bytes(c.bytes)}${c.modified ? `, modified ${ago(c.modified)}` : ''})` : ''}. Pull first to take its changes, or overwrite it with ${store.name} as it is here: Commits only that file has are lost for everyone who pulls it.`}
          </DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <DialogFooter>
          {!missing && (
            <Button
              type="button"
              variant="outline"
              className="sm:mr-auto"
              onClick={() => {
                onOpenChange(false)
                onPullFirst()
              }}
            >
              <ArrowDownToLine /> Pull first
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void overwrite()} disabled={busy}>
            <ArrowUpFromLine /> {busy ? 'Starting…' : 'Overwrite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
