import { t, useI18n } from '@/i18n'
import { FolderGit2, FolderTree } from 'lucide-react'
import type { ProjectState } from '@shared/host-api'

import { LfsBranch, LfsWorkspace } from '@/components/lfs-icons'
import { spotlight } from '@/components/motion/spotlight'
import { Empty } from '@/components/projects/states'
import { Button } from '@/components/ui/button'

interface WorktreeContentProps {
  state: ProjectState
  onBrowseFiles?: (branch: string) => void
}

/** Mounted Workspaces supplied by the project. */
export function WorktreeContent({ state, onBrowseFiles }: WorktreeContentProps) {
  useI18n()
  const worktrees = state.sandboxes
    .filter((sandbox) => sandbox.state !== 'gone')
    .flatMap((sandbox) => sandbox.workspaces.map((workspace) => ({ ...workspace, sandbox })))

  if (worktrees.length === 0) {
    return (
      <Empty icon={FolderGit2} title={t("No Worktrees mounted")}>{t("Workspaces mounted for this project will appear here.")}</Empty>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FolderGit2 className="size-4 text-primary" />{t("Mounted Worktrees")}<span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">{worktrees.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          {new Set(worktrees.map((workspace) => workspace.branch)).size}{t("branches")}</p>
      </header>
      <div className="flex min-w-0 flex-col gap-3">
        {worktrees.map((workspace) => (
          <article
            key={`${workspace.sandbox.id}:${workspace.ws}`}
            onPointerMove={spotlight}
            className="glass-liquid spotlight flex min-w-0 flex-wrap items-center gap-4 rounded-2xl p-5 shadow-xs"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LfsWorkspace className="size-5" />
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="break-all font-mono text-sm font-medium">{workspace.path}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{workspace.sandbox.name} · {workspace.ws}</p>
            </div>
            <span className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs">
              <LfsBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="break-all font-mono">{workspace.branch || t('Unknown branch')}</span>
            </span>
            {onBrowseFiles && workspace.branch && (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => onBrowseFiles(workspace.branch)}>
                <FolderTree className="size-3.5" />{t("Browse files")}</Button>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
