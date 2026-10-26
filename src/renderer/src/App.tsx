import { useState } from 'react'

import { AppSidebar, type Selection } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

export function App() {
  const [selected, setSelected] = useState<Selection>({ kind: 'nav', id: 'sessions' })

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar selected={selected} onSelect={setSelected} />
        {/* The landing page stays empty for now. */}
        <main className="min-w-0 flex-1 bg-background" />
      </SidebarProvider>
    </TooltipProvider>
  )
}
