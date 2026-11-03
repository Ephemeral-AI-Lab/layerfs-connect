import { useI18n } from '@/i18n'
import type { SandboxInfo } from '@shared/host-api'
import { ChevronDown, FolderTree, LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'

import { LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import { StateChip } from '@/components/state-chip'
import { Refusal } from '@/components/refusal'
import { clearingCall, stateLook } from '@/data/states'
import { host } from '@/host/client'

/** Closes a Sandbox; a refused close offers a forced one, which names the Workspaces of unknown state. */
function CloseSandbox({ name, onClosed }: { name: string; onClosed?: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unknown, setUnknown] = useState<string[] | null>(null)
  const close = async (force: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const done = await host.closeSandbox(name, force)
      setUnknown(done.unknown ?? [])
      onClosed?.()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return <span className="flex flex-wrap items-center justify-end gap-1.5">
    {error !== null && <Refusal error={error} compact className="max-w-96 text-[11px] text-destructive" />}
    {unknown && unknown.length > 0 && <span className="text-[11px] text-destructive" title={unknown.join('\n')}>{t('Closed by force; Workspaces of unknown state: {list}', { list: unknown.join(', ') })}</span>}
    <button type="button" disabled={busy} onClick={() => void close(error !== null)} title={error !== null ? t('Close even with Workspaces whose state LayerFS cannot learn') : t('Close this Sandbox')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <X className="size-3.5" />}{error !== null ? t('Force close') : t('Close')}
    </button>
  </span>
}

function SandboxTile({ sandbox, reading, unavailable, onBrowseFiles, onChanged }: { sandbox: SandboxInfo; reading?: boolean; unavailable?: boolean; onBrowseFiles?: (branch: string) => void; onChanged?: () => void }) {
  const { t } = useI18n()
  const state = stateLook('sandbox', sandbox.state)
  const refusal = sandbox.refusal
  return <article className="min-w-0 border-t border-border/70 px-5 py-4" aria-label={t('Sandbox {value1}, {value2}', { value1: sandbox.name, value2: t(state.label) })}>
    <header className="flex min-w-0 items-center gap-2.5">
      <LfsSandbox className="size-4 shrink-0 text-muted-foreground" />
      <h4 className="min-w-0 flex-1 truncate text-[13px] font-medium" title={sandbox.name}>{sandbox.name}</h4>
      {sandbox.machine && <span className="font-mono text-[11px] text-muted-foreground">{sandbox.machine}</span>}
      <StateChip entity="sandbox" state={sandbox.state} op={sandbox.op} />
      {sandbox.state !== 'gone' && <CloseSandbox name={sandbox.name} onClosed={onChanged} />}
    </header>
    <ul className="mt-3 space-y-1" aria-label={t('Mounted Workspaces')}>
      {sandbox.state === 'unresolved' && <li className="rounded-lg bg-destructive/5 px-3 py-2 font-mono text-[11.5px] text-destructive">
        {t('see {status} · clear: {clear}', clearingCall('sandbox', sandbox.name, sandbox.op))}
      </li>}
      {refusal ? <li className="rounded-lg bg-warning/5 px-3 py-2 text-xs break-words text-warning">
        <span className="font-semibold">{refusal.code}</span>: {refusal.message}
      </li> : sandbox.unread ? <li className="py-1 text-xs text-muted-foreground">{t('Reading its Workspaces…')}</li> : reading && !sandbox.workspaces.length && sandbox.state === 'running' ? <li className="py-1 text-xs text-muted-foreground">{t('Reading its Workspaces…')}</li>
        : unavailable ? <li className="py-1 text-xs text-muted-foreground">{t('Workspace status unavailable.')}</li>
          : !sandbox.workspaces.length ? <li className="py-1 text-xs text-muted-foreground">{t('No Workspace mounted')}</li>
          : sandbox.workspaces.map((workspace) => <li key={workspace.ws} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
            <span className="flex min-w-0 flex-1 basis-40 items-center gap-2" title={workspace.path}>
              <LfsWorkspace className="size-3.5 shrink-0 text-muted-foreground" />
              {workspace.name && <span className="shrink-0 font-semibold">{workspace.name}</span>}
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
        <dt>{t('Name')}</dt><dd className="break-all font-mono">{sandbox.name}</dd>
        {sandbox.runtime && <><dt>{t('Runtime')}</dt><dd className="font-mono">{sandbox.runtime}</dd></>}
        <dt>{t('image')}</dt><dd className="break-all font-mono">{sandbox.image || '—'}</dd>
        {sandbox.backend && <><dt>{t('Backend')}</dt><dd className="font-mono">{sandbox.backend}</dd></>}
        {sandbox.route && <><dt>{t('Route')}</dt><dd className="font-mono">{sandbox.route}</dd></>}
      </dl>
    </details>
  </article>
}

/** Quiet rows keep the mounted paths and their file actions in the same place. */
export function SandboxTiles({ sandboxes, reading, unavailable, onBrowseFiles, onChanged }: { sandboxes: SandboxInfo[]; reading?: boolean; unavailable?: boolean; onBrowseFiles?: (branch: string) => void; onChanged?: () => void }) {
  const { t } = useI18n()
  const open = sandboxes.filter((sandbox) => sandbox.state !== 'gone')
  const closed = sandboxes.filter((sandbox) => sandbox.state === 'gone')
  return <div className="min-w-0">
    {open.map((sandbox) => <SandboxTile key={sandbox.id} sandbox={sandbox} reading={reading} unavailable={unavailable} onBrowseFiles={onBrowseFiles} onChanged={onChanged} />)}
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
