import { t, useI18n } from '@/i18n'
import type { ProjectSummary } from '@shared/host-api'
import { ArrowUpRight, FolderOpen } from 'lucide-react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { revealStyle } from '@/components/motion/reveal'
import { spotlight } from '@/components/motion/spotlight'
import { Chip } from '@/components/storage/chips'
import { ago, when } from '@/data/format'

interface ProjectCardProps {
  project: ProjectSummary
  index: number
  onOpen: () => void
}

export function ProjectCard({ project, index, onOpen }: ProjectCardProps) {
  useI18n()
  return (
    <button
      type="button"
      data-flip={project.name}
      onClick={onOpen}
      onPointerMove={spotlight}
      style={revealStyle(index)}
      className="home-card glass-liquid card-hover sheen-sweep spotlight reveal flex min-w-0 flex-col gap-5 rounded-2xl p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex w-full items-center gap-3">
        <span className="home-mark" aria-hidden="true">
          <LayerfsMark className="size-6" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]" title={project.name}>
          {project.name}
        </span>
        <ArrowUpRight aria-hidden="true" className="home-arrow size-4 shrink-0 text-primary" />
      </span>
      <span className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground" title={project.source ?? undefined}>
        <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{project.source || t('Empty workspace')}</span>
      </span>
      <span className="mt-auto flex w-full flex-wrap items-center justify-between gap-2 border-t border-foreground/[0.06] pt-3">
        <Chip tone={project.initialized ? 'success' : 'neutral'}>{project.initialized ? t("Ready") : t("Not initialized")}</Chip>
        {project.created !== null && (
          <span className="text-[11px] text-muted-foreground tabular-nums" title={when(project.created)}>{t("Created ")}{ago(project.created)}
          </span>
        )}
      </span>
    </button>
  )
}
