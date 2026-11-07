// A chat's Trace: every row the agent was given and did (system prompt, your
// messages, its model steps, tool calls and the LayerFS calls inside them,
// a scenario's checks), from host/agents/trace.js. Types mirror TracePage in
// the old app's src/shared/host-api.ts.
import { call } from '@/layerfs/client'

/** A LayerFS write a tool call made: an auto-checkpoint when it went through. */
export interface TraceWrite {
  kind: 'file' | 'workspace' | 'fork' | 'merge' | 'publish' | 'init'
  method: string
  status: 'ok' | 'failed' | 'running'
  outcome: string | null
  commit: string | null
  branch: string | null
  path: string | null
  workspace: string | null
  from: string | null
  onto: string | null
  with: string | null
  layer: string | null
  trunk: string | null
  message: string | null
  sizes: { logical: number | null; stored: number | null } | null
  start: number | null
  ms: number | null
  /** Its auto-checkpoint number in the chat; null when refused. */
  checkpoint: number | null
}

export type TraceKind = 'system' | 'user' | 'context' | 'assistant' | 'tool' | 'subagent' | 'layerfs' | 'check'

export interface TraceRecord {
  id: string
  kind: TraceKind
  /** 0 before the first message; each of your messages opens the next. */
  turn: number
  /** The model request (or scripted step) this row belongs to. */
  step: number | null
  title: string
  status: 'ok' | 'failed' | 'running' | 'stopped' | 'starting'
  start: number | null
  ms: number | null
  text?: string | null
  source?: 'user' | 'parent' | 'child' | 'model' | 'host' | 'scenario'
  from?: string
  opens?: boolean
  /** No model: the scenario's script. */
  scripted?: boolean
  sections?: string[] | null
  model?: string | null
  thinking?: string | null
  toolOnly?: boolean
  final?: boolean
  phase?: string | null
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number } | null
  stopReason?: string | null
  error?: string | null
  tool?: string
  child?: string | null
  output?: string | null
  exitCode?: number | null
  checks?: { name: string; ok: boolean; detail: string }[]
  background?: boolean
  calls?: number
  writes?: TraceWrite[]
  checkpoints?: number[]
  writeKind?: TraceWrite['kind'] | null
  /** tool/subagent: the Pi tool call it is, as the chat's messages name it. */
  callId?: string
  /** layerfs: the tool row it ran in. */
  parent?: string
  outcome?: string | null
  args?: Record<string, string>
}

/** Rows [from, from + records.length) of total, oldest first. */
export interface TracePage {
  agent: string
  kind: 'live' | 'replay'
  total: number
  from: number
  records: TraceRecord[]
  agents: { name: string; parent: string | null; state: string }[]
  checkpoints?: number
}

export const TRACE_PAGE = 300

export const traceHost = {
  /** The newest `limit` rows, or the `limit` before row `before`. */
  page: (id: string, before: number | null = null, limit = TRACE_PAGE) =>
    call<TracePage>('GET', `/api/agent/sessions/${encodeURIComponent(id)}/trace?limit=${limit}${before === null ? '' : `&before=${before}`}`),
}
