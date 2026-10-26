import { ArrowDownToLine, ArrowUpFromLine, CloudOff, KeyRound, Link2, Lock, TriangleAlert } from 'lucide-react'

import { DatabaseHeader } from '@/components/storage/database-header'
import { ProviderIcon } from '@/components/storage/icons'
import { Notice } from '@/components/storage/notice'
import { ProjectsTable } from '@/components/storage/projects-table'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { Project } from '@/data/sample'
import { LOCAL_STORAGE, type LocalDatabase, PROVIDER_LABEL, type SyncLocation, THIS_MACHINE } from '@/data/storage'

interface LocalDetailProps {
  db: LocalDatabase
  location?: SyncLocation
  projects: Project[]
  onAutoPushChange: (on: boolean) => void
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  )
}

export function LocalDetail({ db, location, projects, onAutoPushChange }: LocalDetailProps) {
  const sync = db.sync
  const state = sync?.status.state
  const elsewhere = sync?.checkedOutBy && sync.checkedOutBy !== THIS_MACHINE ? sync.checkedOutBy : undefined

  return (
    <div className="flex flex-col gap-5">
      <DatabaseHeader
        db={db}
        facts={['SQLite', db.size, projects.length === 1 ? '1 project' : `${projects.length} projects`]}
        where={`${LOCAL_STORAGE}/${db.file}`}
      />

      {state === 'diverged' && (
        <Notice
          tone="danger"
          icon={TriangleAlert}
          title="This file and the copy at the sync location both changed"
          actions={
            <>
              <Unavailable>
                <Button variant="outline" size="sm" disabled>
                  Keep mine
                </Button>
              </Unavailable>
              <Unavailable>
                <Button variant="outline" size="sm" disabled>
                  Take theirs
                </Button>
              </Unavailable>
            </>
          }
        >
          Whole files can't be merged. Keep yours to overwrite the remote copy, or take theirs to replace this one.
        </Notice>
      )}
      {elsewhere && (
        <Notice tone="warning" icon={Lock} title={`Checked out by ${elsewhere}`}>
          It may push soon. Pull first, or your next push will probably conflict.
        </Notice>
      )}
      {location?.health === 'needs-sign-in' && (
        <Notice tone="warning" icon={KeyRound} title={`Sign in to ${location.name} again`}>
          The saved credentials were refused. The projects keep working here.
        </Notice>
      )}

      <section className="rounded-xl border bg-card">
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h3 className="text-sm font-semibold">Sync</h3>
          {sync && (
            <div className="flex gap-2">
              <Unavailable>
                <Button variant="outline" size="sm" disabled>
                  <ArrowDownToLine /> Pull
                </Button>
              </Unavailable>
              <Unavailable>
                <Button variant={state === 'ahead' ? 'default' : 'outline'} size="sm" disabled>
                  <ArrowUpFromLine /> Push
                </Button>
              </Unavailable>
            </div>
          )}
        </header>

        {sync && location ? (
          <>
            <div className="flex items-center gap-3 px-5 pt-3">
              <ProviderIcon provider={location.provider} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{location.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {PROVIDER_LABEL[location.provider]} · <span className="font-mono">{sync.remotePath}</span>
                </p>
              </div>
              <Unavailable reason="Changing the sync location needs LayerFS remotes (#446)">
                <Button variant="ghost" size="sm" disabled>
                  Change
                </Button>
              </Unavailable>
            </div>
            <dl className="mx-5 mt-4 grid grid-cols-3 gap-4 border-t pt-4">
              <Fact label="Last pull">{sync.pulled}</Fact>
              <Fact label="Last push">{sync.pushed}</Fact>
              <Fact label="Checked out by">{sync.checkedOutBy ?? 'nobody'}</Fact>
            </dl>
            <div className="mx-5 mt-4 mb-4 flex items-center justify-between gap-4 rounded-lg bg-muted/60 px-4 py-3">
              <div>
                <Label htmlFor={`auto-push-${db.id}`}>Push when no session is active</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Pull and push move the whole file.</p>
              </div>
              <Switch id={`auto-push-${db.id}`} checked={sync.autoPush} onCheckedChange={onAutoPushChange} />
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 px-5 pt-3 pb-4">
            <span className="flex size-9 items-center justify-center rounded-lg border border-dashed text-faint">
              <CloudOff aria-hidden="true" className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Local only</p>
              <p className="text-xs text-muted-foreground">This file has no copy anywhere else.</p>
            </div>
            <Unavailable>
              <Button variant="outline" size="sm" disabled>
                <Link2 /> Sync with…
              </Button>
            </Unavailable>
          </div>
        )}
      </section>

      <ProjectsTable projects={projects} />
    </div>
  )
}
