import { createContext, useContext } from 'react'

export type LayoutState = {
  sidebarOpen: boolean
  toggleSidebar: () => void
}

export const LayoutContext = createContext<LayoutState>({
  sidebarOpen: true,
  toggleSidebar: () => {},
})

export const useLayout = () => useContext(LayoutContext)
