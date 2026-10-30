import { useI18n, localeTag } from '@/i18n'
import { Archive, ArchiveRestore, ChevronDown, Copy, Download, FolderOpen, GitFork, History, Layers, LoaderCircle, MessageSquare, Minimize2, MoreHorizontal, Pencil, Plus, Search, Terminal, Trash2, User, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { AgentSessionDetail, AgentSessionSummary, ChatMessage } from '@shared/agent-api'

import { spotlight } from '@/components/motion/spotlight'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface SessionHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: AgentSessionSummary[]
  activeSession: AgentSessionDetail | null
  selectedId: string | null
  compacting?: boolean
  actionMessage?: string
  actionError?: string
  onSelect: (id: string) => void
  onNew: () => void
  onCompact?: () => void
  onRemove: (id: string) => Promise<void>
  hasDraft?: (id: string) => boolean
  onRename?: (session: AgentSessionSummary) => void
  onArchive?: (session: AgentSessionSummary) => Promise<void>
  onExport?: (session: AgentSessionSummary, format: 'copy' | 'md' | 'json') => void
  onDuplicate?: (session: AgentSessionSummary) => void
}

export function SessionHistory({
  open,
  onOpenChange,
  sessions,
  activeSession,
  selectedId,
  compacting = false,
  actionMessage,
  actionError,
  onSelect,
  onNew,
  onCompact,
  onRemove,
  onDuplicate, hasDraft, onRename, onArchive, onExport,
}: SessionHistoryProps) {
  const { t } = useI18n()
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'history' | 'context'>('history')
  const tabsId = useId()
  const contextVisible = view === 'context' && !!activeSession
  const [removing, setRemoving] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AgentSessionSummary | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleteNotice, setDeleteNotice] = useState('')
  const removeInFlight = useRef(false)
  const [contextExpanded, setContextExpanded] = useState(true)
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const q = search.trim().toLowerCase()
  const shown = sessions.filter((s) => !!s.archived === archived).filter((s) => !q || `${s.title} ${s.cwd} ${s.project ?? ''} ${s.modelId ?? ''}`.toLowerCase().includes(q))

  const messages = activeSession?.messages ?? []
  const userTurns = messages.filter((m) => m.role === 'user').length
  const toolCalls = messages.filter((m) => m.role === 'tool').length
  const inputTokens = messages.reduce((sum, m) => sum + (m.usage?.input ?? 0), 0)
  const outputTokens = messages.reduce((sum, m) => sum + (m.usage?.output ?? 0), 0)
  const totalCost = messages.reduce((sum, m) => sum + (m.usage?.cost ?? 0), 0)
  const isRunning = activeSession?.state === 'running' || activeSession?.execution?.phase === 'children'
  const transcript = messages.filter((m) => m.role !== 'assistant' || m.text || m.thinking)
  const transcriptQuery = transcriptSearch.trim().toLowerCase()
  const shownMessages = transcript.filter((m) => !transcriptQuery || `${m.role} ${m.toolName ?? ''} ${m.text} ${m.thinking ?? ''} ${JSON.stringify(m.args ?? {})} ${JSON.stringify(m.details ?? {})}`.toLowerCase().includes(transcriptQuery))
  const itemKey = (id: string) => `${activeSession?.id}:${id}`
  const allExpanded = shownMessages.length > 0 && shownMessages.every((m) => expandedItems.has(itemKey(m.id)))

  function toggleItem(id: string) {
    setExpandedItems((current) => {
      const next = new Set(current)
      const key = itemKey(id)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function deleteConversation() {
    if (!deleteTarget || removeInFlight.current) return
    removeInFlight.current = true
    setRemoving(deleteTarget.id)
    setDeleteError('')
    try {
      await onRemove(deleteTarget.id)
      if (sessions.length === 1) setSearch('')
      setDeleteTarget(null)
      setDeleteNotice('Conversation deleted.')
    } catch (e) {
      setDeleteError((e as Error).message)
    } finally {
      removeInFlight.current = false
      setRemoving(null)
    }
  }

  function setOpen(next: boolean) {
    if (!next) setView('history')
    onOpenChange(next)
  }

  function startConversation() {
    setSearch('')
    onNew()
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" showCloseButton={false} className="chat-history glass-strong flex min-h-0 flex-col gap-0 overflow-hidden rounded-r-3xl border-r border-foreground/[0.08] p-0 data-[side=left]:w-[min(420px,calc(100vw-16px))] data-[side=left]:sm:max-w-[420px]">
        <div aria-hidden="true" className={cn('shrink-0 app-drag', window.connect.platform === 'darwin' ? 'h-11' : 'h-4')} />
        <SheetHeader className="shrink-0 gap-4 px-5 pt-2 pb-5">
          <div className="flex items-start gap-3">
            <span className="glass-liquid flex size-7 shrink-0 items-center justify-center rounded-lg text-primary"><History className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <SheetTitle className="min-w-0 flex-1 pr-0 text-[17px] font-semibold tracking-tight">{t("History & context")}</SheetTitle>
                <Button variant="ghost" size="icon-sm" aria-label={t("Close history")} title={t("Close history")} onClick={() => setOpen(false)} className="shrink-0 rounded-xl text-muted-foreground hover:bg-foreground/[0.05]"><X className="size-4" /></Button>
              </div>
              <SheetDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("Pick up where you left off.")}</SheetDescription>
            </div>
          </div>
          {sessions.length > 0 && <Button size="sm" variant="outline" className="h-9 w-full justify-center gap-2 rounded-xl border-foreground/[0.08] bg-background/40 text-xs font-medium" onClick={startConversation}><Plus className="size-3.5" />  {t("New chat")}</Button>}
        </SheetHeader>

        {activeSession && (
          <div role="tablist" aria-label={t("History and context")} className="mx-5 mb-4 grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-foreground/[0.04] p-1">
            {(['history', 'context'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`${tabsId}-${tab}`}
                aria-controls={`${tabsId}-${tab}-panel`}
                aria-selected={contextVisible === (tab === 'context')}
                tabIndex={contextVisible === (tab === 'context') ? 0 : -1}
                onClick={() => setView(tab)}
                onKeyDown={(event) => {
                  const next = event.key === 'Home' ? 'history' : event.key === 'End' ? 'context' : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? tab === 'history' ? 'context' : 'history' : null
                  if (!next) return
                  event.preventDefault()
                  setView(next)
                  document.getElementById(`${tabsId}-${next}`)?.focus()
                }}
                className={cn('flex h-8 items-center justify-center gap-2 rounded-lg text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', contextVisible === (tab === 'context') ? 'bg-background/80 text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              >
                {tab === 'history' ? <><History className="size-3.5" />  {t("History")} <span className="rounded-md bg-foreground/[0.05] px-1.5 py-px font-mono text-[10px] text-muted-foreground">{sessions.length}</span></> : <><Layers className="size-3.5" />  {t("Context")}</>}
              </button>
            ))}
          </div>
        )}

        {contextVisible && <div role="tabpanel" id={`${tabsId}-context-panel`} aria-labelledby={`${tabsId}-context`} className="flex min-h-0 flex-1 flex-col">
        {/* Active Session Context Panel */}
        {activeSession && (
          <div onPointerMove={spotlight} className="chat-context-panel chat-glass-card glass-liquid spotlight mx-5 mb-5 flex min-h-0 flex-col overflow-hidden rounded-2xl">
            <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn('size-1.5 shrink-0 rounded-full', isRunning ? 'bg-primary animate-pulse' : 'bg-success')} />
                  <span className="truncate text-xs font-semibold text-foreground">{activeSession.title}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                  <span>{t("{count} turns", { count: userTurns })}</span>
                  <span>·</span>
                  <span>{t("{count} tool calls", { count: toolCalls })}</span>
                  {activeSession.children.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{t("{count} subagents", { count: activeSession.children.length })}</span>
                    </>
                  )}
                </div>
                {(inputTokens > 0 || outputTokens > 0) && <p className="mt-1 text-[10px] text-muted-foreground tabular-nums" title={t("Reported usage from these saved context entries, not the current context size or lifetime session total.")}>{t("Entry usage · {input} in / {output} out", { input: inputTokens.toLocaleString(localeTag()), output: outputTokens.toLocaleString(localeTag()) })}{totalCost > 0 ? ` · $${totalCost.toFixed(4)}` : ''}</p>}
              </div>

              {onCompact && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={isRunning || compacting || messages.length === 0}
                  onClick={onCompact}
                  title={t("Summarize and compact conversation context")}
                  className="h-7 shrink-0 gap-1 rounded-xl px-2.5 text-[11px]"
                >
                  {compacting ? <LoaderCircle className="size-3 animate-spin" /> : <Minimize2 className="size-3" />}

                  {t("Compact")}
                </Button>
              )}
            </div>

            <div className="shrink-0 border-t border-foreground/[0.05] px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
              <p className="truncate font-mono" title={activeSession.cwd}>{activeSession.cwd}</p>
              <p className="mt-1 truncate">{activeSession.provider}/{activeSession.modelId} · {t("Thinking level: {level}", { level: t(activeSession.thinkingLevel) })}</p>
              <p className="mt-2 text-[11px]">{t("Earlier turns may be replaced by a compaction summary.")}</p>
            </div>
            {actionError ? <p role="alert" className="border-t border-destructive/10 px-3.5 py-2 text-xs text-destructive">{t(actionError)}</p> : actionMessage && <p role="status" className="border-t border-foreground/[0.05] px-3.5 py-2 text-xs text-muted-foreground">{t(actionMessage)}</p>}

            {transcript.length > 0 && (
              <div className="flex min-h-0 flex-col border-t border-foreground/[0.05]">
                <button
                  type="button"
                  onClick={() => setContextExpanded(!contextExpanded)}
                  className="flex w-full items-center justify-between px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="size-3 text-muted-foreground" />
                    {t("Conversation transcript ({count})", { count: transcript.length })}
                  </span>
                  <ChevronDown className={cn('size-3 text-muted-foreground transition-transform', contextExpanded && 'rotate-180')} />
                </button>
                {contextExpanded && (
                  <>
                    <div className="flex shrink-0 items-center gap-2 border-t border-foreground/[0.04] px-2.5 py-2">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute top-1/2 left-2 z-10 size-3 -translate-y-1/2 text-muted-foreground" />
                        <Input aria-label={t("Search transcript")} value={transcriptSearch} onChange={(e) => setTranscriptSearch(e.target.value)} placeholder={t("Find in this conversation…")} className="h-7.5 rounded-xl border-foreground/[0.08] bg-background/45 pl-7 text-[11px] text-foreground" />
                      </div>
                      <button type="button" className="shrink-0 rounded-xl px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-foreground/[0.05]" onClick={() => setExpandedItems((current) => {
                        const next = new Set(current)
                        for (const message of shownMessages) {
                          if (allExpanded) next.delete(itemKey(message.id))
                          else next.add(itemKey(message.id))
                        }
                        return next
                      })}>{allExpanded ? t("Collapse all") : t("Expand all")}</button>
                    </div>
                    <ol aria-label={t("Conversation transcript")} className="min-h-0 divide-y divide-foreground/[0.04] overflow-y-auto border-t border-foreground/[0.04] bg-background/20 px-2 py-1 text-[11px]">
                      {shownMessages.map((m) => <TranscriptItem key={m.id} message={m} expanded={expandedItems.has(itemKey(m.id))} onToggle={() => toggleItem(m.id)} />)}
                      {shownMessages.length === 0 && <li className="px-2 py-5 text-center text-muted-foreground">{t("No matching messages.")}</li>}
                    </ol>
                  </>
                )}
              </div>
            )}
            {transcript.length === 0 && <div className="border-t border-foreground/[0.05] px-5 py-8 text-center">
              <Layers className="mx-auto mb-3 size-5 text-muted-foreground" />
              <p className="text-xs font-medium text-foreground">{t("No saved context yet")}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("Send a message to start building this conversation.")}</p>
            </div>}
          </div>
        )}

        </div>}

        {!contextVisible && <div role="tabpanel" id={`${tabsId}-history-panel`} aria-labelledby={activeSession ? `${tabsId}-history` : undefined} className="flex min-h-0 flex-1 flex-col">
        {sessions.length > 0 && <div className="shrink-0 px-5 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label={t("Search sessions")} placeholder={t("Search conversations…")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 rounded-xl border-foreground/[0.08] bg-background/45 pr-9 pl-9 text-xs text-foreground shadow-none" />
            {search && <button type="button" aria-label={t("Clear search")} onClick={() => setSearch('')} className="absolute top-1/2 right-2 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3.5" /></button>}
          </div>
          {!activeSession && <p className="mt-3 px-1 text-[11px] font-medium text-muted-foreground">{t(sessions.length === 1 ? "{count} conversation" : "{count} conversations", { count: sessions.length })}</p>}
        </div>}
        <div aria-label={t("Conversation filter")} className="mx-5 mb-3 grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-foreground/[0.04] p-1">
          {[false, true].map((value) => <button key={String(value)} type="button" aria-pressed={archived === value} onClick={() => setArchived(value)} className={cn('rounded-lg px-3 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', archived === value ? 'bg-background/80 font-medium text-foreground shadow-xs' : 'text-muted-foreground')}>{value ? t("Archived") : t("Unarchived")} <span className="ml-1 font-mono text-[10px]">{sessions.filter((item) => !!item.archived === value).length}</span></button>)}
        </div>
        {actionError && <p role="alert" className="px-6 pb-3 text-xs text-destructive">{t(actionError)}</p>}
        {deleteNotice && <p role="status" className="shrink-0 px-6 pb-3 text-xs text-muted-foreground">{t(deleteNotice)}</p>}

        {/* Sessions List */}
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 pb-5', shown.length === 0 ? 'flex flex-col' : 'space-y-2')}>
          {shown.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pt-8 pb-20 text-center">
              <span onPointerMove={spotlight} className="chat-history-empty-icon glass-liquid spotlight mb-5 flex size-16 shrink-0 items-center justify-center rounded-3xl text-primary">
                {sessions.length > 0 ? <Search className="size-6" /> : <MessageSquare className="size-6" />}
              </span>
              <h3 className="text-base font-semibold tracking-tight text-foreground">{archived ? t("No archived conversations") : sessions.length > 0 ? t("No conversations found") : t("A fresh start")}</h3>
              <p className="mt-2 max-w-64 text-xs leading-relaxed text-muted-foreground">{archived ? t("Archived chats keep their saved context and LayerFS branches.") : sessions.length > 0 ? t("Try another title, folder or model.") : t("Start a conversation. You can return to it here anytime.")}</p>
              <Button size="sm" variant={sessions.length > 0 ? 'outline' : 'default'} className="mt-5 h-9 gap-1.5 rounded-xl px-4 text-xs" onClick={sessions.length > 0 ? () => setSearch('') : startConversation}>
                {sessions.length > 0 ? <><X className="size-3.5" />  {t("Clear search")}</> : <><Plus className="size-3.5" />  {t("Start a conversation")}</>}
              </Button>
            </div>
          ) : (
            shown.map((session) => {
              const active = selectedId === session.id
              const folder = session.cwd.split('/').filter(Boolean).slice(-2).join('/') || session.cwd
              return (
                <div
                  key={session.id}
                  data-active={active}
                  className={cn(
                    'chat-history-row group flex items-center rounded-2xl border border-transparent bg-background/20 transition-colors hover:border-foreground/[0.05] hover:bg-background/60',
                    active && 'border-primary/15 bg-primary/[0.055] shadow-xs',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(session.id)
                      setOpen(false)
                    }}
                    className="flex min-w-0 flex-1 items-start gap-3 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring rounded-2xl"
                  >
                    {session.state === 'running' ? (
                      <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                    ) : (
                      <MessageSquare className={cn('mt-0.5 size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px] font-medium', active ? 'text-foreground font-semibold' : 'text-foreground')}>
                        {session.title}{hasDraft?.(session.id) && <span className="ml-2 rounded bg-primary/10 px-1 py-px text-[10px] font-normal text-primary">{t("Draft")}</span>}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
                        <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{session.project ?? folder}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                        <span>
                          {new Date(session.updated).toLocaleString(localeTag(), {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {session.modelId && (
                          <>
                            <span>·</span>
                            <span className="truncate font-mono">{session.modelId}</span>
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="mr-2 shrink-0 text-muted-foreground" variant="ghost" size="icon-sm" aria-label={t("Actions for {title}", { title: session.title })} title={t("Conversation actions")} disabled={!!removing || compacting}>
                        {removing === session.id ? <LoaderCircle className="size-3 animate-spin" /> : <MoreHorizontal className="size-4" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="chat-popover w-56">
                      {onRename && <DropdownMenuItem className="text-xs" onSelect={() => onRename(session)}><Pencil className="size-3.5" />{t("Rename chat")}</DropdownMenuItem>}
                      {onArchive && <DropdownMenuItem className="text-xs" disabled={session.state === 'running' || session.execution?.phase === 'children'} onSelect={() => void onArchive(session)}>{session.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}{session.archived ? t("Restore chat") : t("Archive chat")}</DropdownMenuItem>}
                      {onExport && <>
                        <DropdownMenuItem className="text-xs" onSelect={() => onExport(session, 'copy')}><Copy className="size-3.5" />{t("Copy conversation")}</DropdownMenuItem>
                        <DropdownMenuItem className="text-xs" onSelect={() => onExport(session, 'md')}><Download className="size-3.5" />{t("Export Markdown")}</DropdownMenuItem>
                        <DropdownMenuItem className="text-xs" onSelect={() => onExport(session, 'json')}><Download className="size-3.5" />{t("Export JSON")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>}

                      {onDuplicate && <>
                        <DropdownMenuItem className="text-xs" disabled={session.state === 'running' || session.execution?.phase === 'children'} onSelect={() => onDuplicate(session)}><Copy className="size-3.5" />{t("Duplicate chat")}</DropdownMenuItem>
                        {(session.state === 'running' || session.execution?.phase === 'children') && <p className="px-2 py-1 text-[11px] text-muted-foreground">{t("Stop the agent before copying.")}</p>}
                        <DropdownMenuSeparator />
                      </>}
                      <DropdownMenuItem variant="destructive" className="text-xs" onSelect={() => {
                        setDeleteError('')
                        setDeleteNotice('')
                        setDeleteTarget(session)
                      }}><Trash2 className="size-3.5" />{session.state === 'running' ? t("Stop and delete") : t("Delete conversation")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })
          )}
        </div>

        </div>}

        <Dialog open={!!deleteTarget} onOpenChange={(next) => {
          if (!next && !removeInFlight.current) setDeleteTarget(null)
        }}>
          <DialogContent showCloseButton={!removing} className="gap-4 rounded-3xl [--dialog-inset:1.5rem]">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">{deleteTarget?.state === 'running' ? t("Stop and delete conversation?") : t("Delete conversation?")}</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                {deleteTarget?.project
                  ? t("This permanently removes the conversation and its saved context. Its workspace will stop and unmount. Saved LayerFS branch history is kept.")
                  : t("This permanently removes the conversation and its saved context. Your workspace files will stay in place.")}
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0 rounded-2xl border border-foreground/[0.06] bg-background/40 px-3.5 py-3">
              <p className="break-words text-sm font-medium">{deleteTarget?.title}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={deleteTarget?.cwd}>{deleteTarget?.cwd}</p>
            </div>
            {deleteTarget?.state === 'running' && <p className="text-xs leading-relaxed text-muted-foreground">{t("The current turn and its subagents will be stopped first.")}</p>}
            {deleteError && <p role="alert" className="break-words rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-xs leading-relaxed text-destructive">{t(deleteError)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" disabled={!!removing} onClick={() => setDeleteTarget(null)}>{t("Cancel")}</Button>
              <Button variant="destructive" size="sm" className="rounded-xl" disabled={!!removing} onClick={() => void deleteConversation()}>
                {removing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {removing ? t("Deleting…") : deleteError ? t("Try again") : deleteTarget?.state === 'running' ? t("Stop and delete") : t("Delete conversation")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}

function TranscriptItem({ message, expanded, onToggle }: { message: ChatMessage; expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const m = message
  const preview = m.role === 'tool' ? String(m.args?.command ?? m.args?.task ?? m.toolName ?? 'tool') : m.text || m.thinking || t("(empty)")
  const Icon = m.role === 'user' ? User : m.role === 'tool' ? m.toolName === 'subagent' ? GitFork : Terminal : MessageSquare
  return <li>
    <button type="button" aria-expanded={expanded} onClick={onToggle} className="flex w-full items-center gap-2 rounded-xl px-1.5 py-2 text-left text-muted-foreground hover:bg-foreground/[0.04]">
      <Icon className={cn('size-3 shrink-0', m.role === 'user' ? 'text-primary' : m.role === 'assistant' ? 'text-success' : 'text-muted-foreground')} />
      <span className="w-14 shrink-0 truncate font-mono text-[10px] uppercase text-muted-foreground">{m.role === 'tool' ? (m.toolName ?? 'tool') : m.role === 'user' ? t('User') : t('Assistant')}</span>
      <span className="min-w-0 flex-1 truncate text-foreground">{preview.replace(/\s+/g, ' ').trim()}</span>
      <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
    </button>
    {expanded && <div className="space-y-3 px-2 pb-3 text-foreground">
      {m.thinking && <TranscriptBlock label={t("Thinking")} text={m.thinking} />}
      {m.args && <TranscriptBlock label={t("Tool arguments")} text={JSON.stringify(m.args, null, 2)} />}
      {m.text && <TranscriptBlock label={m.role === 'tool' ? t("Tool output") : t("Message")} text={m.text} />}
      {m.details != null && <details className="rounded-xl border border-foreground/[0.06] bg-background/30 px-2.5 py-2"><summary className="cursor-pointer text-[10px] text-muted-foreground">{t("Details")}</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{JSON.stringify(m.details, null, 2)}</pre></details>}
    </div>}
  </li>
}

function TranscriptBlock({ label, text }: { label: string; text: string }) {
  return <div><p className="mb-1 text-[10px] font-medium text-muted-foreground">{label}</p><pre className="chat-transcript-block max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-foreground/[0.06] bg-background/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground">{text}</pre></div>
}
