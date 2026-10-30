/** Connect's interactive Pi sessions, served by /api/agent. */
export interface AgentModel {
  provider: string
  id: string
  name: string
  reasoning: boolean
  contextWindow: number
  maxTokens?: number
  thinkingLevels?: string[]
  input?: string[]
}

export interface ModelSelection {
  provider: string
  modelId: string
  thinkingLevel: string
}

export interface AgentModels {
  models: AgentModel[]
  selected: ModelSelection | null
  providers: { id: string; name?: string; baseUrl?: string; api?: string; headers?: Record<string, string>; hasKey: boolean; custom?: boolean }[]
  defaultCwd: string
}

export interface ModelSettings extends ModelSelection {
  apiKey?: string
  baseUrl?: string
  api?: string
  headers?: Record<string, string>
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
}

export interface ProviderSettings {
  provider: string
  name?: string
  baseUrl?: string
  api?: string
  apiKey?: string
  headers?: Record<string, string>
}

export interface ModelDiscoveryInput {
  provider: string
  baseUrl?: string
  api?: string
  apiKey?: string
  headers?: Record<string, string>
}

export interface DiscoveredModel {
  id: string
  name: string
  reasoning?: boolean
  contextWindow?: number
  maxTokens?: number
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[]
  source: 'remote' | 'catalog'
}

export interface ModelSyncResult extends ModelDiscoveryResult {
  catalog: AgentModels
}

export interface ChatMessage {
  id: string
  /** Stable persisted transcript entry. Transient/tool rows may not have one. */
  entryId?: string
  /** Whether the host can restore the conversation immediately before this user entry. */
  canRestore?: boolean
  role: 'user' | 'assistant' | 'tool'
  text: string
  thinking?: string
  toolName?: string
  args?: Record<string, unknown>
  status?: 'running' | 'done' | 'error'
  details?: unknown
  usage?: { input: number; output: number; cost: number }
  attachments?: AgentAttachment[]
  outputArtifact?: { id: string; bytes: number; truncated?: boolean }
}

export interface AgentAttachment {
  id: string
  name: string
  mimeType: string
  data?: string
  size?: number
}

export interface AgentLimits {
  maxTurns: number
  maxRuntimeSeconds: number
  bashTimeoutSeconds: number
  maxRetries: number
  instructions?: string
}

export interface AgentExecution {
  phase: 'idle' | 'preparing' | 'thinking' | 'tool' | 'approval' | 'children' | 'retrying' | 'compacting' | 'stopping' | 'interrupted' | 'error'
  startedAt: number | null
  turns: number
  toolCalls: number
  retryAttempt: number
  reason?: string
}

export interface AgentUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: number
  toolCalls: number
}

export interface ChildRun {
  id: string
  runId?: string
  agent: string
  state: string
  task?: string
  text?: string
  sessionFile?: string
}

export type PermissionMode = 'ask' | 'auto' | 'full'

export interface ApprovalRequest {
  id: string
  agent: string
  toolCallId: string
  command: string
  cwd: string
  created: number
  status: 'reviewing' | 'pending' | 'approved' | 'rejected' | 'cancelled'
  source?: 'user' | 'model'
  reason?: string
  decidedAt?: number
}

/** Host-owned LayerFS workspace shared by a session and its child agents. */
export interface AgentWorkspace {
  branch: string
  state: 'pending' | 'preparing' | 'ready' | 'running' | 'saving' | 'closed' | 'error'
  sandbox: string | null
  path: string | null
  head: string | null
  commitCount: number
  lastSaved: number | null
  error: string | null
}

export interface AgentSessionSummary {
  id: string
  title: string
  archived?: boolean
  archivedAt?: number | null
  execution?: AgentExecution
  limits?: AgentLimits
  cwd: string
  project: string | null
  workspace: AgentWorkspace | null
  created: number
  updated: number
  state: 'idle' | 'running' | 'error'
  provider: string | null
  modelId: string | null
  thinkingLevel: string
  permissionMode: PermissionMode
  error: string | null
}

export interface AgentContextUsage {
  /** Pi's context estimate; null after compaction until the next model response. */
  tokens: number | null
  contextWindow: number
  /** Percentage of the context window (0–100, possibly higher on overflow). */
  percent: number | null
}

export interface QueuedAgentMessage {
  id: string
  text: string
  mode: 'followUp' | 'steer'
  attachments?: AgentAttachment[]
}

export interface AgentSessionDetail extends AgentSessionSummary {
  messages: ChatMessage[]
  queued: QueuedAgentMessage[]
  tools: string[]
  children: ChildRun[]
  approvals: ApprovalRequest[]
  /** Null when the session has not been opened or its model has no known limit. */
  contextUsage: AgentContextUsage | null
  recovery?: { required: boolean; canContinue: boolean }
  usage?: AgentUsage
}

export interface NewAgentSession {
  limits?: AgentLimits
  cwd?: string
  project?: string
  title?: string
  provider?: string
  modelId?: string
  thinkingLevel?: string
  permissionMode?: PermissionMode
}

export interface AgentPrompt {
  text: string
  mode?: 'steer' | 'followUp'
  provider?: string
  modelId?: string
  thinkingLevel?: string
  attachments?: AgentAttachment[]
}

export interface AgentOutputPage {
  text: string
  offset: number
  nextOffset: number | null
  bytes: number
  done: boolean
}

export interface AgentRestoreResult {
  session: AgentSessionDetail
  /** Original user prompt, restored as a draft without sending it. */
  draft: string
  attachments?: AgentAttachment[]
}

export interface AgentForkResult {
  session: AgentSessionDetail
  /** Present when copying the context before a user message. */
  draft?: string
  attachments?: AgentAttachment[]
}
