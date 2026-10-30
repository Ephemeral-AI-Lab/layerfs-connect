// Where a chat works, as two small menus: its working folder, and its LayerFS
// project. Each is a chip that opens a short list: the
// projects with New and Refresh, or the recent folders with Choose folder….
// A started chat's menus only say where it works and how to change it.
import { useI18n } from '@/i18n'
import { ArrowUpRight, Check, ChevronDown, FolderOpen, FolderSearch, LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import type { AgentSessionSummary, AgentWorkspace } from '@shared/agent-api'
import { projectKey, projectRef, type ProjectSummary } from '@shared/host-api'

import { LfsProject } from '@/components/lfs-icons'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface WorkspaceMenusProps {
  cwd: string
  /** The project key (projectKey: `store/name` in a shared Store), or '' for a local folder. */
  project: string
  workspace: AgentWorkspace | null
  /** A started chat: its workspace is fixed. */
  locked: boolean
  disabled: boolean
  sessions: AgentSessionSummary[]
  projects: ProjectSummary[]
  projectsLoading: boolean
  projectError: string
  /** Plain text chips (a new chat's row above the composer) rather than pills (inside it). */
  bare?: boolean
  /** The project menu's open state, so the /workspace command can open it. */
  open: boolean
  onOpenChange: (open: boolean) => void
  onDirectory: (cwd: string) => void
  onProject: (project: string) => void
  onRefresh: () => void
  onNewProject: () => void
  onOpenProject?: (project: string) => void
  /** The folder picker failed to open. */
  onError: (message: string) => void
}

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path

export function WorkspaceMenus({
  cwd, project, workspace, locked, disabled, sessions, projects, projectsLoading, projectError, bare, open, onOpenChange,
  onDirectory, onProject, onRefresh, onNewProject, onOpenProject, onError,
}: WorkspaceMenusProps) {
  const { t, locale } = useI18n()
  const [browsing, setBrowsing] = useState(false)
  // folders of recent chats with no project, newest first
  const recent = useMemo(() => {
    const folders = new Map<string, number>()
    for (const session of sessions) {
      if (session.project || !session.cwd) continue
      folders.set(session.cwd, Math.max(folders.get(session.cwd) ?? 0, session.updated))
    }
    return [...folders].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([path]) => path)
  }, [sessions])
  const known = projects.some((item) => projectKey(item) === project)

  async function browse() {
    if (browsing) return
    setBrowsing(true)
    try {
      const path = await window.connect.chooseDirectory(cwd.trim() || undefined, locale)
      if (path) onDirectory(path)
    } catch (error) {
      onError(t("Could not open the folder picker. {error}", { error: (error as Error).message }))
    } finally {
      setBrowsing(false)
    }
  }

  const projectName = project ? projectRef(project).name : t("No project")
  const fixed = <p className="px-2 pt-1 pb-1.5 text-[11px] leading-relaxed text-muted-foreground">{t("Start a new chat to change where it works.")}</p>

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <Chip bare={bare} disabled={disabled} label={t("Working folder")} title={cwd || undefined} icon={browsing ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : <FolderOpen className="size-3.5 shrink-0 opacity-75" />}>
          {cwd ? lastPart(cwd) : t("Choose folder")}
        </Chip>
        <DropdownMenuContent align="start" collisionPadding={16} className="w-80 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="text-[11px]">{t("Working folder")}</DropdownMenuLabel>
          {cwd && <p className="truncate px-2 pb-1.5 font-mono text-[10.5px] text-muted-foreground" title={cwd}>{cwd}</p>}
          {locked ? fixed : (
            <>
              {recent.filter((path) => path !== cwd).length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px]">{t("Recent folders")}</DropdownMenuLabel>
                  {recent.filter((path) => path !== cwd).map((path) => (
                    <DropdownMenuItem key={path} onSelect={() => onDirectory(path)} className="gap-2" title={path}>
                      <FolderOpen className="size-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs">{lastPart(path)}</span>
                      <span className="max-w-32 shrink truncate font-mono text-[10px] text-faint">{path}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void browse()} className="gap-2 text-xs"><FolderSearch className="size-3.5" />{t("Choose folder…")}</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {(project || !locked) && <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <Chip bare={bare} disabled={disabled} label={t("LayerFS project")} title={project ? projectName : t("No project: the chat works in a local folder")} icon={<LfsProject className={cn('size-3.5 shrink-0', project ? 'text-primary/80' : 'opacity-60')} />} faint={!project}>
          {projectName}
        </Chip>
        <DropdownMenuContent align="start" collisionPadding={16} className="w-72 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="flex items-center justify-between gap-2 text-[11px]">
            {t("LayerFS project")}
            {!locked && (
              <button type="button" onClick={onRefresh} disabled={projectsLoading} aria-label={t("Refresh projects")} title={t("Refresh projects")} className="flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                <RefreshCw className={cn('size-3', projectsLoading && 'animate-spin')} />
              </button>
            )}
          </DropdownMenuLabel>
          {locked ? (
            <>
              {project && <Row checked icon={<LfsProject className="size-3.5 text-primary/80" />} name={projectName} store={projectRef(project).store} />}
              {project && workspace?.path && <p className="truncate px-2 pb-1.5 font-mono text-[10.5px] text-muted-foreground" title={workspace.path}>{workspace.path}</p>}
              {fixed}
            </>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => onProject('')} className="gap-2">
                <Row checked={!project} icon={<FolderOpen className="size-3.5 text-muted-foreground" />} name={t("No project")} hint={t("Work in a local folder")} />
              </DropdownMenuItem>
              <div className="max-h-64 overflow-y-auto">
                {project && !known && (
                  <DropdownMenuItem onSelect={() => onProject(project)} className="gap-2">
                    <Row checked icon={<LfsProject className="size-3.5 text-primary/80" />} name={projectName} store={projectRef(project).store} />
                  </DropdownMenuItem>
                )}
                {projects.map((item) => {
                  const key = projectKey(item)
                  return (
                    <DropdownMenuItem key={key} onSelect={() => onProject(key)} className="gap-2">
                      <Row checked={key === project} icon={<LfsProject className="size-3.5 text-primary/80" />} name={projectRef(key).name} store={projectRef(key).store} />
                    </DropdownMenuItem>
                  )
                })}
              </div>
              {projects.length === 0 && <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{projectsLoading ? t("Loading projects…") : t("No LayerFS projects yet")}</p>}
              {projectError && <p role="alert" className="px-2 py-1.5 text-[11px] text-destructive">{t(projectError)}</p>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onNewProject} className="gap-2 text-xs"><Plus className="size-3.5" />{t("New project…")}</DropdownMenuItem>
            </>
          )}
          {project && onOpenProject && (
            <DropdownMenuItem onSelect={() => onOpenProject(project)} className="gap-2 text-xs"><ArrowUpRight className="size-3.5" />{t("Open project")}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
  )
}

/** A menu's trigger: an icon, a name and a chevron; plain text above the composer, a pill inside it. */
function Chip({ bare, disabled, label, title, icon, faint, children }: { bare?: boolean; disabled: boolean; label: string; title?: string; icon: ReactNode; faint?: boolean; children: ReactNode }) {
  return (
    <DropdownMenuTrigger
      type="button"
      disabled={disabled}
      aria-label={label}
      title={title}
      className={cn(
        'group/chip flex h-7 min-w-0 items-center gap-1.5 overflow-hidden rounded-full px-2.5 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=open]:bg-foreground/[0.06] data-[state=open]:text-foreground',
        bare ? 'max-w-64 text-[13px] text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground' : 'max-w-44 bg-foreground/[0.04] text-xs text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground',
        faint && bare && 'text-muted-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60 transition-transform duration-(--dur-base) group-data-[state=open]/chip:rotate-180" />
    </DropdownMenuTrigger>
  )
}

/** A choice in a menu: its mark, its name (a shared Store's name or a hint faint after it), a check when chosen. */
function Row({ checked, icon, name, store, hint }: { checked: boolean; icon: ReactNode; name: string; store?: string | null; hint?: string }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-2 text-xs">
      {icon}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate font-medium">{name}</span>
        {(store || hint) && <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">{store ?? hint}</span>}
      </span>
      <Check className={cn('size-3.5 shrink-0 text-primary', !checked && 'invisible')} />
    </span>
  )
}
