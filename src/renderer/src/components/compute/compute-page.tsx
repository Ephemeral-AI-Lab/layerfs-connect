import { t, useI18n } from '@/i18n'
import { ChevronDown, RotateCw, Settings2 } from 'lucide-react'

import { CloudCards } from '@/components/compute/cloud-cards'
import { DockerCard } from '@/components/compute/docker-card'
import { NativeCard } from '@/components/compute/native-card'
import type { SandboxGroup } from '@/components/compute/sandbox-list'
import { PageHeader } from '@/components/motion/page-header'
import { LoadError, Loading } from '@/components/projects/states'
import { Button } from '@/components/ui/button'
import { host } from '@/host/client'
import { useHostEvents, useHostQuery } from '@/host/use-host'
import type { HostStatus } from '@shared/host-api'

const OS: Record<HostStatus['platform'], string> = { macos: 'darwin', linux: 'linux', windows: 'win32' }

function Setting({ label, value, mono = true }: { label: string; value: string | null; mono?: boolean }) {
  useI18n()
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'min-w-0 truncate font-mono text-[13px]' : 'min-w-0 truncate'} title={value ?? undefined}>
        {value ?? <span className="font-sans text-warning">{t("not set")}</span>}
      </dd>
    </>
  )
}

interface ComputePageProps {
  /** Dev aid: draw the Native card for another OS (linux, win32, darwin). */
  platform?: string
}

export function ComputePage({ platform }: ComputePageProps) {
  useI18n()
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
    <div className="h-svh min-w-0 overflow-y-auto">
      <PageHeader
        sticky
        width="max-w-5xl"
        title={t("Compute")}
        description={t("Local container runtimes and sandbox execution providers.")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="rounded-full px-3.5"
            onClick={() => {
              status.reload()
              sandboxes.reload()
            }}
          >
            <RotateCw />{t("Refresh")}</Button>
        }
      />
      <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-8 px-6 pt-2 pb-10 @min-[56rem]/workspace:px-8">
        {!s ? (
          status.error ? (
            <LoadError error={status.error} what={t("the compute status")} onRetry={status.reload} />
          ) : (
            <Loading label={t("Asking Docker and the worker")} />
          )
        ) : (
          <>
            <section className="flex min-w-0 flex-col gap-3">
              <div>
                <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("This machine")}</h2>
                <p className="text-xs text-faint">
                  {s.platform === 'macos' ? t("macOS") : s.platform === 'windows' ? t("Windows") : t("Linux")} · {window.connect.arch}
                </p>
              </div>
              <DockerCard status={s} groups={sandboxes.data?.groups} failed={sandboxes.data?.failed ?? []} />
              {sandboxes.error && <LoadError error={sandboxes.error} what={t("the Sandboxes")} onRetry={sandboxes.reload} />}
              <NativeCard platform={os} arch={window.connect.arch} />
            </section>

            <section className="flex min-w-0 flex-col gap-3">
              <div>
                <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("Cloud sandboxes")}</h2>
                <p className="text-xs text-muted-foreground font-medium">{t("Remote execution providers")}</p>
              </div>
              <CloudCards />
            </section>

            <details className="surface reveal group/settings min-w-0 rounded-2xl">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-2xl px-5 py-4 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Settings2 aria-hidden="true" className="size-3.5" />{t("Settings")}<ChevronDown aria-hidden="true" className="ml-auto size-3.5 transition-transform group-open/settings:rotate-180" />
              </summary>
              <div className="border-t px-5 py-4">
                <p className="break-words text-xs text-faint">{t("Read only here. Edit ")}<span className="font-mono">{s.settings.state}{t("/settings.json")}</span>{t("and restart Connect.")}</p>
                <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm @min-[36rem]/workspace:grid-cols-[9rem_minmax(0,1fr)]">
                  <Setting label={t("Settings file")} value={`${s.settings.state}/settings.json`} />
                  <Setting label={t("LayerFS home")} value={s.settings.home} />
                  <Setting label={t("Sandbox image")} value={s.settings.image} />
                  <Setting label={t("LayerFS bundle")} value={s.settings.bundle} />
                  <Setting label={t("Docker socket")} value={s.settings.docker} />
                  <Setting label={t("Name prefix")} value={s.settings.containerPrefix} />
                  {s.missing.length > 0 && <Setting label={t("Still missing")} value={s.missing.join(', ')} mono={false} />}
                </dl>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
