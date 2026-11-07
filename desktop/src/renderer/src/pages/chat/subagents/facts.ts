import { childActive, type ChildRun } from '@/layerfs/agent-api'
import { duration } from '@/layerfs/call-labels'

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k tok` : `${n} tok`)

/** A child's numbers in a line: model · tokens · cost · turns · tool calls · time. */
export function childFacts(child: ChildRun, now = Date.now()): string[] {
  const ms = child.durationMs ?? (child.startedAt ? (child.endedAt && !childActive(child) ? child.endedAt : now) - child.startedAt : undefined)
  return [
    child.model ?? null,
    child.tokens ? tokens(child.tokens) : null,
    child.cost ? `$${child.cost.toFixed(4)}` : null,
    child.turns ? `${child.turns} ${child.turns === 1 ? 'turn' : 'turns'}` : null,
    child.toolCount ? `${child.toolCount} tool ${child.toolCount === 1 ? 'call' : 'calls'}` : null,
    ms ? duration(ms) : null,
  ].filter((v): v is string => !!v)
}
