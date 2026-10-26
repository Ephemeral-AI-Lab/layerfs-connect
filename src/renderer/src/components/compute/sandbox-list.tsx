import { ChevronRight, CircleStop, FolderOpen, GitBranch, LogOut, MessageSquare, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AGENT_DOT } from '@/components/app-sidebar'
import { LayerfsMark } from '@/components/layerfs-mark'
import { Chip } from '@/components/storage/chips'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SANDBOX_CAPACITY, type SandboxRow, type WorkspaceRow } from '@/data/compute'
import { PROJECTS, type Session } from '@/data/sample'
import { cn } from '@/lib/utils'

const HOST = 'Needs the LayerFS host process'

const SESSIONS = new Map<string, Session>(PROJECTS.flatMap((p) => p.sessions.map((s) => [s.id, s] as const)))

// Sandbox rows and their Workspace rows share one column grid, so the
// Workspace details line up under the Sandbox they belong to.
const ROW = 'grid grid-cols-[1.25rem_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_5.5rem] items-center gap-x-3'

/** m:ss for the self-close countdown. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

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

function SessionCell({ id, onOpen }: { id?: string; onOpen: (id: string) => void }) {
  const session = id ? SESSIONS.get(id) : undefined
  if (!session) return <span className="truncate text-[13px] text-faint italic">Not a Connect session</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      className="flex min-w-0 items-center gap-2 rounded text-left text-[13px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', session.busy ? AGENT_DOT[session.agent] : 'bg-idle')}
      />
      <span className="truncate">{session.title}</span>
    </button>
  )
}

interface WorkspaceLineProps {
  ws: WorkspaceRow
  onOpenSession: (id: string) => void
  onUnmount: (ws: WorkspaceRow) => void
}

function WorkspaceLine({ ws, onOpenSession, onUnmount }: WorkspaceLineProps) {
  return (
    <div role="row" className={cn(ROW, 'border-t border-dashed py-2 pr-5 pl-5')}>
      <span />
      <span className="flex min-w-0 items-center gap-2 pl-5">
        <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
        <span className="truncate font-mono text-xs">{ws.path}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <GitBranch aria-hidden="true" className="size-3.5 shrink-0 text-faint" />
        <span className="truncate">{ws.branch}</span>
      </span>
      <SessionCell id={ws.session} onOpen={onOpenSession} />
      <span>
        {ws.activity === 'busy' ? (
          <Chip tone="info" live>
            {ws.doing ?? 'Busy'}
          </Chip>
        ) : (
          <span className="text-xs text-muted-foreground">Idle</span>
        )}
      </span>
      <span className={cn('text-xs tabular-nums', ws.changed > 0 ? 'text-warning' : 'text-faint')}>
        {ws.changed > 0 ? `${ws.changed} changed` : 'clean'}
      </span>
      <span className="flex justify-end gap-0.5">
        {ws.session && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open session" onClick={() => onOpenSession(ws.session!)}>
                <MessageSquare />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open session</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Unmount ${ws.path}`} onClick={() => onUnmount(ws)}>
              <LogOut />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Unmount</TooltipContent>
        </Tooltip>
      </span>
    </div>
  )
}

interface SandboxListProps {
  sandboxes: SandboxRow[]
  onOpenSession: (id: string) => void
  /** Dev aid: open the unmount question for the first changed Workspace. */
  unmountOnOpen?: boolean
}

