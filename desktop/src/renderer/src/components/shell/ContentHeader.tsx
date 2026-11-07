import type { ReactNode } from 'react'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useLayout } from './layout-context'

/** 46px drag header over the page; leaves room for the chrome buttons and panel toggle. */
export function ContentHeader({ children }: { children?: ReactNode }) {
  const { sidebarOpen } = useLayout()
  const lead = sidebarOpen ? 0 : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX
  return (
    <header className={cn('drag relative flex h-[46px] w-full shrink-0 select-none items-center pl-2', children != null && 'border-b border-titlebar-border')}>
      <div className="shrink-0 transition-[width] duration-[250ms]" style={{ width: lead }} />
      <div className="no-drag flex h-full min-w-0 flex-1 items-center">{children}</div>
      <div className="w-9 shrink-0" />
    </header>
  )
}
