import { t, useI18n } from '@/i18n'
import './history.css'

import { ChevronRight } from 'lucide-react'
import { type KeyboardEvent, useMemo } from 'react'

import { Button } from '@/components/ui/button'

import type { ForkBranch, ForkTree } from '@/data/forks'
import { agentColor, shortId } from '@/data/format'
import { cn } from '@/lib/utils'

export type BranchFilter = 'all' | 'open' | 'done'

/** One colour per fork depth; main takes the primary colour. */
export const laneColor = (depth: number) => (depth === 0 ? 'var(--primary)' : `var(--lane-${((depth - 1) % 4) + 1})`)

/** A stable agent marker; its accessible label carries the running state. */
export function AgentDot({ tree, agent, className }: { tree: ForkTree; agent: string; className?: string }) {
  useI18n()
  const color = agentColor(tree.agents, agent)
  const busy = tree.busy.has(agent)
  return (
    <span
      role="img"
      aria-label={t("{value1}{value2}", {value1: agent, value2: busy ? ', call in flight' : ''})}
      title={agent}
      className={cn('relative flex size-2 shrink-0', className)}
    >
      <span className="relative size-2 rounded-full" style={{ background: color, color }} />
    </span>
  )
}

/** A Branch's own match: its name, or one of its Commits' ids or messages. */
function matches(b: ForkBranch, query: string, filter: BranchFilter) {
  if (filter === 'open' && b.state !== 'open') return false
  if (filter === 'done' && b.state === 'open') return false
  if (!query) return true
  return (
    b.name.toLowerCase().includes(query) ||
    b.commits.some((c) => c.id.startsWith(query) || c.message.toLowerCase().includes(query))
  )
}

/** Names to show: matches plus every ancestor of a match, so nesting stays visible. */
export function visibleBranches(tree: ForkTree, query: string, filter: BranchFilter): Set<string> {
  const q = query.trim().toLowerCase()
  const shown = new Set<string>(['main'])
  for (const b of tree.branches.values()) {
    if (b.name === 'main' || !matches(b, q, filter)) continue
    for (let n: ForkBranch | undefined = b; n && !shown.has(n.name); n = n.parent ? tree.branches.get(n.parent) : undefined)
      shown.add(n.name)
  }
  return shown
}

interface BranchTreeProps {
  tree: ForkTree
  focus: string
  onFocus: (name: string) => void
  expanded: Set<string>
  onToggle: (name: string, open?: boolean) => void
  query: string
  filter: BranchFilter
  /** Clears the search and the filter, from the no-match state. */
  onClear?: () => void
}

export function BranchTree({ tree, focus, onFocus, expanded, onToggle, query, filter, onClear }: BranchTreeProps) {
  useI18n()
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
    if (!shown.has(name) || rows.includes(name)) return
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
      <div>
        <ul role="tree" aria-label={t("Branches by fork")} onKeyDown={onKeyDown}>
          <Node
            name="main"
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
      {empty && (
        <div className="hist-swap mx-1.5 mt-3 flex flex-col items-start gap-2 rounded-lg border border-dashed px-3 py-3">
          <p className="text-xs text-muted-foreground">{t("No Branch or Commit matches.")}</p>
          {onClear && (
            <Button variant="outline" size="xs" onClick={onClear}>{t("Show all Branches")}</Button>
          )}
        </div>
      )}
    </div>
  )
}

const treeRowId = (name: string) => `branch-row-${name.replace(/[^a-z0-9]/gi, '-')}`

interface NodeProps {
  name: string
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
  useI18n()
  const { name, tree, focus, onFocus, isOpen, onToggle, shown, direct, narrowing } = props
  const b = tree.branches.get(name)
  if (!b || !shown.has(name)) return null
  const kids = b.children.filter((k) => shown.has(k))
  const open = isOpen(name)
  const quiet = b.state === 'merged' || (narrowing && name !== 'main' && !direct.has(name))
  const selected = name === focus
  const origin = b.forkedFrom ? t('forked from {parent} at {id}', { parent: b.parent ?? 'main', id: shortId(b.forkedFrom.id) }) : t('the published line')

  return (
    <li role="treeitem" aria-expanded={kids.length > 0 ? open : undefined} aria-selected={selected}>
      <div
        data-active={selected}
        className={cn(
          'group flex h-9 items-center gap-1 rounded-lg pr-1.5 text-[13px] transition-colors duration-(--dur-fast)',
          selected ? 'hist-row-indicator text-accent-foreground' : 'hover:bg-muted/70',
        )}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("{value1} {value2}", {value1: t(open ? 'Collapse' : 'Expand'), value2: name})}
            onClick={() => onToggle(name)}
            disabled={narrowing}
            className="flex size-4 shrink-0 items-center justify-center rounded text-faint transition-colors hover:text-foreground"
          >
            <ChevronRight data-open={open} className="chevron size-3.5" />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          id={treeRowId(name)}
          tabIndex={selected ? 0 : -1}
          title={t("{value1} · {value2}", {value1: name, value2: origin})}
          onClick={() => onFocus(name)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 transition-[box-shadow] duration-(--dur-base)',
              name === 'main' ? 'rounded-[2px]' : 'rounded-full',
              quiet && 'opacity-40',
            )}
            style={{
              background: laneColor(b.depth),
              boxShadow: selected ? `0 0 0 2px color-mix(in oklab, ${laneColor(b.depth)} 15%, transparent)` : undefined,
            }}
          />
          <span className={cn('min-w-0 flex-1 truncate', name === 'main' && 'font-semibold', quiet && 'text-faint')}>
            {name}
          </span>
          {b.agent && <AgentDot tree={tree} agent={b.agent} />}
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {name === 'main'
              ? t("{value1} L", {value1: tree.layers.length})
              : b.state === 'merged'
                ? t("merged")
                : b.state === 'published'
                  ? t("published")
                  : t("+{value1}", {value1: b.commits.length})}
          </span>
        </button>
      </div>
      {kids.length > 0 && open && (
          <ul
            role="group"
            className="ml-[7px] border-l pl-1"
            style={{ borderColor: `color-mix(in oklab, ${laneColor(b.depth)} 30%, var(--border))` }}
          >
            {kids.map((k) => (
              <Node key={k} {...props} name={k} />
            ))}
          </ul>
      )}
    </li>
  )
}
