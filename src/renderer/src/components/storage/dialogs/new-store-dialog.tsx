// A new, empty local SQLite Store (layerfs#506): one Docker volume that
// projects are then Inited into. Pulling a Store from a remote (clone) and
// importing one into PostgreSQL are on the MinIO and Store pages.
import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { host } from '@/host/client'

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

interface NewStoreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taken: Set<string>
  onCreated: (name: string) => void
}

export function NewStoreDialog({ open, onOpenChange, taken, onCreated }: NewStoreDialogProps) {
  const id = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) setError(undefined)
  }, [open])
  const problem = name && !NAME.test(name) ? 'Lower-case letters, digits and hyphens, up to 32.' : taken.has(name) ? `A Store named ${name} exists.` : null
  const create = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await host.createStore(name)
      onCreated(name)
      onOpenChange(false)
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New Store</DialogTitle>
          <DialogDescription>
            An empty SQLite Store in a Docker volume of its own. Projects you add to it share its storage, its writer and its link: a push uploads all of them.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name && !problem) void create()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-[13px] font-medium">
              Name
            </label>
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="work" autoFocus disabled={busy} className="font-mono text-[13px]" aria-invalid={!!problem} />
            {problem && <p className="text-[12px] text-destructive">{problem}</p>}
          </div>
          {error && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name || !!problem || busy}>
              {busy ? 'Creating…' : 'Create Store'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
