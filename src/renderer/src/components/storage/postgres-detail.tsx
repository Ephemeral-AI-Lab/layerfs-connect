import { FlaskConical, KeyRound, Unplug } from 'lucide-react'

import { Chip } from '@/components/storage/chips'
import { DatabaseHeader } from '@/components/storage/database-header'
import { Notice } from '@/components/storage/notice'
import { ProjectsTable } from '@/components/storage/projects-table'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import type { Project } from '@/data/sample'
import type { PostgresDatabase } from '@/data/storage'

export function PostgresDetail({ db, projects }: { db: PostgresDatabase; projects: Project[] }) {
  const facts = ['PostgreSQL over HTTP', projects.length === 1 ? '1 project' : `${projects.length} projects`]
  if (db.latencyMs !== undefined) facts.push(`${db.latencyMs} ms round trip`)

  return (
    <div className="flex flex-col gap-5">
      <DatabaseHeader db={db} facts={facts} where={`${db.endpoint} · ${db.database}`} />

      {db.health === 'unreachable' && (
        <Notice tone="danger" icon={Unplug} title="Can't reach the database">
          Commits to its projects are blocked until it's back. Nothing is queued to send later.
        </Notice>
      )}

      <section className="rounded-xl border bg-card">
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h3 className="text-sm font-semibold">Connection</h3>
          <Unavailable>
            <Button variant="outline" size="sm" disabled>
              <FlaskConical /> Test
            </Button>
          </Unavailable>
        </header>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2.5 px-5 pt-3 pb-4 text-sm">
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="font-mono text-[13px]">{db.endpoint}</dd>
          <dt className="text-muted-foreground">Database</dt>
          <dd className="font-mono text-[13px]">{db.database}</dd>
          <dt className="text-muted-foreground">Token</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono text-[13px]">{db.token}</span>
            <Chip tone="neutral" icon={KeyRound}>
              System keychain
            </Chip>
          </dd>
        </dl>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Live: every Commit lands in the database, so there is nothing to push or pull.
        </p>
      </section>

      <ProjectsTable projects={projects} />
    </div>
  )
}
