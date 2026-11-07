// How a LayerFS call reads on the chat page: its icon, a short verb, what it
// acted on, and the colour of its family's bar beside the script.
import type { LfsIconName } from '@/components/layerfs/LfsIcons'
import type { StepCall, StepSegment } from '@/layerfs/agent-api'

const ICON: Record<string, LfsIconName> = {
  'branch.fork': 'fork',
  'branch.merge': 'merge',
  'branch.publish': 'publish',
  'branch.diff': 'diff',
  'commit.diff': 'diff',
  'file.diff': 'diff',
  'sandbox.create': 'sandbox',
  'sandbox.close': 'sandbox',
  'workspace.mount': 'mount',
  'workspace.unmount': 'mount',
  'workspace.exec': 'exec',
  'workspace.commit': 'commit',
  'project.init': 'init',
}

const FAMILY_ICON: Record<string, LfsIconName> = {
  branch: 'branch', commit: 'commit', file: 'layer', sandbox: 'sandbox', workspace: 'workspace',
  project: 'project', store: 'store', machine: 'worker', backup: 'store',
}

export const callIcon = (method: string): LfsIconName => ICON[method] ?? FAMILY_ICON[method.split('.')[0]] ?? 'layer'

/** The bar colour of a segment's kind (and of a call's family). */
export const KIND_COLOR: Record<string, string> = {
  branch: '#8b6fd6',
  workspace: '#3f86d9',
  sandbox: '#1f9e8f',
  fs: '#d08a2c',
  project: '#6b7a8f',
  backend: '#6b7a8f',
  subagent: '#c45a9a',
  job: '#c7772f',
  local: 'transparent',
}

const FAMILY_KIND: Record<string, string> = { file: 'fs', commit: 'branch', machine: 'project', store: 'project', backup: 'project' }
export const callColor = (method: string) => {
  const family = method.split('.')[0]
  return KIND_COLOR[FAMILY_KIND[family] ?? family] ?? KIND_COLOR.project
}

const short = (value: string | null | undefined, n = 8) => (value ? (/^[0-9a-f]{12,}$/.test(value) ? value.slice(0, n) : value) : '')

/** What a call acted on, in a few words: the branch it forked, the Sandbox, the file. */
export function callTarget(call: StepCall, detail?: string): string {
  const [family, verb] = call.method.split('.')
  if (call.method === 'workspace.exec') return detail ?? call.sandbox ?? ''
  if (call.method === 'branch.merge') return call.from && call.onto ? `${call.from} → ${call.onto}` : (call.branch ?? '')
  if (call.method === 'branch.publish') return [call.branch, short(call.commit)].filter(Boolean).join(' @ ')
  if (call.method === 'workspace.commit') return call.message ?? short(call.commit)
  if (call.method === 'workspace.mount') return [call.sandbox, call.branch].filter(Boolean).join(' ← ')
  if (family === 'file') return call.path ?? call.branch ?? ''
  if (family === 'sandbox') return call.sandbox ?? call.name ?? ''
  if (verb === 'fork') return call.branch ?? ''
  return call.branch ?? call.sandbox ?? call.path ?? call.name ?? ''
}

/**
 * Lines up a bash call's trace calls (what ran) with the script's segments
 * (what it meant to run). The two lists are aligned by call name, the latest
 * matches first; between two matches, leftover planned and traced calls pair
 * in order (a wrapper may run a call as another: a scenario's `branch
 * publish` forks the next trunk), extra traced calls of a matched call stay
 * with it (a loop, × n), planned calls nothing ran are `missing`, and traced
 * calls the parser did not see are `other`.
 */
export function matchCalls(segments: StepSegment[], calls: StepCall[]) {
  const planned = segments.flatMap((segment, index) =>
    (segment.at?.length ? segment.at.map((a) => a.call) : segment.call && segment.form !== 'tool' ? [segment.call] : []).map((method) => ({ index, method })),
  )
  const n = planned.length
  const m = calls.length
  // longest common subsequence by call name
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = planned[i].method === calls[j].method ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const pairs: [number, number][] = []
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (planned[i].method === calls[j].method && lcs[i][j] === lcs[i + 1][j + 1] + 1 && lcs[i][j + 1] !== lcs[i][j]) {
      pairs.push([i, j++])
      i++
    } else if (lcs[i][j + 1] >= lcs[i + 1][j]) j++
    else i++
  }

  const bySegment = new Map<number, StepCall[]>()
  const missing = new Map<number, string[]>()
  const other: StepCall[] = []
  const give = (index: number, call: StepCall) => bySegment.set(index, [...(bySegment.get(index) ?? []), call])
  const bounds: [number, number][] = [[-1, -1], ...pairs, [n, m]]
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [i0, j0] = bounds[k]
    const [i1, j1] = bounds[k + 1]
    if (k > 0) give(planned[i0].index, calls[j0])
    const gapPlanned = planned.slice(i0 + 1, i1)
    const gapCalls = calls.slice(j0 + 1, j1)
    const paired = Math.min(gapPlanned.length, gapCalls.length)
    for (let q = 0; q < paired; q++) give(gapPlanned[q].index, gapCalls[q])
    for (const p of gapPlanned.slice(paired)) missing.set(p.index, [...(missing.get(p.index) ?? []), p.method])
    for (const call of gapCalls.slice(paired)) {
      // a loop's repeats go with the matched call of the same name beside them
      const near = [planned[i0], planned[i1]].find((p) => p?.method === call.method)
      if (near) give(near.index, call)
      else other.push(call)
    }
  }
  for (const list of bySegment.values()) list.sort((a, b) => calls.indexOf(a) - calls.indexOf(b))
  return { bySegment, missing, other }
}

/** A call's short verb for the folded chain: "fork", "exec", "apply". */
export const callVerb = (method: string) => method.split('.')[1]?.replaceAll('_', ' ') ?? method

/** "0.2s", "12s", "1m 04s", "6h 30m". */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return ''
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 100)) / 10}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
