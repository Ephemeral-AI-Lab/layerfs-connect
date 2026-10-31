import { useI18n } from '@/i18n'
import type { SandboxInfo } from '@shared/host-api'
import { ChevronDown, FolderTree } from 'lucide-react'

import { sandboxTone } from '@/components/compute/sandbox-list'
import { LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import { Chip } from '@/components/storage/chips'

function SandboxTile({ sandbox, reading, unavailable, onBrowseFiles }: { sandbox: SandboxInfo; reading?: boolean; unavailable?: boolean; onBrowseFiles?: (branch: string) => void }) {
  const { t } = useI18n()
  const state = sandboxTone(sandbox.state)
  return <article className="min-w-0 border-t border-border/70 px-5 py-4" aria-label={t('Sandbox {value1}, {value2}', { value1: sandbox.name, value2: t(state.label) })}>
    <header className="flex min-w-0 items-center gap-2.5">
      <LfsSandbox className="size-4 shrink-0 text-muted-foreground" />
      <h4 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={sandbox.name}>{sandbox.name}</h4>
      <Chip tone={state.tone}>{t(state.label)}</Chip>
    </header>
    <ul className="mt-3 space-y-1" aria-label={t('Mounted Workspaces')}>
      {sandbox.reach ? <li className="rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning" title={sandbox.detail}>
        {t(sandbox.reach === 'busy' ? 'Workspace status timed out.' : 'Workspace status unavailable.')}
      </li> : reading && !sandbox.workspaces.length && sandbox.state === 'running' ? <li className="py-1 text-xs text-muted-foreground">{t('Reading its Workspaces…')}</li>
        : unavailable ? <li className="py-1 text-xs text-muted-foreground">{t('Workspace status unavailable.')}</li>
          : !sandbox.workspaces.length ? <li className="py-1 text-xs text-muted-foreground">{t('No Workspace mounted')}</li>
          : sandbox.workspaces.map((workspace) => <li key={workspace.ws} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
            <span className="flex min-w-0 flex-1 basis-40 items-center gap-2" title={workspace.path}>
              <LfsWorkspace className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{workspace.path}</span>
            </span>
            <span className="flex min-w-0 max-w-full items-center gap-1.5 text-muted-foreground" title={workspace.branch}>
              <LfsBranch className="size-3.5 shrink-0" /><span className="max-w-56 truncate">{workspace.branch || t('Unknown branch')}</span>
            </span>
            {onBrowseFiles && workspace.branch && <button type="button" onClick={() => onBrowseFiles(workspace.branch)} title={t('Browse the files on {branch}', { branch: workspace.branch })} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-foreground outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring">
              <FolderTree className="size-3.5" />{t('Browse files')}
            </button>}
          </li>)}
    </ul>
    <details className="group mt-2 text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {t('Details')}<ChevronDown className="size-3 group-open:rotate-180" />
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 leading-relaxed">
        <dt>ID</dt><dd className="break-all font-mono">{sandbox.id}</dd>
        <dt>{t('image')}</dt><dd className="break-all font-mono">{sandbox.image || '—'}</dd>
        {sandbox.detail && <><dt>{t('Status')}</dt><dd className="break-words">{sandbox.detail}</dd></>}
      </dl>
    </details>
  </article>
}

/** Quiet rows keep the mounted paths and their file actions in the same place. */
export function SandboxTiles({ sandboxes, reading, unavailable, onBrowseFiles }: { sandboxes: SandboxInfo[]; reading?: boolean; unavailable?: boolean; onBrowseFiles?: (branch: string) => void }) {
  const { t } = useI18n()
  const open = sandboxes.filter((sandbox) => sandbox.state !== 'gone')
  const closed = sandboxes.filter((sandbox) => sandbox.state === 'gone')
  return <div className="min-w-0">
    {open.map((sandbox) => <SandboxTile key={sandbox.id} sandbox={sandbox} reading={reading} unavailable={unavailable} onBrowseFiles={onBrowseFiles} />)}
    {!open.length && <p className="border-t border-border/70 px-5 py-10 text-center text-sm text-muted-foreground">{t(reading ? 'Reading Sandboxes…' : 'No active Sandboxes')}</p>}
    {closed.length > 0 && <details className="group border-t border-border/70 px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {t('Closed')}<span className="tabular-nums">{closed.length}</span><ChevronDown className="ml-auto size-3.5 group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-2 pb-1 text-xs text-muted-foreground">
        {closed.map((sandbox) => <li key={sandbox.id} className="flex min-w-0 items-center gap-2" title={sandbox.id}><LfsSandbox className="size-3.5 shrink-0" /><span className="truncate">{sandbox.name}</span></li>)}
      </ul>
    </details>}
  </div>
}
