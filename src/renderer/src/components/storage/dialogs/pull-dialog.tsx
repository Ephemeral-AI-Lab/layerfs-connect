// Pull (storage-links §3.5): replace a Store with its linked file. The page
// opens this only when the pull would discard local changes (ahead or
// diverged, or local changes Connect can't rule out); it says what is lost
// before the name is typed. Otherwise Pull runs at once.
import { ArrowDownToLine, TriangleAlert } from 'lucide-react'

import { ConfirmByName } from '@/components/storage/dialogs/confirm-by-name'
import { PULL_DISCARDS } from '@/components/storage/sync/sync-state'
import { ago, bytes } from '@/data/format'
import { t, useI18n } from '@/i18n'
import type { StoreInfo, StoreLink } from '@shared/host-api'

/** "1.1 GB, modified 20 min ago", from the last check, else the last transfer. */
export function linkFacts(link: StoreLink): string {
  const c = link.check
  if (c && c.present) return `${bytes(c.bytes)}${c.modified ? `, ${t('modified {ago}', { ago: ago(c.modified) })}` : ''}`
  if (c && !c.present) return t('the file is gone')
  if (link.last) return `${t(link.last.direction === 'pull' ? 'last pulled {ago}' : 'last pushed {ago}', { ago: ago(link.last.at) })}${link.last.bytes !== null ? `, ${bytes(link.last.bytes)}` : ''} (${t('not checked')})`
  return t('not checked yet')
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
  useI18n()
  const link = store.link
  if (!link) return null
  const n = store.projects.length
  const discards = PULL_DISCARDS.includes(link.sync) || link.local === 'changed'
  return (
    <ConfirmByName
      open={open}
      onOpenChange={onOpenChange}
      icon={ArrowDownToLine}
      title={t('Pull {store} from {where}?', { store: store.name, where: `${link.remote} / ${link.file}` })}
      body={n === 1 ? t('Pull replaces {store} and its project with the linked file.', { store: store.name }) : t('Pull replaces {store} and all {n} of its projects with the linked file.', { store: store.name, n })}
      name={store.name}
      prompt={t('Type {name} to pull', { name: store.name })}
      action={t('Pull and replace')}
      busyAction={t('Starting…')}
      onConfirm={onPull}
    >
      <div className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/[0.06] px-3.5 py-3 text-xs leading-relaxed">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {discards
              ? t('{store} has changes not pushed to {remote}. Pulling discards them.', { store: store.name, remote: link.remote })
              : t('Connect can’t tell whether {store} changed since your last push or pull.', { store: store.name })}
          </p>
          <p className="mt-0.5 text-muted-foreground">{t('Push first, or Send a copy to keep both.')}</p>
        </div>
      </div>
      {store.open && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('{store} is open now. The pull is refused until every Sandbox and Workspace lets go; the LayerFS box lets go a minute after its last use.', { store: store.name })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        <span className="font-mono text-foreground">
          {link.remote} / {link.file}
        </span>
        : {linkFacts(link)}
      </p>
    </ConfirmByName>
  )
}
