// A quiet live overview: recent conversations and their mounted sandboxes.
// Calls still update from the host; expanding a row reveals its working agents.
import './live.css'

import type { RunSummary } from '@shared/host-api'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'

import { useProjectSandboxes } from '@/components/projects/use-sandboxes'
import { activeRun, runName, useLiveProject, useLiveSessions } from '@/components/live/live-data'
import { type Folds, type Group, layoutGroup, sandboxViews } from '@/components/live/live-model'
import { SandboxNode, SessionGroup, ZoneLabel, count } from '@/components/live/live-nodes'
import { agentColors, isLive } from '@/components/live/run-format'
import { useNow } from '@/lib/use-now'
import { useI18n } from '@/i18n'

const MAX_SESSIONS = 12
const foldStore = (project: string) => `connect.live.folds:${project}`

export interface LiveTabProps {
  project: string
  runs: RunSummary[] | undefined
  onOpenRun: (runId: string, agent?: string) => void
}

function readFolds(project: string): Folds {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(foldStore(project)) ?? '{}')
    return saved && typeof saved === 'object' ? saved as Folds : {}
  } catch {
    return {}
  }
}

function useFolds(project: string) {
  const [over, setOver] = useState(() => readFolds(project))
  useEffect(() => setOver(readFolds(project)), [project])
  const set = useCallback((key: string, folded: boolean) => setOver((current) => {
    const { [key]: _, ...rest } = current
    const next = Object.fromEntries(Object.entries({ ...rest, [key]: folded }).slice(-200))
    try { localStorage.setItem(foldStore(project), JSON.stringify(next)) } catch { /* Keep folds for this visit. */ }
    return next
  }), [project])
  return { over, set }
}

export function LiveTab({ project, runs, onOpenRun }: LiveTabProps) {
  const { t } = useI18n()
  const anyLive = runs?.some((run) => isLive(run.state)) ?? false
  const now = useNow(true, anyLive ? 1000 : 10_000)
  const recent = useMemo(() => (runs ?? [])
    .filter((run) => activeRun(run, now))
    .sort((a, b) => Number(isLive(b.state)) - Number(isLive(a.state)) || b.started - a.started), [runs, now])
  const [showAll, setShowAll] = useState(false)
  useEffect(() => setShowAll(false), [project])
  const shown = useMemo(() => showAll ? recent : recent.slice(0, MAX_SESSIONS), [recent, showAll])
  const sessions = useLiveSessions(shown)
  const changed = sessions.map((session) => `${session.run.id}:${session.run.state}`).join(',')
  const state = useLiveProject(project, anyLive, changed)
  const sandboxRead = useProjectSandboxes(project, anyLive ? 4000 : null, changed)
  const groups = useMemo<Group[]>(() => sessions.map((session) => ({
    session, name: runName(session.run), colorOf: agentColors(session.run.agents.map((agent) => agent.name)),
  })), [sessions])
  const withWorkspaces = useMemo(() => state && sandboxRead.data ? { ...state, sandboxes: sandboxRead.data } : state, [state, sandboxRead.data])
  const sandboxes = useMemo(() => sandboxViews(withWorkspaces, groups), [withWorkspaces, groups])
  const folds = useFolds(project)
  const layouts = useMemo(() => groups.map((group, index) => layoutGroup(group, folds.over, index, true)), [groups, folds.over])
  const inFlight = groups.reduce((sum, group) => sum + group.session.live.running.length, 0)
  const waiting = runs === undefined || (sandboxRead.loading && !sandboxRead.data && !state)
  const empty = !groups.length && !sandboxes.length

  return <section aria-label={t('Live')} className="glass-liquid live-panel rounded-2xl">
    {sandboxRead.error && <div role="alert" className="live-error">
      <span>{t('Could not load sandboxes.')}</span>
      <button type="button" onClick={sandboxRead.reload}>{t('Retry')}</button>
      <details><summary>{t('Details')}</summary><p>{sandboxRead.error.message}</p></details>
    </div>}
    {empty ? <div className="live-empty" role={waiting ? 'status' : undefined}>
      <Activity aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{waiting ? t('Reading activity…') : t('No active chats')}</p>
      {!waiting && <p className="text-xs text-muted-foreground">{t('Start a chat to see activity here.')}</p>}
    </div> : <div className="live-sections">
      <section className="live-section" aria-label={t('Sessions')}>
        <div className="live-section-heading">
          <ZoneLabel label={t('Sessions')} count={groups.length} />
          {inFlight > 0 && <span className="text-xs text-muted-foreground tabular-nums">{count(t, inFlight, '{n} call in flight', '{n} calls in flight')}</span>}
        </div>
        {!groups.length ? <p className="live-empty-row">{t('No active chats')}</p> : layouts.map((layout) => <SessionGroup
          key={layout.group.session.run.id}
          layout={layout}
          now={now}
          onOpen={(agent) => onOpenRun(layout.group.session.run.id, agent)}
          onFold={folds.set}
        />)}
        {recent.length > MAX_SESSIONS && <button type="button" className="live-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? t('Show fewer') : t('+{n} more', { n: recent.length - MAX_SESSIONS })}
        </button>}
      </section>
      <section className="live-section" aria-label={t('Sandboxes')}>
        <ZoneLabel label={t('Sandboxes')} count={sandboxes.length} />
        {!sandboxes.length ? <p className="live-empty-row">{t('No Sandbox open')}</p> : sandboxes.map((sandbox) => <SandboxNode
          key={sandbox.id} sandbox={sandbox} groups={groups} now={now}
        />)}
      </section>
    </div>}
  </section>
}
