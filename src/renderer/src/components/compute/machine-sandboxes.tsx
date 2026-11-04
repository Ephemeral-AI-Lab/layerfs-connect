import { t, useI18n } from '@/i18n'
// A machine's Sandboxes (#537 §6, U6), as sandbox.list answers them: a grid of
// compact cards. Its head: name, state, any operation in flight and the menu
// (backend and kernel route in the name's title), then project and Store
// (links) and the image it was made from (against its machine's default). Its
// foot: how full it is, and its Workspaces (sandbox.get) as rows that open and
// close, each with its path, Branch, the chat that uses it, and Close
// (workspace.unmount). The menu opens the project and closes the
// Sandbox; a refused close offers Force close, which names the Workspaces of
// unknown state. An unresolved Sandbox shows the call that clears it.
import { ChevronDown, Disc3, LoaderCircle, MessageSquare, Users, X } from 'lucide-react'
import { useState } from 'react'

import { LfsBranch, LfsProject, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import { Collapse } from '@/components/motion'
import { StoreChip } from '@/components/projects/where-chips'
import { Refusal } from '@/components/refusal'
import { StateChip } from '@/components/state-chip'
import { Bar } from '@/components/storage/meters'
import { Card, MoreButton } from '@/components/storage/overview/row-parts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { chatsOn } from '@/data/compute'
import { shortDigest } from '@/data/format'
import { clearingCall } from '@/data/states'
import { chatLive } from '@/host/use-chat-sessions'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { AgentSessionSummary } from '@shared/agent-api'
import { type MachineSandbox, projectRef, type SandboxInfo, type WorkspaceInfo } from '@shared/host-api'

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
  /** The chats, to name the one each Workspace is used by. */
  chats?: AgentSessionSummary[]
  /** The panels open now (their Workspaces shown), by Sandbox name. */
  open: Set<string>
  onToggle: (name: string) => void
  onOpenProject?: (key: string, tab?: string) => void
  onOpenChat?: (session: string) => void
}

export function MachineSandboxes({ sandboxes, ops, machineImage, chats, open, onToggle, onOpenProject, onOpenChat }: Props) {
  useI18n()
  return (
    <div role="list" aria-label={t('Sandboxes and their Workspaces')} className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3">
      {sandboxes.map((b, i) => (
        <SandboxPanel key={b.name} b={b} index={Math.min(i + 2, 12)} ops={ops} machineImage={machineImage} chats={chats} expanded={open.has(b.name)} onToggle={() => onToggle(b.name)} onOpenProject={onOpenProject} onOpenChat={onOpenChat} />
      ))}
    </div>
  )
}

/** The image a Sandbox was made from: a digest cut short or an archive's file name; "machine default" or "custom" against its machine's. */
function SandboxImage({ image, backend, machineImage }: { image?: string | null; backend?: string | null; machineImage?: string }) {
  useI18n()
  if (!image)
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground" title={backend === 'native' ? undefined : t('Its record names no image')}>
        <Disc3 aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
        {t(backend === 'native' ? 'No image · host processes' : 'Image not reported')}
      </span>
    )
  const label = image.startsWith('/') ? image.slice(image.lastIndexOf('/') + 1) : shortDigest(image)
  const tag = !machineImage ? null : image === machineImage ? 'machine default' : 'custom'
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={image}>
      <Disc3 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-mono text-[11.5px] text-foreground/85">{label}</span>
      {tag && <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-medium', tag === 'custom' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05] text-muted-foreground')}>{t(tag)}</span>}
    </span>
  )
}

