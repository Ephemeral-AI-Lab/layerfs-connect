// The Connect host's HTTP API, as the renderer sees it. The host
// (apps/connect/host, plain Node) answers JSON on 127.0.0.1 behind a bearer
// token; host/README.md describes each route. These types are the contract
// between the host and the renderer: change both sides together.

// ---------- Deployment and status ----------

export interface HostStatus {
  platform: 'linux' | 'macos' | 'windows'
  /** Settings LayerFS still needs before Init and Workspaces work (image, daemon, bundle). */
  missing: string[]
  docker: { level: 'ok' | 'down' | string; version?: string | null; error?: string | null }
  worker: { name: string; state: string; build?: string | null; error?: string | null } | null
  disk: { home: number | null; volumes: number | null }
  settings: {
    state: string
    home: string
    image: string | null
    bundle: string | null
    containerPrefix: string
    docker: string
  }
}

// ---------- Projects (real LayerFS reads) ----------

export interface ProjectSummary {
  name: string
  volume: string | null
  source: string | null
  created: number | null
  initialized: boolean
  /** The demo whose run made this project, when a run made it. */
  demo?: string | null
  run?: string | null
}

export interface BranchInfo {
  name: string
  /** The head Commit or Layer id this Branch points at. */
  head: string | null
  /** The Branch it was forked from, null for main. */
  parent: string | null
  forkedFrom: string | null
  state: 'open' | 'merged' | 'published' | string
  commits: number
}

export interface CommitInfo {
  id: string
  branch: string
  message: string
  at: number | null
  parent: string | null
  /** Merge Commits have a second parent. */
  merged?: string | null
  kind?: string | null
  changes?: { path: string; kind: string }[]
}

export interface LayerInfo {
  id: string
  message: string
  at: number | null
  from: string | null
}

export interface FsEntry {
  name: string
  path: string
  kind: 'file' | 'dir' | 'symlink' | string
  size: number | null
  mode?: number | null
}

export interface SandboxInfo {
  id: string
  name: string
  state: string
  image: string | null
  workspaces: { ws: string; branch: string; path: string }[]
}

export interface ProjectState {
  project: ProjectSummary
  branches: BranchInfo[]
  layers: LayerInfo[]
  sandboxes: SandboxInfo[]
}

// ---------- Demos (scenarios) ----------

export type ToolName =
  | 'bash'
  | 'subagent'
  | 'send_message'
  | 'interrupt_agent'
  | 'list_agents'
  | 'job_output'
  | 'job_kill'
  | 'job_list'
  | 'working_directory'

/** What a piece of an agent's call does. */
export type SegmentKind =
  | 'workspace' // mount, exec, commit, status, unmount
  | 'fs' // fs read/write/edit/list/… on a Branch (each write is a Commit)
  | 'branch' // fork, merge, publish, list/diff commits
  | 'sandbox' // create, list, close a Sandbox
  | 'project' // project-level reads (branches, layers, state)
  | 'backend' // @layerfs/backend reads and background processes
  | 'subagent' // subagent, send_message, interrupt_agent, list_agents
  | 'job' // a background bash job: run_in_background, job_output, job_kill, job_list
  | 'local' // plain shell with no LayerFS call (jq, echo, files in the agent's folder)

export interface Segment {
  kind: SegmentKind
  /** cli: the `layerfs` command; sdk: a Node script on @layerfs/agent or @layerfs/backend; shell; tool: a non-bash tool call. */
  form: 'cli' | 'sdk' | 'shell' | 'tool'
  /** The LayerFS method, e.g. "workspace.exec", "fs.edit", "branch.merge"; absent for local shell. */
  call?: string
  /** The source text of this segment. */
  text: string
  /** 1-based first and last line in the command. */
  lines: [number, number]
  /** The command a workspace.exec runs inside the Workspace, a subagent's name, a job's id. */
  detail?: string
}

export interface StepView {
  index: number
  tool: ToolName | 'reply'
  /** The bash command, the subagent prompt, the message: the call's main text. */
  text: string
  description?: string
  say?: string
  phase?: string
  note?: string
  expect?: string[]
  exit?: number
  /** The kind the step is mostly about (the first LayerFS kind among its segments, else local/subagent/job). */
  kind: SegmentKind
  segments: Segment[]
  /** reply steps: the agents it waits for. */
  until?: string[]
  /** bash with run_in_background: it runs as a job. */
  background?: boolean
  /** The job's or child's `as` name, which later steps call it by (`@name`). */
  job?: string
}

export interface DemoAgent {
  name: string
  /** The prompt a parent starts it with; null for root. */
  prompt: string | null
  steps: number
}

export interface DemoSummary {
  id: string
  title: string
  blurb: string | null
  order: number
  tags: string[]
  agents: DemoAgent[]
  /** Total steps over every agent. */
  steps: number
  /** Counts by segment kind over every step. */
  kinds: Partial<Record<SegmentKind, number>>
  fixture: string
  latest: RunSummary | null
  runs: number
}

export interface DemoDetail extends DemoSummary {
  /** Steps per agent, root first. */
  script: Record<string, StepView[]>
}

// ---------- Runs ----------

export type RunState = 'starting' | 'running' | 'passed' | 'failed' | 'stopped'

export interface RunSummary {
  id: string
  demo: string
  /** The LayerFS project this run made from the demo's fixture. */
  project: string
  state: RunState
  started: number
  ended: number | null
  error: string | null
  /** Finished and total steps over every agent. */
  done: number
  of: number
  phase: string | null
}

export type AgentState = 'waiting' | 'running' | 'idle' | 'done' | 'failed' | 'stopped'

export interface AgentRun {
  name: string
  /** The agent that started it; null for root. */
  parent: string | null
  state: AgentState
  done: number
  of: number
}

/** One LayerFS call from a trace line. */
export interface TraceCall {
  id: string
  agent: string
  /** The step label this call ran under: "<agent>:<index>". */
  step: string
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
}

export interface CheckResult {
  /** "exit", "expect", "commits", "final" … */
  name: string
  ok: boolean
  detail: string
}

export interface StepResult {
  agent: string
  index: number
  state: 'running' | 'ok' | 'failed' | 'stopped'
  started: number
  ended: number | null
  exitCode?: number | null
  stdout?: string
  stderr?: string
  /** True when stdout or stderr was cut to the kept size. */
  truncated?: boolean
  /** Tool calls other than bash: their answer text. */
  output?: string
  calls: TraceCall[]
  checks: CheckResult[]
}

export interface RunDetail extends RunSummary {
  agents: AgentRun[]
  /** Every step result so far, in the order steps started. */
  steps: StepResult[]
  /** Replies and messages between agents. */
  messages: { at: number; from: string; to: string | null; text: string }[]
  /** Values captured during the run: commits by ref, the sandbox, the ws. */
  captured: Record<string, string>
  /** Final checks after the root's last step (final.json and the like). */
  checks: CheckResult[]
}

/** One server-sent event on /api/events. */
export type RunEvent =
  | { type: 'run'; run: RunSummary }
  | { type: 'agent'; run: string; agent: AgentRun }
  | { type: 'step'; run: string; step: StepResult }
  | { type: 'call'; run: string; call: TraceCall }
  | { type: 'message'; run: string; message: RunDetail['messages'][number] }
  | { type: 'checks'; run: string; checks: CheckResult[] }
