import { t, useI18n } from '@/i18n'
import './home.css'

import { FolderOpen, FolderSearch, Plus, RotateCw, Search, X } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'
import { projectKey } from '@shared/host-api'

import { PageHeader } from '@/components/motion/page-header'
import { revealStyle } from '@/components/motion/reveal'
import { ProjectCard } from '@/components/projects/home/project-card'
import { useFlip } from '@/components/projects/home/use-flip'
import { Empty, LoadError } from '@/components/projects/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProjectCatalog } from '@/host/use-projects'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4'

interface ProjectsHomeProps {
  projects: ProjectCatalog
  onOpenProject: (project: string) => void
  onNewProject: () => void
}

export function ProjectsHome({ projects, onOpenProject, onNewProject }: ProjectsHomeProps) {
  useI18n()
  const [query, setQuery] = useState('')
  const flip = useFlip<HTMLDivElement>()
  const search = (next: string) => {
    flip.snapshot()
    setQuery(next)
  }

  const q = query.trim().toLowerCase()
  const all = projects.data ?? []
  const shown = all.filter((project) => !q || `${project.name} ${project.store ?? ''} ${project.source ?? ''}`.toLowerCase().includes(q))
  useLayoutEffect(flip.play, [q, flip.play])

  return (
    <div className="h-svh overflow-y-auto">
      <PageHeader
        sticky
        width="max-w-6xl"
        title={t("Projects")}
        description={t("Your LayerFS workspaces.")}
        actions={
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5">
            <div className="group/search relative min-w-40 flex-1 basis-52">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within/search:text-primary"
              />
              <Input
                aria-label={t("Search projects")}
                placeholder={t("Search projects")}
                value={query}
                onChange={(e) => search(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    search('')
                  }
                }}
                className="glass h-9 rounded-full pl-9 pr-9 text-sm shadow-xs focus-visible:ring-primary/40"
              />
              {query && (
                <button
                  type="button"
                  aria-label={t("Clear search")}
                  onClick={() => search('')}
                  className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" className="h-9 rounded-full px-3.5 text-xs shadow-xs" disabled={projects.loading} onClick={projects.reload}>
              <RotateCw className={projects.loading ? 'size-3.5 animate-spin' : 'size-3.5'} />{t("Refresh")}</Button>
            <Button size="sm" className="h-9 rounded-full px-3.5 text-xs" onClick={onNewProject}><Plus className="size-3.5" />{t("New project")}</Button>
          </div>
        }
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 pt-2 pb-12 @min-[56rem]/workspace:px-8">
        {projects.error ? (
          <LoadError error={projects.error} what={t("the projects")} onRetry={projects.reload} />
        ) : !projects.data ? (
          <div className={GRID} aria-busy="true" aria-label={t("Loading projects")}>
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="reveal h-40 rounded-2xl" style={revealStyle(i)} />
            ))}
          </div>
        ) : all.length === 0 ? (
          <Empty icon={FolderOpen} title={t("No projects yet")} className="rounded-2xl py-16" action={<Button size="sm" className="rounded-xl" onClick={onNewProject}><Plus className="size-3.5" />{t("Create project")}</Button>}>{t("Start with an empty workspace or import an existing folder.")}</Empty>
        ) : shown.length === 0 ? (
          <Empty
            icon={FolderSearch}
            title={t("No projects match")}
            action={<Button variant="outline" size="sm" onClick={() => search('')}>{t("Clear search")}</Button>}
            className="rounded-2xl"
          >{t("Nothing matches “")}{query.trim()}{t("”. Search by name, Store or source folder.")}</Empty>
        ) : (
          <>
            <p aria-live="polite" className="px-1 text-xs text-muted-foreground tabular-nums">
              {q ? t("{value1} of {value2} projects", {value1: shown.length, value2: all.length}) : t(all.length === 1 ? '{count} project' : '{count} projects', {count: all.length})}
            </p>
            <div ref={flip.container} className={GRID}>
              {shown.map((project, index) => (
                <ProjectCard key={projectKey(project)} project={project} index={index} onOpen={() => onOpenProject(projectKey(project))} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
