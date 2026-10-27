import type { DemoSummary, RunSummary } from '@shared/host-api'
import { ChevronRight, Cpu, Database, Layers, LoaderCircle, type LucideIcon, Plus, RotateCw, Unplug } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { RunDot } from '@/components/runs/run-badges'
import { ago, isLive, runLabel } from '@/components/runs/run-format'
import { useNow } from '@/components/runs/use-run'
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

/** What the sidebar has selected: a page, one demo project, or one run (a session of it). */
export type Selection = { kind: 'nav'; id: NavId } | { kind: 'project'; id: string } | { kind: 'run'; id: string }

interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  count?: number
}

/** Runs shown under a demo before "All runs". */
const SHOWN_RUNS = 6

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

  // The selected demo (or the selected run's demo) is open.
  const selectedDemo =
    selected.kind === 'project' ? selected.id : selected.kind === 'run' ? runs?.find((r) => r.id === selected.id)?.demo : undefined
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

  const { start, starting, error: refused } = useStartRun((run) => onSelect({ kind: 'run', id: run.id }))
  const anyLive = runs?.some((r) => isLive(r.state)) ?? false
  const now = useNow(true, anyLive ? 15_000 : 60_000)

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
            <div className="text-[13px] text-faint">Demo runs on real LayerFS</div>
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
                      now={now}
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
  runs: RunSummary[]
  now: number
  open: boolean
  selected: Selection
  starting: boolean
  refused?: string
  onToggle: () => void
  onSelect: (selection: Selection) => void
  onStart: () => void
}

function DemoItem({ demo, runs, now, open, selected, starting, refused, onToggle, onSelect, onStart }: DemoItemProps) {
  const playing = runs.filter((r) => isLive(r.state)).length
  const shown = runs.slice(0, SHOWN_RUNS)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={selected.kind === 'project' && selected.id === demo.id}
        onClick={() => {
          onSelect({ kind: 'project', id: demo.id })
          if (!open) onToggle()
        }}
        className="h-9 gap-2 pl-8 text-[14px] font-medium"
      >
        <span className="min-w-0 flex-1 truncate">{demo.title}</span>
        {playing > 0 ? (
          <span className="flex items-center gap-1.5 text-[12px] font-normal text-primary">
            <RunDot state="running" />
            {playing}
          </span>
        ) : (
          <span className="text-[12px] font-normal text-faint tabular-nums">{runs.length || ''}</span>
        )}
      </SidebarMenuButton>
      <SidebarMenuAction
        onClick={onToggle}
        aria-label={open ? `Hide ${demo.title}'s runs` : `Show ${demo.title}'s runs`}
        aria-expanded={open}
        className="top-2 right-auto left-2 text-faint"
      >
        <ChevronRight className={cn('size-3.5! transition-transform', open && 'rotate-90')} />
      </SidebarMenuAction>
      <SidebarMenuAction showOnHover onClick={onStart} disabled={starting} aria-label={`New run of ${demo.title}`} title="New run" className="top-2">
        {starting ? <LoaderCircle className="animate-spin" /> : <Plus />}
      </SidebarMenuAction>

      {open && (
        <SidebarMenuSub className="mr-0 ml-[18px] gap-0.5 pr-0">
          {refused && (
            <li role="alert" className="px-2 py-1 text-xs text-destructive">
              {refused}
            </li>
          )}
          {runs.length === 0 && !refused && <li className="px-2 py-1 text-xs text-faint">No runs yet</li>}
          {shown.map((run) => (
            <SidebarMenuSubItem key={run.id}>
              <SidebarMenuSubButton asChild isActive={selected.kind === 'run' && selected.id === run.id} className="h-8 text-[13px]">
                <button type="button" onClick={() => onSelect({ kind: 'run', id: run.id })} className="w-full">
                  <RunDot state={run.state} />
                  <span className="flex-1 text-left">{runLabel(run)}</span>
                  <span className="text-[11px] text-faint tabular-nums">{isLive(run.state) ? `${run.done}/${run.of}` : ago(run.ended ?? run.started, now)}</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          {runs.length > SHOWN_RUNS && (
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild className="h-7 text-xs text-muted-foreground">
                <button type="button" onClick={() => onSelect({ kind: 'project', id: demo.id })} className="w-full">
                  All {runs.length} runs
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
          <SidebarMenuSubItem>
            <SidebarMenuSubButton asChild className="h-7 text-xs text-muted-foreground">
              <button type="button" onClick={onStart} disabled={starting} className="w-full">
                <Plus className="size-3.5! text-muted-foreground!" />
                <span>{starting ? 'Starting…' : 'New run'}</span>
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}
