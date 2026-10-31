import { useI18n } from '@/i18n'
import { CircleAlert, FolderOpen, GitBranch, GitCommitVertical, LoaderCircle } from 'lucide-react'
import type { AgentWorkspace } from '@shared/agent-api'
import { projectLabel } from '@shared/host-api'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const labels: Record<AgentWorkspace['state'], string> = {
  pending: 'Waiting for workspace',
  preparing: 'Preparing workspace',
  ready: 'Workspace ready',
  running: 'Running command',
  saving: 'Saving changes',
  closed: 'Workspace closed',
  error: 'Workspace needs attention',
}

interface WorkspaceStatusProps {
  /** The project key (`store/name` in a shared Store). */
  project: string
  workspace: AgentWorkspace | null
  started: boolean
  onOpenProject?: (project: string, branch?: string) => void
}

/** Only host metadata describes a mounted workspace or saved session commit. */
export function WorkspaceStatus({ project, workspace, started, onOpenProject }: WorkspaceStatusProps) {
  const { t, locale } = useI18n()
  const busy = workspace && ['pending', 'preparing', 'running', 'saving'].includes(workspace.state)
  const saved = workspace?.state === 'ready' && workspace.lastSaved !== null
  return (
    <section aria-label={t("LayerFS workspace")} className="chat-content-gutter w-full shrink-0 pb-2">
      <div className="min-w-0 rounded-xl border border-foreground/[0.06] bg-foreground/[0.025] px-3 py-2 text-[11px]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-1 basis-40 items-center gap-1.5 text-foreground/80">
            <GitBranch className="size-3.5 shrink-0 text-(--icon-accent)" />
            <span className="truncate" title={workspace?.branch ? `${projectLabel(project)} · ${workspace.branch}` : projectLabel(project)}>{workspace?.branch ?? projectLabel(project)}</span>
          </div>
          <span role="status" className={cn('flex shrink-0 items-center gap-1.5 text-muted-foreground', workspace?.state === 'error' && 'text-destructive')}>
            {busy && <LoaderCircle className="size-3 animate-spin" />}
            {workspace?.state === 'error' && <CircleAlert className="size-3" />}
            {workspace ? saved ? t("Changes saved") : t(labels[workspace.state]) : started ? t("Workspace details unavailable") : t("New branch on first message")}
          </span>
          {onOpenProject && <Button type="button" variant="link" size="xs" className="h-5 shrink-0 p-0 text-[11px]" onClick={() => onOpenProject(project, workspace?.branch)}>{workspace ? t("Branch history") : t("Open project")} →</Button>}
        </div>
        {workspace ? (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            {workspace.path && <span className="flex min-w-0 flex-1 basis-48 items-center gap-1.5" title={workspace.path}><FolderOpen className="size-3 shrink-0" /><span className="truncate font-mono text-[10px]">{workspace.path}</span></span>}
            {workspace.head && <span className="inline-flex shrink-0 items-center gap-1.5" title={`${t("Head {head}", { head: workspace.head })}${workspace.lastSaved ? ` · ${t("Saved {date}", { date: new Date(workspace.lastSaved).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US") })}` : ''}`}><GitCommitVertical className="size-3" /><code>{workspace.head.slice(0, 8)}</code><span>· {workspace.commitCount} {workspace.commitCount === 1 ? t("commit") : t("commits")}</span></span>}
            {!workspace.path && !workspace.head && <span>{t("Workspace location appears when it is ready.")}</span>}
          </div>
        ) : !started && <p className="mt-1 text-muted-foreground">{t("Changes save automatically to this session’s branch. Main stays unchanged.")}</p>}
        {workspace?.error && <p role="alert" className="mt-1.5 break-words text-destructive">{workspace.error}</p>}
      </div>
    </section>
  )
}