/** One Sandbox: name, project and Store, image, state and menu; then how full it is and, opened, its Workspaces as tiles. */
function SandboxPanel({ b, index, ops, machineImage, chats, expanded, onToggle, onOpenProject, onOpenChat }: { b: MachineSandbox; index: number; ops: SandboxOps; machineImage?: string; chats?: AgentSessionSummary[]; expanded: boolean; onToggle: () => void; onOpenProject?: Props['onOpenProject']; onOpenChat?: Props['onOpenChat'] }) {
  useI18n()
  const closing = useClose(b, ops)
  const route = [b.backend, b.route].filter(Boolean).join(' · ')
  const used = b.workspaces ?? 0
  const share = used / SANDBOX_CAPACITY
  const ref = b.project ? projectRef(b.project) : null
  return (
    <Card index={index} role="listitem" aria-label={b.name} className="flex flex-col">
      <header className="flex min-w-0 flex-col gap-1 px-3.5 pt-3 pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-(--icon-accent) ring-1 ring-foreground/[0.06] ring-inset">
            <LfsSandbox className="size-3.5" />
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-tight" title={route ? `${b.name} · ${route}` : b.name}>{t('Sandbox {name}', { name: b.name })}</h3>
          <StateChip entity="sandbox" state={b.state} op={b.op} className="max-w-32" />
          <SandboxMenu b={b} closing={closing} onOpenProject={onOpenProject} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-[12.5px]">
          {ref ? (
            <>
              <button type="button" className="inline-flex min-w-0 items-center gap-1 rounded-md font-medium text-foreground/85 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:hover:text-foreground/85" title={t('Open {project}’s Sandboxes', { project: ref.name })} disabled={!onOpenProject} onClick={() => onOpenProject?.(b.project!, 'sandboxes')}>
                <LfsProject className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{ref.name}</span>
              </button>
              {ref.store && <StoreChip store={ref.store} className="shrink-0" />}
            </>
          ) : (
            <span className="text-muted-foreground">{t('No project')}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center pl-8 text-xs">
          <SandboxImage image={b.image} backend={b.backend} machineImage={machineImage} />
        </div>
      </header>

      {(b.state === 'unresolved' || closing.error !== null || (closing.unknown && closing.unknown.length > 0)) && (
        <div className="flex flex-col gap-0.5 px-3.5 pb-2.5 text-[11.5px] text-destructive">
          {b.state === 'unresolved' && <p className="font-mono break-words">{t('see {status} · clear: {clear}', clearingCall('sandbox', b.name, b.op))}</p>}
          {closing.error !== null && <Refusal error={closing.error} compact />}
          {closing.unknown && closing.unknown.length > 0 && <span title={closing.unknown.join('\n')}>{t('Closed by force; Workspaces of unknown state: {list}', { list: closing.unknown.join(', ') })}</span>}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1.5 border-t border-foreground/[0.06] px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {used > 0 || expanded ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={t('{value1} Workspaces in {value2}', { value1: t(expanded ? 'Hide' : 'Show'), value2: b.name })}
              onClick={onToggle}
              className="-mx-1.5 flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 font-medium text-foreground/85 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform duration-(--dur-base) ease-out-expo', !expanded && '-rotate-90')} />
              {b.workspaces === null ? t('Workspaces unknown') : t(used === 1 ? '1 Workspace' : '{n} Workspaces', { n: used })}
            </button>
          ) : (
            <span className="shrink-0 py-1">{b.workspaces === null ? t('Workspaces unknown') : t('No Workspace mounted')}</span>
          )}
          <Bar share={share} tone={share >= 1 ? 'danger' : share > 0.75 ? 'warning' : 'brand'} live={b.state === 'running' && used > 0} className="ml-auto w-16 max-w-[30%] shrink" />
          <span className="shrink-0 text-[11px]" title={t('{n} of {cap} Workspaces', { n: b.workspaces ?? '—', cap: SANDBOX_CAPACITY })}>{t('{n} of {cap}', { n: b.workspaces ?? '—', cap: SANDBOX_CAPACITY })}</span>
        </div>
        <Collapse open={expanded} appear={false}>
          {expanded && <Workspaces b={b} ops={ops} chats={chats} onOpenChat={onOpenChat} />}
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
  useI18n()
  const { busy, error, close } = closing
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label={t('More for Sandbox {name}', { name: b.name })} className="-my-1 -mr-1.5 size-7 shrink-0" disabled={busy} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {b.project && onOpenProject && <DropdownMenuItem onSelect={() => onOpenProject(b.project!, 'sandboxes')}>{t('Open project')}</DropdownMenuItem>}
        <DropdownMenuItem variant="destructive" disabled={busy || b.state === 'gone'} onSelect={() => void close(error !== null)} title={error !== null ? t('Close even with Workspaces whose state LayerFS cannot learn') : t('Close this Sandbox')}>
          <X />
          {error !== null ? t('Force close') : t('Close Sandbox')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** An opened card: its Workspaces (sandbox.get) with their Branches and chats. */
function Workspaces({ b, ops, chats, onOpenChat }: { b: MachineSandbox; ops: SandboxOps; chats?: AgentSessionSummary[]; onOpenChat?: (session: string) => void }) {
  useI18n()
  const read = useHostQuery(() => ops.read(b.name), [b.name, b.workspaces])
  const [all, setAll] = useState(false)
  const s = read.data
  const hidden = s && !s.refusal && !all ? Math.max(0, s.workspaces.length - FIRST_ROWS) : 0
  return (
    <div className="pb-1 text-xs">
      {read.error ? (
        <Refusal error={read.error} className="text-warning" />
      ) : !s ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> {t('Reading its Workspaces…')}
        </p>
      ) : s.refusal ? (
        <p className="break-words text-warning">
          <span className="font-semibold">{s.refusal.code}</span>: {s.refusal.message}
        </p>
      ) : s.workspaces.length === 0 ? (
        <p className="text-muted-foreground">{t('No Workspace mounted')}</p>
      ) : (
        <>
          <ul aria-label={t('Workspaces in {sandbox}', { sandbox: b.name })} className="-mx-1.5 flex flex-col">
            {s.workspaces.slice(0, s.workspaces.length - hidden).map((w) => (
              <WorkspaceRow key={w.ws} sandbox={b.name} w={w} ops={ops} chats={chatsOn(chats, b.name, w)} onOpenChat={onOpenChat} onDone={read.reload} />
            ))}
          </ul>
          {s.workspaces.length > FIRST_ROWS && (
            <button type="button" onClick={() => setAll(!all)} className="mt-0.5 rounded-md pl-5.5 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {all ? t('Show fewer') : t('Show {n} more', { n: hidden })}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Workspace rows an opened card shows before "Show N more". */
const FIRST_ROWS = 4

/** A Workspace as a row: its path (and name), Branch and Close (shown on hover), then the chats that use it. */
function WorkspaceRow({ sandbox, w, ops, chats, onOpenChat, onDone }: { sandbox: string; w: WorkspaceInfo; ops: SandboxOps; chats: AgentSessionSummary[]; onOpenChat?: (session: string) => void; onDone: () => void }) {
  useI18n()
  const handle = w.ws || `${sandbox}:${w.path}`
  const unmount = useUnmount(handle, chats.length > 0, ops, onDone)
  return (
    <li className="group/ws flex min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-1 hover:bg-foreground/[0.03]">
      <span className="relative flex h-5 min-w-0 items-center gap-2 pr-5">
        <LfsWorkspace className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5" title={handle}>
          {w.name && <span className="shrink-0 font-semibold">{w.name}</span>}
          <span className="min-w-0 truncate font-mono text-[11.5px]">{w.path || handle}</span>
        </span>
        <span className="flex w-[38%] min-w-0 shrink-0 items-center gap-1 text-muted-foreground" title={w.branch}>
          <LfsBranch className="size-3 shrink-0" />
          <span className="truncate">{w.branch || t('Unknown branch')}</span>
        </span>
        <Button
          size="sm"
          variant={unmount.sure ? 'destructive' : 'ghost'}
          className={cn('absolute top-0 -right-1 h-5 min-w-5 rounded-md px-1 text-[11px]', !unmount.sure && !unmount.busy && 'opacity-0 group-hover/ws:opacity-100 focus-visible:opacity-100')}
          disabled={unmount.busy}
          title={t('Unmount {ws}', { ws: handle })}
          aria-label={t('Unmount {ws}', { ws: handle })}
          onClick={() => void unmount.run()}
          onBlur={() => unmount.setSure(false)}
        >
          {unmount.busy ? <LoaderCircle className="size-3 animate-spin" /> : unmount.sure ? t('Close anyway') : <X className="size-3" />}
        </Button>
      </span>
      <span className="flex min-h-5 min-w-0 flex-col justify-center gap-0.5 pl-5.5">
        {chats.length === 0 ? (
          <span className="truncate text-faint">— {t('not used by a chat')}</span>
        ) : (
          chats.map((c) => <ChatLink key={c.id} chat={c} onOpenChat={onOpenChat} />)
        )}
      </span>
      {unmount.failed != null && <Refusal error={unmount.failed} compact className="pl-5.5 text-destructive" />}
    </li>
  )
}
/** The chat a Workspace is used by: its title (a scenario's, for a scenario chat), and whether it is working. */
function ChatLink({ chat, onOpenChat }: { chat: AgentSessionSummary; onOpenChat?: (session: string) => void }) {
  useI18n()
  const live = chatLive(chat)
  const Icon = chat.scenario ? Users : MessageSquare
  const title = chat.scenario?.title || chat.title || t('Untitled chat')
  return (
    <span className="flex min-w-0 items-center gap-2">
      <button type="button" disabled={!onOpenChat} onClick={() => onOpenChat?.(chat.id)} title={onOpenChat ? t('Open the chat {title}', { title }) : title} className="flex min-w-0 items-center gap-1.5 text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:no-underline">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn('truncate', chat.archived && 'text-muted-foreground')}>{title}</span>
      </button>
      {live ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-primary">
          <span aria-hidden="true" className="pulse-ring size-1.5 rounded-full bg-primary text-primary" />
          {t('working')}
        </span>
      ) : (
        <span className="shrink-0 text-muted-foreground">{t('idle')}</span>
      )}
    </span>
  )
}

/** Closes one Workspace (workspace.unmount; its uncommitted changes are not discarded); one a chat uses asks again first. LayerFS's refusal shows under it. */
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
