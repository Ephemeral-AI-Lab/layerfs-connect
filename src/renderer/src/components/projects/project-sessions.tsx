import { t, useI18n } from '@/i18n'
import { Archive, GitBranch, MessageSquare, MessageSquarePlus, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AgentScenario, AgentSessionSummary } from '@shared/agent-api'

import { CountUp } from '@/components/motion/count-up'
import { revealStyle } from '@/components/motion/reveal'
import { spotlight } from '@/components/motion/spotlight'
import { LoadError } from '@/components/projects/states'
import { Chip, StateDot, type Tone } from '@/components/storage/chips'
import { Tile } from '@/components/storage/icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
    <section onPointerMove={spotlight} className="glass-liquid spotlight reveal overflow-hidden rounded-2xl shadow-xs">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-4 px-6 py-5">
        <Tile className={cn(working > 0 && 'text-primary')}>
          <MessageSquare className="size-5" />
        </Tile>
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-sm font-semibold">{t('Sessions')}</h3>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{t('Chats on this project, newest first. Open one to pick it up where it left off.')}</p>
        </div>
        <dl className="ml-auto flex max-w-full flex-wrap gap-x-5 gap-y-2 text-right">
          <div>
            <dt className="text-[11px] text-faint">{t('Working')}</dt>
            <dd className={cn('text-lg leading-6 font-semibold tabular-nums', working > 0 && 'text-primary')}>
              <CountUp value={sessions ? working : null} />
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-faint">{t('Sessions')}</dt>
            <dd className="text-lg leading-6 font-semibold tabular-nums">
              <CountUp value={sessions ? active.length : null} />
            </dd>
          </div>
        </dl>
      </header>

      <div className="border-t bg-muted/25 p-2">
        {error && !sorted.length ? (
          <LoadError error={error} what={t('Sessions')} onRetry={onRetry} className="m-2" />
        ) : !sessions ? (
          <div aria-busy="true" aria-label={t('Reading sessions')} className="space-y-1.5 p-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
          </div>
        ) : !shown.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-sm font-medium">{t('No sessions yet')}</p>
            <p className="max-w-sm text-xs text-muted-foreground">{t('A chat started on this project shows here, with its Branch and Commits.')}</p>
            <Button size="sm" className="rounded-xl" disabled={!canChat} onClick={onNewChat}>
              <MessageSquarePlus className="size-3.5" />{t('New chat')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((session, i) => (
              <SessionRow key={session.id} index={i} session={session} now={now} onOpen={() => onOpenChat(session.id)} />
            ))}
          </ul>
        )}
        {archived > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="mt-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Archive aria-hidden="true" className="size-3" />
            {showArchived ? t('Hide archived') : t('Show archived')}
            <span className="rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-4 tabular-nums">{archived}</span>
          </button>
        )}
      </div>
    </section>
  )
}

/** A chat: a state dot, its title (and scenario), its model, Branch and Commits, and when it was last active. */
function SessionRow({ index, session, now, onOpen }: { index: number; session: AgentSessionSummary; now: number; onOpen: () => void }) {
  const live = chatLive(session)
  const failed = session.state === 'error'
  const state = failed ? 'error' : live ? 'working' : 'idle'
  const scenario = session.scenario
  const workspace = session.workspace
  const meta = [
    session.modelId,
    workspace && workspace.commitCount > 0 && (workspace.commitCount === 1 ? t('1 Commit') : t('{n} Commits', { n: workspace.commitCount })),
  ].filter(Boolean)
  return (
    <li className="side-in" style={revealStyle(index)}>
      <button
        type="button"
        onClick={onOpen}
        title={session.title}
        className={cn(
          'group/session flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring',
          session.archived && 'opacity-60',
        )}
      >
        <StateDot tone={failed ? 'danger' : live ? 'info' : 'neutral'} live={live} label={state} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{session.title || t('New session')}</span>
            {scenario && (
              <Chip tone={SCENARIO_TONE[scenario.state]} icon={Play} live={scenario.state === 'playing'} className="shrink-0">
                {scenario.title}
                {scenario.of ? <span className="font-normal tabular-nums opacity-80">{scenario.done ?? 0}/{scenario.of}</span> : null}
              </Chip>
            )}
            {session.archived && <Chip tone="neutral" icon={Archive} className="shrink-0">{t('Archived')}</Chip>}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {workspace?.branch && (
              <span className="flex min-w-0 items-center gap-1 font-mono text-[11px]">
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
