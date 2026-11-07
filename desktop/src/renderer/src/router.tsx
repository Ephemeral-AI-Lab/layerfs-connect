import { createHashRouter } from 'react-router-dom'
import { MainLayout } from '@/components/shell/MainLayout'
import { ChatPage } from '@/pages/chat/ChatPage'
import { NewChatPage } from '@/pages/chat/NewChatPage'
import { MachinesRoute } from '@/pages/machines/MachinesRoute'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { StorageRoute } from '@/pages/storage/StorageRoute'

// Hash routes, as in Cindy: the shell stays mounted and only the outlet swaps.
export const router = createHashRouter([
  {
    element: <MainLayout />,
    children: [
      // the start page is always a new chat
      { index: true, element: <NewChatPage /> },
      // a chat and its tabs (/trace, /subagents, /subagents/:child): one route, so the page stays mounted between them
      { path: 'chat/:id/*', element: <ChatPage /> },
      { path: 'machines', element: <MachinesRoute /> },
      { path: 'machines/:name', element: <MachinesRoute /> },
      { path: 'storage', element: <StorageRoute /> },
      { path: 'storage/:store', element: <StorageRoute /> },
      { path: 'settings', element: <PlaceholderPage title="Settings" body="Settings come later." /> },
      { path: '*', element: <PlaceholderPage title="Not found" body="This page does not exist." /> },
    ],
  },
])
