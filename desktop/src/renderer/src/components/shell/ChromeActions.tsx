import { ArrowLeft, ArrowRight, Menu, PanelLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { IconButton } from '@/components/ui/icon-button'
import { macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { useLayout } from './layout-context'

/** The four title-row buttons beside the traffic lights; they float above sidebar and header. */
export function ChromeActions() {
  const navigate = useNavigate()
  const { sidebarOpen, toggleSidebar } = useLayout()
  return (
    <div
      className="no-drag absolute top-0 z-20 flex h-[46px] items-center gap-1"
      style={{ left: macChrome ? TRAFFIC_LIGHTS_PX : 8 }}
    >
      <IconButton icon={PanelLeft} label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} onClick={toggleSidebar} />
      <IconButton icon={Menu} label="Menu" />
      <IconButton icon={ArrowLeft} label="Back" onClick={() => navigate(-1)} />
      <IconButton icon={ArrowRight} label="Forward" onClick={() => navigate(1)} />
    </div>
  )
}
