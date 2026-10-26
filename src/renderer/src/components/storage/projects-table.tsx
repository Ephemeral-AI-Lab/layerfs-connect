import { FolderPlus } from 'lucide-react'

import { AGENT_DOT } from '@/components/app-sidebar'
import { LayerfsMark } from '@/components/layerfs-mark'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Project } from '@/data/sample'
import { cn } from '@/lib/utils'

export function ProjectsTable({ projects }: { projects: Project[] }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-baseline gap-2 px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold">Projects</h3>
        <span className="text-xs text-faint">{projects.length}</span>
      </header>
      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-5 pt-4 pb-7 text-center">
          <FolderPlus aria-hidden="true" className="size-5 text-faint" />
          <p className="text-sm font-medium">No projects yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Pick this database when you create a project, and its history lives here.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 text-xs text-faint">Project</TableHead>
              <TableHead className="text-xs text-faint">Last Commit</TableHead>
              <TableHead className="text-xs text-faint">Sessions</TableHead>
              <TableHead className="pr-5 text-right text-xs text-faint">Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const busy = project.sessions.filter((s) => s.busy)
              return (
                <TableRow key={project.key}>
                  <TableCell className="pl-5">
                    <span className="flex items-center gap-2.5 font-medium">
                      <LayerfsMark className="size-4" />
                      {project.key}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{project.lastCommit.id}</code>
                      <span className="text-muted-foreground">{project.lastCommit.ago}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <span className="flex gap-1">
                        {project.sessions.map((s) => (
                          <span
                            key={s.id}
                            aria-hidden="true"
                            className={cn('size-2 rounded-full', s.busy ? AGENT_DOT[s.agent] : 'bg-idle')}
                          />
                        ))}
                      </span>
                      {busy.length > 0 ? `${busy.length} active` : `${project.sessions.length} idle`}
                    </span>
                  </TableCell>
                  <TableCell className="pr-5 text-right text-muted-foreground tabular-nums">{project.size}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
