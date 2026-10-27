import type { DemoSummary, RunSummary } from '@shared/host-api'
import { Cpu, Folder, FolderOpen, LoaderCircle, Plus, RotateCw, Unplug } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { LfsProject, LfsStore } from '@/components/lfs-icons'
import { RunDot } from '@/components/runs/run-badges'
import { ago, isLive, runLabel } from '@/components/runs/run-format'
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

        {/* each demo is a project folder of its own, beside the pages */}
        <SidebarGroup className="mt-1 border-t border-sidebar-border px-3 pt-3">
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

/** Sessions a folder lists before "Show all". */
const SHOWN = 6

/** A project folder: its LayerFS project, and under it its sessions, one per replay. */
function DemoItem({ demo, runs, open, selected, starting, refused, onToggle, onSelect, onStart }: DemoItemProps) {
  const [all, setAll] = useState(false)
  const live = runs.find((r) => isLive(r.state))
  const newest = runs[0]
  const here = selected.kind === 'project' && selected.id === demo.id
  const shown = all ? runs : runs.slice(0, SHOWN)
  return (
    <SidebarMenuItem>
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
          <span className="flex items-center gap-1.5 text-[12px] font-normal text-primary" title="A session is playing">
            <RunDot state={live.state} />
          </span>
        ) : newest ? (
          <RunDot state={newest.state} className="opacity-70" />
        ) : null}
      </SidebarMenuButton>
      <SidebarMenuAction
        onClick={onToggle}
        aria-label={open ? `Hide ${demo.title}'s sessions` : `Show ${demo.title}'s sessions`}
        aria-expanded={open}
        className="top-2 right-auto left-2.5 text-muted-foreground"
      >
        {open ? <FolderOpen className="size-4!" /> : <Folder className="size-4!" />}
      </SidebarMenuAction>

      {open && (
        <SidebarMenuSub className="mr-0 ml-[19px] gap-0.5 pr-0">
          {refused && (
            <li role="alert" className="px-2 py-1 text-xs text-destructive">
              {refused}
            </li>
          )}
          {shown.map((r) => (
            <SidebarMenuSubItem key={r.id}>
              <SidebarMenuSubButton asChild isActive={here && selected.run === r.id} className="h-8 text-[13px]">
                <button type="button" onClick={() => onSelect({ kind: 'project', id: demo.id, run: r.id })} className="w-full">
                  <RunDot state={r.state} />
                  <span className="min-w-0 flex-1 truncate text-left">{runLabel(r)}</span>
                  <span className="text-[11px] text-faint tabular-nums">{isLive(r.state) ? 'live' : ago(r.ended ?? r.started)}</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
          {runs.length > SHOWN && (
            <li>
              <button type="button" onClick={() => setAll(!all)} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                {all ? 'Show fewer' : `Show all ${runs.length}`}
              </button>
            </li>
          )}
          <SidebarMenuSubItem>
            <SidebarMenuSubButton asChild className="h-7 text-xs text-muted-foreground">
              <button type="button" onClick={onStart} disabled={starting || !!live} className="w-full" title={live ? 'A session is playing' : 'Reset the project and play the scenario as a new session'}>
                {starting ? <LoaderCircle className="size-3.5! animate-spin" /> : <Plus className="size-3.5! text-muted-foreground!" />}
                <span>{starting ? 'Starting…' : 'New session'}</span>
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}
