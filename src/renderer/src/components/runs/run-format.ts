// Shared look and wording for demo runs: state tones, kind colours, agent
// colours and time formatting. Class names are literal, so Tailwind sees them.
import type { AgentState, RunState, SegmentKind, StepResult } from '@shared/host-api'

import type { Tone } from '@/components/storage/chips'

export const RUN_TONE: Record<RunState, Tone> = {
  starting: 'info',
  running: 'info',
  passed: 'success',
  failed: 'danger',
  stopped: 'warning',
}

export const RUN_LABEL: Record<RunState, string> = {
  starting: 'Starting',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
}

export const AGENT_TONE: Record<AgentState, Tone> = {
  waiting: 'neutral',
  running: 'info',
  idle: 'neutral',
  done: 'success',
  failed: 'danger',
  stopped: 'warning',
}

export const STEP_TONE: Record<StepResult['state'], Tone> = {
  running: 'info',
  ok: 'success',
  failed: 'danger',
  stopped: 'warning',
}

export const isLive = (state: RunState) => state === 'starting' || state === 'running'

export interface KindStyle {
  label: string
  /** What the kind covers, for the legend. */
  about: string
  /** The block's left edge. */
  edge: string
  /** The block's tint. */
  tint: string
  /** The kind chip. */
  chip: string
  dot: string
}

export const KIND: Record<SegmentKind, KindStyle> = {
  workspace: {
    label: 'workspace',
    about: 'mount, exec, commit, unmount',
    edge: 'border-l-primary',
    tint: 'bg-primary/[0.05]',
    chip: 'bg-primary/10 text-accent-foreground ring-primary/25 dark:text-primary',
    dot: 'bg-primary',
  },
  fs: {
    label: 'fs',
    about: 'reads and writes on a Branch',
    edge: 'border-l-success',
    tint: 'bg-success/[0.05]',
    chip: 'bg-success/10 text-success ring-success/25',
    dot: 'bg-success',
  },
  branch: {
    label: 'branch',
    about: 'fork, merge, publish, history',
    edge: 'border-l-(--lane-1)',
    tint: 'bg-(--lane-1)/[0.06]',
    chip: 'bg-(--lane-1)/10 text-(--lane-1) ring-(--lane-1)/25',
    dot: 'bg-(--lane-1)',
  },
  sandbox: {
    label: 'sandbox',
    about: 'create, list, close',
    edge: 'border-l-(--lane-2)',
    tint: 'bg-(--lane-2)/[0.06]',
    chip: 'bg-(--lane-2)/10 text-(--lane-2) ring-(--lane-2)/25',
    dot: 'bg-(--lane-2)',
  },
  project: {
    label: 'project',
    about: 'branches, layers, state',
    edge: 'border-l-(--lane-4)',
    tint: 'bg-(--lane-4)/[0.06]',
    chip: 'bg-(--lane-4)/10 text-(--lane-4) ring-(--lane-4)/25',
    dot: 'bg-(--lane-4)',
  },
  backend: {
    label: 'backend',
    about: '@layerfs/backend reads, processes',
    edge: 'border-l-(--hl-function)',
    tint: 'bg-(--hl-function)/[0.06]',
    chip: 'bg-(--hl-function)/10 text-(--hl-function) ring-(--hl-function)/25',
    dot: 'bg-(--hl-function)',
  },
  subagent: {
    label: 'subagent',
    about: 'spawn, message, interrupt',
    edge: 'border-l-(--lane-3)',
    tint: 'bg-(--lane-3)/[0.06]',
    chip: 'bg-(--lane-3)/10 text-(--lane-3) ring-(--lane-3)/25',
    dot: 'bg-(--lane-3)',
  },
  job: {
    label: 'job',
    about: 'background bash jobs',
    edge: 'border-l-warning',
    tint: 'bg-warning/[0.05]',
    chip: 'bg-warning/10 text-warning ring-warning/25',
    dot: 'bg-warning',
  },
  local: {
    label: 'local',
    about: 'plain shell, no LayerFS call',
    edge: 'border-l-input',
    tint: 'bg-muted/40',
    chip: 'bg-muted text-muted-foreground ring-foreground/10',
    dot: 'bg-faint',
  },
}

