// The Sandboxes tab's tiles: one card per open Sandbox with its Workspace
// slots and each mounted Workspace's Branch; closed Sandboxes in a quiet row
// under them. A running Sandbox glows: its edge carries a turning band of
// light, its icon pulses and bytes travel from each Workspace to its Branch.
// Cards and Workspaces rise in as they appear.
import type { SandboxInfo } from '@shared/host-api'
import type { CSSProperties } from 'react'

import { SANDBOX_CAPACITY, sandboxTone } from '@/components/compute/sandbox-list'
import { LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import { revealStyle } from '@/components/motion'
import { Chip } from '@/components/storage/chips'
import { shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'

import '@/components/storage/storage.css'

/** The Sandbox's Workspace slots: a lit square per mounted Workspace. */
function Slots({ used }: { used: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid grid-cols-16 gap-[3px]" aria-hidden="true">
        {Array.from({ length: SANDBOX_CAPACITY }, (_, i) => (
          <span key={i} data-on={i < used} className="sc-slot size-2 rounded-[2px]" style={{ '--d': `${250 + i * 50}ms` } as CSSProperties} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{used}</span> / {SANDBOX_CAPACITY} Workspaces
      </span>
    </div>
  )
}

function SandboxTile({ s, index }: { s: SandboxInfo; index: number }) {
  const state = sandboxTone(s.state)
  const running = s.state === 'running'
  return (
    <article
      className={cn('surface reveal flex flex-col rounded-xl', running && 'live-border')}
      style={revealStyle(index)}
      aria-label={`Sandbox ${s.name}, ${state.label}`}
    >
      <header className="flex items-start gap-3 px-4 pt-4">
        <span
          className={cn(
            'relative flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            running ? 'bg-primary/10 text-primary ring-primary/25' : 'bg-muted text-muted-foreground ring-foreground/[0.07]',
          )}
        >
          <LfsSandbox className="relative size-[18px]" />
          {running && <span aria-hidden="true" className="pulse-ring absolute -top-0.5 -right-0.5 size-2 rounded-full bg-success text-success" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px] font-medium" title={s.name}>
            {s.name}
          </p>
          <p className="text-xs text-faint">Sandbox {s.id}</p>
        </div>
        <Chip tone={state.tone} live={state.live}>
          {state.label}
        </Chip>
      </header>
      <div className="px-4 pt-3.5">
        <Slots used={s.workspaces.length} />
      </div>
      <ul className="mt-3 flex flex-1 flex-col gap-1.5 px-4" aria-label="Mounted Workspaces">
        {s.workspaces.length === 0 ? (
          <li className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-faint">
            <LfsWorkspace className="size-3.5 opacity-60" />
            No Workspace mounted
          </li>
        ) : (
          s.workspaces.map((ws, k) => (
            <li
              key={ws.ws}
              className="reveal flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs ring-1 ring-foreground/[0.05] ring-inset"
              style={revealStyle(index + k + 2)}
            >
              <LfsWorkspace className={cn('size-3.5 shrink-0', running ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0 truncate font-mono" title={ws.path}>
                {ws.path}
              </span>
              <span aria-hidden="true" data-live={running} className="sc-wire mx-1 min-w-6 flex-1" />
              <span className="flex min-w-0 items-center gap-1 rounded-md bg-card px-1.5 py-0.5 font-medium shadow-elev-1 ring-1 ring-foreground/10">
                <LfsBranch className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{ws.branch || 'unknown Branch'}</span>
              </span>
            </li>
          ))
        )}
      </ul>
      <footer className="mt-3.5 flex items-center gap-2 border-t px-4 py-2.5 font-mono text-[11px] text-faint" title={s.image ?? undefined}>
        <span className="font-sans">image</span>
        <span className="truncate">{shortDigest(s.image)}</span>
      </footer>
    </article>
  )
}

/** Open Sandboxes as tiles, closed ones as a row of names. */
export function SandboxTiles({ sandboxes }: { sandboxes: SandboxInfo[] }) {
  const open = sandboxes.filter((s) => s.state !== 'gone')
  const closed = sandboxes.filter((s) => s.state === 'gone')
  return (
    <div className="flex flex-col gap-4">
      {open.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {open.map((s, i) => (
            <SandboxTile key={s.id} s={s} index={i} />
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <div className="reveal flex flex-wrap items-center gap-2 text-xs text-faint" style={revealStyle(open.length + 1)}>
          <span className="font-medium">Closed</span>
          {closed.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 rounded-md bg-muted/70 px-2 py-1 font-mono text-muted-foreground ring-1 ring-foreground/[0.05] ring-inset">
              <LfsSandbox className="size-3.5 opacity-60" />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
