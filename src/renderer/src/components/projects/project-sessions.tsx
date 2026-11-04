import { t, useI18n } from '@/i18n'
import { Archive, ChevronRight, LoaderCircle, MessageSquarePlus, Square, SquareStack } from 'lucide-react'
import { type MouseEvent, useMemo, useState } from 'react'
import type { AgentScenario, AgentSessionSummary } from '@shared/agent-api'
import type { SandboxInfo } from '@shared/host-api'

import { LfsBranch } from '@/components/lfs-icons'
import { LoadError, Loading } from '@/components/projects/states'
import { MachineChip } from '@/components/projects/where-chips'
import { Chip, StateDot, type Tone } from '@/components/storage/chips'
import { Button } from '@/components/ui/button'
import { ago, when } from '@/data/format'
import { agentHost } from '@/host/agent-client'
import { chatLive } from '@/host/use-chat-sessions'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

const SCENARIO_LOOK: Record<AgentScenario['state'], { tone: Tone; label: string; live?: boolean }> = {
  preparing: { tone: 'warning', label: 'Preparing', live: true },
  playing: { tone: 'info', label: 'Running', live: true },
  passed: { tone: 'success', label: 'Passed' },
  failed: { tone: 'danger', label: 'Failed' },
  stopped: { tone: 'neutral', label: 'Stopped' },
}

/**
 * Columns: Chat, Branch, Runs in (its Workspace's machine and Sandbox), State, Updated, the actions and opener.
 * Every row is its own grid, so the actions column has one fixed width (Stop and the chevron) to keep the columns aligned.
 */
const COLS = '@min-[48rem]/chats:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_5rem_5rem]'

interface ProjectSessionsProps {
  /** The project's chats (scenario chats included), archived ones too; undefined while reading. */
  sessions: AgentSessionSummary[] | undefined
  error?: Error
  onRetry: () => void
  onOpenChat: (session: string) => void
  onNewChat: () => void
  /** A new chat needs an initialized project. */
  canChat: boolean
  /** The project's Sandboxes, for the machine a chat's Workspace runs on. */
  sandboxes?: SandboxInfo[]
  /** The project's Store's machine, where its Sandboxes run when a Sandbox does not say. */
  machine?: string | null
  /** Opens History at a chat's Branch. */
  onOpenBranch?: (branch: string) => void
}

