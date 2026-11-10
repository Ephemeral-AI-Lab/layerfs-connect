/** Shared declarations only: avoid loading the root app's JSX runtime into desktop. */
export interface CliAction {
  id: string
  name: string
  label: string
  target?: string
  page?: string
  origin: 'user' | 'background'
}

export interface CliText {
  text: string
  bytes: number
  truncated: boolean
}

export interface CliInvocation {
  id: string
  at: number
  argv: string[]
  stdin: CliText | null
  binary?: string
  identity?: { version: string; commit: string; dirty: boolean; features: string[] }
  mode: 'real'
  status: 'queued' | 'running' | 'success' | 'refused' | 'uncertain' | 'launch-failed' | 'usage-error' | 'not-started' | 'interrupted'
  pid?: number
  started?: number
  ended?: number
  waitMs?: number
  durationMs?: number
  exitCode?: number | null
  commandExitCode?: number
  signal?: string | null
  code?: string
  message?: string
  progress?: Record<string, string | number>
  stdout?: CliText
  stderr?: CliText
  outputUnavailable?: boolean
  shared?: boolean
}

export interface CliActivity extends CliAction {
  at: number
  status: 'running' | 'failed' | 'success' | 'no-cli'
  invocations: CliInvocation[]
  request?: { status: number; error?: boolean; code?: string }
  /** Full stage history is present on the action detail endpoint only. */
  events?: { id: string; at: number; seq: number; type: string; invocationId?: string; data: { progress?: Record<string, string | number> } }[]
}

export interface CliActivityPage {
  items: CliActivity[]
  next: string | null
  warning: string | null
  clearedAt?: number | null
}
