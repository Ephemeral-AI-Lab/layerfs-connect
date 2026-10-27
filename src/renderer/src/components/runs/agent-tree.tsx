import type { AgentRun } from '@shared/host-api'
import { Users } from 'lucide-react'

import { AgentDot } from '@/components/runs/run-badges'
import type { AgentColor } from '@/components/runs/run-format'
import { AgentAvatar } from '@/components/runs/step-card'
import { cn } from '@/lib/utils'

export interface TreeNode<T> {
  item: T
  depth: number
  /** Whether a later sibling follows, for each ancestor level and this one. */
  last: boolean
}

/** Orders items as a tree: roots first, then each item's children in the given order. */
export function treeOrder<T>(items: T[], name: (t: T) => string, parent: (t: T) => string | null): TreeNode<T>[] {
  const names = new Set(items.map(name))
  const children = new Map<string | null, T[]>()
  for (const t of items) {
    const p = parent(t)
    const key = p && names.has(p) && p !== name(t) ? p : null
    children.set(key, [...(children.get(key) ?? []), t])
  }
  const out: TreeNode<T>[] = []
  const seen = new Set<string>()
  const walk = (key: string | null, depth: number) => {
    const list = children.get(key) ?? []
    list.forEach((t, i) => {
      if (seen.has(name(t))) return
      seen.add(name(t))
      out.push({ item: t, depth, last: i === list.length - 1 })
      walk(name(t), depth + 1)
    })
  }
  walk(null, 0)
  // Anything in a cycle still shows, at the top level.
  for (const t of items) if (!seen.has(name(t))) out.push({ item: t, depth: 0, last: true })
  return out
}

interface AgentTreeProps {
  agents: AgentRun[]
  colorOf: (name: string) => AgentColor
  selected: string | null
  onSelect: (name: string | null) => void
  /** Steps started so far, for the "All" row. */
  started: number
  total: number
}

/** Root and its subagents (parent → child), each with its state and progress. */
export function AgentTree({ agents, colorOf, selected, onSelect, started, total }: AgentTreeProps) {
  const nodes = treeOrder(agents, (a) => a.name, (a) => a.parent)
  return (
    <nav aria-label="Agents" className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg px-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          selected === null && 'bg-muted font-medium',
        )}
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-muted ring-1 ring-foreground/10 ring-inset">
          <Users aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </span>
        <span className="flex-1">All agents</span>
        <span className="text-[11px] text-faint tabular-nums">
          {started}/{total}
        </span>
      </button>
      {nodes.map(({ item: a, depth }) => {
        const color = colorOf(a.name)
        const pct = a.of > 0 ? Math.min(100, (a.done / a.of) * 100) : 0
        return (
          <button
            key={a.name}
            type="button"
            onClick={() => onSelect(selected === a.name ? null : a.name)}
            aria-pressed={selected === a.name}
            style={{ paddingLeft: 8 + depth * 14 }}
            className={cn(
              'relative flex min-h-11 flex-col justify-center gap-1 rounded-lg py-1.5 pr-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
              selected === a.name && 'bg-muted',
            )}
          >
            {depth > 0 && (
              <span aria-hidden="true" className="absolute top-0 bottom-1/2 border-b border-l border-border" style={{ left: depth * 14 - 3, width: 8 }} />
            )}
            <span className="flex min-w-0 items-center gap-2">
              <AgentAvatar name={a.name} color={color} />
              <span className={cn('min-w-0 flex-1 truncate text-[13px]', selected === a.name ? 'font-semibold' : 'font-medium')}>{a.name}</span>
              <AgentDot state={a.state} />
            </span>
            <span className="flex items-center gap-2 pl-8">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted-foreground/15">
                <span
                  className={cn('block h-full rounded-full', a.state === 'failed' ? 'bg-destructive' : color.dot)}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="text-[11px] text-faint tabular-nums">
                {a.done}/{a.of}
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
