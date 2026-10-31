import { t, useI18n } from '@/i18n'
import { Archive, GitBranch, MessageSquarePlus, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentScenario, AgentSessionSummary } from '@shared/agent-api'

import { LoadError, Loading } from '@/components/projects/states'
import { Chip, StateDot, type Tone } from '@/components/storage/chips'
import { Button } from '@/components/ui/button'
import { ago } from '@/data/format'
import { chatLive } from '@/host/use-chat-sessions'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

const SCENARIO_TONE: Record<AgentScenario['state'], Tone> = {
  preparing: 'warning',
  playing: 'info',
  passed: 'success',
  failed: 'danger',
  stopped: 'neutral',
}

interface ProjectSessionsProps {
  /** The project's chats (scenario chats included), archived ones too; undefined while reading. */
  sessions: AgentSessionSummary[] | undefined
  error?: Error
  onRetry: () => void
  onOpenChat: (session: string) => void
  onNewChat: () => void
  /** A new chat needs an initialized project. */
  canChat: boolean
}

/** The project's chat sessions, newest first: each opens on the Chat page. */
export function ProjectSessionsContent({ sessions, error, onRetry, onOpenChat, onNewChat, canChat }: ProjectSessionsProps) {
  useI18n()
  const [showArchived, setShowArchived] = useState(false)
  const sorted = useMemo(() => [...(sessions ?? [])].sort((a, b) => b.updated - a.updated), [sessions])
  const active = sorted.filter((s) => !s.archived)
  const archived = sorted.length - active.length
  const shown = showArchived ? sorted : active
  const working = active.filter(chatLive).length
  const now = useNow(sorted.length > 0, working > 0 ? 5000 : 30_000)

  return (
    <section className="glass-liquid overflow-hidden rounded-2xl">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <h3 className="text-sm font-medium">{t('Sessions')} <span className="ml-1 text-muted-foreground tabular-nums">{sessions ? shown.length : '—'}</span></h3>
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

      <div className="border-t p-2">
        {error && <LoadError error={error} what={t('Sessions')} onRetry={onRetry} className="m-2" />}
        {!sessions ? (
          !error && <Loading label={t('Reading sessions')} />
        ) : !shown.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-sm font-medium">{t('No sessions yet')}</p>
            <Button size="sm" className="rounded-xl" disabled={!canChat} onClick={onNewChat}>
              <MessageSquarePlus className="size-3.5" />{t('New chat')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((session) => (
              <SessionRow key={session.id} session={session} now={now} onOpen={() => onOpenChat(session.id)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** A chat: a state dot, its title (and scenario), its model, Branch and Commits, and when it was last active. */
function SessionRow({ session, now, onOpen }: { session: AgentSessionSummary; now: number; onOpen: () => void }) {
  const live = chatLive(session)
  const failed = session.state === 'error'
  const state = failed ? 'error' : live ? 'working' : 'idle'
  const scenario = session.scenario
  const workspace = session.workspace
  const meta = [
    !workspace?.branch && session.modelId,
    workspace && workspace.commitCount > 0 && (workspace.commitCount === 1 ? t('1 Commit') : t('{n} Commits', { n: workspace.commitCount })),
  ].filter(Boolean)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={[session.title, session.modelId].filter(Boolean).join('\n')}
        className={cn(
          'group/session flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring',
          session.archived && 'opacity-60',
        )}
      >
        <StateDot tone={failed ? 'danger' : live ? 'info' : 'neutral'} label={state} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{session.title || t('New session')}</span>
            {scenario && (
              <Chip tone={SCENARIO_TONE[scenario.state]} icon={Play} className="shrink-0">
                {scenario.title}
                {scenario.of ? <span className="font-normal tabular-nums opacity-80">{scenario.done ?? 0}/{scenario.of}</span> : null}
              </Chip>
            )}
            {session.archived && <Chip tone="neutral" icon={Archive} className="shrink-0">{t('Archived')}</Chip>}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {workspace?.branch && (
              <span className="flex min-w-0 items-center gap-1 text-[11px]">
                <GitBranch aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{workspace.branch}</span>
              </span>
            )}
            {workspace?.branch && meta.length > 0 && <span aria-hidden="true">·</span>}
            <span className="truncate">{meta.join(' · ')}</span>
          </span>
          {failed && session.error && <span className="mt-0.5 block truncate text-[11.5px] text-destructive">{session.error}</span>}
        </span>
        <span className={cn('shrink-0 text-[11.5px] tabular-nums', live ? 'font-medium text-primary' : 'text-muted-foreground')}>
          {live ? t('working') : ago(session.updated, now)}
        </span>
      </button>
    </li>
  )
}
