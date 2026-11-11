import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { setGo } from '@/layerfs/go'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { cn } from '@/lib/utils'
import { ChromeActions } from './ChromeActions'
import { LayoutContext } from './layout-context'
import { Sidebar } from './Sidebar'
import { PresetEnvironment } from '@/components/presets/PresetEnvironment'

export function MainLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  // cross-page links inside the LayerFS pages (a Store badge, a Sandbox's machine): go.ts
  useEffect(
    () =>
      setGo((place) => {
        if ('page' in place) {
          const m = place.focus ? /^(store|machine):(.+?)(?:#\d+)?$/.exec(place.focus) : null
          navigate(m ? `/${place.page}/${encodeURIComponent(m[2])}` : `/${place.page}`)
        } else navigate(`/storage/${place.project.split('/').map(encodeURIComponent).join('/')}/${place.tab ?? 'files'}`)
      }),
    [navigate],
  )
  const { width, dragging, startDrag } = useSidebarResize()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const layout = useMemo(
    () => ({
      sidebarOpen,
      toggleSidebar: () => setSidebarOpen((v) => !v),
    }),
    [sidebarOpen],
  )
  const section = location.pathname.split('/')[1] ?? ''

  return (
    <LayoutContext.Provider value={layout}>
      <div className={cn('relative flex h-screen text-foreground', dragging && 'cursor-col-resize select-none')}>
        <Sidebar width={width} open={sidebarOpen} dragging={dragging} onResizeStart={startDrag} />
        <ChromeActions sidebarWidth={width} dragging={dragging} />
        <main className="bg-content-area relative flex min-w-[400px] flex-1 flex-col overflow-hidden">
          <PresetEnvironment />
          <div key={section} className="flex min-h-0 flex-1 animate-in fade-in-0 duration-150 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
    </LayoutContext.Provider>
  )
}
