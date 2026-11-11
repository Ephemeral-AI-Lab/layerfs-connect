// A conversation's LayerFS operations and saved-version links (host/sessions/,
// docs/specs/chat-session-store.md). An operation id is identity; a
// SavedVersionRef is the exact saved version; list positions and counts are
// display only.
import { call } from '@/layerfs/client'

export interface SavedVersionRef {
  store_id: string
  project_id: string
  branch_id: string
  commit_id: string
  version_kind: 'Commit' | 'Layer'
}

export type LinkEffect = 'created' | 'referenced' | 'published' | 'unchanged'
export interface VersionLink { ref: SavedVersionRef; effect: LinkEffect }

export type OperationStatus = 'running' | 'succeeded' | 'failed' | 'unknown'

export interface OperationItem {
  operation_id: string
  method: string
  status: OperationStatus
  outcome: string | null
  cause: 'tool' | 'session_boundary' | 'lifecycle' | null
  checkpoints: VersionLink[]
  inputs: SavedVersionRef[]
  unresolved: string | null
  arguments: Record<string, unknown>
  started_at: string | null
  ms: number | null
}

/** A tool's operations, as Chat and Trace rows carry them. */
export interface ToolOperations {
  count: number
  links: number
  created: number
  distinct: number
  unknown: number
  failed: number
  running: number
  items: OperationItem[]
  truncated: boolean
}

export interface Operation extends OperationItem {
  seq: number
  session_id: string | null
  agent_id: string | null
  entry_id: string | null
  tool_call_id: string | null
  canonical: string | null
  origin: 'sdk' | 'cli' | 'host' | null
  ended_at: string | null
  error: { code: string; message: string; transport: string | null; detail: unknown } | null
  pending: { branch: string; commit: string; role: string }[]
  execution_context: Record<string, unknown> | null
  mount_facts: Record<string, unknown> | null
  inherited_from: string | null
  missing_intent: boolean
  reconciliation: { at: string; note: string | null; evidence: unknown }[] | null
  receipt_preview: Record<string, unknown> | null
  has_receipt: boolean
}

export interface OperationDetail extends Operation {
  receipt: { value: unknown; error: unknown; mount: unknown; missing: string | null } | null
  full_arguments: unknown
}

export type PersistenceState = 'local' | 'saving' | 'saved' | 'save-unknown' | 'failed' | 'conflict'
export interface Persistence {
  state: PersistenceState
  last_seq: number
  saved_through: number
  pending: number
  portable: boolean
  /** Why a conversation is not saved to a project: a simulation run's chats are recorded in this home only. */
  local_only?: 'simulation' | 'scenario' | 'no-project' | null
  branch: string | null
  error: { code: string; message: string } | null
  conflict: { message: string } | null
  flush: { status: string } | null
}

export interface Coverage {
  gaps: { reason: string; scope: string | null; at: string }[]
  conflicts: { operation_id: string }[]
}

export interface OperationPage {
  items: Operation[]
  total: number
  from: number
  facets: { agents: string[]; methods: string[]; projects: string[]; statuses: string[] }
  counts: { operations: number; links: number; distinct_versions: number; unknown: number }
  coverage: Coverage
  persistence: Persistence
}

export interface VersionLinkRow {
  session_id: string
  operation_id: string
  role: 'output' | 'input'
  effect: LinkEffect | null
  method: string
  agent_id: string | null
  tool_call_id: string | null
  status: OperationStatus
  branch_id: string
  version_kind: 'Commit' | 'Layer'
  title: string | null
  inherited_from: string | null
  bound_from?: string
}

export interface OperationQuery { agent?: string; tool?: string; method?: string; status?: string; project?: string; branch?: string; linked?: boolean; before?: number | null; from?: number | null; limit?: number }

const base = (id: string) => `/api/agent/sessions/${encodeURIComponent(id)}`

