import type { AgentCapabilities, AgentCapabilityChange, ChatScenario, ChildConversation, AgentForkResult, AgentLimits, AgentModels, AgentOutputPage, ModelLogin, AgentPrompt, AgentRestoreResult, AgentSessionDetail, AgentSessionSummary, ModelDiscoveryInput, ModelDiscoveryResult, ModelSettings, ModelSyncResult, NewAgentSession, PermissionMode, ProviderSettings, RunLimitSettings, AgentSdks } from '@shared/agent-api'
import type { RunLive, TraceCall, TracePage } from '@shared/host-api'
import { call } from '@/host/client'

const sessionPath = (id: string) => `/api/agent/sessions/${encodeURIComponent(id)}`

export const agentHost = {
  models: () => call<AgentModels>('GET', '/api/agent/models'),
  discoverModels: (input: ModelDiscoveryInput) => call<ModelDiscoveryResult>('POST', '/api/agent/models/discover', input),
  syncModels: (input: ModelDiscoveryInput) => call<ModelSyncResult>('POST', '/api/agent/models/sync', input),
  saveProvider: (settings: ProviderSettings) => call<AgentModels>('POST', '/api/agent/providers', settings),
  removeProvider: (id: string) => call<AgentModels>('DELETE', `/api/agent/providers/${encodeURIComponent(id)}`),
  saveModels: (settings: ModelSettings) => call<AgentModels>('POST', '/api/agent/models', settings),
  testModel: (settings: ModelSettings) => call<{ text: string }>('POST', '/api/agent/models/test', settings),
  /** Opens models.json, where providers and models are kept, in the system's text editor. */
  openModelConfig: () => call<{ path: string }>('POST', '/api/agent/models/config/open'),
  /** Starts a provider's subscription sign-in (AgentProvider.signIn); a running one for it is cancelled. Poll it with `login`. */
  startLogin: (provider: string) => call<ModelLogin>('POST', `/api/agent/providers/${encodeURIComponent(provider)}/login`),
  login: (id: string) => call<ModelLogin>('GET', `/api/agent/logins/${encodeURIComponent(id)}`),
  /** Answers the sign-in's open question: an option's id, or a pasted code or redirect URL. */
  respondLogin: (id: string, value: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/respond`, { value }),
  cancelLogin: (id: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/cancel`),
  /** Opens the sign-in's page (its URL, or the device-code page) in the system browser. */
  openLogin: (id: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/open`),
  /** The host's scenarios, for `/scenario <id>`. */
  scenarios: () => call<ChatScenario[]>('GET', '/api/agent/scenarios'),
  /** A chat's tools, Pi extensions and Pi commands; Connect's configuration without a session. */
  capabilities: (session?: string) => call<AgentCapabilities>('GET', `/api/agent/capabilities${session ? `?session=${encodeURIComponent(session)}` : ''}`),
  /** Turns an extension or tool on or off; refused while a chat works, and for the locked ones. */
  setCapability: (change: AgentCapabilityChange) => call<AgentCapabilities>('POST', '/api/agent/capabilities', change),
  /** The run limits every chat uses (Settings → Runs). */
  runLimits: () => call<RunLimitSettings>('GET', '/api/agent/run-limits'),
  /** Saves the run limits for every chat; refused while a chat works. */
  setRunLimits: (limits: RunLimitSettings['limits']) => call<RunLimitSettings>('POST', '/api/agent/run-limits', limits),
  /** Settings → SDKs: sdks.json and what the host found of each SDK. */
  sdks: () => call<AgentSdks>('GET', '/api/agent/sdks'),
  /** Switches one SDK on or off in sdks.json. */
  setSdk: (id: string, enabled: boolean) => call<AgentSdks>('POST', '/api/agent/sdks', { id, enabled }),
  /** Opens sdks.json in the system's text editor (writing the built-in list first if it is new). */
  openSdkConfig: () => call<{ path: string }>('POST', '/api/agent/sdks/config/open'),
  /** One page of a chat's Trace rows: the newest `limit` before row `before`. */
  trace: (id: string, o: { before?: number; limit?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    return call<TracePage>('GET', `${sessionPath(id)}/trace${q ? `?${q}` : ''}`)
  },
  /** A chat's Live: its newest LayerFS calls and what its agents hold in LayerFS now. */
  live: (id: string) => call<{ calls: TraceCall[]; live: RunLive }>('GET', `${sessionPath(id)}/live`),
  sessions: () => call<AgentSessionSummary[]>('GET', '/api/agent/sessions'),
  create: (options: NewAgentSession) => call<AgentSessionDetail>('POST', '/api/agent/sessions', options),
  session: (id: string) => call<AgentSessionDetail>('GET', sessionPath(id)),
  update: (id: string, patch: { title?: string; archived?: boolean }) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/update`, patch),
  limits: (id: string, limits: Partial<AgentLimits>) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/limits`, limits),
  continue: (id: string, selection?: Partial<Pick<AgentPrompt, 'provider' | 'modelId' | 'thinkingLevel'>>) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/continue`, selection ?? {}),
  /** One subagent's own conversation, read-only. */
  child: (id: string, childId: string) => call<ChildConversation>('GET', `${sessionPath(id)}/children/${encodeURIComponent(childId)}`),
  stopChild: (id: string, childId: string) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/children/${encodeURIComponent(childId)}/stop`),
  output: (id: string, artifactId: string, offset = 0) => call<AgentOutputPage>('GET', `${sessionPath(id)}/output/${encodeURIComponent(artifactId)}?offset=${offset}`),
  send: (id: string, prompt: AgentPrompt) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/message`, prompt),
  steerQueued: (id: string, messageId: string) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/queue/${encodeURIComponent(messageId)}`, { mode: 'steer' }),
  removeQueued: (id: string, messageId: string) => call<AgentSessionDetail>('DELETE', `${sessionPath(id)}/queue/${encodeURIComponent(messageId)}`),
  stop: (id: string) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/stop`),
  compact: (id: string) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/compact`),
  rollback: (id: string, entryId: string) => call<AgentRestoreResult>('POST', `${sessionPath(id)}/rollback`, { entryId }),
  editMessage: (id: string, entryId: string, prompt: AgentPrompt) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/edit`, { entryId, ...prompt }),
  fork: (id: string, entryId?: string) => call<AgentForkResult>('POST', `${sessionPath(id)}/fork`, entryId ? { entryId } : {}),
  permissions: (id: string, mode: PermissionMode) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/permissions`, { mode }),
  approve: (id: string, requestId: string, decision: 'approve' | 'reject') =>
    call<AgentSessionDetail>('POST', `${sessionPath(id)}/approvals/${encodeURIComponent(requestId)}`, { decision }),
  remove: (id: string) => call<{ id: string }>('DELETE', sessionPath(id)),
}
