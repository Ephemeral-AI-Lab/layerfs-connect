import { PanelLeft } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { useLayout } from './layout-context'

/** The toggle sits at the sidebar's right edge; when folded it stays accessible. */
export function ChromeActions({ sidebarWidth, dragging }: { sidebarWidth: number; dragging: boolean }) {
  const { sidebarOpen, toggleSidebar } = useLayout()
  return (
    <div
      className="no-drag absolute top-0 z-20 flex h-[46px] items-center gap-1"
      style={{ left: sidebarOpen ? sidebarWidth - CHROME_CLUSTER_PX - 12 : macChrome ? TRAFFIC_LIGHTS_PX : 8, transition: dragging ? undefined : 'left 250ms cubic-bezier(0.4,0,0.2,1)' }}
    >
      <IconButton icon={PanelLeft} label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} onClick={toggleSidebar} />
    </div>
  )
}
