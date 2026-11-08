import { fill } from '@/lib/text'
import type { SandboxInfo } from '@/layerfs/host-api'
import { ChevronDown, FolderTree, LoaderCircle, Plus, X } from 'lucide-react'
import { useState } from 'react'

import { go } from '@/layerfs/go'
import { LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/layerfs/LfsIcons'
import { StateChip } from '@/components/layerfs/StateChip'
import { Refusal } from '@/components/layerfs/Refusal'
import { clearingCall, stateLook } from '@/layerfs/states'
import { host } from '@/layerfs/client'

/** Closes a Sandbox; a refused close offers a forced one, which names the Workspaces of unknown state. */
export function CloseSandbox({ name, onClosed }: { name: string; onClosed?: () => void }) {
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
  const refusal = error as { code?: string; detail?: { execs?: unknown[] } } | null
  const forceAllowed = refusal?.code === 'MountsActive' || (refusal?.code === 'Busy' && !!refusal.detail?.execs?.length)
  const uncertain = refusal?.code === 'Unknown'
  return <span className="flex flex-wrap items-center justify-end gap-1.5">
    {error !== null && <Refusal error={error} compact className="max-w-96 text-xs text-destructive" />}
    {unknown && unknown.length > 0 && <span className="text-xs text-destructive" title={unknown.join('\n')}>{`Closed by force; Workspaces of unknown state: ${unknown.join(', ')}`}</span>}
    <button type="button" disabled={busy} onClick={() => { if (forceAllowed && !window.confirm('Running commands receive SIGTERM, then SIGKILL after 5 seconds. Uncommitted changes are lost. Force close?')) return; if (uncertain) { setBusy(true); host.sandbox(name).then(() => setError(null), setError).finally(() => setBusy(false)); return }; void close(forceAllowed) }} title={error !== null ? 'Close even with Workspaces whose state LayerFS cannot learn' : 'Close this Sandbox'} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <X className="size-3.5" />}{forceAllowed ? 'Force close' : uncertain ? 'Read Sandbox' : 'Close'}
    </button>
  </span>
}

const NEW_BRANCH = '\u0000new'

/**
 * Mount Workspace (#537 §7): a side Branch of the project, or a new one
 * forked from main first (only side Branches are mounted, owner D14), and an
 * optional Workspace name (its handle is then `<sandbox>:<name>`).
 */
