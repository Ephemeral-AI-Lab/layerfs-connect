// Chats: the host's interactive Pi sessions under /api/agent (host/agents/routes.js).
// Only what the sidebar and the new-chat page use; the conversation page adds more.
import { call } from '@/layerfs/client'

export type ChatPhase =
  | 'idle' | 'preparing' | 'thinking' | 'tool' | 'approval' | 'children'
  | 'retrying' | 'compacting' | 'stopping' | 'interrupted' | 'error'

export interface ChatSummary {
  id: string
  title: string
  archived?: boolean
  /** The chat's working folder: its scratch folder, or one the user chose. */
  cwd: string
  /** The LayerFS project key (`store/name`) it works with, or null for a scratch-only chat. */
  project: string | null
  created: number
  updated: number
  state: 'idle' | 'running' | 'error'
  execution?: { phase: ChatPhase; startedAt: number | null }
  provider: string | null
  modelId: string | null
  error: string | null
  /** A scenario chat: the scripted run and the project it plays on. */
  scenario?: { id: string; title: string; project: string; state: string; error: string | null } | null
}

/** The parser's view of one bash call (host/agents/step-views.js): what each line means to do, and what LayerFS ran. */
export interface StepSegment {
  kind: 'workspace' | 'fs' | 'branch' | 'sandbox' | 'project' | 'backend' | 'subagent' | 'job' | 'local'
  form: 'cli' | 'sdk' | 'shell' | 'tool'
  /** The LayerFS call, e.g. "branch.fork"; absent for plain shell. */
  call?: string
  text: string
  /** 1-based first and last line in the command. */
  lines: [number, number]
  /** The command a workspace.exec runs inside the Sandbox. */
  detail?: string
  at?: { call: string; line: number; cols: [number, number] }[]
}

/** One LayerFS call a bash call made, from the chat's trace. */
export interface StepCall {
  id: string
  method: string
  ok: boolean | null
  kind: string | null
  code: string | null
  ms: number | null
  start: string
  branch?: string | null
  sandbox?: string | null
  path?: string | null
  commit?: string | null
  message?: string | null
  from?: string | null
  onto?: string | null
  name?: string | null
}

export interface StepView {
  segments: StepSegment[]
  calls: StepCall[]
}

export interface ChatMessage {
  id: string
  entryId?: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  thinking?: string
  toolName?: string
  args?: Record<string, unknown>
  status?: 'running' | 'done' | 'error'
  details?: { outputArtifact?: { id: string; bytes: number; truncated?: boolean } } & Record<string, unknown>
  usage?: { input: number; output: number; cost: number }
  /** bash calls: what they did to LayerFS. */
  view?: StepView
}

export interface ApprovalRequest {
  id: string
  agent: string
  toolCallId: string
  command: string
  cwd: string
  created: number
  status: 'reviewing' | 'pending' | 'approved' | 'rejected' | 'cancelled'
  reason?: string
}

/** A subagent run of the chat (host/agents/children.js describeChildren). */
export interface ChildRun {
  id: string
  runId?: string
  agent: string
  /** running, queued, pending, paused, completed, failed, stopped */
  state: string
  task?: string
  /** Its latest output: the final answer once done. */
  text?: string
  currentTool?: string | null
  model?: string | null
  error?: string | null
  tokens?: number
  cost?: number
  turns?: number
  toolCount?: number
  durationMs?: number
  startedAt?: number
  endedAt?: number
  /** Its session file is saved, so its conversation can be read. */
  conversation?: boolean
}

export const childActive = (child: ChildRun) => ['running', 'pending', 'queued', 'paused'].includes(child.state)

export interface QueuedMessage {
  id: string
  text: string
  mode: 'followUp' | 'steer'
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[]
  queued: QueuedMessage[]
  children: ChildRun[]
  approvals: ApprovalRequest[]
  contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null
  usage?: { totalTokens: number; cost: number }
  recovery?: { required: boolean; canContinue: boolean }
  execution?: { phase: ChatPhase; startedAt: number | null; turns?: number; toolCalls?: number; retryAttempt?: number; reason?: string }
}

export interface ChatModel {
  provider: string
  id: string
  name: string
  thinkingLevels?: string[]
}

export interface ChatModels {
  models: ChatModel[]
  selected: { provider: string; modelId: string; thinkingLevel: string } | null
  providers: { id: string; name?: string; hasKey: boolean }[]
}

export interface NewChat {
  cwd: string
  project?: string
  title?: string
  provider?: string
  modelId?: string
  thinkingLevel?: string
}

const sessionPath = (id: string) => `/api/agent/sessions/${encodeURIComponent(id)}`

export const chatHost = {
  list: () => call<ChatSummary[]>('GET', '/api/agent/sessions'),
  create: (input: NewChat) => call<ChatSummary>('POST', '/api/agent/sessions', input),
  send: (id: string, text: string) => call<ChatSummary>('POST', `${sessionPath(id)}/message`, { text }),
  update: (id: string, patch: { title?: string; archived?: boolean }) => call<ChatSummary>('POST', `${sessionPath(id)}/update`, patch),
  remove: (id: string) => call<{ id: string }>('DELETE', sessionPath(id)),
  models: () => call<ChatModels>('GET', '/api/agent/models'),
  detail: (id: string) => call<ChatDetail>('GET', sessionPath(id)),
  /** A message; while the chat works it queues as a follow-up. */
  message: (id: string, text: string, mode?: 'followUp' | 'steer') => call<ChatDetail>('POST', `${sessionPath(id)}/message`, mode ? { text, mode } : { text }),
  stop: (id: string) => call<ChatDetail>('POST', `${sessionPath(id)}/stop`),
  continue: (id: string) => call<ChatDetail>('POST', `${sessionPath(id)}/continue`, {}),
  approve: (id: string, requestId: string, decision: 'approve' | 'reject') =>
    call<ChatDetail>('POST', `${sessionPath(id)}/approvals/${encodeURIComponent(requestId)}`, { decision }),
  steer: (id: string, messageId: string) => call<ChatDetail>('POST', `${sessionPath(id)}/queue/${encodeURIComponent(messageId)}`, { mode: 'steer' }),
  unqueue: (id: string, messageId: string) => call<ChatDetail>('DELETE', `${sessionPath(id)}/queue/${encodeURIComponent(messageId)}`),
  /** One subagent's own conversation, read-only; its bash calls carry step views. */
  child: (id: string, childId: string) => call<{ child: ChildRun; messages: ChatMessage[] }>('GET', `${sessionPath(id)}/children/${encodeURIComponent(childId)}`),
  stopChild: (id: string, childId: string) => call<ChatDetail>('POST', `${sessionPath(id)}/children/${encodeURIComponent(childId)}/stop`, {}),
  /** A tool call's full output, a page at a time. */
  output: (id: string, artifact: string, offset = 0) =>
    call<{ text: string; offset: number; nextOffset: number | null; bytes: number; done: boolean }>('GET', `${sessionPath(id)}/output/${encodeURIComponent(artifact)}?offset=${offset}`),
}

/** The project a chat works with: its own, or the one its scenario plays on. */
export const chatProject = (chat: ChatSummary) => chat.project ?? chat.scenario?.project ?? null

/** What a chat row shows: working, waiting for an approval, failed, or nothing. */
export function chatStatus(chat: ChatSummary): 'working' | 'approval' | 'error' | null {
  const phase = chat.execution?.phase
  if (phase === 'approval') return 'approval'
  if (chat.state === 'error' || phase === 'error') return 'error'
  if (chat.state === 'running' || (phase && phase !== 'idle' && phase !== 'interrupted')) return 'working'
  return null
}
