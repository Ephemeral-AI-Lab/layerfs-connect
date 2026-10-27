// The history as a list of things that happened, oldest first: each fork,
// Commit, merge and publish, which the game animates one after another.
// LayerFS records no time for a fork, so a fork is placed just before its
// Branch's first Commit (and after the point it forked at).
import type { ForkTree } from '@/data/forks'

import type { GameEvent, GameEventKind } from './types'

/** Ties at the same time go in this order: a Branch exists before its Commits; publishes come last. */
const RANK: Record<GameEventKind, number> = { fork: 0, commit: 1, merge: 2, publish: 3 }

export function eventsOf(tree: ForkTree): GameEvent[] {
  const out: GameEvent[] = []
  const layers = [...tree.layers].reverse() // oldest first: Init is 0
  const layerAt = new Map(layers.map((l) => [l.id, l.at]))
  layers.forEach((l, i) => {
    if (i === 0) return
    const from = l.from && tree.branches.has(l.from) ? l.from : 'main'
    out.push({ key: `publish:${l.id}`, kind: 'publish', at: l.at, branch: from, id: l.id, message: l.message, layer: i, by: tree.branches.get(from)?.agent })
  })
  for (const name of tree.order) {
    const b = tree.branches.get(name)
    if (!b) continue
    const own = [...b.commits].reverse()
    if (name !== 'main') {
      const f = b.forkedFrom
      const pointAt = f ? (f.kind === 'layer' ? layerAt.get(f.id) : tree.commits.get(f.id)?.at) ?? 0 : 0
      const first = own[0]?.at
      const at = first ? Math.max(pointAt + 1, first - 1) : pointAt + 1
      out.push({ key: `fork:${name}`, kind: 'fork', at, branch: name, id: name, from: b.parent ?? 'main', fromId: f?.id, message: `${name} forks from ${b.parent ?? 'main'}`, by: b.agent })
    }
    for (const c of own) {
      const from = c.merged ? tree.commits.get(c.merged) : undefined
      if (from && from.branch !== c.branch) {
        const source = tree.branches.get(from.branch)
        out.push({
          key: `merge:${c.id}`,
          kind: 'merge',
          at: c.at,
          branch: c.branch,
          id: c.id,
          from: from.branch,
          fromId: from.id,
          message: c.message,
          closes: source?.state === 'merged' && source.commits[0]?.id === from.id,
          by: c.by,
        })
      } else out.push({ key: `commit:${c.id}`, kind: 'commit', at: c.at, branch: c.branch, id: c.id, message: c.message, by: c.by })
    }
  }
  // Stable: events with the same time keep their rank, then the order they were found in.
  const index = new Map(out.map((e, i) => [e, i]))
  return out.sort((a, b) => a.at - b.at || RANK[a.kind] - RANK[b.kind] || index.get(a)! - index.get(b)!)
}

/**
 * How `next` follows `prev`: 'same', 'append' (only new events at the end,
 * which the game animates live) or 'changed' (anything else: rebuild).
 */
export function compareEvents(prev: GameEvent[], next: GameEvent[]): 'same' | 'append' | 'changed' {
  if (next.length < prev.length) return 'changed'
  for (let i = 0; i < prev.length; i++) if (prev[i].key !== next[i].key) return 'changed'
  return next.length === prev.length ? 'same' : 'append'
}

/** The counts the HUD shows after the first `n` events. */
export function countsAt(events: GameEvent[], n: number) {
  const c = { commits: 0, forks: 0, merges: 0, layers: 0 }
  for (let i = 0; i < Math.min(n, events.length); i++) {
    const e = events[i]
    if (e.kind === 'commit') c.commits++
    else if (e.kind === 'fork') c.forks++
    else if (e.kind === 'merge') (c.merges++, c.commits++)
    else c.layers++
  }
  return c
}
