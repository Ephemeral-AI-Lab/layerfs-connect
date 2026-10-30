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
  providers: AgentProvider[]
  defaultCwd: string
}

export interface AgentProvider {
  id: string
  name?: string
  baseUrl?: string
  api?: string
  headers?: Record<string, string>
  /** It has a credential: an API key or a subscription sign-in. */
  hasKey: boolean
  custom?: boolean
  /** Its subscription sign-in, when it offers one: the button's label and the plan's name. */
  signIn?: { label: string; plan: string } | null
  /** Its credential is a subscription sign-in (OAuth), not an API key. */
  signedIn?: boolean
  /** Pi ships it (a catalog provider); otherwise models.json declares it. */
  builtIn?: boolean
  /** The models models.json lists for it: all of a declared provider's, the extras of a built-in one. */
  savedModels?: ProviderModel[]
}

/** One model in a provider's saved list, as the settings page edits it. */
export interface ProviderModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  input?: ('text' | 'image')[]
}

/** A step a sign-in shows: a page to open, or a code to enter on one. */
export type ModelLoginStep =
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string; expires?: number }

/** The question a sign-in waits on: a method to choose, or a code or redirect URL to paste. */
export interface ModelLoginPrompt {
  type: 'select' | 'manual_code' | 'text' | 'secret'
  message: string
  placeholder?: string
  options?: { id: string; label: string; description?: string }[]
}

/**
 * A subscription sign-in (host/agents/model-login.js), polled while it runs
 * (GET /api/agent/logins/:id); readable for two minutes after it ends.
 */
export interface ModelLogin {
  id: string
  provider: string
  /** The sign-in's name, e.g. "OpenAI (ChatGPT Plus/Pro)". */
  name: string
  state: 'starting' | 'waiting' | 'done' | 'failed' | 'cancelled'
  step: ModelLoginStep | null
  prompt: ModelLoginPrompt | null
  progress: string | null
  error: string | null
  started: number
  ended: number | null
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
  /** Replaces the provider's saved model list (ProviderModel). */
  models?: ProviderModel[]
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
  bashTimeoutSeconds: number
  maxRetries: number
  instructions?: string
}

/** Settings → Runs: the run limits every chat uses, the built-in defaults, and the chats working now. */
export interface RunLimitSettings {
  limits: Omit<AgentLimits, 'instructions'>
  defaults: Omit<AgentLimits, 'instructions'>
  busy: string[]
}

/** One call an SDK offers: `name` is `<group>.<call>`, `signature` as its docs write it. */
export interface AgentSdkCall {
  name: string
  signature: string
  description: string
}

/** An SDK from sdks.json, with what the host found under its root. */
export interface AgentSdkInfo {
  id: string
  title: string
  description: string
  enabled: boolean
  /** As written in sdks.json; `rootPath` is it resolved. */
  root: string
  rootPath: string | null
  /** From the first package found. */
  version: string | null
  /** Every package was found. */
  found: boolean
  packages: { name: string; found: boolean }[]
  command: string | null
  docs: { path: string; found: boolean }[]
  agents: AgentKind[]
  calls: AgentSdkCall[]
}

/** Settings → SDKs: sdks.json (`custom` once it exists; the built-in list until then), or why it cannot be read. */
export interface AgentSdks {
  file: string
  custom: boolean
  error: string | null
  sdks: AgentSdkInfo[]
  /** Chats whose work keeps the switches from changing now. */
  busy: string[]
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
  model?: string | null
  currentTool?: string | null
  error?: string | null
  /** Input plus output tokens; from its session file once it has one. */
  tokens?: number
  cost?: number
  turns?: number
  toolCount?: number
  startedAt?: number
  endedAt?: number
  /** Reported while it runs, before its session file has times. */
  durationMs?: number
  /** Its own conversation can be opened (GET …/children/:id). */
  conversation?: boolean
}

