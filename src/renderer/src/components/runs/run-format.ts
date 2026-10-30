import { t, localeTag, getLocale } from '@/i18n'
// Shared look and wording for demo runs: state tones, kind colours, agent
// colours and time formatting. Class names are literal, so Tailwind sees them.
import type { AgentState, RunState, SegmentKind, StepResult } from '@shared/host-api'

import type { Tone } from '@/components/storage/chips'

// Passed and failed are the scenario's verdict, for the backend and its tests:
// the UI shows both as an ended session.
export const RUN_TONE: Record<RunState, Tone> = {
  starting: 'info',
  running: 'info',
  passed: 'neutral',
  failed: 'neutral',
  stopped: 'warning',
}

export const RUN_LABEL: Record<RunState, string> = {
  starting: 'Starting',
  running: 'Running',
  passed: 'Ended',
  failed: 'Ended',
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

/** How long an ended session stays active in Live before it goes idle. */
export const IDLE_AFTER_MS = 5 * 60 * 1000

/**
 * True when a session is idle: it ended over IDLE_AFTER_MS ago, or a newer
 * session of its demo has started (a replay resets the project, so it sends
 * every earlier session idle at once).
 */
export function isIdle(
  run: { demo: string; state: RunState; started: number; ended: number | null },
  runs: readonly { demo: string; started: number }[] | undefined,
  now: number,
): boolean {
  if (isLive(run.state)) return false
  if (runs?.some((r) => r.demo === run.demo && r.started > run.started)) return true
  return now - (run.ended ?? run.started) > IDLE_AFTER_MS
}

export interface KindStyle {
  label: string
  /** What the kind covers, for the legend. */
  about: string
  /** A marked line's tint (the call lines of a script). */
  tint: string
  /** The kind chip. */
  chip: string
  dot: string
}

export const KIND: Record<SegmentKind, KindStyle> = {
  workspace: {
    label: 'workspace',
    about: 'mount, exec, commit, unmount',
    tint: 'bg-primary/[0.05]',
    chip: 'bg-primary/10 text-accent-foreground ring-primary/25 dark:text-primary',
    dot: 'bg-primary',
  },
  fs: {
    label: 'fs',
    about: 'reads and writes on a Branch',
    tint: 'bg-success/[0.05]',
    chip: 'bg-success/10 text-success ring-success/25',
    dot: 'bg-success',
  },
  branch: {
    label: 'branch',
    about: 'fork, merge, publish, history',
    tint: 'bg-(--lane-1)/[0.06]',
    chip: 'bg-(--lane-1)/10 text-(--lane-1) ring-(--lane-1)/25',
    dot: 'bg-(--lane-1)',
  },
  sandbox: {
    label: 'sandbox',
    about: 'create, list, close',
    tint: 'bg-(--lane-2)/[0.06]',
    chip: 'bg-(--lane-2)/10 text-(--lane-2) ring-(--lane-2)/25',
    dot: 'bg-(--lane-2)',
  },
  project: {
    label: 'project',
    about: 'branches, layers, state',
    tint: 'bg-(--lane-4)/[0.06]',
    chip: 'bg-(--lane-4)/10 text-(--lane-4) ring-(--lane-4)/25',
    dot: 'bg-(--lane-4)',
  },
  backend: {
    label: 'backend',
    about: '@layerfs/backend reads, processes',
    tint: 'bg-(--hl-function)/[0.06]',
    chip: 'bg-(--hl-function)/10 text-(--hl-function) ring-(--hl-function)/25',
    dot: 'bg-(--hl-function)',
  },
  subagent: {
    label: 'subagent',
    about: 'spawn, message, interrupt',
    tint: 'bg-(--lane-3)/[0.06]',
    chip: 'bg-(--lane-3)/10 text-(--lane-3) ring-(--lane-3)/25',
    dot: 'bg-(--lane-3)',
  },
  job: {
    label: 'job',
    about: 'background bash jobs',
    tint: 'bg-warning/[0.05]',
    chip: 'bg-warning/10 text-warning ring-warning/25',
    dot: 'bg-warning',
  },
  local: {
    label: 'local',
    about: 'plain shell, no LayerFS call',
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
  // the page's clock ticks once a second, so an event newer than its last tick would read negative
  ms = Math.max(0, ms)
  if (ms < 1000) return t('{n} ms', { n: Math.round(ms) })
  const s = ms / 1000
  if (s < 9.95) return t('{n} s', { n: s.toFixed(1) })
  // round once, before splitting, so 119.6 s reads 2 m 00 s and never 1 m 60 s
  const total = Math.round(s)
  if (total < 60) return t('{n} s', { n: total })
  const m = Math.floor(total / 60)
  const rest = total % 60
  if (m < 60) return t('{m} m {s} s', { m, s: String(rest).padStart(2, '0') })
  return t('{h} h {m} m', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') })
}

/**
 * What an agent is doing now and for how long: its LayerFS call in flight
 * ("workspace.exec · 2.2 s"), "thinking · 1.4 s" between steps, "idle · 1 m 05 s"
 * while it waits, "done" once finished.
 */
export function activity(
  a: { state?: AgentState; since?: number; thinking?: number | null },
  call: { method: string; start: number } | undefined,
  now: number,
): string {
  if (call) return `${call.method} · ${duration(now - call.start)}`
  if (a.thinking) return t('thinking · {duration}', { duration: duration(now - a.thinking) })
  const since = a.since ? ` · ${duration(now - a.since)}` : ''
  switch (a.state) {
    case 'running':
      return t('working')
    case 'idle':
      return t('idle{since}', { since })
    case 'waiting':
      return t('not started')
    case 'done':
      return a.since ? t('done · {time}', { time: ago(a.since, now) }) : t('done')
    case undefined:
      return ''
    default:
      return t(a.state)
  }
}

/** "12:04:31" for today, else "Oct 26, 12:04". */
export function clock(at: number | null | undefined): string {
  if (!at) return '–'
  const d = new Date(at)
  const today = new Date()
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return d.toLocaleString(localeTag(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function ago(at: number | null | undefined, now = Date.now()): string {
  if (!at) return '–'
  const s = Math.max(0, (now - at) / 1000)
  if (s < 45) return t('just now')
  if (s < 3600) return new Intl.RelativeTimeFormat(localeTag(), { numeric: 'always' }).format(-Math.max(1, Math.round(s / 60)), 'minute')
  if (s < 86400) return new Intl.RelativeTimeFormat(localeTag(), { numeric: 'always' }).format(-Math.round(s / 3600), 'hour')
  return new Date(at).toLocaleDateString(localeTag(), { month: 'short', day: 'numeric' })
}

export const plural = (n: number, word: string) => getLocale() === 'zh-CN' ? `${n} ${t(word)}` : `${n} ${word}${n === 1 ? '' : 's'}`

export const stepKey = (agent: string, index: number) => `${agent}:${index}`

/** A run as a session: "Session 3", or the project an older run played on. */
export function runLabel(run: { id: string; project: string; replay?: number | null; session?: string | null }): string {
  // a session of the demo's project (named, for a demo of several); a run from before that played on a project of its own, named here
  return run.replay ? `Session ${run.replay}${run.session ? ` · ${run.session}` : ''}` : `Session · ${run.project}`
}

/** True for a run from before one project per demo: it made its own project (`<demo>-<n>`). */
export const ownProject = (run: { demo: string; project: string }) => run.project !== run.demo

/** A call's milliseconds: one decimal under 10 ms, whole above. */
export const ms = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n < 10 ? n.toFixed(1) : String(Math.round(n)))
