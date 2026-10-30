// The Projects page's Live: one Live diagram per project that has a chat
// working in LayerFS (or one that ended a moment ago), newest first, each
// under its project's name, which opens the project. Nothing shows while no
// chat works.
import { ArrowUpRight } from 'lucide-react'
import { projectRef } from '@shared/host-api'
import { useMemo } from 'react'

import { activeRun, projectRuns } from '@/components/live/live-data'
import { LiveTab } from '@/components/live/live-tab'
import { ZoneLabel } from '@/components/live/live-nodes'
import { isLive } from '@/components/live/run-format'
import { LfsProject } from '@/components/lfs-icons'
import { chatProject, useChatSessions } from '@/host/use-chat-sessions'
import { useI18n } from '@/i18n'
import { useNow } from '@/lib/use-now'

/** Projects drawn at most: a diagram each. */
const MAX_PROJECTS = 3

interface ProjectsLiveProps {
  /** The project keys the page lists: Live shows only these. */
  projects: readonly string[]
  onOpenProject: (project: string) => void
  onOpenChat: (session: string) => void
}

export function ProjectsLive({ projects, onOpenProject, onOpenChat }: ProjectsLiveProps) {
  const { t } = useI18n()
  const { sessions } = useChatSessions('projects-live')
  const now = useNow(!!sessions?.length, 30_000)
  const shown = useMemo(() => {
    const keys = new Set(projects)
    const byProject = new Map<string, true>()
    for (const chat of sessions ?? []) {
      const key = chatProject(chat)
      if (key && keys.has(key)) byProject.set(key, true)
    }
    return [...byProject.keys()]
      .map((key) => ({ key, runs: projectRuns(sessions, key) ?? [] }))
      .map((p) => ({ ...p, active: p.runs.filter((run) => activeRun(run, now)) }))
      .filter((p) => p.active.length > 0)
      // working projects first, then the one that worked last
      .sort((a, b) => Number(b.active.some((r) => isLive(r.state))) - Number(a.active.some((r) => isLive(r.state))) || b.active[0].started - a.active[0].started)
  }, [sessions, projects, now])

  if (!shown.length) return null
  return (
    <section aria-label={t('Live')} className="flex flex-col gap-4">
      <ZoneLabel label={t('Live')} count={shown.length} />
      {shown.slice(0, MAX_PROJECTS).map(({ key, runs }) => (
        <div key={key} className="flex min-w-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => onOpenProject(key)}
            title={t('Open {name}', { name: key })}
            className="group/open inline-flex w-fit items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-sm font-semibold outline-none transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LfsProject className="size-4 text-primary/80" />
            {projectRef(key).name}
            <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/open:opacity-100 group-focus-visible/open:opacity-100" />
          </button>
          <LiveTab project={key} runs={runs} onOpenRun={(id) => onOpenChat(id)} />
        </div>
      ))}
      {shown.length > MAX_PROJECTS && (
        <p className="px-1 text-xs text-muted-foreground">{t('{n} more projects are working: open one to see its Live.', { n: shown.length - MAX_PROJECTS })}</p>
      )}
    </section>
  )
}
