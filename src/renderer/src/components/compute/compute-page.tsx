import { RotateCw, Settings2 } from 'lucide-react'

import { CloudCards } from '@/components/compute/cloud-cards'
import { DockerCard } from '@/components/compute/docker-card'
import { NativeCard } from '@/components/compute/native-card'
import type { SandboxGroup } from '@/components/compute/sandbox-list'
import { LoadError, Loading } from '@/components/projects/states'
import { Button } from '@/components/ui/button'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import type { HostStatus } from '@shared/host-api'

const OS: Record<HostStatus['platform'], string> = { macos: 'darwin', linux: 'linux', windows: 'win32' }

function Setting({ label, value, mono = true }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'min-w-0 truncate font-mono text-[13px]' : 'min-w-0 truncate'} title={value ?? undefined}>
        {value ?? <span className="font-sans text-warning">not set</span>}
      </dd>
    </>
  )
}

interface ComputePageProps {
  /** Dev aid: draw the Native card for another OS (linux, win32, darwin). */
  platform?: string
}

export function ComputePage({ platform }: ComputePageProps) {
  const status = useHostQuery(() => host.status(), [])
  // Every project's Sandboxes: one state read per project, none of which starts a Sandbox.
  const sandboxes = useHostQuery(async () => {
    const projects = await host.projects()
    const states = await Promise.all(
      projects.filter((p) => p.initialized).map((p) => host.project(p.name).then((s) => ({ name: p.name, s }), () => ({ name: p.name, s: null }))),
    )
    const groups: SandboxGroup[] = states.flatMap(({ name, s }) => (s && s.sandboxes.length > 0 ? [{ project: name, sandboxes: s.sandboxes }] : []))
    return { groups, failed: states.filter((x) => !x.s).map((x) => x.name) }
  }, [])
  // A run that starts or ends opens or closes Sandboxes.
  useHostEvents((e) => {
    if (e.type === 'run') sandboxes.reload()
  })

  const s = status.data
  const os = platform ?? (s ? OS[s.platform] : window.connect.platform)

  return (
    <div className="h-svh overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 pt-7 pb-10">
        <header className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">Compute</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Where runs execute commands with their Workspace mounted. Docker is the one LayerFS has today.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              status.reload()
              sandboxes.reload()
            }}
          >
            <RotateCw /> Refresh
          </Button>
        </header>

        {!s ? (
          status.error ? (
            <LoadError error={status.error} what="the compute status" onRetry={status.reload} />
          ) : (
            <Loading label="Asking Docker and the worker" />
          )
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-[13px] font-semibold">This machine</h2>
                <p className="text-xs text-faint">
                  {s.platform === 'macos' ? 'macOS' : s.platform === 'windows' ? 'Windows' : 'Linux'} · {window.connect.arch}
                </p>
              </div>
              <DockerCard status={s} groups={sandboxes.data?.groups} failed={sandboxes.data?.failed ?? []} />
              {sandboxes.error && <LoadError error={sandboxes.error} what="the Sandboxes" onRetry={sandboxes.reload} />}
              <NativeCard platform={os} arch={window.connect.arch} />
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-[13px] font-semibold">Cloud sandboxes</h2>
                <p className="text-xs text-faint">They can't open a local SQLite file, so they wait on PostgreSQL storage too.</p>
              </div>
              <CloudCards />
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Settings2 aria-hidden="true" className="size-3.5" /> Settings
                </h2>
                <p className="text-xs text-faint">
                  Read only here. Edit <span className="font-mono">{s.settings.state}/settings.json</span> and restart Connect.
                </p>
              </div>
              <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-xl border bg-card px-5 py-4 text-sm">
                <Setting label="Settings file" value={`${s.settings.state}/settings.json`} />
                <Setting label="LayerFS home" value={s.settings.home} />
                <Setting label="Sandbox image" value={s.settings.image} />
                <Setting label="LayerFS bundle" value={s.settings.bundle} />
                <Setting label="Docker socket" value={s.settings.docker} />
                <Setting label="Name prefix" value={s.settings.containerPrefix} />
                {s.missing.length > 0 && <Setting label="Still missing" value={s.missing.join(', ')} mono={false} />}
              </dl>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
