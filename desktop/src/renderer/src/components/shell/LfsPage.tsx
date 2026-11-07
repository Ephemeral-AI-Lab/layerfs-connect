import type { CSSProperties, ReactNode } from 'react'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { useLayout } from './layout-context'

/**
 * The frame for a ported LayerFS page. The page's own header sits in the top
 * row and is the window's drag area; with the sidebar hidden it starts after
 * the traffic lights and chrome buttons (--chrome-lead, styles/layerfs.css).
 */
export function LfsPage({ children }: { children: ReactNode }) {
  const { sidebarOpen } = useLayout()
  const lead = sidebarOpen ? 0 : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX
  return (
    <div
      className="lfs-root canvas relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-chrome-lead={lead ? '' : undefined}
      style={{ '--chrome-lead': `${lead}px` } as CSSProperties}
    >
      <main className="vt-page tab-body @container/workspace relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