function MountWorkspace({ sandbox, branches, onMounted }: { sandbox: string; branches: string[]; onMounted?: () => void }) {
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState(branches[0] ?? NEW_BRANCH)
  const [fresh, setFresh] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const forking = branch === NEW_BRANCH
  const chosen = forking ? fresh.trim() : branch
  const mount = async () => {
    setBusy(true)
    setError(null)
    try {
      await host.mountWorkspace(sandbox, { branch: chosen, ...(forking ? { fork: true } : {}), ...(name.trim() ? { name: name.trim() } : {}) })
      setOpen(false)
      setName('')
      setFresh('')
      onMounted?.()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <Plus className="size-3.5" />{'Mount Workspace'}
    </button>
  }
  return <form className="mt-2 flex flex-col gap-2 rounded-md bg-muted/40 px-3 py-2.5 text-sm" onSubmit={(e) => { e.preventDefault(); if (chosen && !busy) void mount() }}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="text-muted-foreground">{'Branch'}</span>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm">
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          <option value={NEW_BRANCH}>{'New Branch from main…'}</option>
        </select>
      </label>
      {forking && <label className="flex min-w-36 flex-1 flex-col gap-1">
        <span className="text-muted-foreground">{'New Branch name'}</span>
        <input value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="task-42" className="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm" />
      </label>}
      <label className="flex min-w-32 flex-1 flex-col gap-1">
        <span className="text-muted-foreground">{'Workspace name (optional)'}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={chosen || 'build'} className="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm" />
      </label>
      <span className="flex gap-1.5">
        <button type="submit" disabled={!chosen || busy} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-50">{busy && <LoaderCircle className="size-3.5 animate-spin" />}{'Mount'}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="h-8 rounded-md px-2.5 text-muted-foreground hover:bg-foreground/[0.05]">{'Cancel'}</button>
      </span>
    </div>
    <p className="text-xs text-muted-foreground">{'Only side Branches are mounted; main is the published line. A new Branch is forked from main first.'}</p>
    {error !== null && <Refusal error={error} className="text-destructive" />}
  </form>
}

function SandboxTile({ sandbox, branches, reading, unavailable, onBrowseFiles, onChanged }: { sandbox: SandboxInfo; branches: string[]; reading?: boolean; unavailable?: boolean; onBrowseFiles?: (branch: string) => void; onChanged?: () => void }) {
  const state = stateLook('sandbox', sandbox.state)
  const refusal = sandbox.refusal
  return <article className="min-w-0 border-t border-border/70 px-5 py-4" aria-label={`Sandbox ${sandbox.name}, ${state.label}`}>
    <header className="flex min-w-0 items-center gap-2.5">
      <LfsSandbox className="size-4 shrink-0 text-muted-foreground" />
      <h4 className="min-w-0 flex-1 truncate text-md font-medium" title={sandbox.name}>{sandbox.name}</h4>
      {sandbox.machine && (
        // the machine's row on Machines (#537 §7)
        <button type="button" className="font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" title={`Show ${sandbox.machine} on Machines`} onClick={() => go.machine(sandbox.machine!)}>
          {sandbox.machine}
        </button>
      )}
      <StateChip entity="sandbox" state={sandbox.state} op={sandbox.op} />
      {sandbox.name.startsWith('chat.') && <span className="text-xs text-muted-foreground">Used by chat {sandbox.name.slice(5)}; closing ends its Workspace.</span>}
      {sandbox.state !== 'gone' && <CloseSandbox name={sandbox.name} onClosed={onChanged} />}
    </header>
    <ul className="mt-3 space-y-1" aria-label={'Mounted Workspaces'}>
      {sandbox.state === 'unresolved' && <li className="rounded-md bg-destructive/5 px-3 py-2 font-mono text-xs-plus text-destructive">
        {fill('see {status} · clear: {clear}', clearingCall('sandbox', sandbox.name, sandbox.op))}
      </li>}
      {sandbox.downReason ? <li className="py-1 text-sm text-muted-foreground">Workspaces unavailable: {sandbox.downReason}</li> : refusal ? <li className="rounded-md bg-warning/5 px-3 py-2 text-sm break-words text-warning">
        <span className="font-strong">{refusal.code}</span>: {refusal.message}
      </li> : sandbox.unread ? <li className="py-1 text-sm text-muted-foreground">{'Workspace details are read when opened.'}</li> : reading && !sandbox.workspaces.length && sandbox.state === 'running' ? <li className="py-1 text-sm text-muted-foreground">{'Workspace details are read when opened.'}</li>
        : unavailable ? <li className="py-1 text-sm text-muted-foreground">{'Workspace status unavailable.'}</li>
          : !sandbox.workspaces.length ? <li className="py-1 text-sm text-muted-foreground">{'No Workspace mounted'}</li>
          : sandbox.workspaces.map((workspace) => <li key={workspace.ws} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="flex min-w-0 flex-1 basis-40 items-center gap-2" title={workspace.path}>
              <LfsWorkspace className="size-3.5 shrink-0 text-muted-foreground" />
              {workspace.name && <span className="shrink-0 font-strong">{workspace.name}</span>}
              <span className="truncate font-mono">{workspace.path}</span>
            </span>
            <span className="flex min-w-0 max-w-full items-center gap-1.5 text-muted-foreground" title={workspace.branch}>
              <LfsBranch className="size-3.5 shrink-0" /><span className="max-w-56 truncate">{workspace.branch || 'Unknown branch'}</span>
            </span>
            {onBrowseFiles && workspace.branch && <button type="button" onClick={() => onBrowseFiles(workspace.branch)} title={`Browse the files on ${workspace.branch}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-foreground outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring">
              <FolderTree className="size-3.5" />{'Browse files'}
            </button>}
          </li>)}
    </ul>
    {sandbox.state === 'running' && !refusal && <MountWorkspace sandbox={sandbox.name} branches={branches} onMounted={onChanged} />}
    <details className="group mt-2 text-sm text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {'Details'}<ChevronDown className="size-3 group-open:rotate-180" />
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 leading-relaxed">
        <dt>{'Name'}</dt><dd className="break-all font-mono">{sandbox.name}</dd>
        {sandbox.runtime && <><dt>{'Runtime'}</dt><dd className="font-mono">{sandbox.runtime}</dd></>}
        <dt>{'image'}</dt><dd className="break-all font-mono">{sandbox.image || '—'}</dd>
        {sandbox.backend && <><dt>{'Backend'}</dt><dd className="font-mono">{sandbox.backend}</dd></>}
        {sandbox.route && <><dt>{'Route'}</dt><dd className="font-mono">{sandbox.route}</dd></>}
      </dl>
    </details>
  </article>
}

/** Quiet rows keep the mounted paths and their file actions in the same place. */
export function SandboxTiles({ sandboxes, branches = [], reading, unavailable, onBrowseFiles, onChanged }: { sandboxes: SandboxInfo[]; branches?: string[]; reading?: boolean; unavailable?: boolean; onBrowseFiles?: (branch: string) => void; onChanged?: () => void }) {
  const open = sandboxes.filter((sandbox) => sandbox.state !== 'gone')
  const closed = sandboxes.filter((sandbox) => sandbox.state === 'gone')
  return <div className="min-w-0">
    {open.map((sandbox) => <SandboxTile key={sandbox.id} sandbox={sandbox} branches={branches} reading={reading} unavailable={unavailable} onBrowseFiles={onBrowseFiles} onChanged={onChanged} />)}
    {!open.length && <p className="border-t border-border/70 px-5 py-10 text-center text-base text-muted-foreground">{fill(reading ? 'Reading Sandboxes…' : 'No active Sandboxes')}</p>}
    {closed.length > 0 && <details className="group border-t border-border/70 px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {'No runtime recorded'}<span className="tabular-nums">{closed.length}</span><ChevronDown className="ml-auto size-3.5 group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-2 pb-1 text-sm text-muted-foreground">
        {closed.map((sandbox) => <li key={sandbox.id} className="flex min-w-0 items-center gap-2" title={sandbox.id}><LfsSandbox className="size-3.5 shrink-0" /><span className="truncate">{sandbox.name}</span></li>)}
      </ul>
    </details>}
  </div>
}
