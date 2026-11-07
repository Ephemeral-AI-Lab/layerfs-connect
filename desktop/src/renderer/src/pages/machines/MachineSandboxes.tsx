import { fill } from '@/lib/text'
// A machine's Sandboxes (#537 §6, U6), as sandbox.list answers them: a grid of
// compact cards. Its head: name, state, any operation in flight and the menu
// (backend and kernel route in the name's title), then project and Store
// (links) and the image it was made from (against its machine's default). Its
// foot: how full it is, and its Workspaces (sandbox.get) as rows that open and
// close, each with its path, Branch and Close
// (workspace.unmount). The menu opens the project and closes the
// Sandbox; a refused close offers Force close, which names the Workspaces of
// unknown state. An unresolved Sandbox shows the call that clears it.
import { ChevronDown, Disc3, LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'

import { LfsBranch, LfsProject, LfsSandbox, LfsWorkspace } from '@/components/layerfs/LfsIcons'
import { Collapse } from '@/components/layerfs/motion/index'
import { StoreChip } from '@/components/layerfs/WhereChips'
import { Refusal } from '@/components/layerfs/Refusal'
import { StateChip } from '@/components/layerfs/StateChip'
import { Bar } from '@/pages/storage/Meters'
import { Card, MoreButton } from '@/pages/storage/RowParts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { shortDigest } from '@/layerfs/format'
import { clearingCall } from '@/layerfs/states'
import { useHostQuery } from '@/layerfs/use-host'
import { cn } from '@/lib/utils'
import { type MachineSandbox, projectRef, type SandboxInfo, type WorkspaceInfo } from '@/layerfs/host-api'

/** LayerFS refuses a mount past this many Workspaces in one Sandbox. */
export const SANDBOX_CAPACITY = 16

/** The Sandbox and Workspace calls, on the live host or a simulated one. */
export interface SandboxOps {
  /** sandbox.get */
  read: (name: string) => Promise<SandboxInfo>
  /** sandbox.close; answers the Workspaces of unknown state a forced close names. */
  close: (name: string, force: boolean) => Promise<string[]>
  /** workspace.unmount */
  unmount: (ws: string) => Promise<void>
}

interface Props {
  sandboxes: MachineSandbox[]
  ops: SandboxOps
  /** Its machine's Sandbox image, to tell a Sandbox made from its own image. */
  machineImage?: string
  /** The panels open now (their Workspaces shown), by Sandbox name. */
  open: Set<string>
  onToggle: (name: string) => void
  onOpenProject?: (key: string, tab?: string) => void
}

export function MachineSandboxes({ sandboxes, ops, machineImage, open, onToggle, onOpenProject }: Props) {
  return (
    <div role="list" aria-label={'Sandboxes and their Workspaces'} className="grid grid-cols-[repeat(auto-fill,minmax(304px,1fr))] gap-3">
      {sandboxes.map((b, i) => (
        <SandboxPanel key={b.name} b={b} index={Math.min(i + 2, 12)} ops={ops} machineImage={machineImage} expanded={open.has(b.name)} onToggle={() => onToggle(b.name)} onOpenProject={onOpenProject} />
      ))}
    </div>
  )
}

/** The image a Sandbox was made from: a digest cut short or an archive's file name; "machine default" or "custom" against its machine's. */
function SandboxImage({ image, backend, machineImage }: { image?: string | null; backend?: string | null; machineImage?: string }) {
  if (!image)
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground" title={backend === 'native' ? undefined : 'Its record names no image'}>
        <Disc3 aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
        {fill(backend === 'native' ? 'No image · host processes' : 'Image not reported')}
      </span>
    )
  const label = image.startsWith('/') ? image.slice(image.lastIndexOf('/') + 1) : shortDigest(image)
  const tag = !machineImage ? null : image === machineImage ? 'machine default' : 'custom'
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={image}>
      <Disc3 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-mono text-xs-plus text-foreground/85">{label}</span>
      {tag && <span className={cn('shrink-0 rounded-full px-1.5 py-px text-3xs font-medium', tag === 'custom' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05] text-muted-foreground')}>{tag}</span>}
    </span>
  )
}

/** One Sandbox: name, project and Store, image, state and menu; then how full it is and, opened, its Workspaces as tiles. */
function SandboxPanel({ b, index, ops, machineImage, expanded, onToggle, onOpenProject }: { b: MachineSandbox; index: number; ops: SandboxOps; machineImage?: string; expanded: boolean; onToggle: () => void; onOpenProject?: Props['onOpenProject'] }) {
  const closing = useClose(b, ops)
  const route = [b.backend, b.route].filter(Boolean).join(' · ')
  const used = b.workspaces ?? 0
  const share = used / SANDBOX_CAPACITY
  const ref = b.project ? projectRef(b.project) : null
  return (
    <Card index={index} role="listitem" aria-label={b.name} className="flex flex-col">
      <header className="flex min-w-0 flex-col gap-1 px-3.5 pt-3 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-(--icon-accent) ring-1 ring-foreground/[0.06] ring-inset">
            <LfsSandbox className="size-3.5" />
          </span>
          <h3 className="min-w-0 flex-1 truncate text-md-plus font-strong tracking-tight" title={route ? `${b.name} · ${route}` : b.name}>{`Sandbox ${b.name}`}</h3>
          <StateChip entity="sandbox" state={b.state} op={b.op} className="max-w-32" />
          <SandboxMenu b={b} closing={closing} onOpenProject={onOpenProject} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-sm-plus">
          {ref ? (
            <>
              <button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-sm font-medium text-foreground/85 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:hover:text-foreground/85" title={`Open ${ref.name}’s Sandboxes`} disabled={!onOpenProject} onClick={() => onOpenProject?.(b.project!, 'sandboxes')}>
                <LfsProject className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{ref.name}</span>
              </button>
              {ref.store && <StoreChip store={ref.store} className="shrink-0" />}
            </>
          ) : (
            <span className="text-muted-foreground">{'No project'}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center pl-8 text-sm">
          <SandboxImage image={b.image} backend={b.backend} machineImage={machineImage} />
        </div>
      </header>

      {(b.state === 'unresolved' || closing.error !== null || (closing.unknown && closing.unknown.length > 0)) && (
        <div className="flex flex-col gap-0.5 px-3.5 pb-2.5 text-xs-plus text-destructive">
          {b.state === 'unresolved' && <p className="font-mono break-words">{fill('see {status} · clear: {clear}', clearingCall('sandbox', b.name, b.op))}</p>}
          {closing.error !== null && <Refusal error={closing.error} compact />}
          {closing.unknown && closing.unknown.length > 0 && <span title={closing.unknown.join('\n')}>{`Closed by force; Workspaces of unknown state: ${closing.unknown.join(', ')}`}</span>}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1.5 border-t border-foreground/[0.06] px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-3 text-sm text-muted-foreground tabular-nums">
          {used > 0 || expanded ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${fill(expanded ? 'Hide' : 'Show')} Workspaces in ${b.name}`}
              onClick={onToggle}
              className="-mx-1.5 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-foreground/85 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform duration-(--dur-base) ease-(--ease-out-expo)', !expanded && '-rotate-90')} />
              {b.workspaces === null ? 'Workspaces unknown' : fill(used === 1 ? '1 Workspace' : '{n} Workspaces', { n: used })}
            </button>
          ) : (
            <span className="shrink-0 py-1">{b.workspaces === null ? 'Workspaces unknown' : 'No Workspace mounted'}</span>
          )}
          <Bar share={share} tone={share >= 1 ? 'danger' : share > 0.75 ? 'warning' : 'brand'} live={b.state === 'running' && used > 0} className="ml-auto w-16 max-w-[30%] shrink" />
          <span className="shrink-0 text-xs" title={`${b.workspaces ?? '—'} of ${SANDBOX_CAPACITY} Workspaces`}>{`${b.workspaces ?? '—'} of ${SANDBOX_CAPACITY}`}</span>
        </div>
        <Collapse open={expanded} appear={false}>
          {expanded && <Workspaces b={b} ops={ops} />}
        </Collapse>
      </div>
    </Card>
  )
}

/** sandbox.close, then Force close once a close was refused: what is pending, the refusal, and what a forced close could not learn. */
function useClose(b: MachineSandbox, ops: SandboxOps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [unknown, setUnknown] = useState<string[] | null>(null)
  const close = async (force: boolean) => {
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
  return { busy, error, unknown, close }
}

/** The card's menu: its project, and Close (Force close once a close was refused). */
function SandboxMenu({ b, closing, onOpenProject }: { b: MachineSandbox; closing: ReturnType<typeof useClose>; onOpenProject?: Props['onOpenProject'] }) {
  const { busy, error, close } = closing
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={`More for Sandbox ${b.name}`} className="-my-1 -mr-1.5 size-7 shrink-0" disabled={busy} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {b.project && onOpenProject && <DropdownMenuItem onSelect={() => onOpenProject(b.project!, 'sandboxes')}>{'Open project'}</DropdownMenuItem>}
        <DropdownMenuItem variant="destructive" disabled={busy || b.state === 'gone'} onSelect={() => void close(error !== null)} title={error !== null ? 'Close even with Workspaces whose state LayerFS cannot learn' : 'Close this Sandbox'}>
          <X />
          {error !== null ? 'Force close' : 'Close Sandbox'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** An opened card: its Workspaces (sandbox.get) with their Branches. */
function Workspaces({ b, ops }: { b: MachineSandbox; ops: SandboxOps }) {
  const read = useHostQuery(() => ops.read(b.name), [b.name, b.workspaces])
  const [all, setAll] = useState(false)
  const s = read.data
  const hidden = s && !s.refusal && !all ? Math.max(0, s.workspaces.length - FIRST_ROWS) : 0
  return (
    <div className="pb-1 text-sm">
      {read.error ? (
        <Refusal error={read.error} className="text-warning" />
      ) : !s ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> {'Reading its Workspaces…'}
        </p>
      ) : s.refusal ? (
        <p className="break-words text-warning">
          <span className="font-strong">{s.refusal.code}</span>: {s.refusal.message}
        </p>
      ) : s.workspaces.length === 0 ? (
        <p className="text-muted-foreground">{'No Workspace mounted'}</p>
      ) : (
        <>
          <ul aria-label={`Workspaces in ${b.name}`} className="-mx-1.5 flex flex-col">
            {s.workspaces.slice(0, s.workspaces.length - hidden).map((w) => (
              <WorkspaceRow key={w.ws} sandbox={b.name} w={w} ops={ops} onDone={read.reload} />
            ))}
          </ul>
          {s.workspaces.length > FIRST_ROWS && (
            <button type="button" onClick={() => setAll(!all)} className="mt-0.5 rounded-sm pl-5.5 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {all ? 'Show fewer' : `Show ${hidden} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Workspace rows an opened card shows before "Show N more". */
const FIRST_ROWS = 4

/** A Workspace as a row: its path (and name), Branch and Close (shown on hover). */
function WorkspaceRow({ sandbox, w, ops, onDone }: { sandbox: string; w: WorkspaceInfo; ops: SandboxOps; onDone: () => void }) {
  const handle = w.ws || `${sandbox}:${w.path}`
  const unmount = useUnmount(handle, false, ops, onDone)
  return (
    <li className="group/ws flex min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1 hover:bg-foreground/[0.03]">
      <span className="relative flex h-5 min-w-0 items-center gap-2 pr-5">
        <LfsWorkspace className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5" title={handle}>
          {w.name && <span className="shrink-0 font-strong">{w.name}</span>}
          <span className="min-w-0 truncate font-mono text-xs-plus">{w.path || handle}</span>
        </span>
        <span className="flex w-[38%] min-w-0 shrink-0 items-center gap-1 text-muted-foreground" title={w.branch}>
          <LfsBranch className="size-3 shrink-0" />
          <span className="truncate">{w.branch || 'Unknown branch'}</span>
        </span>
        <Button
          size="sm"
          variant={unmount.sure ? 'destructive' : 'ghost'}
          className={cn('absolute top-0 -right-1 h-5 min-w-5 rounded-sm px-1 text-xs', !unmount.sure && !unmount.busy && 'opacity-0 group-hover/ws:opacity-100 focus-visible:opacity-100')}
          disabled={unmount.busy}
          title={`Unmount ${handle}`}
          aria-label={`Unmount ${handle}`}
          onClick={() => void unmount.run()}
          onBlur={() => unmount.setSure(false)}
        >
          {unmount.busy ? <LoaderCircle className="size-3 animate-spin" /> : unmount.sure ? 'Close anyway' : <X className="size-3" />}
        </Button>
      </span>
      {unmount.failed != null && <Refusal error={unmount.failed} compact className="pl-5.5 text-destructive" />}
    </li>
  )
}
/** Closes one Workspace (workspace.unmount; its uncommitted changes are not discarded). LayerFS's refusal shows under it. */
function useUnmount(ws: string, used: boolean, ops: SandboxOps, onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const [failed, setFailed] = useState<unknown>(null)
  const run = async () => {
    if (used && !sure) return setSure(true)
    setBusy(true)
    setFailed(null)
    try {
      await ops.unmount(ws)
      onDone()
    } catch (e) {
      setFailed(e)
    } finally {
      setBusy(false)
      setSure(false)
    }
  }
  return { busy, sure, setSure, failed, run }
}
