import type { DemoSummary, RunSummary } from '@shared/host-api'
import { ChevronRight, Cpu, Folder, FolderOpen, LoaderCircle, Plus, RotateCw, Unplug } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'

import { ConnectMark } from '@/components/connect-mark'
import { LfsProject, LfsStore } from '@/components/lfs-icons'
import { Collapse } from '@/components/motion/collapse'
import { useIndicator } from '@/components/motion/indicator'
import { revealStyle } from '@/components/motion/reveal'
import { RunDot } from '@/components/runs/run-badges'
import { agentColors, ago, isLive, runLabel } from '@/components/runs/run-format'
import { useRuns, useStartRun } from '@/components/runs/use-runs'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
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
 * What the sidebar has selected: a page, or one demo project, optionally one
 * of its sessions (`run`, one replay) and an agent of it (`agent`, its root when
 * absent).
 */
export type Selection = { kind: 'nav'; id: NavId } | { kind: 'project'; id: string; run?: string; agent?: string }

interface NavItem {
  id: NavId
  label: string
  icon: React.ComponentType<{ className?: string }>
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
    { id: 'projects', label: 'Projects', icon: LfsProject, count: demos.data?.length },
    { id: 'storage', label: 'Storage', icon: LfsStore, count: storageCount },
    { id: 'compute', label: 'Compute', icon: Cpu, count: computeCount },
  ]
  const unreachable = demos.error ?? (runsError && !runs ? runsError : undefined)

  // One highlight for the whole tree, gliding to whichever row is active.
  const { container, indicator } = useIndicator<HTMLDivElement>()

  return (
    <Sidebar collapsible="none" className="h-svh border-r border-sidebar-border">
      <SidebarHeader className="px-3 pt-5 pb-2">
        <div className="group/brand flex items-center gap-2.5 px-1.5">
          <span className="relative flex size-10 shrink-0 items-center justify-center">
            <span aria-hidden="true" className="absolute inset-1 rounded-full bg-brand opacity-25 blur-lg transition-opacity duration-(--dur-slow) group-hover/brand:opacity-45 dark:opacity-30" />
            <span className="surface relative flex size-10 items-center justify-center rounded-xl">
              <ConnectMark className="size-7 transition-transform duration-(--dur-slow) ease-out-expo group-hover/brand:scale-[1.06] group-hover/brand:-rotate-3" />
            </span>
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[16px] font-semibold tracking-[-0.015em]">LayerFS Connect</div>
            <div className="text-[12px] text-faint">Demo replays on real LayerFS</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 pb-6">
        <div ref={container} className="side-tree relative">
          <span
            ref={indicator}
            aria-hidden="true"
            className="indicator rounded-md bg-sidebar-accent shadow-[var(--highlight),var(--elev-1)] ring-1 ring-foreground/[0.05] before:absolute before:inset-y-2 before:-left-px before:w-[3px] before:rounded-full before:bg-brand before:shadow-[0_0_8px_0_var(--glow-strong)] dark:ring-white/[0.04]"
          />
          <SidebarGroup className="px-3 pt-3 pb-2">
            <SidebarMenu className="gap-1">
              {nav.map((item) => {
                const active = selected.kind === 'nav' && selected.id === item.id
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active}
                      onClick={() => onSelect({ kind: 'nav', id: item.id })}
                      className={cn(
                        'h-10 gap-3 px-3 text-[15px] font-medium [&_svg]:size-[18px] [&_svg]:transition-colors [&_svg]:duration-(--dur-base)',
                        active ? '[&_svg]:text-primary' : '[&_svg]:text-muted-foreground',
                      )}
                    >
                      <item.icon />
                      <span className="flex-1">{item.label}</span>
                      {item.count !== undefined && (
                        <span
                          className={cn(
                            'min-w-6 rounded-full px-1.5 text-center text-[11.5px] leading-5 font-medium tabular-nums ring-1 ring-inset transition-colors duration-(--dur-base) animate-in fade-in',
                            active ? 'bg-primary/10 text-primary ring-primary/20' : 'bg-foreground/[0.04] text-faint ring-foreground/[0.05]',
                          )}
                        >
                          {item.count}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>

          {/* each demo is a project folder of its own, beside the pages */}
          <SidebarGroup className="mt-1 px-3 pt-3 before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-sidebar-border before:to-transparent">
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
                  : ordered.map((demo, i) => (
                      <DemoItem
                        key={demo.id}
                        index={i}
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
        </div>
      </SidebarContent>
    </Sidebar>
  )
}

function HostNotice({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="status" className="reveal mx-1 flex flex-col gap-1.5 rounded-lg border border-dashed border-warning/30 bg-warning/[0.04] px-3 py-2.5">
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
  /** Its place in the list, for the entrance stagger. */
  index: number
  demo: DemoSummary
  /** The demo's runs (its sessions), newest first. */
  runs: RunSummary[]
  open: boolean
  selected: Selection
  starting: boolean
  refused?: string
  onToggle: () => void
  onSelect: (selection: Selection) => void
  onStart: () => void
}

/** A CSS colour from an agent's dot class: "bg-agent-builder" → var(--agent-builder), "bg-(--lane-3)" → var(--lane-3). */
const cssColor = (dot: string) => {
  const v = dot.match(/^bg-\((--[\w-]+)\)$/)
  return v ? `var(${v[1]})` : `var(--${dot.slice(3)})`
}

/** A playing session's row breathes in its first running agent's colour. */
function pulseOf(run: RunSummary): CSSProperties | undefined {
  const colorOf = agentColors(run.agents.map((a) => a.name))
  const first = run.agents.find((a) => a.state === 'running')
  return first ? ({ '--pulse': cssColor(colorOf(first.name).dot) } as CSSProperties) : undefined
}

/** A playing session's running agents, a pulsing dot each in its colour (at most three). */
function RunningAgents({ run }: { run: RunSummary }) {
  const colorOf = agentColors(run.agents.map((a) => a.name))
  const running = run.agents.filter((a) => a.state === 'running')
  if (!running.length) return <RunDot state={run.state} />
  return (
    <span role="img" aria-label={`${running.length} running`} title={running.map((a) => a.name).join(', ')} className="flex shrink-0 items-center gap-[3px]">
      {running.slice(0, 3).map((a) => {
        const c = colorOf(a.name)
        return <span key={a.name} className={cn('pulse-ring size-1.5 rounded-full', c.dot, c.text)} />
      })}
    </span>
  )
}

/** Sessions a folder lists before "Show all". */
const SHOWN = 6

/** A project folder: its LayerFS project, and under it its sessions, one per replay. A folder with a playing session glows. */
function DemoItem({ index, demo, runs, open, selected, starting, refused, onToggle, onSelect, onStart }: DemoItemProps) {
  const [all, setAll] = useState(false)
  const live = runs.find((r) => isLive(r.state))
  const newest = runs[0]
  const here = selected.kind === 'project' && selected.id === demo.id
  const shown = all ? runs : runs.slice(0, SHOWN)
  const FolderIcon = open ? FolderOpen : Folder
  return (
    <SidebarMenuItem className="side-in" style={revealStyle(index)}>
      <SidebarMenuButton
        isActive={here && !selected.run}
        onClick={() => {
          onSelect({ kind: 'project', id: demo.id })
          if (!open) onToggle()
        }}
        className="h-9 gap-2 pl-10 text-[14px] font-medium"
      >
        <span className="min-w-0 flex-1 truncate">{demo.title}</span>
        {live ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary" title="A session is playing">
            <span className="text-brand">live</span>
            <RunDot state={live.state} />
          </span>
        ) : newest ? (
          <RunDot state={newest.state} className="opacity-60" />
        ) : null}
      </SidebarMenuButton>
      <SidebarMenuAction
        onClick={onToggle}
        aria-label={open ? `Hide ${demo.title}'s sessions` : `Show ${demo.title}'s sessions`}
        aria-expanded={open}
        className="group/folder top-2 right-auto left-2.5 text-muted-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          className="chevron absolute -left-2 size-3! text-faint opacity-0 transition-[opacity,transform] group-hover/menu-item:opacity-100 group-focus-visible/folder:opacity-100"
        />
        <FolderIcon key={open ? 'open' : 'shut'} className={cn('size-4! animate-in zoom-in-75 duration-200', live && 'text-primary')} />
      </SidebarMenuAction>

      <Collapse open={open} appear={false}>
        <SidebarMenuSub className="mr-0 ml-[19px] gap-0.5 pt-0.5 pr-0">
          {refused && (
            <li role="alert" className="px-2 py-1 text-xs text-destructive animate-in fade-in slide-in-from-top-1">
              {refused}
            </li>
          )}
          {shown.map((r, i) => {
            const playing = isLive(r.state)
            return (
              <SidebarMenuSubItem key={r.id} className="side-in" style={revealStyle(i)}>
                <SidebarMenuSubButton
                  asChild
                  isActive={here && selected.run === r.id}
                  className={cn('h-8 text-[13px]', playing && 'side-live text-foreground')}
                  style={playing ? pulseOf(r) : undefined}
                >
                  <button type="button" onClick={() => onSelect({ kind: 'project', id: demo.id, run: r.id })} className="w-full">
                    {playing ? <RunningAgents run={r} /> : <RunDot state={r.state} />}
                    <span className="min-w-0 flex-1 truncate text-left">{runLabel(r)}</span>
                    <span className={cn('text-[11px] tabular-nums', playing ? 'font-medium text-primary' : 'text-faint')}>
                      {playing ? (r.of ? `${Math.round((100 * r.done) / r.of)}%` : 'live') : ago(r.ended ?? r.started)}
                    </span>
                    {playing && <span aria-hidden="true" className="side-progress" style={{ '--p': r.of ? r.done / r.of : 0 } as CSSProperties} />}
                  </button>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )
          })}
          {runs.length > SHOWN && (
            <li>
              <button
                type="button"
                onClick={() => setAll(!all)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                {all ? 'Show fewer' : 'Show all'}
                {!all && <span className="rounded-full bg-foreground/[0.05] px-1.5 text-[11px] leading-4 text-faint tabular-nums">{runs.length}</span>}
              </button>
            </li>
          )}
          <SidebarMenuSubItem className="side-in" style={revealStyle(shown.length + 1)}>
            <SidebarMenuSubButton asChild className="mt-0.5 h-7 text-xs text-muted-foreground hover:text-foreground">
              <button
                type="button"
                onClick={onStart}
                disabled={starting || !!live}
                className="group/new w-full"
                title={live ? 'A session is playing' : 'Reset the project and play the scenario as a new session'}
              >
                <span
                  aria-hidden="true"
                  className="flex size-4 shrink-0 items-center justify-center rounded-full border border-dashed border-foreground/20 transition-[border-color,background-color,box-shadow] duration-(--dur-base) group-hover/new:border-solid group-hover/new:border-primary/50 group-hover/new:bg-primary/10 group-hover/new:shadow-[0_0_10px_-2px_var(--glow)]"
                >
                  {starting ? (
                    <LoaderCircle className="size-3! animate-spin text-primary!" />
                  ) : (
                    <Plus className="size-3! text-muted-foreground! transition-transform duration-(--dur-base) ease-out-expo group-hover/new:rotate-90 group-hover/new:text-primary!" />
                  )}
                </span>
                <span>{starting ? 'Starting…' : 'New session'}</span>
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      </Collapse>
    </SidebarMenuItem>
  )
}
