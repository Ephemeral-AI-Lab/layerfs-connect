// A new, empty local SQLite Store (layerfs#506): one Docker volume that
// projects are then Inited into. Loading a Store from a bucket and importing
// one into PostgreSQL are on the bucket and Store pages.
import { LoaderCircle, Plus } from 'lucide-react'
import { siSqlite } from 'simple-icons'
import { useEffect, useId, useState } from 'react'

import { BTN, Field, FormError, message, SHEET, SheetFooter, SheetHeader } from '@/components/storage/dialogs/fields'
import { Mark } from '@/components/storage/icons'
import { NAME } from '@/components/storage/identity/providers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { host } from '@/host/client'
import { t, useI18n } from '@/i18n'

interface NewStoreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taken: Set<string>
  onCreated: (name: string) => void
}

export function NewStoreDialog({ open, onOpenChange, taken, onCreated }: NewStoreDialogProps) {
  useI18n()
  const id = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) setError(undefined)
  }, [open])
  const problem = name && !NAME.test(name) ? t('Lower-case letters, digits and hyphens, up to 32.') : taken.has(name) ? t('A Store named {name} exists.', { name }) : null
  const create = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await host.createStore(name)
      onCreated(name)
      onOpenChange(false)
      setName('')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className={`${SHEET} sm:max-w-[440px]`}>
        <SheetHeader
          mark={
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08]">
              <Mark icon={siSqlite} className="size-4" />
            </span>
          }
          title={t('New Store')}
        >
          {t('An empty SQLite Store in a Docker volume of its own. Projects you add to it share its storage, its writer and its link: a push uploads all of them.')}
        </SheetHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name && !problem) void create()
          }}
        >
          <Field id={id} label={t('Name')} problem={problem}>
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="work" autoFocus disabled={busy} className="rounded-xl font-mono text-[13px]" aria-invalid={!!problem} />
          </Field>
          <FormError error={error} />
          <SheetFooter>
            <Button type="button" variant="outline" size="sm" className={BTN} onClick={() => onOpenChange(false)} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" className={BTN} disabled={!name || !!problem || busy}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {busy ? t('Creating…') : t('Create Store')}
            </Button>
          </SheetFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
