import { createHashRouter, Navigate } from 'react-router-dom'
import { MainLayout } from '@/components/shell/MainLayout'
import { ChatPage } from '@/pages/chat/ChatPage'
import { NewChatPage } from '@/pages/chat/NewChatPage'
import { SandboxDetailPage } from '@/pages/machines/SandboxDetailPage'
import { MachinesRoute } from '@/pages/machines/MachinesRoute'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { PiPoliciesPage } from '@/pages/settings/PiPoliciesPage'
import { ModelsPage } from '@/pages/settings/ModelsPage'
import { ToolsPage, AgentsPage, HooksPage } from '@/pages/settings/CapabilitiesPage'
import { StorageRoute } from '@/pages/storage/StorageRoute'

import { CliActivityPage } from '@/pages/activity/CliActivityPage'

// Hash routes, as in Cindy: the shell stays mounted and only the outlet swaps.
export const router = createHashRouter([
  {
    element: <MainLayout />,
    children: [
      // the start page is always a new chat
      { index: true, element: <NewChatPage /> },
      // a chat and its tabs (/trace, /subagents, /subagents/:child): one route, so the page stays mounted between them
      { path: 'chat/:id/*', element: <ChatPage /> },
      { path: 'activity', element: <CliActivityPage /> },
      { path: 'machines', element: <MachinesRoute /> },
      { path: 'machines/:name', element: <MachinesRoute /> },
      { path: 'machines/:name/sandboxes/:sandbox', element: <SandboxDetailPage /> },
      { path: 'storage', element: <StorageRoute /> },
      { path: 'storage/:store', element: <StorageRoute /> },
      { path: 'storage/:store/:project/*', element: <StorageRoute /> },
      { path: 'settings', element: <Navigate to="/settings/models" replace /> },
      { path: 'settings/models', element: <ModelsPage /> },
      { path: 'settings/configurations', element: <PiPoliciesPage /> },
      { path: 'settings/pi-policies', element: <Navigate to="/settings/configurations" replace /> },
      { path: 'settings/tools', element: <ToolsPage /> },
      { path: 'settings/agents', element: <AgentsPage /> },
      { path: 'settings/hooks', element: <HooksPage /> },
      { path: '*', element: <PlaceholderPage title="Not found" body="This page does not exist." /> },
    ],
  },
])
