import { t, useI18n } from '@/i18n'
import { ArrowUpRight, FolderPlus } from 'lucide-react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { Chip } from '@/components/storage/chips'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ago, when } from '@/data/format'
import { cn } from '@/lib/utils'
import type { ProjectSummary } from '@shared/host-api'

interface ProjectsTableProps {
  projects: ProjectSummary[]
  title?: string
  onOpenProject?: (project: string) => void
  /** A project to mark, such as the one the page is about. */
  current?: string
  empty?: React.ReactNode
}

/** LayerFS projects in Connect's home: each one Store in its own Docker volume. Rows rise in, staggered. */
export function ProjectsTable({ projects, title = 'Projects', onOpenProject, current, empty }: ProjectsTableProps) {
  useI18n()
  return (
    <section className="glass-liquid card-hover overflow-hidden rounded-2xl shadow-xs">
      <header className="flex items-baseline gap-2 px-5 pt-4 pb-2.5 border-b">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums ring-1 ring-border/50">{projects.length}</span>
      </header>
      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-5 pt-4 pb-7 text-center">
          <span className="surface drift mb-1 flex size-10 items-center justify-center rounded-xl text-faint">
            <FolderPlus aria-hidden="true" className="size-5" />
          </span>
          <p className="text-sm font-medium">{t("No projects yet")}</p>
          <p className="max-w-xs text-xs text-muted-foreground">{empty ?? t('Your LayerFS projects and their storage will appear here.')}</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 text-xs text-faint">{t("Project")}</TableHead>
              <TableHead className="text-xs text-faint">{t("Store volume")}</TableHead>
              <TableHead className="text-xs text-faint">{t("Source")}</TableHead>
              <TableHead className="pr-5 text-right text-xs text-faint">{t("Created")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="stagger">
            {projects.map((p) => (
              <TableRow
                key={p.name}
                className={cn(
                  'border-border/70 transition-colors duration-(--dur-fast) hover:bg-foreground/[0.025]',
                  p.name === current && 'bg-accent/50 shadow-[inset_2px_0_0_var(--primary)] hover:bg-accent/60',
                )}
              >
                <TableCell className="pl-5">
                  <span className="flex items-center gap-2.5 font-medium">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-foreground/[0.06] ring-inset">
                      <LayerfsMark className="size-3.5" />
                    </span>
                    {onOpenProject ? (
                      <button
                        type="button"
                        onClick={() => onOpenProject(p.name)}
                        className="group/project inline-flex min-w-0 items-center gap-1 rounded-md text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{p.name}</span>
                        <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground group-hover/project:text-primary" />
                      </button>
                    ) : p.name}
                    {!p.initialized && <Chip tone="warning">{t("Not initialized")}</Chip>}
                  </span>
                </TableCell>
                <TableCell>
                  {p.volume ? (
                    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-foreground/[0.05] ring-inset">
                      {p.volume}
                    </code>
                  ) : (
                    <span className="text-faint">{t("none")}</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="text-faint" title={p.source ?? undefined}>
                    {p.source ? p.source.split('/').filter(Boolean).pop() : t("Empty project")}
                  </span>
                </TableCell>
                <TableCell className="pr-5 text-right text-muted-foreground tabular-nums" title={when(p.created)}>
                  {p.created ? ago(p.created) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
