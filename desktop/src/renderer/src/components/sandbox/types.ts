import type { ReactNode } from 'react'

// View data only. Resource inspection and execution stay outside these components.
export type Outcome = 'ok' | 'error' | 'unknown'
export interface Actor { id: string; name: string; task: string; parent: string | null; branch: string; workspace?: string }
export interface Workspace { id: string; name: string; branch: string; sandbox: string; users: string[]; path?: string; activity?: string }
export interface Activity {
  id: string; start: number; end: number; actor: string; method: string; branch: string
  workspace?: string; sandbox?: string; detail: string; result: string; outcome: Outcome
}
export interface SandboxFile {
  path: string; content: string; type: string; mode: string; availableAt: number
  actor?: string; command?: string; workspace?: string
}
export interface SandboxSnapshot {
  name: string; project: string; runtimeId: string | null; image: string | null; backend: string | null
  machine: { name: string; state: string; platform: string; architecture: string; description: string; href: string }
  actors: Actor[]; workspaces: Workspace[]; events: Activity[]
  scratch: { path: string | null; files: SandboxFile[] }
  workspaceFiles: SandboxFile[]
  links: Record<string, string>
  duration: number
  recorded?: { state: string; route: string | null; downReason?: string; workspacesKnown?: boolean }
}

export type SandboxTab = 'overview' | 'workspaces'
export type WorkspaceTab = 'details' | 'commands'
export interface SandboxDetailProps {
  snapshot: SandboxSnapshot
  time: number
  playing: boolean
  observedAt: number
  navigation: { backLabel: string; onBack: () => void; standaloneHref?: string }
  onRefresh?: () => void
  highlightedConversation?: string
  initialTab?: SandboxTab
  controls?: ReactNode
  simulation?: boolean
  notice?: string
}