export const KIND_ORDER: SegmentKind[] = ['workspace', 'fs', 'branch', 'sandbox', 'project', 'backend', 'subagent', 'job', 'local']

/** The kind of a LayerFS method from its family ("fs.edit" → fs). */
export function methodKind(method: string): SegmentKind {
  const family = method.split('.')[0]
  return (KIND_ORDER as string[]).includes(family) ? (family as SegmentKind) : family === 'agent' ? 'subagent' : 'local'
}

export interface AgentColor {
  dot: string
  text: string
  ring: string
  soft: string
}

// Agents take colours in the order they appear, root first.
const AGENT_COLORS: AgentColor[] = [
  { dot: 'bg-primary', text: 'text-primary', ring: 'ring-primary/30', soft: 'bg-primary/10' },
  { dot: 'bg-agent-builder', text: 'text-agent-builder', ring: 'ring-agent-builder/30', soft: 'bg-agent-builder/10' },
  { dot: 'bg-agent-docs', text: 'text-agent-docs', ring: 'ring-agent-docs/30', soft: 'bg-agent-docs/10' },
  { dot: 'bg-agent-tester', text: 'text-agent-tester', ring: 'ring-agent-tester/30', soft: 'bg-agent-tester/10' },
  { dot: 'bg-(--lane-3)', text: 'text-(--lane-3)', ring: 'ring-(--lane-3)/30', soft: 'bg-(--lane-3)/10' },
  { dot: 'bg-(--lane-2)', text: 'text-(--lane-2)', ring: 'ring-(--lane-2)/30', soft: 'bg-(--lane-2)/10' },
  { dot: 'bg-agent-reviewer', text: 'text-agent-reviewer', ring: 'ring-agent-reviewer/30', soft: 'bg-agent-reviewer/10' },
  { dot: 'bg-(--hl-function)', text: 'text-(--hl-function)', ring: 'ring-(--hl-function)/30', soft: 'bg-(--hl-function)/10' },
]

/** A stable colour per agent name, by its position in `names`. */
export function agentColors(names: string[]): (name: string) => AgentColor {
  // a name listed twice keeps its first place
  const index = new Map<string, number>()
  for (const n of names) if (!index.has(n)) index.set(n, index.size)
  return (name) => {
    let i = index.get(name)
    if (i === undefined) {
      i = index.size
      index.set(name, i)
    }
    return AGENT_COLORS[i % AGENT_COLORS.length]
  }
}

/** "4.2 s", "1 m 05 s", "320 ms". */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  if (m < 60) return `${m} m ${String(rest).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`
}

/** "12:04:31" for today, else "Oct 26, 12:04". */
export function clock(at: number | null | undefined): string {
  if (!at) return '–'
  const d = new Date(at)
  const today = new Date()
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function ago(at: number | null | undefined, now = Date.now()): string {
  if (!at) return '–'
  const s = Math.max(0, (now - at) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const stepKey = (agent: string, index: number) => `${agent}:${index}`

/** A run as a session: "Session 3", or the project an older run played on. */
export function runLabel(run: { id: string; project: string; replay?: number | null }): string {
  // a session of the demo's project; a run from before that played on a project of its own, named here
  return run.replay ? `Session ${run.replay}` : `Session · ${run.project}`
}

/** True for a run from before one project per demo: it made its own project (`<demo>-<n>`). */
export const ownProject = (run: { demo: string; project: string }) => run.project !== run.demo

/** A call's milliseconds: one decimal under 10 ms, whole above. */
export const ms = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n < 10 ? n.toFixed(1) : String(Math.round(n)))
