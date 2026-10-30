import { Cpu, FolderClosed, FolderOpen, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { projectKey, projectRef, type ProjectSummary } from '@shared/host-api'

import { ConnectMark } from '@/components/connect-mark'
import { LanguageSwitcher } from '@/components/language-switcher'
import { LfsProject, LfsStore } from '@/components/lfs-icons'
import { useIndicator } from '@/components/motion/indicator'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProjectCatalog } from '@/host/use-projects'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

export type NavId = 'chat' | 'projects' | 'storage' | 'compute'
/** A page, or a project by its key (projectKey: `store/name` in a shared Store). */
export type Selection = { kind: 'nav'; id: NavId } | { kind: 'project'; id: string }

interface NavItem {
  id: NavId
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { id: 'chat', label: 'Chat', icon: Sparkles },
      { id: 'projects', label: 'Projects', icon: LfsProject },
    ],
  },
  {
    label: 'Resources',
    items: [
      { id: 'storage', label: 'Storage', icon: LfsStore },
      { id: 'compute', label: 'Compute', icon: Cpu },
    ],
  },
]

interface AppSidebarProps {
  selected: Selection
  projects: ProjectCatalog
  onSelect: (selection: Selection) => void
  onNewProject: () => void
  onDeleteProject: (project: ProjectSummary) => void
}

export function AppSidebar({ selected, projects, onSelect, onNewProject, onDeleteProject }: AppSidebarProps) {
  const { t } = useI18n()
  const { container, indicator } = useIndicator<HTMLDivElement>()
  const isMac = window.connect.platform === 'darwin'
  const activePage = selected.kind === 'nav' ? selected.id : undefined
  const items = projects.data ?? []

  return (
    <Sidebar collapsible="none" className="sidebar-glass relative z-10 h-svh shrink-0">
      <SidebarHeader className={cn('px-3 pb-3 app-drag', isMac ? 'pt-11' : 'pt-4')}>
        <div className="group/brand flex items-center gap-2.5 px-1.5 app-no-drag">
          <span className="glass-liquid relative flex size-9.5 shrink-0 items-center justify-center rounded-xl">
            <ConnectMark className="size-6 transition-transform duration-(--dur-slow) ease-out-expo group-hover/brand:scale-[1.05]" />
          </span>
          <span className="min-w-0 text-[15px] font-semibold leading-tight tracking-[-0.015em] text-foreground">LayerFS Connect</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden pb-3">
        <div ref={container} className="side-tree relative shrink-0">
          <span ref={indicator} aria-hidden="true" className="indicator glass-liquid rounded-xl shadow-xs border border-white/80 dark:border-white/15" />
          {groups.map((group) => (
            <SidebarGroup key={group.label} className="px-3 pt-3 pb-2">
              <SidebarGroupLabel className="px-3 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
                {t(group.label)}
              </SidebarGroupLabel>
              <SidebarMenu className="mt-1 gap-1">
                {group.items.map((item) => {
                  const active = activePage === item.id
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={active}
                        onClick={() => onSelect({ kind: 'nav', id: item.id })}
                        className={cn(
                          'h-10 gap-3 px-3 text-[14.5px] font-medium [&_svg]:size-[18px] [&_svg]:transition-colors [&_svg]:duration-(--dur-base)',
                          active
                            ? 'font-semibold text-foreground [&_svg]:text-primary'
                            : 'text-foreground/80 hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground',
                        )}
                      >
                        <item.icon />
                        <span>{t(item.label)}</span>
                      </SidebarMenuButton>
                      {item.id === 'projects' && (
                        <SidebarMenuAction type="button" aria-label={t('New project')} title={t('New project')} onClick={onNewProject} className="top-1.5 right-1.5 size-7 rounded-lg text-muted-foreground peer-data-[size=default]/menu-button:top-1.5 [&>svg]:size-3.5"><Plus /></SidebarMenuAction>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </div>
        <SidebarGroup aria-label={t('Your projects')} className="mt-3 min-h-0 flex-1 px-3 pt-0 pb-0">
          <div className="mx-3 mb-2 shrink-0 border-t border-foreground/[0.07]" />
          <div className="flex shrink-0 items-center gap-1 pr-1.5">
            <SidebarGroupLabel className="min-w-0 flex-1 gap-2 px-3 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
              {t('Your projects')}
              {items.length > 0 && <span className="text-[10px] font-medium tabular-nums tracking-normal">{items.length}</span>}
            </SidebarGroupLabel>
            <button type="button" aria-label={t('Refresh sidebar projects')} title={t('Refresh projects')} disabled={projects.loading} onClick={projects.reload} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              <RefreshCw className={cn('size-3', projects.loading && 'animate-spin')} />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain pt-1 pb-2">
            {projects.error && (
              <div role="status" className="mx-1 mb-2 rounded-xl bg-foreground/[0.03] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                {t('Could not load projects.')}
                <button type="button" onClick={projects.reload} className="ml-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('Retry')}</button>
              </div>
            )}
            {!projects.data && projects.loading ? (
              <div aria-label={t('Loading sidebar projects')} aria-busy="true" className="space-y-2 px-2">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 rounded-xl" />)}
              </div>
            ) : items.length > 0 ? (
              <SidebarMenu className="gap-1">
                {items.map((project) => {
                  const key = projectKey(project)
                  // a project in a shared Store also names its Store, faint after its name
                  const store = projectRef(key).store
                  const active = selected.kind === 'project' && selected.id === key
                  const Icon = active ? FolderOpen : FolderClosed
                  return (
                    <SidebarMenuItem key={key}>
                      <SidebarMenuButton
                        type="button"
                        isActive={active}
                        aria-current={active ? 'page' : undefined}
                        title={store ? t('{name} in Store {store}', { name: project.name, store }) : project.name}
                        onClick={() => onSelect({ kind: 'project', id: key })}
                        className={cn('h-10 gap-3 border px-3 text-[13px] group-has-data-[sidebar=menu-action]/menu-item:pr-10 [&_svg]:size-4', active
                          ? 'glass-liquid border-white/80 font-medium text-foreground shadow-xs dark:border-white/15 [&_svg]:text-primary'
                          : 'border-transparent text-foreground/80 hover:text-foreground [&_svg]:text-muted-foreground')}
                      >
                        <Icon />
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate">{project.name}</span>
                          {store && <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">{store}</span>}
                        </span>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        type="button"
                        aria-label={t('Delete project {name}', { name: store ? `${project.name} · ${store}` : project.name })}
                        title={t('Delete project')}
                        onClick={() => onDeleteProject(project)}
                        className="top-2 right-2 size-6 rounded-lg text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive peer-data-[size=default]/menu-button:top-2 [&>svg]:size-3.5"
                      >
                        <X />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            ) : !projects.error && (
              <div className="px-3 pt-2 pb-3 text-xs leading-relaxed text-muted-foreground">
                <p>{t('No projects yet.')}</p>
                <button type="button" onClick={onNewProject} className="mt-2 inline-flex items-center gap-1.5 rounded-md py-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus className="size-3" />{t('Create project')}</button>
              </div>
            )}
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-foreground/[0.06] px-3 py-2">
        <LanguageSwitcher />
      </SidebarFooter>
    </Sidebar>
  )
}
