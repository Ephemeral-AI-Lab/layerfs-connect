// The Sandboxes tab's tiles: one card per open Sandbox with its Workspace
// slots and each mounted Workspace's Branch; closed Sandboxes in a quiet
// row under them. Cards and Workspaces slide in as they appear.
import type { SandboxInfo } from '@shared/host-api'

import { SANDBOX_CAPACITY, sandboxTone } from '@/components/compute/sandbox-list'
import { LfsBranch, LfsSandbox, LfsWorkspace } from '@/components/lfs-icons'
import { Chip } from '@/components/storage/chips'
import { shortDigest } from '@/data/format'
import { cn } from '@/lib/utils'

const ENTER = 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both'

/** The Sandbox's Workspace slots: a filled square per mounted Workspace. */
function Slots({ used }: { used: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="grid grid-cols-8 gap-[3px]" aria-hidden="true">
        {Array.from({ length: SANDBOX_CAPACITY }, (_, i) => (
          <span
            key={i}
            className={cn('size-2 rounded-[2px] transition-colors duration-500', i < used ? 'bg-primary' : 'bg-muted ring-1 ring-foreground/5 ring-inset')}
            style={{ transitionDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {used} / {SANDBOX_CAPACITY} Workspaces
      </span>
    </div>
  )
}

function SandboxTile({ s, index }: { s: SandboxInfo; index: number }) {
  const state = sandboxTone(s.state)
  const running = s.state === 'running'
  return (
    <article className={cn('flex flex-col rounded-xl border bg-card shadow-xs', ENTER)} style={{ animationDelay: `${index * 90}ms`, animationDuration: '450ms' }}>
      <header className="flex items-start gap-3 px-4 pt-4">
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground dark:text-primary">
          {running && <span aria-hidden="true" className="absolute inset-0 rounded-lg bg-primary/20 motion-safe:animate-ping" style={{ animationDuration: '2.4s' }} />}
          <LfsSandbox className="relative size-[18px]" />
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
      <div className="px-4 pt-3">
        <Slots used={s.workspaces.length} />
      </div>
      <ul className="mt-3 flex flex-1 flex-col gap-1.5 px-4">
        {s.workspaces.length === 0 ? (
          <li className="rounded-lg border border-dashed px-3 py-2 text-xs text-faint">No Workspace mounted</li>
        ) : (
          s.workspaces.map((ws, i) => (
            <li
              key={ws.ws}
              className={cn('flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs', ENTER)}
              style={{ animationDelay: `${200 + i * 70}ms`, animationDuration: '400ms' }}
            >
              <LfsWorkspace className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate font-mono">{ws.path}</span>
              <span aria-hidden="true" className="relative mx-1 h-px min-w-6 flex-1 overflow-hidden bg-border">
                {running && <span className="absolute inset-y-0 left-0 w-1/3 bg-primary/60 motion-safe:animate-[slide-across_1.8s_linear_infinite]" />}
              </span>
              <span className="flex min-w-0 items-center gap-1 rounded-md bg-card px-1.5 py-0.5 ring-1 ring-foreground/10">
                <LfsBranch className="size-3 shrink-0" />
                <span className="truncate">{ws.branch || 'unknown Branch'}</span>
              </span>
            </li>
          ))
        )}
      </ul>
      <footer className="mt-3 border-t px-4 py-2.5 font-mono text-[11px] text-faint" title={s.image ?? undefined}>
        {shortDigest(s.image)}
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
        <div className={cn('flex flex-wrap items-center gap-2 text-xs text-faint', ENTER)}>
          <span>Closed</span>
          {closed.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-muted-foreground">
              <LfsSandbox className="size-3.5 opacity-60" />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
