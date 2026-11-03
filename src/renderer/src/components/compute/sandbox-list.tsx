import { t, useI18n } from '@/i18n'
// Sandboxes by project, as table rows (a project's own, without its heading). Each row names its platform
// (layerfs#529) with a badge after its name, Docker's too. A running Sandbox's row carries a
// breathing brand edge and its capacity bar glows; rows rise in, staggered,
// and open with an animated height to the Workspaces mounted in them.
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { PlatformBadge } from '@/components/compute/target-parts'
import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsBranch, LfsWorkspace } from '@/components/lfs-icons'
import { Collapse, revealStyle } from '@/components/motion'
import { Chip, type Tone } from '@/components/storage/chips'
import { Bar } from '@/components/storage/meters'
import { type Os, platformOfSandbox } from '@/data/compute'
import { stateLook } from '@/data/states'
import { cn } from '@/lib/utils'
import { projectLabel, type SandboxInfo } from '@shared/host-api'

/** LayerFS refuses a mount past this many Workspaces in one Sandbox. */
export const SANDBOX_CAPACITY = 16

// Sandbox rows and their Workspace rows share one column grid, so the
// Workspace details line up under the Sandbox they belong to.
const ROW = 'grid grid-cols-[1.25rem_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-x-3'

/** A Sandbox's state as the SDK gives it (creating, running, closing, gone, unresolved), as a chip. */
export function sandboxTone(state: string): { tone: Tone; live?: boolean; label: string } {
  const look = stateLook('sandbox', state)
  return { tone: look.tone, live: look.live, label: look.label }
}

function Capacity({ used, live, wait }: { used: number; live: boolean; wait: number }) {
  useI18n()
  const share = used / SANDBOX_CAPACITY
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <Bar share={used > 0 ? Math.max(share, 0.06) : 0} tone={share >= 0.75 ? 'warning' : 'brand'} live={live && used > 0} wait={wait} className="hidden w-16 min-w-6 @min-[26rem]/sandboxes:block" />
      <span className="shrink-0 whitespace-nowrap">
        <span className="text-foreground">{used}</span> / {SANDBOX_CAPACITY}
      </span>
    </span>
  )
}

export interface SandboxGroup {
  /** The project's key (`store/name` in a shared Store). */
  project: string
  sandboxes: SandboxInfo[]
}

interface SandboxListProps {
  groups: SandboxGroup[]
  /** Label each project's group; off when the list is one project's. */
  showProject?: boolean
  /** The column titles; off inside a table that has its own. */
  header?: boolean
  /** Their states cannot be read now (a worker that does not answer): states show as unknown, rows dimmed. */
  unknown?: boolean
  /** The host's system, which names a native Sandbox's platform when an older host leaves it out. */
  os?: Os
}

/** Sandboxes by project; each opens to the Workspaces mounted in it. */
export function SandboxList({ groups, showProject = true, header = true, unknown = false, os = 'darwin' }: SandboxListProps) {
  useI18n()
  const grid = ROW
  // Sandboxes with a Workspace mounted start open.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.flatMap((g) => g.sandboxes.filter((s) => s.workspaces.length > 0).map((s) => `${g.project}/${s.id}`))),
  )
  const toggle = (key: string) =>
    setOpen((all) => {
      const next = new Set(all)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  let n = 0
  return (
    <div role="table" aria-label={t("Sandboxes and their Workspaces")} className="@container/sandboxes">
      <div role="row" className={cn(grid, 'px-5 pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase', !header && 'sr-only')}>
        <span />
        <span role="columnheader">{t("Sandbox")}</span>
        <span role="columnheader">{t("State")}</span>
        <span role="columnheader">{t("Workspaces")}</span>
      </div>
      {groups.map((g) => (
        <div key={g.project} role="rowgroup" className="border-t">
          {showProject && (
            <div className="flex items-center gap-2 px-5 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
              <LayerfsMark className="size-3.5" />
              {projectLabel(g.project)}
              <span className="text-faint tabular-nums">· {g.sandboxes.length}</span>
            </div>
          )}
          {g.sandboxes.map((s, i) => {
            const key = `${g.project}/${s.id}`
            const expanded = open.has(key)
            const state = unknown ? { tone: 'neutral' as const, live: false, label: 'Unknown' } : sandboxTone(s.state)
            const running = !unknown && s.state === 'running'
            const at = n++
            return (
              <div
                key={key}
                className={cn('reveal transition-colors duration-(--dur-base)', expanded && 'bg-muted/30', running && 'sc-live-row', unknown && 'opacity-60')}
                style={revealStyle(at)}
              >
                <div
                  role="row"
                  className={cn(grid, 'py-2.5 pr-5 pl-5 transition-colors duration-(--dur-fast) hover:bg-foreground/[0.025]', (showProject || !header ? i > 0 : true) && 'border-t')}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={t("{value1} Workspaces in {value2}", {value1: t(expanded ? 'Hide' : 'Show'), value2: s.name})}
                    onClick={() => toggle(key)}
                    disabled={s.workspaces.length === 0}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                  >
                    <ChevronRight className="chevron size-4" />
                  </button>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-mono text-xs" title={s.name}>
                      {s.name}
                    </span>
                    <PlatformBadge id={platformOfSandbox(s, os)} labelClassName="hidden @min-[24rem]/sandboxes:inline" />
                  </span>
                  <span>
                    <Chip tone={state.tone} live={state.live}>
                      {t(state.label)}
                    </Chip>
                  </span>
                  <Capacity used={s.workspaces.length} live={running} wait={250 + Math.min(at, 10) * 60} />
                </div>
                <Collapse open={expanded} appear={false}>
                  {s.workspaces.map((ws) => (
                    <div key={ws.ws} role="row" className={cn(grid, 'border-t border-dashed py-2 pr-5 pl-5')}>
                      <span />
                      <span className="flex min-w-0 items-center gap-2 pl-5">
                        <LfsWorkspace className={cn('size-3.5 shrink-0', running ? 'text-primary' : 'text-muted-foreground')} />
                        <span className="truncate font-mono text-xs">{ws.path}</span>
                      </span>
                      <span className={cn('col-span-2', 'flex min-w-0 items-center gap-2 text-[13px]')}>
                        <span aria-hidden="true" data-live={running} className="sc-wire w-8 shrink-0" />
                        <span className="flex min-w-0 items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-xs font-medium shadow-elev-1 ring-1 ring-foreground/10">
                          <LfsBranch className="size-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{ws.branch || t('Unknown branch')}</span>
                        </span>
                      </span>
                    </div>
                  ))}
                </Collapse>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