export const operationsHost = {
  page: (id: string, q: OperationQuery = {}) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '' && v !== false) params.set(k, v === true ? '1' : String(v))
    return call<OperationPage>('GET', `${base(id)}/operations?${params}`)
  },
  get: (id: string, operationId: string) => call<OperationDetail>('GET', `${base(id)}/operations/${encodeURIComponent(operationId)}`),
  persistence: (id: string) => call<Persistence>('GET', `${base(id)}/persistence`),
  save: (id: string) => call<Persistence>('POST', `${base(id)}/persistence`, { action: 'save' }),
  adopt: (id: string) => call<Persistence>('POST', `${base(id)}/persistence`, { action: 'adopt' }),
  reconcile: (id: string) => call<{ status: Persistence; operations: { operation_id: string; resolved: boolean; reason?: string }[] }>('POST', `${base(id)}/persistence`, { action: 'reconcile' }),
  versions: (project: string, commit: string) => call<{ producers: VersionLinkRow[]; references: VersionLinkRow[] }>('GET', `/api/agent/versions?${new URLSearchParams({ project, commit })}`),
}

export interface SavedConversation {
  branch: string
  head: string | null
  session_id: string
  valid: boolean
  problem: string | null
  local: boolean
  manifest: { project?: { store_id: string; project_id: string } | null; updated_at?: string; last_seq?: number; owner?: { instance_id: string } } | null
}

export const portableHost = {
  /** Conversations saved in a project's session branches, verified by manifest. */
  list: (project: string) => call<SavedConversation[]>('GET', `/api/agent/portable?${new URLSearchParams({ project })}`),
  /** Rebuilds one into this home; a renamed Store/project needs `binding` from its saved origin. */
  import: (project: string, sessionId: string, binding?: { from: string; to: string }) =>
    call<{ session: { id: string }; missingArtifacts: string[]; binding: { from: string; to: string } | null }>('POST', '/api/agent/sessions/import', { project, sessionId, ...(binding ? { binding } : {}) }),
}

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 10) : '—')

const EFFECT: Record<LinkEffect, string> = { created: 'Created', referenced: 'From', published: 'Published', unchanged: 'Unchanged' }
export const effectLabel = (effect: LinkEffect | null) => (effect ? EFFECT[effect] : 'Input')

/** History address of one exact saved version, with the operation that links it. */
export function versionHref(chatPath: string, ref: SavedVersionRef, operationId?: string) {
  return `${chatPath}/history?${new URLSearchParams({ commit: ref.commit_id, branch: ref.branch_id, ...(operationId ? { op: operationId } : {}) })}`
}

/** Trace address of one operation. */
export const operationHref = (chatPath: string, operationId: string) => `${chatPath}/trace?${new URLSearchParams({ op: operationId })}`

/** What an operation names, briefly: its path, branch, workspace or command. */
export function operationTarget(op: Pick<OperationItem, 'method' | 'arguments'>) {
  const a = op.arguments ?? {}
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null)
  if (op.method === 'branch.merge') return [s(a.a), s(a.b)].filter(Boolean).join(' + ') + (s(a.name) ? ` → ${a.name}` : '')
  if (op.method === 'branch.fork') return `${s(a.name) ?? ''}${s(a.from_commit) ? ` from ${shortId(String(a.from_commit))}` : s(a.from_branch) ? ` from ${a.from_branch}` : ''}`
  if (op.method === 'workspace.exec') return s(a.command)?.split('\n')[0] ?? ''
  if (op.method.startsWith('file.')) return s(a.path) ?? (typeof a.changes_count === 'number' ? `${a.changes_count} changes` : '') + (s(a.branch) ? ` on ${a.branch}` : '')
  return s(a.branch) ?? s(a.name) ?? s(a.ws) ?? ''
}

export function statusLabel(op: Pick<OperationItem, 'status' | 'outcome'>) {
  if (op.status === 'running') return 'Running'
  if (op.status === 'unknown') return 'Unknown'
  if (op.status === 'failed') return op.outcome ?? 'Failed'
  return op.outcome && !['Committed', 'UpToDate', 'Forked', 'Merged', 'Added', 'ok'].includes(op.outcome) ? op.outcome : 'Completed'
}

const PERSISTENCE: Record<PersistenceState, string> = {
  local: 'Recorded locally', saving: 'Saving to project…', saved: 'Saved to project', 'save-unknown': 'Save unknown', failed: 'Not saved', conflict: 'Ownership conflict',
}
const LOCAL_ONLY = { simulation: 'Recorded locally (simulation run)', scenario: 'Recorded locally (scenario)', 'no-project': 'Local only (no project)' } as const
export const persistenceLabel = (p: Persistence) => (!p.portable ? LOCAL_ONLY[p.local_only ?? 'no-project'] : PERSISTENCE[p.state])
