// Storage: where a demo's LayerFS project keeps its state. Its Store (one
// SQLite file in its Docker volume) with its size, what the Store holds
// (Layers, Branches, Commits), and the Sandboxes open on it now.
import type { ProjectState, RunDetail } from '@shared/host-api'

import { SandboxList } from '@/components/compute/sandbox-list'
import { LfsSandbox, LfsStore } from '@/components/lfs-icons'
import { Empty, LoadError, Loading } from '@/components/projects/states'
import { isLive } from '@/components/runs/run-format'
import { useRunProject } from '@/components/runs/run-project-tabs'
import { Tile } from '@/components/storage/icons'
import { bytes, when } from '@/data/format'

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={mono ? 'mt-0.5 truncate font-mono text-[13px]' : 'mt-0.5 truncate text-sm tabular-nums'}>{children}</dd>
    </div>
  )
}

function StoreCard({ s }: { s: ProjectState }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-start gap-3 px-5 pt-4">
        <Tile>
          <LfsStore className="size-5" />
        </Tile>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Local SQLite Store</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every Commit, Branch and Layer of <span className="font-mono text-foreground">{s.project.name}</span> lives in one SQLite file in
            its Docker volume; each new session starts it again from the demo’s fixture.
          </p>
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums">{bytes(s.store.bytes)}</span>
      </header>
      <dl className="mx-5 mt-4 mb-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
        <Fact label="Layers on main">{s.layers.length}</Fact>
        <Fact label="Branches">{s.branches.length}</Fact>
        <Fact label="Commits">{s.commits}</Fact>
        <Fact label="Created">{when(s.project.created)}</Fact>
        <div className="col-span-2 sm:col-span-4">
          <Fact label="Store file" mono>
            {s.store.path ?? '—'}
          </Fact>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <Fact label="Volume" mono>
            {s.project.volume ?? '—'}
          </Fact>
        </div>
      </dl>
    </section>
  )
}

/** The Storage tab of a project, read from the project its newest session played on. */
export function ProjectStorage({ run }: { run: RunDetail }) {
  const p = useRunProject(run)
  const s = p.state
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-8 py-6">
        {!s ? (
          p.error ? (
            <LoadError error={p.error} what={run.project} onRetry={p.reload} />
          ) : (
            <Loading label={`Reading ${run.project}`} />
          )
        ) : (
          <>
            <StoreCard s={s} />
            <section className="flex flex-col gap-3">
              <header className="flex items-baseline gap-2">
                <h2 className="text-sm font-semibold">Sandboxes</h2>
                <span className="text-xs text-faint">{s.sandboxes.length}</span>
              </header>
              {s.sandboxes.length > 0 ? (
                <div className="overflow-hidden rounded-xl border bg-card">
                  <SandboxList groups={[{ project: s.project.name, sandboxes: s.sandboxes }]} showProject={false} />
                </div>
              ) : (
                <Empty icon={LfsSandbox} title="No Sandboxes open">
                  {isLive(run.state)
                    ? 'A Sandbox opens when an agent first mounts a Workspace.'
                    : 'The session’s Sandboxes have closed; its Workspaces were unmounted with them.'}
                </Empty>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
