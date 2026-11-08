// Square machine inventory cards. Workspace management lives in the existing
// Sandbox detail route; opening a card preserves the machine's return position.
import { ArrowRight, ArrowUpRight, GitBranch, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { SandboxResources } from './SandboxResources'
import { sampleSandboxUsage } from '@/layerfs/simulation/sandbox-metrics'

import { Refusal } from '@/components/layerfs/Refusal'
import { MoreButton } from '@/pages/storage/RowParts'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { clearingCall, opWords, stateLook } from '@/layerfs/states'
import { shortDigest } from '@/layerfs/format'
import { type MachineSandbox, projectRef, type SandboxInfo } from '@/layerfs/host-api'

export const SANDBOX_CAPACITY = 16

export interface SandboxOps {
  read: (name: string) => Promise<SandboxInfo>
  close: (name: string, force: boolean) => Promise<string[]>
  unmount: (ws: string) => Promise<void>
}

interface Props {
  sandboxes: MachineSandbox[]
  sampleMetrics?: boolean
  ops: SandboxOps
  onOpenProject?: (key: string, tab?: string) => void
}

export function MachineSandboxes({ sandboxes, ops, onOpenProject, sampleMetrics = false }: Props) {
  return <div role="list" aria-label="Sandboxes" className="machine-sandbox-grid">
    {sandboxes.map(b => <SandboxBox key={b.name} b={b} ops={ops} onOpenProject={onOpenProject} sampleMetrics={sampleMetrics} />)}
  </div>
}

function SandboxBox({ b, ops, onOpenProject, sampleMetrics }: { b: MachineSandbox; ops: SandboxOps; sampleMetrics: boolean; onOpenProject?: Props['onOpenProject'] }) {
  const location = useLocation()
  const closing = useClose(b, ops)
  const ref = b.project ? projectRef(b.project) : null
  const used = b.workspaces
  const preview: { data: SandboxInfo | null; error: Error | null } = { data: null, error: null }
  // Sandbox detail performs live daemon reads on open and Refresh; cards show recorded inventory.
  const workspaces = preview.data?.workspaces ?? []
  const imageRef = b.image || preview.data?.image
  const backend = b.backend || preview.data?.backend
  const image = imageRef ? (imageRef.startsWith('/') ? imageRef.split('/').at(-1) : shortDigest(imageRef)) : backend === 'native' ? 'None · host processes' : 'Not reported'
  const route = b.route || preview.data?.route
  const kernel = route === 'fuse' ? 'FUSE' : route === 'nfs' ? 'NFS' : route || 'Not reported'
  const look = stateLook('sandbox', b.state)
  const operation = opWords(b.op)
  const calls = b.state === 'unresolved' ? clearingCall('sandbox', b.name, b.op) : null
  return <article role="listitem" aria-label={b.name} className="machine-sandbox-box" data-sandbox={b.name}>
    <header className="machine-sandbox-box-top">
      <h3 title={b.name}>
        {b.machine ? <Link className="machine-sandbox-link"
          aria-label={`Open Sandbox ${b.name}`}
          to={`/machines/${encodeURIComponent(b.machine)}/sandboxes/${encodeURIComponent(b.name)}`}
          state={{ fromMachine: location.pathname + location.search }}
          onClick={event => {
            const scroll = event.currentTarget.closest('[data-machine-scroll]')?.scrollTop ?? 0
            sessionStorage.setItem(`connect.machine-return:${location.pathname}${location.search}`, String(scroll))
          }}
        >{b.name}</Link> : b.name}
      </h3>
      <span aria-hidden="true" className="machine-identity-separator">·</span>
      <span className="machine-card-project" title={b.project ? `Bound project: ${b.project}` : 'No project recorded'}>{ref ? `${ref.store}/${ref.name}` : 'No project recorded'}</span>
      <div className="machine-sandbox-action"><SandboxMenu b={b} closing={closing} onOpenProject={onOpenProject} /></div>
    </header>
    <div className="machine-card-subtitle">
      <p className="machine-card-image" title={imageRef ? `Image: ${imageRef}` : `Image: ${image}`}><span>Image:</span> {image}</p>
      <span className="machine-card-kernel" title="Reported filesystem kernel"><span>Kernel</span> {kernel}</span>
    </div>
    <SandboxResources usage={import.meta.env.DEV && sampleMetrics ? sampleSandboxUsage(b.name) : null} sample={import.meta.env.DEV && sampleMetrics} />
    <section className="machine-card-workspaces" aria-label={`Workspaces in ${b.name}`}>
      <h4>Workspaces <span aria-label={used === null ? 'Workspace count unknown' : `${used} of ${SANDBOX_CAPACITY} workspaces`}>{used ?? '—'} <span className="text-faint">/ {SANDBOX_CAPACITY}</span></span></h4>
      {used === 0 ? <p className="machine-card-empty">No workspaces mounted</p>
        : preview.error || preview.data?.refusal || preview.data?.unread || preview.data?.downReason ? <p className="machine-card-empty" title={preview.error?.message || preview.data?.refusal?.message}>Workspace details unavailable</p>
        : !preview.data ? <p className="machine-card-empty">Open Sandbox to read Workspace details.</p>
        : workspaces.length === 0 ? <p className="machine-card-empty">No workspace details reported</p>
        : <>
          <div className="machine-workspace-head" aria-hidden="true"><span>Workspace</span><span>Branch</span></div>
          <ul>{workspaces.slice(0, 3).map(w => <li key={w.ws}>
            <span className="machine-workspace-name" title={w.path || w.ws}>{w.name || w.path.split('/').filter(Boolean).at(-1) || w.ws}</span>
            <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-faint" />
            <span className="machine-workspace-branch" title={w.branch || undefined}><GitBranch aria-hidden="true" className="size-3 shrink-0" /><span>{w.branch || 'Not reported'}</span></span>
          </li>)}</ul>
          {used !== null && used > 3 && workspaces.length >= 3 && <p className="machine-card-more">+{used - 3} more in sandbox details</p>}
        </>}
    </section>
    <footer className="machine-sandbox-box-footer">
      <span className="machine-module-status" title={operation ?? undefined}>
        <span aria-hidden="true" className="machine-module-dot" data-tone={look.tone} />
        <span className="truncate">Recorded: {look.label}{operation ? ` · ${operation}` : ''}</span>
      </span>
      <span className="machine-card-open">Open sandbox <ArrowUpRight aria-hidden="true" className="size-4" /></span>
    </footer>
    {(calls || closing.error !== null || !!closing.unknown?.length) && <div className="machine-sandbox-notice">
      {calls && <p className="font-mono">{`see ${calls.status} · clear: ${calls.clear}`}</p>}
      {closing.error !== null && <Refusal error={closing.error} compact />}
      {!!closing.unknown?.length && <p>{`Closed by force; Workspaces of unknown state: ${closing.unknown.join(', ')}`}</p>}
    </div>}
  </article>
}

/** sandbox.close, then Force close once a close was refused: what is pending, the refusal, and what a forced close could not learn. */
function useClose(b: MachineSandbox, ops: SandboxOps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unknown, setUnknown] = useState<string[] | null>(null)
  const close = async (force: boolean) => {
    if ((error as { code?: string } | null)?.code === 'Unknown') {
      setBusy(true)
      try { await ops.read(b.name); setError(null) } catch (e) { setError(e) } finally { setBusy(false) }
      return
    }
    setBusy(true)
    setError(null)
    try {
      setUnknown(await ops.close(b.name, force))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  const refusal = error as { code?: string; detail?: { execs?: unknown[] } } | null
  const forceAllowed = refusal?.code === 'MountsActive' || (refusal?.code === 'Busy' && !!refusal.detail?.execs?.length)
  return { busy, error, unknown, close, forceAllowed, uncertain: refusal?.code === 'Unknown' }
}

/** The card's menu: its project, and Close (Force close once a close was refused). */
function SandboxMenu({ b, closing, onOpenProject }: { b: MachineSandbox; closing: ReturnType<typeof useClose>; onOpenProject?: Props['onOpenProject'] }) {
  const { busy, close, forceAllowed, uncertain } = closing
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={`More for Sandbox ${b.name}`} className="-my-1 -mr-1.5 size-7 shrink-0" disabled={busy} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {b.project && onOpenProject && <DropdownMenuItem onSelect={() => onOpenProject(b.project!, 'sandboxes')}>{'Open project'}</DropdownMenuItem>}
        <DropdownMenuItem variant="destructive" disabled={busy || b.state === 'gone'} onSelect={() => { if (forceAllowed && !window.confirm('Running commands receive SIGTERM, then SIGKILL after 5 seconds. Uncommitted changes are lost. Force close?')) return; if (b.name.startsWith('chat.') && !window.confirm(`Used by chat ${b.name.slice(5)}; closing ends its Workspace. Close?`)) return; void close(forceAllowed) }} title={forceAllowed ? 'Close even with Workspaces whose state LayerFS cannot learn' : 'Close this Sandbox'}>
          <X />
          {forceAllowed ? 'Force close' : uncertain ? 'Read Sandbox' : 'Close Sandbox'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
