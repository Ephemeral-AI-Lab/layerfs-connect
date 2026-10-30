// Push conflict (storage-links §3.5): the linked file changed since this
// machine's last push or pull, so a push is refused (Conflict). Pull first,
// or Overwrite (force: true), which replaces what is there.
import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { BTN, FormError, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ago, bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import type { StoreInfo } from '@shared/host-api'

interface PushConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: StoreInfo
  onOverwrite: () => Promise<void>
  onPullFirst: () => void
}

export function PushConflictDialog({ open, onOpenChange, store, onOverwrite, onPullFirst }: PushConflictDialogProps) {
  useI18n()
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
  const now = c?.present ? ` (${t('now {size}', { size: `${bytes(c.bytes)}${c.modified ? `, ${t('modified {ago}', { ago: ago(c.modified) })}` : ''}` })})` : ''
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className={`${SHEET} sm:max-w-[480px]`}>
        <SheetHeader icon={TriangleAlert} tone="warning" title={missing ? t('{where} is gone', { where: `${link.remote} / ${link.file}` }) : t(link.last?.direction === 'pull' ? '{remote} changed since your last pull.' : '{remote} changed since your last push.', { remote: link.remote })}>
          {missing
            ? t('The linked file was deleted. Overwrite writes {store} there as it is here.', { store: store.name })
            : `${t('{file} is not what this machine last pushed or pulled', { file: link.file })}${now}. ${t('Pull first to take its changes, or overwrite it with {store} as it is here: Commits only that file has are lost for everyone who pulls it.', { store: store.name })}`}
        </SheetHeader>
        <FormError error={error} />
        <SheetFooter
          left={
            !missing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={BTN}
                onClick={() => {
                  onOpenChange(false)
                  onPullFirst()
                }}
              >
                <ArrowDownToLine className="size-3.5" /> {t('Pull first')}
              </Button>
            )
          }
        >
          <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button type="button" variant="destructive" size="sm" className={BTN} onClick={() => void overwrite()} disabled={busy}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUpFromLine className="size-3.5" />}
            {busy ? t('Starting…') : t('Overwrite')}
          </Button>
        </SheetFooter>
      </DialogContent>
    </Dialog>
  )
}
