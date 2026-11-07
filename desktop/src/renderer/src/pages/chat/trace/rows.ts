// The Trace's rows as the tab shows them: grouped by turn (Setup, then one
// per message you sent), each tool row carrying the LayerFS calls it made,
// with the totals, search and failure filter the toolbar works on.
import type { TraceRecord } from '@/layerfs/trace-api'

/** A row and, for a tool row, the LayerFS calls that ran inside it. */
export interface TraceItem {
  row: TraceRecord
  calls: TraceRecord[]
}

export interface TraceTurnGroup {
  turn: number
  /** The message that opened it; null for Setup. */
  title: string | null
  items: TraceItem[]
  steps: number
  calls: number
  failed: number
  start: number | null
  ms: number | null
}

export function failed(row: TraceRecord) {
  if (row.status === 'failed') return true
  if (row.kind === 'tool' && row.exitCode != null && row.exitCode !== 0) return true
  if (row.kind === 'check') return row.checks?.some((c) => !c.ok) ?? false
  return false
}

const end = (row: TraceRecord) => (row.start === null ? null : row.start + (row.ms ?? 0))

export function groupTrace(records: TraceRecord[]): TraceTurnGroup[] {
  const groups = new Map<number, TraceTurnGroup>()
  const byId = new Map<string, TraceItem>()
  for (const row of records) {
    let group = groups.get(row.turn)
    if (!group) {
      group = { turn: row.turn, title: null, items: [], steps: 0, calls: 0, failed: 0, start: null, ms: null }
      groups.set(row.turn, group)
    }
    if (row.kind === 'layerfs') {
      group.calls++
      const parent = row.parent ? byId.get(row.parent) : undefined
      if (parent) parent.calls.push(row)
      else group.items.push({ row, calls: [] }) // its tool row is on an earlier page
    } else {
      const item = { row, calls: [] }
      byId.set(row.id, item)
      group.items.push(item)
      if (row.kind === 'user' && group.title === null) group.title = row.title || row.text?.split('\n')[0] || null
      if (row.kind === 'assistant') group.steps++
    }
    if (failed(row)) group.failed++
    if (row.start !== null) {
      group.start = group.start === null ? row.start : Math.min(group.start, row.start)
      const e = end(row)
      if (e !== null) group.ms = Math.max(group.ms ?? 0, e - group.start)
    }
  }
  return [...groups.values()].sort((a, b) => a.turn - b.turn)
}

export interface TraceTotals {
  turns: number
  steps: number
  tools: number
  calls: number
  failed: number
}

export function totals(records: TraceRecord[]): TraceTotals {
  const turns = new Set<number>()
  const t: TraceTotals = { turns: 0, steps: 0, tools: 0, calls: 0, failed: 0 }
  for (const row of records) {
    if (row.turn > 0) turns.add(row.turn)
    if (row.kind === 'assistant') t.steps++
    if (row.kind === 'tool' || row.kind === 'subagent') t.tools++
    if (row.kind === 'layerfs') t.calls++
    if (failed(row)) t.failed++
  }
  t.turns = turns.size
  return t
}

/** Whether a row holds the search text: its title, text, output, arguments or outcome. */
export function holds(row: TraceRecord, query: string) {
  const q = query.toLowerCase()
  const fields = [row.title, row.text, row.output, row.thinking, row.outcome, row.tool, row.error, ...Object.values(row.args ?? {})]
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q))
}

export interface Filter {
  query: string
  failures: boolean
}

/** The items a filter keeps; a tool row kept for its calls shows just those calls (`only`). */
export function filterItems(items: TraceItem[], filter: Filter): (TraceItem & { only?: TraceRecord[] })[] {
  const query = filter.query.trim()
  if (!query && !filter.failures) return items
  const pass = (row: TraceRecord) => (!query || holds(row, query)) && (!filter.failures || failed(row))
  const out: (TraceItem & { only?: TraceRecord[] })[] = []
  for (const item of items) {
    const calls = item.calls.filter(pass)
    if (pass(item.row)) out.push(calls.length ? { ...item, only: calls } : item)
    else if (calls.length) out.push({ ...item, only: calls })
  }
  return out
}