/** The project's chats, newest first: each opens on the Chat page. */
export function ProjectSessionsContent({ sessions, error, onRetry, onOpenChat, onNewChat, canChat, sandboxes, machine, onOpenBranch }: ProjectSessionsProps) {
  useI18n()
  const [showArchived, setShowArchived] = useState(false)
  const sorted = useMemo(() => [...(sessions ?? [])].sort((a, b) => b.updated - a.updated), [sessions])
  const active = sorted.filter((s) => !s.archived)
  const archived = sorted.length - active.length
  const shown = showArchived ? sorted : active
  const working = active.filter(chatLive).length
  const now = useNow(sorted.length > 0, working > 0 ? 5000 : 30_000)
  const machineOf = (session: AgentSessionSummary) =>
    sandboxes?.find((s) => s.name === session.workspace?.sandbox)?.machine ?? session.scenario?.machine ?? machine ?? null

  return (
    <section className="@container/chats glass-liquid overflow-hidden rounded-2xl">
      {/* the tab above names it and counts it; this row only says what is working and holds the archive switch */}
      {(working > 0 || archived > 0) && (
        <header className="flex min-h-10 flex-wrap items-center gap-3 border-b px-4 py-1.5">
          {working > 0 && <span className="text-xs text-primary tabular-nums">{t('Working')} · {working}</span>}
          {archived > 0 && (
            <button
              type="button"
              aria-pressed={showArchived}
              onClick={() => setShowArchived(!showArchived)}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Archive aria-hidden="true" className="size-3.5" />
              {showArchived ? t('Hide archived') : t('Show archived')}
              <span className="tabular-nums">{archived}</span>
            </button>
          )}
        </header>
      )}

      <div>
        {error && <LoadError error={error} what={t('Chats')} onRetry={onRetry} className="m-3" />}
        {!sessions ? (
          !error && <Loading label={t('Reading the chats…')} />
        ) : !shown.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-sm font-medium">{t('No chats yet')}</p>
            <Button size="sm" className="rounded-xl" disabled={!canChat} onClick={onNewChat}>
              <MessageSquarePlus className="size-3.5" />{t('New chat')}
            </Button>
          </div>
        ) : (
          <div role="table" aria-label={t('Chats')}>
            <div role="row" className={cn('hidden gap-x-3 border-b px-4 py-2 text-[11px] font-medium text-faint @min-[48rem]/chats:grid', COLS)}>
              <span role="columnheader">{t('Chat')}</span>
              <span role="columnheader">{t('Branch')}</span>
              <span role="columnheader">{t('Runs in')}</span>
              <span role="columnheader">{t('State')}</span>
              <span role="columnheader">{t('Updated')}</span>
              <span />
            </div>
            {shown.map((session, i) => (
              <ChatRow key={session.id} session={session} first={i === 0} now={now} machine={machineOf(session)} onOpen={() => onOpenChat(session.id)} onOpenBranch={onOpenBranch} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** The chat's state: archived, its scenario's, an error, working, its Workspace's preparing or saving, or idle. */
function chatLook(session: AgentSessionSummary): { tone: Tone; label: string; live?: boolean; dashed?: boolean } {
  const live = chatLive(session)
  const ws = session.workspace?.state
  if (session.archived) return { tone: 'neutral', label: 'Archived', dashed: true }
  if (session.scenario) return SCENARIO_LOOK[session.scenario.state]
  if (session.state === 'error' || ws === 'error') return { tone: 'danger', label: 'Error' }
  if (live) return { tone: 'info', label: 'Working', live: true }
  if (ws === 'pending' || ws === 'preparing') return { tone: 'warning', label: 'Preparing', live: true }
  if (ws === 'saving') return { tone: 'info', label: 'Saving', live: true }
  return { tone: 'neutral', label: 'Idle' }
}

/** A chat: a state dot and its title (a scenario's marked ⧉), its Branch, its Workspace, its state and when it was last active. */
function ChatRow({ session, first, now, machine, onOpen, onOpenBranch }: { session: AgentSessionSummary; first: boolean; now: number; machine: string | null; onOpen: () => void; onOpenBranch?: (branch: string) => void }) {
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const live = chatLive(session)
  const failed = session.state === 'error'
  const scenario = session.scenario
  const workspace = session.workspace
  const look = chatLook(session)
  const branch = workspace?.branch || null
  // no Workspace on a chat at rest: it was closed (a working one may still be making it)
  const closed = workspace ? workspace.state === 'closed' : !live
  const shownBranch = branch ?? (scenario?.folder ? `${scenario.folder}.*` : null)
  const canStop = !!scenario && live && !session.archived
  const stopRun = async (e: MouseEvent) => {
    e.stopPropagation()
    setStopping(true)
    setStopError(null)
    try {
      await agentHost.stop(session.id)
    } catch (cause) {
      setStopError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStopping(false)
    }
  }
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
      title={[session.title, session.modelId].filter(Boolean).join('\n')}
      className={cn(
        'group/row grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_minmax(1rem,auto)] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        !first && 'border-t',
        session.archived && 'opacity-60',
        COLS,
      )}
    >
      <span role="cell" className="min-w-0">
        <span className="flex min-w-0 items-center gap-2.5">
          {scenario
            ? <SquareStack aria-label={t('Scenario')} className="size-3.5 shrink-0 text-primary/80" />
            : <StateDot tone={failed ? 'danger' : live ? 'info' : 'neutral'} live={live} label={failed ? 'Error' : live ? 'Working' : 'Idle'} />}
          <span className="truncate text-[13px] font-medium text-foreground">{scenario?.title || session.title || t('New session')}</span>
          {scenario?.folder && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{scenario.folder}</span>}
          {scenario?.of ? <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{scenario.done ?? 0}/{scenario.of}</span> : null}
        </span>
        {failed && session.error && <span className="mt-0.5 block truncate pl-5 text-[11.5px] text-destructive">{session.error}</span>}
        {stopError && <span className="mt-0.5 block truncate pl-5 text-[11.5px] text-destructive">{stopError}</span>}
      </span>
      {/* narrow: one second line; wide: three cells of the grid */}
      <span className="col-span-3 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-5 @min-[48rem]/chats:contents">
        <span role="cell" className="min-w-0">
          {shownBranch ? (
            branch && onOpenBranch ? (
              <button type="button" onClick={(e) => { stop(e); onOpenBranch(branch) }} onKeyDown={stop} title={t('Show {branch} in History', { branch })} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 font-mono text-[11.5px] text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <LfsBranch className="size-3 shrink-0" /><span className="truncate">{shownBranch}</span>
              </button>
            ) : (
              <span className="inline-flex max-w-full min-w-0 items-center gap-1 px-1 font-mono text-[11.5px] text-muted-foreground" title={shownBranch}>
                <LfsBranch className="size-3 shrink-0" /><span className="truncate">{shownBranch}</span>
              </span>
            )
          ) : <span className="text-xs text-faint">—</span>}
        </span>
        <span role="cell" className="min-w-0 text-xs text-muted-foreground">
          {closed ? <span className="text-faint">— {t('closed')}</span>
            : !workspace ? <span className="text-faint">—</span>
            : workspace.sandbox && machine ? <MachineChip machine={machine} title={t('Sandbox {sandbox} on {machine}: open the machine', { sandbox: workspace.sandbox, machine })} label={<>{machine} · <span className="font-mono">{workspace.sandbox}</span></>} />
              : workspace.sandbox ? <span className="truncate font-mono">{workspace.sandbox}</span>
                : <span className="text-faint">—</span>}
        </span>
        <span role="cell" className="text-[11.5px] text-muted-foreground tabular-nums @min-[48rem]/chats:order-1" title={when(session.updated)}>{ago(session.updated, now)}</span>
      </span>
      <span role="cell" className="col-start-2 row-start-1 min-w-0 max-w-full @min-[48rem]/chats:col-start-auto @min-[48rem]/chats:row-start-auto">
        <Chip tone={look.tone} live={look.live} dashed={look.dashed} className="max-w-full">{t(look.label)}</Chip>
      </span>
      <span className="col-start-3 row-start-1 flex items-center justify-end gap-1 @min-[48rem]/chats:order-2 @min-[48rem]/chats:col-start-auto @min-[48rem]/chats:row-start-auto">
        {canStop && (
          <button type="button" disabled={stopping} onClick={stopRun} onKeyDown={stop} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {stopping ? <LoaderCircle className="size-3 animate-spin" /> : <Square className="size-3" />}{t('Stop')}
          </button>
        )}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-faint transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-foreground" />
      </span>
    </div>
  )
}
