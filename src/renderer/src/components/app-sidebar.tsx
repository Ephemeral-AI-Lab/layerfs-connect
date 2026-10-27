import { Blocks, Cpu, Database, Layers, type LucideIcon, MessageSquare, Plus } from 'lucide-react'

import { LayerfsMark } from '@/components/layerfs-mark'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { type Agent, PROJECTS } from '@/data/sample'
import { cn } from '@/lib/utils'

export type NavId = 'sessions' | 'extensions' | 'projects' | 'storage' | 'compute'

/** What the sidebar has selected: a page, one project, or one session. */
export type Selection = { kind: 'nav'; id: NavId } | { kind: 'project'; id: string } | { kind: 'session'; id: string }

interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  count?: number
}

const APP_NAV: NavItem[] = [
  { id: 'sessions', label: 'Sessions', icon: MessageSquare },
  { id: 'extensions', label: 'Extensions', icon: Blocks },
]

const layerfsNav = (storageCount: number, computeCount: number): NavItem[] => [
  { id: 'projects', label: 'Projects', icon: Layers, count: PROJECTS.length },
  { id: 'storage', label: 'Storage', icon: Database, count: storageCount },
  { id: 'compute', label: 'Compute', icon: Cpu, count: computeCount },
]

// Literal class names, so Tailwind sees them.
export const AGENT_DOT: Record<Agent, string> = {
  builder: 'bg-agent-builder',
  reviewer: 'bg-agent-reviewer',
  tester: 'bg-agent-tester',
  docs: 'bg-agent-docs',
}

interface AppSidebarProps {
  selected: Selection
  onSelect: (selection: Selection) => void
  storageCount: number
  /** Compute targets turned on. */
  computeCount: number
}

export function AppSidebar({ selected, onSelect, storageCount, computeCount }: AppSidebarProps) {
  const navItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.id}>
        <SidebarMenuButton
          isActive={(selected.kind === 'nav' && selected.id === item.id) || (selected.kind === 'project' && item.id === 'projects')}
          onClick={() => onSelect({ kind: 'nav', id: item.id })}
          className="h-10 gap-3 px-3 text-[15px] font-medium [&_svg]:size-[18px] [&_svg]:text-muted-foreground"
        >
          <item.icon />
          <span className="flex-1">{item.label}</span>
          {item.count !== undefined && (
            <span className="text-[13px] font-normal text-faint">{item.count}</span>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    ))

  return (
    <Sidebar collapsible="none" className="h-svh border-r border-sidebar-border">
      <SidebarHeader className="gap-5 px-3 pt-5 pb-2">
        <div className="flex items-center gap-3 px-2">
          <LayerfsMark className="size-9 shrink-0" />
          <div className="leading-tight">
            <div className="text-[17px] font-semibold tracking-[-0.01em]">LayerFS Connect</div>
            <div className="text-[13px] text-faint">built on pi</div>
          </div>
        </div>
        <Button variant="outline" className="h-11 w-full gap-2.5 rounded-xl bg-card text-[15px] font-medium shadow-none">
          <Plus className="size-[18px]" />
          New session
        </Button>
      </SidebarHeader>

      <SidebarContent className="gap-0 pb-6">
        <SidebarGroup className="px-3 py-2">
          <SidebarMenu className="gap-1">{navItems(APP_NAV)}</SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="px-3 pt-4 pb-2">
          <SidebarGroupLabel className="gap-2 px-3 text-[13px] font-normal text-faint">
            <LayerfsMark className="size-3.5" />
            LayerFS
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1">{navItems(layerfsNav(storageCount, computeCount))}</SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="px-3 pt-4">
          <SidebarGroupLabel className="px-3 text-[13px] font-normal text-faint">
            Sessions by project
          </SidebarGroupLabel>
          <SidebarMenu>
            {PROJECTS.map((project) => (
              <SidebarMenuItem key={project.key} className="pt-2">
                <SidebarMenuButton
                  isActive={selected.kind === 'project' && selected.id === project.key}
                  onClick={() => onSelect({ kind: 'project', id: project.key })}
                  className="h-9 gap-3 px-3 text-[15px] font-medium"
                >
                  <LayerfsMark className="size-4 shrink-0" />
                  <span className="truncate">{project.key}</span>
                </SidebarMenuButton>
                <SidebarMenu>
                  {project.sessions.map((session) => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={selected.kind === 'session' && selected.id === session.id}
                        onClick={() => onSelect({ kind: 'session', id: session.id })}
                        className="h-8 gap-3 pl-[34px] text-[14px] text-sidebar-foreground/85"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            session.busy ? AGENT_DOT[session.agent] : 'bg-idle',
                          )}
                        />
                        <span>{session.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
