import type { AgentForkResult, AgentLimits, AgentModels, AgentOutputPage, ModelLogin, AgentPrompt, AgentRestoreResult, AgentSessionDetail, AgentSessionSummary, ModelDiscoveryInput, ModelDiscoveryResult, ModelSettings, ModelSyncResult, NewAgentSession, PermissionMode, ProviderSettings } from '@shared/agent-api'
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
  /** Starts a provider's subscription sign-in (AgentProvider.signIn); a running one for it is cancelled. Poll it with `login`. */
  startLogin: (provider: string) => call<ModelLogin>('POST', `/api/agent/providers/${encodeURIComponent(provider)}/login`),
  login: (id: string) => call<ModelLogin>('GET', `/api/agent/logins/${encodeURIComponent(id)}`),
  /** Answers the sign-in's open question: an option's id, or a pasted code or redirect URL. */
  respondLogin: (id: string, value: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/respond`, { value }),
  cancelLogin: (id: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/cancel`),
  /** Opens the sign-in's page (its URL, or the device-code page) in the system browser. */
  openLogin: (id: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/open`),
  sessions: () => call<AgentSessionSummary[]>('GET', '/api/agent/sessions'),
  create: (options: NewAgentSession) => call<AgentSessionDetail>('POST', '/api/agent/sessions', options),
  session: (id: string) => call<AgentSessionDetail>('GET', sessionPath(id)),
  update: (id: string, patch: { title?: string; archived?: boolean }) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/update`, patch),
  limits: (id: string, limits: Partial<AgentLimits>) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/limits`, limits),
  continue: (id: string, selection?: Partial<Pick<AgentPrompt, 'provider' | 'modelId' | 'thinkingLevel'>>) => call<AgentSessionDetail>('POST', `${sessionPath(id)}/continue`, selection ?? {}),
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
