// One chat in the sidebar: its title, a status mark (working, waiting for an
// approval, failed) and its age; on hover a ⋯ menu to rename, archive or delete.
import { Archive, Ellipsis, LoaderCircle, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { chatStatus, type ChatSummary } from '@/layerfs/agent-api'
import { ago } from '@/layerfs/format'
import { archiveChat, deleteChat, renameChat } from '@/layerfs/use-chats'
import { cn } from '@/lib/utils'

const shortAgo = (at: number) =>
  ago(at)
    .replace(/ minutes? ago/, 'm')
    .replace(/ hours? ago/, 'h')
    .replace(/ days? ago/, 'd')
    .replace('yesterday', '1d')
    .replace('just now', 'now')

export function ChatRow({ chat }: { chat: ChatSummary }) {
  const navigate = useNavigate()
  const here = useMatch(`/chat/${encodeURIComponent(chat.id)}`)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = chatStatus(chat)
  const title = chat.title || 'New chat'

  async function rename(next: string) {
    setRenaming(false)
    const value = next.trim()
    if (value && value !== chat.title) await renameChat(chat.id, value).catch(() => undefined)
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteChat(chat.id)
      setConfirming(false)
      if (here) navigate('/')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (renaming) {
    return (
      <input
        autoFocus
        defaultValue={title}
        aria-label="Chat name"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => void rename(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setRenaming(false)
        }}
        className="h-8 w-full rounded-full border border-[var(--border-default)] bg-[var(--card)] pl-8 pr-3 text-13 text-[var(--text-primary)] outline-none focus:border-ring"
      />
    )
  }

  return (
    <div className="group/chat relative">
      <NavLink
        to={`/chat/${encodeURIComponent(chat.id)}`}
        className={({ isActive }) =>
          cn(
            'flex h-8 w-full items-center gap-2 rounded-full pl-8 pr-3 text-13 text-[var(--sidebar-nav-text)] transition-colors hover:bg-sidebar-item-hover',
            isActive && 'sidebar-row-active font-medium hover:bg-sidebar-item-active',
          )
        }
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="flex shrink-0 items-center gap-1.5 group-hover/chat:invisible group-has-[[data-state=open]]/chat:invisible">
          {status === 'working' && <LoaderCircle aria-label="Working" className="size-3 animate-spin text-[var(--text-tertiary)]" />}
          {status === 'approval' && <span aria-label="Waiting for your approval" className="size-1.5 rounded-full bg-warning" />}
          {status === 'error' && <span aria-label="Stopped with an error" className="size-1.5 rounded-full bg-destructive" />}
          <span className="text-11 tabular-nums text-[var(--text-tertiary)]">{shortAgo(chat.updated)}</span>
        </span>
      </NavLink>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${title} actions`}
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover/chat:opacity-100 data-[state=open]:opacity-100"
        >
          <Ellipsis className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="min-w-40">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void archiveChat(chat.id).then(() => here && navigate('/'))}>
            <Archive /> Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2 /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete “{title}”?</DialogTitle>
            <DialogDescription>
              The conversation is deleted for good. Its scratch folder and any LayerFS project stay as they are.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