/** Running Sandboxes by project; each opens to the Workspaces mounted in it. */
export function SandboxList({ sandboxes, onOpenSession, unmountOnOpen }: SandboxListProps) {
  // Sandboxes with a busy Workspace start open.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(sandboxes.filter((s) => s.workspaces.some((w) => w.activity === 'busy')).map((s) => s.name)),
  )
  const [unmounting, setUnmounting] = useState<{ sandbox: string; ws: WorkspaceRow } | null>(() => {
    if (!unmountOnOpen) return null
    for (const s of sandboxes) for (const ws of s.workspaces) if (ws.changed > 0) return { sandbox: s.name, ws }
    return null
  })
  // Seconds since the page opened, for idle Sandboxes' countdowns.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!sandboxes.some((s) => s.closesIn !== undefined)) return
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [sandboxes])

  const projects = [...new Set(sandboxes.map((s) => s.project))]
  const toggle = (name: string) =>
    setOpen((all) => {
      const next = new Set(all)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div role="table" aria-label="Sandboxes and their Workspaces">
      {projects.map((project) => (
        <div key={project} role="rowgroup" className="border-t first:border-t-0">
          <div className="flex items-center gap-2 px-5 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
            <LayerfsMark className="size-3.5" />
            {project}
          </div>
          {sandboxes
            .filter((s) => s.project === project)
            .map((s) => {
              const expanded = open.has(s.name)
              const left = s.closesIn !== undefined ? Math.max(s.closesIn - elapsed, 0) : undefined
              return (
                <div key={s.name} className={cn(expanded && 'bg-muted/30')}>
                  <div role="row" className={cn(ROW, 'border-t py-2.5 pr-5 pl-5')}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} Workspaces in ${s.name}`}
                      onClick={() => toggle(s.name)}
                      disabled={s.workspaces.length === 0}
                      className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                    >
                      <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
                    </button>
                    <span className="truncate font-mono text-[13px]">{s.name}</span>
                    <span>
                      {!s.running ? (
                        <Chip tone="neutral">Stopped</Chip>
                      ) : left !== undefined ? (
                        <Chip tone="neutral" icon={Timer}>
                          {left > 0 ? `Idle · closes in ${clock(left)}` : 'Closing…'}
                        </Chip>
                      ) : (
                        <Chip tone="success" live>
                          Running · {s.started}
                        </Chip>
                      )}
                    </span>
                    <Capacity used={s.workspaces.length} />
                    <span className="text-xs text-muted-foreground">
                      {s.workspaces.filter((w) => w.activity === 'busy').length > 0
                        ? `${s.workspaces.filter((w) => w.activity === 'busy').length} busy`
                        : ''}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{s.scratch}</span>
                    <span className="flex justify-end">
                      {s.running && (
                        <Unavailable reason={s.workspaces.length > 0 ? 'Unmount its Workspaces first' : HOST}>
                          <Button variant="ghost" size="sm" disabled>
                            <CircleStop /> Stop
                          </Button>
                        </Unavailable>
                      )}
                    </span>
                  </div>
                  {expanded &&
                    s.workspaces.map((ws) => (
                      <WorkspaceLine
                        key={ws.path}
                        ws={ws}
                        onOpenSession={onOpenSession}
                        onUnmount={(w) => setUnmounting({ sandbox: s.name, ws: w })}
                      />
                    ))}
                </div>
              )
            })}
        </div>
      ))}

      <Dialog open={unmounting !== null} onOpenChange={(next) => !next && setUnmounting(null)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unmount {unmounting?.ws.path}?</DialogTitle>
            <DialogDescription>
              {unmounting && unmounting.ws.changed > 0
                ? `${unmounting.ws.changed} changed paths on ${unmounting.ws.branch} aren't committed. Commit them first, or discard them.`
                : `Nothing is waiting to be committed on ${unmounting?.ws.branch}.`}
              {unmounting?.ws.activity === 'busy' && ` It's busy right now (${unmounting.ws.doing}).`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUnmounting(null)}>
              Cancel
            </Button>
            {unmounting && unmounting.ws.changed > 0 ? (
              <>
                <Unavailable reason={HOST}>
                  <Button variant="destructive" disabled>
                    Discard and unmount
                  </Button>
                </Unavailable>
                <Unavailable reason={HOST}>
                  <Button disabled>Commit and unmount</Button>
                </Unavailable>
              </>
            ) : (
              <Unavailable reason={HOST}>
                <Button disabled>Unmount</Button>
              </Unavailable>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
