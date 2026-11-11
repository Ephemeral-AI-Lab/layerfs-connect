export type PresetExecutionMode = 'filesystem' | 'mixed'
export interface CleanupPlan {
  remove: { stores: string[]; sandboxes: string[]; machines: string[]; workspaces: string[] }
  retainMachines: string[]
  preserved: { store: string[]; sandbox: string[]; machine: string[] }
  projects: number
  signature: string
  revision: string | null
  home: string
  command: 'reset' | 'teardown'
}
export interface CleanupReceipt extends Omit<CleanupPlan, 'revision' | 'home' | 'command'> {
  verified: boolean
  remaining?: string[]
  unexpected?: string[]
}
export interface EnvironmentResetPlan {
  environment: string
  home: string
  homeId: string
  scope: 'environment'
  remove: CleanupPlan['remove']
  disconnect: string[]
  unknownSandboxes: string[]
  workspaceGroups?: { sandbox: string; workspaces: string[] }[]
  startMachines: string[]
  projects: number
  stopDocker: boolean
  detectedMachines?: { name: string; state: string; platform?: string }[]
  signature: string
}
export interface EnvironmentResetReceipt extends EnvironmentResetPlan {
  verified: boolean
  remaining: string[]
  warnings: string[]
  completed: string[][]
}
export interface PresetProjectTask {
  id: string
  project: string
  machine: string
  state: 'waiting' | 'running' | 'completed' | 'failed' | 'stopped'
  completed: number
  total: number
  tier?: number
  commits?: number
  branches?: number
  layers?: number
  targetCommits?: number
  targetBranches?: number
  targetLayers?: number
  error?: string
  errorCode?: string
  started?: number
  ended?: number
}
export interface PresetProgress {
  workspaceCoverage?: { completed: number; required: number; total: number }
  historyCompleted?: number
  historyTotal?: number
  tasks?: PresetProjectTask[]
  stage: 'checking' | 'resetting' | 'building' | 'verifying'
  completed: number
  total: number | null
  label: string
}
export interface PresetScript {
  total?: number
  offset?: number
  next?: number | null
  snapshot?: string
  commands: { phase: 'reset' | 'build' | 'verify'; argv: string[]; input?: string; note?: string; key?: string; dependsOn?: string[]; lane?: string; commitFrom?: string }[]
  dynamicReset: boolean
  preset: string
  language: 'javascript'
  command: string
  configuration: Record<string, unknown> & { executionMode?: PresetExecutionMode; historySchedule?: 'parallel' | 'serial'; historyLimits?: { concurrency: number; perStore: number; perProject: number } }
  files: { path: string; source: string }[]
}
export interface PresetJob {
  executionMode?: PresetExecutionMode
  started?: number
  ended?: number
  progress?: PresetProgress
  actionIds?: string[]
  id: string
  requestId: string
  preset: string
  command: 'setup' | 'reset' | 'teardown' | 'environment-reset'
  actionId: string | null
  state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'
  phase: string
  historyCleared: boolean
  cleanup?: CleanupReceipt | EnvironmentResetReceipt
  presetVerified?: boolean
  rebuild?: boolean
  rebuildActionId?: string
  error?: { code: string; message: string }
}
export interface DemoPreset {
  executionMode?: PresetExecutionMode
  contentVersion?: number
  contentReady?: boolean
  projectDefinitions?: { store: string; name: string; title: string; description: string; branches: string[]; tier?: number; cycles?: number; layers?: number; commands?: number; workspaceRevisions?: number; authoredRevisions?: number; sandboxLimit?: number; workspaceLimit?: number; history: { commits: number; branches: number; merges: number; publishes: number } }[]
  machineDefinitions?: { name: string; platform: string; cpus?: number; memory?: string; disk?: string }[]
  projectGroups: { store: string; machine: string; projects: string[] }[]
  id: string
  description: string
  machines: string[]
  stores: number
  projects: number
  sandboxes: number
  workspaces: number
  requirements: string[]
  coverage: string
  state: string
  home: string
  initialized: boolean
  settings: { sandboxes: boolean; executionMode?: PresetExecutionMode } | null
  revision: string | null
  job: PresetJob | null
}
export interface DemoPresets {
  items: DemoPreset[]
  active: string
  original: { home: string; job?: PresetJob | null }
  busy: boolean
}
