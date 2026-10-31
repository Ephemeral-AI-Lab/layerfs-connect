import { t, useI18n } from '@/i18n'
// Sandboxes by project, as table rows. A running Sandbox's row carries a
// breathing brand edge and its capacity bar glows; rows rise in, staggered,
// and open with an animated height to the Workspaces mounted in them.
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsBranch, LfsWorkspace } from '@/components/lfs-icons'
import { Collapse, revealStyle } from '@/components/motion'
import { Chip, type Tone } from '@/components/storage/chips'
import { Bar } from '@/components/storage/meters'
import { shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'
import { projectLabel, type SandboxInfo } from '@shared/host-api'

/** LayerFS refuses a mount past this many Workspaces in one Sandbox. */
export const SANDBOX_CAPACITY = 16

// Sandbox rows and their Workspace rows share one column grid, so the
// Workspace details line up under the Sandbox they belong to.
const ROW = 'grid grid-cols-[1.25rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-x-3'

/** A Sandbox container's state as a chip: running is live, gone is quiet. */
export function sandboxTone(state: string): { tone: Tone; live?: boolean; label: string } {
  switch (state) {
    case 'running':
      return { tone: 'success', live: true, label: 'Running' }
    case 'created':
    case 'restarting':
      return { tone: 'info', label: state === 'created' ? 'Starting' : 'Restarting' }
    case 'gone':
      return { tone: 'neutral', label: 'Gone' }
    case 'exited':
    case 'dead':
      return { tone: 'warning', label: state === 'dead' ? 'Dead' : 'Exited' }
    default:
      return { tone: 'neutral', label: state || 'Unknown' }
  }
}

function Capacity({ used, live, wait }: { used: number; live: boolean; wait: number }) {
  useI18n()
  const share = used / SANDBOX_CAPACITY
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <Bar share={used > 0 ? Math.max(share, 0.06) : 0} tone={share >= 0.75 ? 'warning' : 'brand'} live={live && used > 0} wait={wait} className="w-16 min-w-6" />
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
}

/** Sandboxes by project; each opens to the Workspaces mounted in it. */
export function SandboxList({ groups, showProject = true }: SandboxListProps) {
  useI18n()
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
    <div role="table" aria-label={t("Sandboxes and their Workspaces")}>
      <div role="row" className={cn(ROW, 'px-5 pt-2 pb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase')}>
        <span />
        <span role="columnheader">{t("Sandbox")}</span>
        <span role="columnheader">{t("State")}</span>
        <span role="columnheader">{t("Workspaces")}</span>
        <span role="columnheader">{t("Image")}</span>
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
            const state = sandboxTone(s.state)
            const running = s.state === 'running'
            const at = n++
            return (
              <div
                key={key}
                className={cn('reveal transition-colors duration-(--dur-base)', expanded && 'bg-muted/30', running && 'sc-live-row')}
                style={revealStyle(at)}
              >
                <div
                  role="row"
                  className={cn(ROW, 'py-2.5 pr-5 pl-5 transition-colors duration-(--dur-fast) hover:bg-foreground/[0.025]', (showProject ? i > 0 : true) && 'border-t')}
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
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]" title={s.name}>
                      {s.name}
                    </span>
                    <span className="block text-xs text-faint">{t("Sandbox ")}{s.id}</span>
                  </span>
                  <span>
                    <Chip tone={state.tone} live={state.live}>
                      {t(state.label)}
                    </Chip>
                  </span>
                  <Capacity used={s.workspaces.length} live={running} wait={250 + Math.min(at, 10) * 60} />
                  <span className="truncate font-mono text-xs text-muted-foreground" title={s.image ?? undefined}>
                    {shortDigest(s.image)}
                  </span>
                </div>
                <Collapse open={expanded} appear={false}>
                  {s.workspaces.map((ws) => (
                    <div key={ws.ws} role="row" className={cn(ROW, 'border-t border-dashed py-2 pr-5 pl-5')}>
                      <span />
                      <span className="flex min-w-0 items-center gap-2 pl-5">
                        <LfsWorkspace className={cn('size-3.5 shrink-0', running ? 'text-primary' : 'text-muted-foreground')} />
                        <span className="truncate font-mono text-xs">{ws.path}</span>
                      </span>
                      <span className="col-span-3 flex min-w-0 items-center gap-2 text-[13px]">
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
