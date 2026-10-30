// Pull (storage-links §3.5): replace a Store with its linked file. The page
// opens this only when the pull would discard local changes (ahead or
// diverged, or local changes Connect can't rule out); it says what is lost
// before the name is typed. Otherwise Pull runs at once.
import { TriangleAlert } from 'lucide-react'

import { ConfirmByName } from '@/components/storage/dialogs/confirm-by-name'
import { PULL_DISCARDS } from '@/components/storage/sync/sync-state'
import { ago, bytes } from '@/data/format'
import type { StoreInfo, StoreLink } from '@shared/host-api'

/** "1.1 GB, modified 20 min ago", from the last check, else the last transfer. */
export function linkFacts(link: StoreLink): string {
  const c = link.check
  if (c && c.present) return `${bytes(c.bytes)}${c.modified ? `, modified ${ago(c.modified)}` : ''}`
  if (c && !c.present) return 'the file is gone'
  if (link.last) return `last ${link.last.direction === 'pull' ? 'pulled' : 'pushed'} ${ago(link.last.at)}${link.last.bytes !== null ? `, ${bytes(link.last.bytes)}` : ''} (not checked)`
  return 'not checked yet'
}

/** Whether a pull of `store` may discard local changes: then the dialog asks for its name. */
export const pullDiscards = (store: StoreInfo) => !!store.link && (PULL_DISCARDS.includes(store.link.sync) || store.link.local !== 'same')

interface PullDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: StoreInfo
  onPull: (typed: string) => Promise<void>
}

export function PullDialog({ open, onOpenChange, store, onPull }: PullDialogProps) {
  const link = store.link
  if (!link) return null
  const n = store.projects.length
  const discards = PULL_DISCARDS.includes(link.sync) || link.local === 'changed'
  return (
    <ConfirmByName
      open={open}
      onOpenChange={onOpenChange}
      title={`Pull ${store.name} from ${link.remote} / ${link.file}?`}
      body={`Pull replaces ${store.name} and ${n === 1 ? 'its project' : `all ${n} of its projects`} with the linked file.`}
      name={store.name}
      prompt={`Type ${store.name} to pull`}
      action="Pull and replace"
      busyAction="Starting…"
      onConfirm={onPull}
    >
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2.5 text-[13px]">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{discards ? `${store.name} has changes not pushed to ${link.remote}. Pulling discards them.` : `Connect can’t tell whether ${store.name} changed since your last push or pull.`}</p>
          <p className="mt-0.5 text-muted-foreground">Push first, or Send a copy to keep both.</p>
        </div>
      </div>
      {store.open && (
        <p className="text-[12px] text-muted-foreground">
          {store.name} is open now. The pull is refused until every Sandbox and Workspace lets go; the LayerFS box lets go a minute after its last use.
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">
        <span className="font-mono text-foreground">
          {link.remote} / {link.file}
        </span>
        : {linkFacts(link)}
      </p>
    </ConfirmByName>
  )
}
