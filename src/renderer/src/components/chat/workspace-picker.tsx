import { useI18n } from '@/i18n'
import { Check, ChevronDown, Clock3, FolderOpen, Layers3, LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { AgentSessionSummary, AgentWorkspace } from '@shared/agent-api'
import type { ProjectSummary } from '@shared/host-api'

import { spotlight } from '@/components/motion/spotlight'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface WorkspacePickerProps {
  cwd: string
  project: string
  workspace: AgentWorkspace | null
  locked: boolean
  disabled: boolean
  sessions: AgentSessionSummary[]
  projects: ProjectSummary[]
  projectsLoading: boolean
  projectError: string
  onDirectory: (cwd: string) => void
  onProject: (project: string) => void
  onRefresh: () => void
  onNewProject: () => void
  onOpenProject?: (project: string) => void
}

const LOCAL_FOLDER = 'local-folder'
const projectValue = (name: string) => `project:${name}`

export function WorkspacePicker({
  cwd, project, workspace, locked, disabled, sessions, projects, projectsLoading, projectError,
  onDirectory, onProject, onRefresh, onNewProject, onOpenProject,
}: WorkspacePickerProps) {
  const { t, locale } = useI18n()
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const browseInFlight = useRef(false)
  const readOnly = locked || disabled || browsing
  const recent = useMemo(() => {
    const folders = new Map<string, AgentSessionSummary>()
    for (const session of sessions) {
      if (session.project) continue
      const previous = folders.get(session.cwd)
      if (!previous || session.updated > previous.updated) folders.set(session.cwd, session)
    }
    return [...folders.values()].sort((a, b) => b.updated - a.updated).slice(0, 6)
  }, [sessions])

  async function browse() {
    if (browseInFlight.current) return
    browseInFlight.current = true
    setBrowsing(true)
    setBrowseError('')
    try {
      const path = await window.connect.chooseDirectory(cwd.trim() || undefined, locale)
      if (path) onDirectory(path)
    } catch (error) {
      setBrowseError((error as Error).message)
    } finally {
      browseInFlight.current = false
      setBrowsing(false)
    }
  }

  return (
    <div className="shrink-0 px-6 pb-2">
      <section aria-label={t("Workspace settings")} onPointerMove={spotlight} className="@container/workspace-picker glass-liquid spotlight mx-auto max-w-3xl rounded-2xl p-4 animate-in fade-in slide-in-from-top-1 duration-200">
        <div className="grid gap-4 @min-[40rem]/workspace-picker:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] @min-[40rem]/workspace-picker:gap-5">
          {project ? (
            <div className="min-w-0 space-y-2">
              <p className="flex h-5 items-center text-[11.5px] font-medium text-foreground/75">{t("Managed workspace")}</p>
              <div className="flex min-h-10 min-w-0 items-start gap-2.5 rounded-xl border border-primary/10 bg-primary/[0.035] px-3 py-2.5">
                <Layers3 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <div className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
                  {workspace?.path ? <p className="break-all font-mono text-[10px] text-foreground/80">{workspace.path}</p> : <p>{locked ? t("The host provides this session’s workspace location when available.") : t("LayerFS creates a dedicated branch and workspace on your first message.")}</p>}
                  <p className="mt-1">{t("The agent and its subagents share this workspace. Changes save to the session branch.")}</p>
                </div>
              </div>
            </div>
          ) : <div className="min-w-0 space-y-2">
            <div className="flex h-5 items-center justify-between gap-2">
              <Label htmlFor="agent-cwd" className="text-[11.5px] font-medium text-foreground/75">{t("Working directory")}</Label>
              {!locked && recent.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger type="button" disabled={readOnly} aria-label={t("Recent working directories")} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                    <Clock3 className="size-3" /> {t("Recent")} <ChevronDown className="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" collisionPadding={16} className="w-80 max-w-[calc(100vw-2rem)]">
                    <DropdownMenuLabel className="px-2.5 text-[11px]">{t("Recent folders")}</DropdownMenuLabel>
                    {recent.map((workspace) => (
                      <DropdownMenuItem key={workspace.cwd} onSelect={() => {
                        setBrowseError('')
                        onDirectory(workspace.cwd)
                        onProject(workspace.project ?? '')
                      }} className="gap-2 rounded-xl px-2.5 py-2">
                        <FolderOpen className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{workspace.cwd.split(/[\\/]/).filter(Boolean).at(-1) || workspace.cwd}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground" title={workspace.cwd}>{workspace.cwd}</span>
                          {workspace.project && <span className="mt-0.5 block truncate text-[10px] text-primary">{workspace.project}</span>}
                        </span>
                        {cwd === workspace.cwd && project === (workspace.project ?? '') && <Check className="size-3.5 shrink-0 text-primary" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className={cn(
              'flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-foreground/[0.09] bg-background/55 py-1 pr-1 pl-3 transition-[border-color,box-shadow] focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10',
              readOnly && 'bg-foreground/[0.02]',
            )}>
              <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                id="agent-cwd"
                value={cwd}
                title={cwd || undefined}
                onChange={(event) => { setBrowseError(''); onDirectory(event.target.value) }}
                disabled={readOnly}
                placeholder={t("Choose a folder…")}
                aria-describedby={browseError ? 'workspace-browse-error' : undefined}
                autoComplete="off"
                spellCheck={false}
                className="h-full flex-1 rounded-none border-0 bg-transparent p-0 font-mono text-xs shadow-none backdrop-blur-none placeholder:font-sans focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent disabled:opacity-70 md:text-xs dark:bg-transparent dark:disabled:bg-transparent"
              />
              {!locked && (
                <Button type="button" variant="ghost" size="sm" disabled={readOnly} aria-label={t("Choose working directory")} aria-busy={browsing} className="h-7.5 gap-1.5 rounded-lg bg-foreground/[0.035] px-2.5 text-[11px] font-medium hover:bg-foreground/[0.07]" onClick={() => void browse()}>
                  {browsing && <LoaderCircle className="size-3 animate-spin" />}
                  {browsing ? t("Opening…") : t("Browse")}
                </Button>
              )}
            </div>
            {browseError && <p id="workspace-browse-error" role="alert" className="break-words text-[11px] leading-relaxed text-destructive">{t("Could not open the folder picker. {error}", { error: browseError })}</p>}
          </div>}

          <div className="min-w-0 space-y-2 @min-[40rem]/workspace-picker:border-l @min-[40rem]/workspace-picker:border-foreground/[0.06] @min-[40rem]/workspace-picker:pl-5">
            <div className="flex h-5 items-center justify-between gap-2">
              <Label htmlFor="agent-project" className="min-w-0 text-[11.5px] font-medium text-foreground/75">
                {t("LayerFS project")} <span className="ml-1 font-normal text-muted-foreground/70">{t("Optional")}</span>
              </Label>
              <div className="flex shrink-0 items-center gap-1">
                {!locked && <Button type="button" variant="ghost" size="icon-xs" disabled={readOnly} title={t("New project")} aria-label={t("New LayerFS project")} className="size-6 rounded-lg text-muted-foreground" onClick={onNewProject}><Plus className="size-3" /></Button>}
                <Button type="button" variant="ghost" size="icon-xs" disabled={projectsLoading} title={t("Refresh projects")} aria-label={t("Refresh projects")} className="size-6 rounded-lg text-muted-foreground" onClick={onRefresh}>
                  <RefreshCw className={cn('size-3', projectsLoading && 'animate-spin')} />
                </Button>
              </div>
            </div>
            <Select value={project ? projectValue(project) : LOCAL_FOLDER} onValueChange={(value) => onProject(value === LOCAL_FOLDER ? '' : value.slice('project:'.length))} disabled={readOnly}>
              <SelectTrigger id="agent-project" type="button" title={project || t("Local folder only")} aria-describedby={projectError ? 'workspace-project-error' : undefined} className="w-full min-w-0 gap-2.5 rounded-xl border-foreground/[0.09] bg-background/55 px-3 text-xs shadow-none data-[size=default]:h-10 hover:border-primary/25 focus-visible:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/10 disabled:opacity-70 [&>svg:last-child]:size-3.5 [&>svg:last-child]:transition-transform [&[data-state=open]>svg:last-child]:rotate-180">
                <Layers3 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 overflow-hidden text-left">
                  <SelectValue><span className="block truncate">{project || t("Local folder only")}</span></SelectValue>
                </span>
              </SelectTrigger>
              <SelectContent position="popper" align="end" sideOffset={6} collisionPadding={16} className="glass-strong w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)] rounded-2xl bg-transparent shadow-xl ring-0 [&>div[data-position=popper]]:max-h-64">
                <SelectGroup className="p-1.5">
                  <SelectItem value={LOCAL_FOLDER} textValue={t("Local folder only")} className="rounded-xl py-2.5 pr-8 pl-3 data-[state=checked]:bg-primary/[0.07]">
                    <span className="block min-w-0">
                      <span className="block text-xs font-medium">{t("Local folder only")}</span>
                      <span className="mt-0.5 block text-[10.5px] text-muted-foreground">{t("Work directly in a local directory")}</span>
                    </span>
                  </SelectItem>
                  {(projects.length > 0 || project) && <SelectSeparator className="mx-2 my-1 bg-foreground/[0.06]" />}
                  {project && !projects.some((item) => item.name === project) && (
                    <SelectItem value={projectValue(project)} textValue={project} className="rounded-xl py-2.5 pr-8 pl-3 text-xs [overflow-wrap:anywhere] data-[state=checked]:bg-primary/[0.07] [&>span:last-child]:min-w-0">{project}</SelectItem>
                  )}
                  {projects.map((item) => (
                    <SelectItem key={item.name} value={projectValue(item.name)} textValue={item.name} className="rounded-xl py-2.5 pr-8 pl-3 text-xs [overflow-wrap:anywhere] data-[state=checked]:bg-primary/[0.07] [&>span:last-child]:min-w-0">{item.name}</SelectItem>
                  ))}
                  {projects.length === 0 && !project && <SelectLabel className="px-3 py-2 text-[10.5px] font-normal text-muted-foreground">{projectsLoading ? t("Loading projects…") : t("No LayerFS projects yet")}</SelectLabel>}
                </SelectGroup>
              </SelectContent>
            </Select>
            {projectError && <p id="workspace-project-error" role="alert" className="break-words text-[11px] leading-relaxed text-destructive">{t(projectError)}</p>}
          </div>
        </div>
        {locked && (
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-foreground/[0.05] pt-3">
            <p className="text-[11px] text-muted-foreground">{t("Start a new session to change its workspace.")}</p>
            {project && onOpenProject && <Button type="button" variant="link" size="xs" className="p-0 text-xs" onClick={() => onOpenProject(project)}>{t("Open project →")}</Button>}
          </div>
        )}
      </section>
    </div>
  )
}
