import { SlidersHorizontal, Bot, Wrench, Workflow, ArrowLeft, Cpu, CircleHelp, Database, FlaskConical, type LucideIcon, Server, Settings, SquarePen } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChatList } from '@/components/chat/ChatList'
import { Avatar } from '@/components/ui/avatar'
import { Tip } from '@/components/ui/tooltip'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { EXAMPLE_CHAT_PATH } from '@/layerfs/chat-sim'
import layerfsLogo from '@/assets/layerfs-logo.png'

// Cindy's sidebar row: 32px pill, 14px, ink-88 text.
const ROW =
  'flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-14 leading-5 font-normal text-[var(--sidebar-nav-text)] transition-colors hover:bg-sidebar-item-hover'
const ROW_ACTIVE = 'sidebar-row-active font-medium hover:bg-sidebar-item-active'

export function Sidebar({ width, open, dragging, onResizeStart }: {
  width: number
  open: boolean
  dragging: boolean
  onResizeStart: (e: React.PointerEvent) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const settings = location.pathname === '/settings' || location.pathname.startsWith('/settings/')
  const previous = useRef('/')
  useEffect(() => {
    if (!settings) previous.current = location.pathname + location.search + location.hash
  }, [location, settings])
  function toggleSettings() {
    navigate(settings ? previous.current : '/settings/models')
  }
  return (
    <aside aria-label={settings ? 'Settings sidebar' : 'Workspace sidebar'}
      style={{ width: open ? width : 0 }}
      className={cn(
        'app-sidebar relative flex shrink-0 flex-col overflow-hidden bg-sidebar',
        open && 'border-r border-sidebar-border',
        !dragging && 'transition-[width] duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ width }}>
        {/* Back is on the left; reserve the right edge for the floating sidebar toggle. */}
        <div className="drag flex h-[46px] w-full shrink-0 items-center" style={{ paddingLeft: macChrome ? TRAFFIC_LIGHTS_PX : 8, paddingRight: CHROME_CLUSTER_PX + 16 }}>
          {settings && <button type="button" onClick={toggleSettings} title="Back to workspace" aria-label="Back to workspace" className="no-drag flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2 text-12 text-[var(--text-secondary)] outline-none hover:bg-sidebar-item-hover focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="size-3.5 shrink-0" /><span className="truncate">Back to workspace</span>
          </button>}
          {!settings && <div className="flex min-w-0 items-center gap-2" title="LayerFS Connect" aria-label="LayerFS Connect">
            <img src={layerfsLogo} alt="" aria-hidden="true" draggable={false} className="size-5 shrink-0 object-contain" />
            <span className="truncate text-13 font-medium tracking-tight text-[var(--text-primary)]">LayerFS Connect</span>
          </div>}
        </div>
        {settings ? <div className="flex min-h-0 flex-1 flex-col">
          <h2 className="px-6 pb-3 pt-3 text-12 font-medium text-[var(--text-tertiary)]">Settings</h2>
          <nav aria-label="Settings" className="space-y-0.5 px-3">
            <NavRow to="/settings/models" icon={Cpu} label="Models" />
            <NavRow to="/settings/configurations" icon={SlidersHorizontal} label="Configurations" />
            <NavRow to="/settings/tools" icon={Wrench} label="Tools" />
            <NavRow to="/settings/agents" icon={Bot} label="Agents" />
            <NavRow to="/settings/hooks" icon={Workflow} label="Hooks" />
          </nav>
        </div> : <>
          <div className="shrink-0 px-3 pb-2 pt-1"><NewChatButton /></div>
          <nav aria-label="Pages" className="flex shrink-0 flex-col gap-0.5 px-3">
            <NavRow to={EXAMPLE_CHAT_PATH} icon={FlaskConical} label="Example chat" />
            <NavRow to="/machines" icon={Server} label="Machines" />
            <NavRow to="/storage" icon={Database} label="Storage" />
          </nav>
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 pb-4"><ChatList /></div>
        </>}
        <UserCard settings={settings} onToggleSettings={toggleSettings} />
      </div>
      {open && (
        <div
          onPointerDown={onResizeStart}
          className="no-drag group/handle absolute right-0 top-0 z-10 h-full w-[4px] cursor-col-resize"
        >
          <div className="absolute right-0 top-0 h-full w-px bg-transparent transition-colors group-hover/handle:bg-sidebar-action-icon" />
        </div>
      )}
    </aside>
  )
}

function NavRow({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => cn(ROW, isActive && ROW_ACTIVE)}>
      <Icon size={15} strokeWidth={1.8} />
      <span className="leading-none">{label}</span>
    </NavLink>
  )
}

/** The top of the sidebar: a white card that opens the new-chat page (the app's start page). */
function NewChatButton() {
  return (
    <NavLink
      to="/"
      end
      className="flex h-9 w-full items-center gap-2.5 rounded-full border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)] px-3 text-14 font-medium leading-5 text-[var(--text-primary)] transition-colors hover:bg-[var(--sidebar-user-card-bg-hover)]"
    >
      <SquarePen size={15} strokeWidth={1.8} />
      <span className="leading-none">New chat</span>
    </NavLink>
  )
}

function UserCard({ settings, onToggleSettings }: { settings: boolean; onToggleSettings: () => void }) {
  const round =
    'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)] text-[var(--text-secondary)] hover:bg-sidebar-item-hover'
  return (
    <div className="mt-auto px-3 pb-3 pt-2">
      <div className="flex h-10 items-center rounded-full border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)] px-[7px] transition-colors hover:bg-[var(--sidebar-user-card-bg-hover)]">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-[10px] text-left">
          <Avatar initials="YX" tint="#5A6B7D" size="user" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-14 font-semibold leading-[1.286] text-[var(--text-primary)]">Ephemeral-AI</span>
            <span className="flex min-w-0 items-center gap-1 text-10 leading-[1.3] text-[var(--text-secondary)]">Simulated · 0.0.0</span>
          </span>
        </button>
        <Tip label={settings ? 'Back to workspace' : 'Settings'} side="top">
          <button type="button" aria-label="Settings" aria-pressed={settings} className={cn(round, 'mr-1', settings && 'bg-sidebar-item-active text-[var(--text-primary)]')} onClick={onToggleSettings}>
            <Settings className="h-3 w-3" />
          </button>
        </Tip>
        <Tip label="Help" side="top">
          <button type="button" aria-label="Help" className={round}>
            <CircleHelp className="h-3 w-3" />
          </button>
        </Tip>
      </div>
    </div>
  )
}
