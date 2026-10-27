import { ChevronRight, FolderOpen, GitBranch } from 'lucide-react'
import { useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { Chip, type Tone } from '@/components/storage/chips'
import { shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'
import type { SandboxInfo } from '@shared/host-api'

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

function Capacity({ used }: { used: number }) {
  const share = used / SANDBOX_CAPACITY
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', share >= 0.75 ? 'bg-warning' : 'bg-success')}
          style={{ width: `${Math.max(share * 100, used > 0 ? 6 : 0)}%` }}
        />
      </span>
      {used} / {SANDBOX_CAPACITY}
    </span>
  )
}

export interface SandboxGroup {
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

  return (
    <div role="table" aria-label="Sandboxes and their Workspaces">
      <div role="row" className={cn(ROW, 'px-5 pt-2 pb-1.5 text-xs text-faint')}>
        <span />
        <span role="columnheader">Sandbox</span>
        <span role="columnheader">State</span>
        <span role="columnheader">Workspaces</span>
        <span role="columnheader">Image</span>
      </div>
      {groups.map((g) => (
        <div key={g.project} role="rowgroup" className="border-t">
          {showProject && (
            <div className="flex items-center gap-2 px-5 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
              <LayerfsMark className="size-3.5" />
              {g.project}
            </div>
          )}
          {g.sandboxes.map((s, i) => {
            const key = `${g.project}/${s.id}`
            const expanded = open.has(key)
            const state = sandboxTone(s.state)
            return (
              <div key={key} className={cn(expanded && 'bg-muted/30')}>
                <div role="row" className={cn(ROW, 'py-2.5 pr-5 pl-5', (showProject ? i > 0 : true) && 'border-t')}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Hide' : 'Show'} Workspaces in ${s.name}`}
                    onClick={() => toggle(key)}
                    disabled={s.workspaces.length === 0}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                  >
                    <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
                  </button>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[13px]" title={s.name}>
                      {s.name}
                    </span>
                    <span className="block text-xs text-faint">Sandbox {s.id}</span>
                  </span>
                  <span>
                    <Chip tone={state.tone} live={state.live}>
                      {state.label}
                    </Chip>
                  </span>
                  <Capacity used={s.workspaces.length} />
                  <span className="truncate font-mono text-xs text-muted-foreground" title={s.image ?? undefined}>
                    {shortDigest(s.image)}
                  </span>
                </div>
                {expanded &&
                  s.workspaces.map((ws) => (
                    <div key={ws.ws} role="row" className={cn(ROW, 'border-t border-dashed py-2 pr-5 pl-5')}>
                      <span />
                      <span className="flex min-w-0 items-center gap-2 pl-5">
                        <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
                        <span className="truncate font-mono text-xs">{ws.path}</span>
                      </span>
                      <span className="col-span-3 flex min-w-0 items-center gap-1.5 text-[13px]">
                        <GitBranch aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
                        <span className="truncate">{ws.branch || 'unknown Branch'}</span>
                      </span>
                    </div>
                  ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
