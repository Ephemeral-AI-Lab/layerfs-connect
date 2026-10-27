import { ChevronRight } from 'lucide-react'
import { type KeyboardEvent, useMemo } from 'react'

import { AGENT_DOT } from '@/components/app-sidebar'
import type { ForkBranch, ForkTree } from '@/data/forks'
import type { Project } from '@/data/sample'
import { cn } from '@/lib/utils'

export type BranchFilter = 'all' | 'open' | 'session'

/** One colour per fork depth; main takes the primary colour. */
export const laneColor = (depth: number) => (depth === 0 ? 'var(--primary)' : `var(--lane-${((depth - 1) % 4) + 1})`)

/** A Branch's own match: its name, or one of its Commits' ids or messages. */
function matches(b: ForkBranch, query: string, filter: BranchFilter) {
  if (filter === 'open' && b.state !== 'open') return false
  if (filter === 'session' && !b.session) return false
  if (!query) return true
  return (
    b.name.toLowerCase().includes(query) ||
    b.commits.some((c) => c.id === query || c.message.toLowerCase().includes(query))
  )
}

/** Names to show: matches plus every ancestor of a match, so nesting stays visible. */
export function visibleBranches(tree: ForkTree, query: string, filter: BranchFilter): Set<string> {
  const q = query.trim().toLowerCase()
  const shown = new Set<string>(['main'])
  for (const b of tree.branches.values()) {
    if (b.name === 'main' || !matches(b, q, filter)) continue
    for (let n: ForkBranch | undefined = b; n; n = n.parent ? tree.branches.get(n.parent) : undefined) shown.add(n.name)
  }
  return shown
}

interface BranchTreeProps {
  project: Project
  tree: ForkTree
  focus: string
  onFocus: (name: string) => void
  expanded: Set<string>
  onToggle: (name: string, open?: boolean) => void
  query: string
  filter: BranchFilter
}

export function BranchTree({ project, tree, focus, onFocus, expanded, onToggle, query, filter }: BranchTreeProps) {
  const narrowing = query.trim() !== '' || filter !== 'all'
  const shown = useMemo(() => visibleBranches(tree, query, filter), [tree, query, filter])
  const direct = useMemo(() => {
    const q = query.trim().toLowerCase()
    return new Set([...tree.branches.values()].filter((b) => b.name !== 'main' && matches(b, q, filter)).map((b) => b.name))
  }, [tree, query, filter])
  const isOpen = (name: string) => narrowing || expanded.has(name)

  // Rows in the order they draw, for arrow keys.
  const rows: string[] = []
  const walk = (name: string) => {
    if (!shown.has(name)) return
    rows.push(name)
    if (isOpen(name)) for (const kid of tree.branches.get(name)?.children ?? []) walk(kid)
  }
  walk('main')

  const onKeyDown = (e: KeyboardEvent) => {
    const i = rows.indexOf(focus)
    const node = tree.branches.get(focus)
    if (!node) return
    const kids = node.children.filter((k) => shown.has(k))
    let next: string | undefined
    if (e.key === 'ArrowDown') next = rows[Math.min(i + 1, rows.length - 1)]
    else if (e.key === 'ArrowUp') next = rows[Math.max(i - 1, 0)]
    else if (e.key === 'ArrowRight') {
      if (kids.length > 0 && !isOpen(focus)) onToggle(focus, true)
      else next = kids[0]
    } else if (e.key === 'ArrowLeft') {
      if (kids.length > 0 && isOpen(focus) && !narrowing) onToggle(focus, false)
      else next = node.parent
    } else return
    e.preventDefault()
    if (next && next !== focus) {
      onFocus(next)
      requestAnimationFrame(() => document.getElementById(treeRowId(next))?.focus())
    }
  }

  const empty = narrowing && shown.size === 1 && direct.size === 0
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
      {empty && <p className="px-2 pb-2 text-xs text-muted-foreground">No Branch or Commit matches.</p>}
      <ul role="tree" aria-label="Branches by fork" onKeyDown={onKeyDown}>
        <Node
          name="main"
          project={project}
          tree={tree}
          focus={focus}
          onFocus={onFocus}
          isOpen={isOpen}
          onToggle={onToggle}
          shown={shown}
          direct={direct}
          narrowing={narrowing}
        />
      </ul>
    </div>
  )
}

const treeRowId = (name: string) => `branch-row-${name.replace(/[^a-z0-9]/gi, '-')}`

interface NodeProps {
  name: string
  project: Project
  tree: ForkTree
  focus: string
  onFocus: (name: string) => void
  isOpen: (name: string) => boolean
  onToggle: (name: string, open?: boolean) => void
  shown: Set<string>
  direct: Set<string>
  narrowing: boolean
}

function Node(props: NodeProps) {
  const { name, project, tree, focus, onFocus, isOpen, onToggle, shown, direct, narrowing } = props
  const b = tree.branches.get(name)
  if (!b || !shown.has(name)) return null
  const kids = b.children.filter((k) => shown.has(k))
  const open = isOpen(name)
  const session = b.session ? project.sessions.find((s) => s.id === b.session) : undefined
  const quiet = b.state === 'merged' || (narrowing && name !== 'main' && !direct.has(name))
  const selected = name === focus
  const origin = b.forkedFrom ? `forked from ${b.parent} at ${b.forkedFrom.id}` : 'the published line'

  return (
    <li role="treeitem" aria-expanded={kids.length > 0 ? open : undefined} aria-selected={selected}>
      <div
        className={cn(
          'group flex h-8 items-center gap-1 rounded-lg pr-1.5 text-[13px]',
          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
        )}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            onClick={() => onToggle(name)}
            disabled={narrowing}
            className="flex size-4 shrink-0 items-center justify-center rounded text-faint hover:text-foreground"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          id={treeRowId(name)}
          tabIndex={selected ? 0 : -1}
          title={`${name} · ${origin}`}
          onClick={() => onFocus(name)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0', name === 'main' ? 'rounded-[2px]' : 'rounded-full', quiet && 'opacity-40')}
            style={{ background: laneColor(b.depth) }}
          />
          <span className={cn('min-w-0 flex-1 truncate', name === 'main' && 'font-semibold', quiet && 'text-faint')}>
            {name}
          </span>
          {session && (
            <span
              aria-label={`${session.title}${session.busy ? ', call in flight' : ''}`}
              className="relative flex size-2 shrink-0"
            >
              {session.busy && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', AGENT_DOT[session.agent])} />}
              <span className={cn('relative size-2 rounded-full', session.busy ? AGENT_DOT[session.agent] : 'bg-idle')} />
            </span>
          )}
          <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
            {name === 'main'
              ? tree.layers[0]?.id
              : b.state === 'merged'
                ? 'merged'
                : b.state === 'published'
                  ? `→ ${b.publishedAs}`
                  : `+${b.commits.length}`}
          </span>
        </button>
      </div>
      {kids.length > 0 && open && (
        <ul role="group" className="ml-[7px] border-l border-border/80 pl-1">
          {kids.map((k) => (
            <Node key={k} {...props} name={k} />
          ))}
        </ul>
      )}
    </li>
  )
}
