import type { DemoSummary, RunSummary } from '@shared/host-api'
import { ChevronRight, Cpu, Database, Layers, LoaderCircle, type LucideIcon, RotateCcw, RotateCw, Unplug } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { AgentDot, RunDot } from '@/components/runs/run-badges'
import { agentColors, isLive } from '@/components/runs/run-format'
import { treeOrder } from '@/components/runs/thread'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { HostError, host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'

export type NavId = 'projects' | 'storage' | 'compute'

/**
 * What the sidebar has selected: a page, or one demo project, optionally on
 * an earlier replay (`run`) and one session (`agent`, the replay's root when
 * absent).
 */
export type Selection = { kind: 'nav'; id: NavId } | { kind: 'project'; id: string; run?: string; agent?: string }

interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  count?: number
}

interface AppSidebarProps {
  selected: Selection
  onSelect: (selection: Selection) => void
  /** Counts beside Storage and Compute, when known. */
  storageCount?: number
  computeCount?: number
}

export function AppSidebar({ selected, onSelect, storageCount, computeCount }: AppSidebarProps) {
  const demos = useHostQuery(() => host.demos(), [])
  const { runs, error: runsError, reload: reloadRuns } = useRuns()
  const ordered = useMemo(() => [...(demos.data ?? [])].sort((a, b) => a.order - b.order), [demos.data])

  const byDemo = useMemo(() => {
    const map = new Map<string, RunSummary[]>()
    for (const r of runs ?? []) map.set(r.demo, [...(map.get(r.demo) ?? []), r])
    return map
  }, [runs])

  // The selected demo is open.
  const selectedDemo = selected.kind === 'project' ? selected.id : undefined
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (selectedDemo) setOpen((s) => (s.has(selectedDemo) ? s : new Set(s).add(selectedDemo)))
  }, [selectedDemo])
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const { start, starting, error: refused } = useStartRun((run) => onSelect({ kind: 'project', id: run.demo }))

  const nav: NavItem[] = [
    { id: 'projects', label: 'Projects', icon: Layers, count: demos.data?.length },
    { id: 'storage', label: 'Storage', icon: Database, count: storageCount },
    { id: 'compute', label: 'Compute', icon: Cpu, count: computeCount },
  ]
  const unreachable = demos.error ?? (runsError && !runs ? runsError : undefined)

  return (
    <Sidebar collapsible="none" className="h-svh border-r border-sidebar-border">
      <SidebarHeader className="px-3 pt-5 pb-2">
        <div className="flex items-center gap-3 px-2">
          <LayerfsMark className="size-9 shrink-0" />
          <div className="leading-tight">
            <div className="text-[17px] font-semibold tracking-[-0.01em]">LayerFS Connect</div>
            <div className="text-[13px] text-faint">Demo replays on real LayerFS</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 pb-6">
        <SidebarGroup className="px-3 pt-3 pb-2">
          <SidebarMenu className="gap-1">
            {nav.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={selected.kind === 'nav' && selected.id === item.id}
                  onClick={() => onSelect({ kind: 'nav', id: item.id })}
                  className="h-10 gap-3 px-3 text-[15px] font-medium [&_svg]:size-[18px] [&_svg]:text-muted-foreground"
                >
                  <item.icon />
                  <span className="flex-1">{item.label}</span>
                  {item.count !== undefined && <span className="text-[13px] font-normal text-faint">{item.count}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="px-3 pt-4">
          <SidebarGroupLabel className="gap-2 px-3 text-[13px] font-normal text-faint">
            <LayerfsMark className="size-3.5" />
            Demo projects
          </SidebarGroupLabel>
          {unreachable ? (
            <HostNotice
              title={unreachable instanceof HostError && unreachable.status > 0 ? 'Demos unavailable' : 'Host unreachable'}
              message={unreachable.message}
              onRetry={() => {
                demos.reload()
                reloadRuns()
              }}
            />
          ) : (
            <SidebarMenu className="gap-0.5">
              {demos.loading && !demos.data
                ? Array.from({ length: 5 }, (_, i) => <SidebarMenuSkeleton key={i} className="h-9" />)
                : ordered.map((demo) => (
                    <DemoItem
                      key={demo.id}
                      demo={demo}
                      runs={byDemo.get(demo.id) ?? []}
                      open={open.has(demo.id)}
                      selected={selected}
                      starting={starting === demo.id}
                      refused={refused?.demo === demo.id ? refused.message : undefined}
                      onToggle={() => toggle(demo.id)}
                      onSelect={onSelect}
                      onStart={() => void start(demo.id)}
                    />
                  ))}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

function HostNotice({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="status" className="mx-1 flex flex-col gap-1.5 rounded-lg border border-dashed px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <Unplug aria-hidden="true" className="size-3.5 text-warning" />
        {title}
      </span>
      <span className="line-clamp-3 text-xs text-muted-foreground" title={message}>
        {message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="flex w-fit items-center gap-1 text-xs font-medium text-primary outline-none hover:underline focus-visible:underline"
      >
        <RotateCw aria-hidden="true" className="size-3" /> Retry
      </button>
    </div>
  )
}

interface DemoItemProps {
  demo: DemoSummary
  /** The demo's runs, newest first. */
  runs: RunSummary[]
  open: boolean
  selected: Selection
  starting: boolean
  refused?: string
  onToggle: () => void
  onSelect: (selection: Selection) => void
  onStart: () => void
}

interface Session {
  name: string
  parent: string | null
  state?: RunSummary['agents'][number]['state']
  done?: number
  of: number
}

/** The sessions of a project: its replay's agents, and the demo's agents that have not started. */
function sessionsOf(demo: DemoSummary, run: RunSummary | undefined): Session[] {
  const list: Session[] = (run?.agents ?? []).map((a) => ({ ...a }))
  const root = demo.agents.find((a) => a.prompt === null)?.name ?? 'root'
  for (const a of demo.agents)
    if (!list.some((x) => x.name === a.name)) list.push({ name: a.name, parent: a.prompt === null ? null : root, of: a.steps })
  return list
}

/** A demo project: its one LayerFS project, and under it the sessions (agents) of its replay. */
function DemoItem({ demo, runs, open, selected, starting, refused, onToggle, onSelect, onStart }: DemoItemProps) {
  // the replay the project holds: the newest on the demo's own project (else the newest at all)
  const run = runs.find((r) => r.project === demo.id) ?? runs[0]
  const live = run !== undefined && isLive(run.state)
  const sessions = sessionsOf(demo, run)
  const nodes = treeOrder(sessions, (a) => a.name, (a) => a.parent)
  const colorOf = agentColors([...demo.agents.map((a) => a.name), ...sessions.map((a) => a.name)])
  const root = sessions.find((a) => a.parent === null)?.name
  const here = selected.kind === 'project' && selected.id === demo.id && !selected.run
  const shownAgent = here ? (selected.agent ?? root) : undefined
  const working = sessions.filter((a) => a.state === 'running').length
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={here && !selected.agent}
        onClick={() => {
          onSelect({ kind: 'project', id: demo.id })
          if (!open) onToggle()
        }}
        className="h-9 gap-2 pl-8 text-[14px] font-medium"
      >
        <span className="min-w-0 flex-1 truncate">{demo.title}</span>
        {live ? (
          <span className="flex items-center gap-1.5 text-[12px] font-normal text-primary" title={`${working} session${working === 1 ? '' : 's'} working`}>
            <RunDot state={run.state} />
            {working || ''}
          </span>
        ) : run ? (
          <RunDot state={run.state} className="opacity-70" />
        ) : null}
      </SidebarMenuButton>
      <SidebarMenuAction
        onClick={onToggle}
        aria-label={open ? `Hide ${demo.title}'s sessions` : `Show ${demo.title}'s sessions`}
        aria-expanded={open}
        className="top-2 right-auto left-2 text-faint"
      >
        <ChevronRight className={cn('size-3.5! transition-transform', open && 'rotate-90')} />
      </SidebarMenuAction>
      <SidebarMenuAction
        showOnHover
        onClick={onStart}
        disabled={starting || live}
        aria-label={`Replay ${demo.title}`}
        title={live ? 'Replaying now' : 'Reset the project and replay'}
        className="top-2"
      >
        {starting ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
      </SidebarMenuAction>

      {open && (
        <SidebarMenuSub className="mr-0 ml-[18px] gap-0.5 pr-0">
          {refused && (
            <li role="alert" className="px-2 py-1 text-xs text-destructive">
              {refused}
            </li>
          )}
          {nodes.map(({ item: a, depth }) => (
            <SidebarMenuSubItem key={a.name}>
              <SidebarMenuSubButton asChild isActive={shownAgent === a.name && selected.kind === 'project' && !!selected.agent} className="h-8 text-[13px]">
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'project', id: demo.id, agent: a.name })}
                  className={cn('w-full', !a.state && 'text-muted-foreground')}
                  style={{ paddingLeft: 8 + Math.min(depth, 3) * 12 }}
                >
                  <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', colorOf(a.name).dot, !a.state && 'opacity-50')} />
                  <span className="min-w-0 flex-1 truncate text-left">{a.name}</span>
                  {a.state && a.state !== 'done' && <AgentDot state={a.state} />}
                  <span className="text-[11px] text-faint tabular-nums">{a.done !== undefined ? `${a.done}/${a.of}` : a.of}</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          {!run && !refused && <li className="px-2 py-1 text-xs text-faint">Not replayed yet</li>}
          <SidebarMenuSubItem>
            <SidebarMenuSubButton asChild className="h-7 text-xs text-muted-foreground">
              <button type="button" onClick={onStart} disabled={starting || live} className="w-full">
                <RotateCcw className="size-3.5! text-muted-foreground!" />
                <span>{starting ? 'Starting…' : live ? 'Replaying…' : run ? 'Replay' : 'Replay (Init the project)'}</span>
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}
