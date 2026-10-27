import { FolderPlus } from 'lucide-react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { Chip } from '@/components/storage/chips'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ago, when } from '@/data/format'
import { cn } from '@/lib/utils'
import type { ProjectSummary } from '@shared/host-api'

interface ProjectsTableProps {
  projects: ProjectSummary[]
  title?: string
  /** Opens a project a demo run made, by its run. */
  onOpenRun?: (runId: string) => void
  /** A project to mark, such as the one the page is about. */
  current?: string
  empty?: React.ReactNode
}

/** LayerFS projects in Connect's home: each one Store in its own Docker volume. */
export function ProjectsTable({ projects, title = 'Projects', onOpenRun, current, empty }: ProjectsTableProps) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-baseline gap-2 px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-faint">{projects.length}</span>
      </header>
      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-5 pt-4 pb-7 text-center">
          <FolderPlus aria-hidden="true" className="size-5 text-faint" />
          <p className="text-sm font-medium">No projects yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">{empty ?? 'Run a demo, and the project it Inits keeps its history here.'}</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 text-xs text-faint">Project</TableHead>
              <TableHead className="text-xs text-faint">Store volume</TableHead>
              <TableHead className="text-xs text-faint">Made by</TableHead>
              <TableHead className="pr-5 text-right text-xs text-faint">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.name} className={cn(p.name === current && 'bg-accent/50')}>
                <TableCell className="pl-5">
                  <span className="flex items-center gap-2.5 font-medium">
                    <LayerfsMark className="size-4" />
                    {p.name}
                    {!p.initialized && <Chip tone="warning">Not initialized</Chip>}
                  </span>
                </TableCell>
                <TableCell>
                  {p.volume ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{p.volume}</code>
                  ) : (
                    <span className="text-faint">none</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {p.demo && p.run ? (
                    onOpenRun ? (
                      <button type="button" onClick={() => onOpenRun(p.run!)} className="hover:text-foreground hover:underline">
                        {p.demo} demo · run {p.run}
                      </button>
                    ) : (
                      `${p.demo} demo · run ${p.run}`
                    )
                  ) : (
                    <span className="text-faint" title={p.source ?? undefined}>
                      {p.source ? `Init from ${p.source.split('/').pop()}` : 'outside Connect'}
                    </span>
                  )}
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