/** GET /api/agent/sessions/:id/children/:childId: one subagent's conversation, read-only. */
export interface ChildConversation {
  child: ChildRun
  messages: ChatMessage[]
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

/**
 * A scenario chat's scenario (host/agents/scenarios.js): its model is the
 * scenario's script, played on `project` in a folder /<folder>/ of its own.
 */
export interface AgentScenario {
  id: string
  title: string
  /** The project key it plays on. */
  project: string
  /** `<scenario>_<n>`; null until set up. */
  folder: string | null
  /** preparing: its folder is being set up; playing; passed: its final checks passed and it landed on main. */
  state: 'preparing' | 'playing' | 'passed' | 'failed' | 'stopped'
  phase: string | null
  /** Script steps done and in all, as of its latest step. */
  done?: number
  of?: number
  checks: { name: string; ok: boolean; detail: string }[]
  error: string | null
}

/** A scenario of the host, for `/scenario <id>`; `notInChat` says why it does not play in a chat yet. */
export interface ChatScenario {
  id: string
  title: string
  blurb: string
  notInChat: string | null
}

export interface AgentSessionSummary {
  id: string
  /** Set on a scenario chat. */
  scenario?: AgentScenario | null
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
  /** A scenario chat: the scenario to play on `project` (its own model; the rest is ignored). */
  scenario?: string
  /** Missing fields come from Settings → Runs. */
  limits?: Partial<AgentLimits>
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

/** Which agents get a tool: the chat's own agent, a connect-worker, a connect-lead. */
export type AgentKind = 'main' | 'worker' | 'lead'

/** One Pi extension Connect loads (Settings → Extensions). */
export interface AgentExtensionInfo {
  id: string
  title: string
  description: string
  package: string
  version: string | null
  /** Part of Connect itself. */
  builtin: boolean
  enabled: boolean
  /** Why its switch cannot be used, or null. */
  locked: string | null
  tools: string[]
  hooks: string[]
  commands: string[]
  commandsNote: string | null
}

/** One tool an extension gives the agents (Settings → Tools). */
export interface AgentToolInfo {
  name: string
  extension: string
  description: string
  parameters: string[]
  agents: AgentKind[]
  enabled: boolean
  locked: string | null
  /** Agents that have it turned off for themselves. */
  offFor: AgentKind[]
}

/** One Pi event an extension handles (Settings → Hooks); hooks switch with their extension. */
export interface AgentHookInfo {
  /** `extension:event`. */
  id: string
  event: string
  extension: string
  /** What the event is. */
  description: string
  /** What Connect does on it (its own hooks only). */
  purpose: string | null
  /** Handlers registered, when read from an open chat. */
  handlers: number | null
  enabled: boolean
  /** Why its switch cannot be used; only Connect's project instructions hook has one. */
  locked: string | null
  offFor: AgentKind[]
}

/** A slash command a Pi extension registered; typing `/<name>` in the message box runs it. */
export interface AgentPiCommand {
  name: string
  description: string
  extension: string
}

/** One kind of agent a chat runs (Settings → Agents): its tools, extensions and hooks. */
export interface AgentInfo {
  id: AgentKind
  title: string
  /** Its Pi agent name (connect-worker, connect-lead); null for the chat's own. */
  name: string | null
  description: string
  startedBy: string
  model: string
  instructions: string
  /** It can run now. */
  enabled: boolean
  locked: string | null
  /** Its tools, on for it or not; `locked` says why its switch cannot be used. */
  tools: { name: string; enabled: boolean; locked: string | null }[]
  extensions: string[]
  hooks: { id: string; event: string; extension: string; purpose: string | null; enabled: boolean; locked: string | null }[]
  hooksNote: string | null
}

/** GET /api/agent/capabilities: the setup, with what an open chat's Pi session reports (`live`). */
export interface AgentCapabilities {
  live: boolean
  agents: AgentInfo[]
  /** Chats whose work blocks changes now. */
  busy: string[]
  extensions: AgentExtensionInfo[]
  tools: AgentToolInfo[]
  hooks: AgentHookInfo[]
  commands: AgentPiCommand[]
}

/** POST /api/agent/capabilities: turns one extension or tool on or off. */
export interface AgentCapabilityChange {
  kind: 'extension' | 'tool' | 'agent' | 'hook'
  id: string
  enabled: boolean
  /** A tool or hook for this agent only; without it, for all agents. */
  agent?: AgentKind
}
