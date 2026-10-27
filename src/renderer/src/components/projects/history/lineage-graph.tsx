import { ChevronRight, CornerDownRight, Ellipsis, GitFork, GitMerge, Upload } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react'

import { AGENT_DOT } from '@/components/app-sidebar'
import { laneColor } from '@/components/projects/history/branch-tree'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { type ForkBranch, type ForkTree, type HistoryCommit, type Layer, ancestry } from '@/data/forks'
import type { Project } from '@/data/sample'
import { cn } from '@/lib/utils'

const HOST = 'Needs the LayerFS host process'
const ROW = 40
const LANE = 16
const PAD = 12

/** What the detail panel shows: a Commit or a Layer, by id. */
export type HistoryItem = { kind: 'commit' | 'layer'; id: string }

type Row =
  | { kind: 'commit'; lane: number; minutes: number; commit: HistoryCommit; forks: string[] }
  | { kind: 'layer'; lane: 0; minutes: number; layer: Layer; dim: boolean; forks: string[] }
  | { kind: 'earlier'; lane: number; minutes: number; count: number; of: string }
  | { kind: 'empty'; lane: number; minutes: number }

/** The focused Branch's rows and its ancestors' rows up to each fork point, newest first. */
function lineageRows(tree: ForkTree, path: ForkBranch[]): Row[] {
  const rows: Row[] = []
  const forksAt = (id: string, except?: string) =>
    [...tree.branches.values()].filter((b) => b.forkedFrom?.id === id && b.name !== except).map((b) => b.name)
  const last = path.length - 1

  path.forEach((b, lane) => {
    const child = path[lane + 1]
    if (lane === 0) {
      const forkIndex = child ? tree.layers.findIndex((l) => l.id === child.forkedFrom?.id) : -1
      tree.layers.forEach((layer, i) => {
        // Newer Layers show main moving on; keep two older ones, fold the rest.
        if (forkIndex >= 0 && i > forkIndex + 2) return
        rows.push({ kind: 'layer', lane: 0, minutes: layer.minutes, layer, dim: forkIndex >= 0 && i < forkIndex, forks: forksAt(layer.id, child?.name) })
      })
      const folded = forkIndex >= 0 ? tree.layers.length - (forkIndex + 3) : 0
      if (folded > 0) rows.push({ kind: 'earlier', lane: 0, minutes: Infinity, count: folded, of: 'Layers on main' })
      return
    }
    const oldestFirst = [...b.commits].reverse()
    const upTo = child ? oldestFirst.findIndex((c) => c.id === child.forkedFrom?.id) : oldestFirst.length - 1
    for (const commit of oldestFirst.slice(0, upTo + 1))
      rows.push({ kind: 'commit', lane, minutes: commit.minutes, commit, forks: forksAt(commit.id, child?.name) })
    if (lane === last && b.commits.length === 0) rows.push({ kind: 'empty', lane, minutes: -1 })
  })
  // Fewest minutes ago first: newest at the top.
  return rows.sort((a, b) => a.minutes - b.minutes)
}

const rowId = (r: Row) => (r.kind === 'commit' ? r.commit.id : r.kind === 'layer' ? r.layer.id : undefined)

interface LineageGraphProps {
  project: Project
  tree: ForkTree
  focus: string
  onFocus: (name: string) => void
  selected?: HistoryItem
  onSelect: (item: HistoryItem) => void
}

export function LineageGraph({ project, tree, focus, onFocus, selected, onSelect }: LineageGraphProps) {
  const path = useMemo(() => ancestry(tree, focus), [tree, focus])
  const rows = useMemo(() => lineageRows(tree, path), [tree, path])
  const branch = path[path.length - 1]
  const parent = path[path.length - 2]
  const lanes = path.length
  const width = PAD * 2 + (lanes - 1) * LANE
  const list = useRef<HTMLDivElement>(null)
  const x = (lane: number) => PAD + lane * LANE
  const y = (i: number) => i * ROW + ROW / 2

  const selectedIndex = rows.findIndex((r) => rowId(r) === selected?.id)
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const selectable = rows.map((r, i) => (rowId(r) ? i : -1)).filter((i) => i >= 0)
  const onKeyDown = (e: KeyboardEvent) => {
    const at = selectable.indexOf(selectedIndex)
    let next: number | undefined
    if (e.key === 'ArrowDown') next = selectable[Math.min(at + 1, selectable.length - 1)]
    else if (e.key === 'ArrowUp') next = selectable[Math.max(at - 1, 0)]
    else if (e.key === 'ArrowLeft' && parent) {
      e.preventDefault()
      onFocus(parent.name)
      return
    } else if (e.key === 'ArrowRight') {
      const kid = branch.children.map((k) => tree.branches.get(k)!).find((k) => k.state !== 'merged') ?? tree.branches.get(branch.children[0] ?? '')
      if (kid) {
        e.preventDefault()
        onFocus(kid.name)
      }
      return
    } else return
    e.preventDefault()
    const r = next !== undefined ? rows[next] : undefined
    if (r?.kind === 'commit') onSelect({ kind: 'commit', id: r.commit.id })
    if (r?.kind === 'layer') onSelect({ kind: 'layer', id: r.layer.id })
  }

  // Each lane runs from the row its fork point sits on to its newest row.
  const segments = path.map((b, lane) => {
    const own = rows.map((r, i) => (r.lane === lane ? i : -1)).filter((i) => i >= 0)
    const top = Math.min(...own)
    const bottom = Math.max(...own)
    const forkRow = lane > 0 ? rows.findIndex((r) => rowId(r) === b.forkedFrom?.id) : -1
    return { b, lane, top, bottom, forkRow }
  })
  const mainFork = path[1] ? rows.findIndex((r) => rowId(r) === path[1].forkedFrom?.id) : -1
  const forkPoints = new Set(path.slice(1).map((b) => b.forkedFrom?.id))
  const firstOfLane = new Map(segments.map((s) => [s.top, s.b]))
  // Long ancestries keep main, the parent and the Branch; the middle folds into a menu.
  const crumbs: { b?: ForkBranch; folded?: ForkBranch[] }[] =
    path.length > 3
      ? [{ b: path[0] }, { folded: path.slice(1, -2) }, { b: path[path.length - 2] }, { b: path[path.length - 1] }]
      : path.map((b) => ({ b }))

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-r">
      <header className="flex flex-col gap-2 border-b px-4 py-3">
        <nav aria-label="Fork ancestry" className="flex min-w-0 items-center gap-1 text-[13px]">
          {crumbs.map(({ b, folded }, i) => (
            <span key={b?.name ?? 'folded'} className={cn('flex items-center gap-1', i === crumbs.length - 1 ? 'min-w-0' : 'min-w-0 shrink')}>
              {i > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-faint" />}
              {folded ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`${folded.length} more ancestors`}
                    className="flex h-5 items-center rounded px-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {folded.map((f) => (
                      <DropdownMenuItem key={f.name} onSelect={() => onFocus(f.name)}>
                        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: laneColor(f.depth) }} />
                        {f.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : !b ? null : i === crumbs.length - 1 ? (
                <span aria-current="page" className="truncate font-semibold">
                  {b.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onFocus(b.name)}
                  className="truncate rounded text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {b.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <p title={branch.forkedFrom ? `Forked from ${parent?.name} at ${branch.forkedFrom.id}` : undefined} className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {branch.name === 'main'
              ? `${tree.layers.length} Layer${tree.layers.length === 1 ? '' : 's'} · the published line new mounts start from`
              : `Forked from ${parent?.name} at ${branch.forkedFrom?.id} · ${branch.commits.length} Commit${branch.commits.length === 1 ? '' : 's'} · ${branch.children.length} fork${branch.children.length === 1 ? '' : 's'}${branch.state === 'merged' ? ' · merged' : branch.state === 'published' ? ` · published as ${branch.publishedAs}` : ''}`}
          </p>
          <div className="flex shrink-0 gap-1">
            <Unavailable reason={HOST}>
              <Button variant="ghost" size="sm" disabled>
                <GitFork /> Fork
              </Button>
            </Unavailable>
            {parent && (
              <>
                <Unavailable reason={`Merging into ${parent.name} needs the LayerFS host process`}>
                  <Button variant="outline" size="sm" disabled>
                    <GitMerge /> Merge
                  </Button>
                </Unavailable>
                <Unavailable reason={HOST}>
                  <Button size="sm" disabled>
                    <Upload /> Publish
                  </Button>
                </Unavailable>
              </>
            )}
          </div>
        </div>
      </header>

      <div
        ref={list}
        role="listbox"
        aria-label={`Ancestry of ${branch.name}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="relative" style={{ height: rows.length * ROW + 8 }}>
          <svg aria-hidden="true" width={width} height={rows.length * ROW} className="absolute top-0 left-0">
            {segments.map(({ b, lane, top, bottom, forkRow }) => {
              const color = laneColor(b.depth)
              if (lane === 0) {
                const split = mainFork >= 0 ? mainFork : top
                return (
                  <g key={b.name}>
                    {split > top && <line x1={x(0)} x2={x(0)} y1={y(top)} y2={y(split)} stroke={color} strokeWidth={3} opacity={0.3} />}
                    <line x1={x(0)} x2={x(0)} y1={y(split)} y2={rows[bottom]?.kind === 'earlier' ? (bottom + 1) * ROW : y(bottom)} stroke={color} strokeWidth={3} />
                  </g>
                )
              }
              if (forkRow < 0) return null
              const bend = y(forkRow) - ROW * 0.55
              return (
                <path
                  key={b.name}
                  d={`M${x(lane - 1)} ${y(forkRow)} C${x(lane - 1)} ${bend} ${x(lane)} ${y(forkRow) - ROW * 0.2} ${x(lane)} ${bend} L${x(lane)} ${y(top)}`}
                  stroke={color}
                  strokeWidth={2}
                  fill="none"
                  strokeDasharray={rows[top]?.kind === 'empty' ? '3 3' : undefined}
                />
              )
            })}
            {rows.map((r, i) => {
              const color = laneColor(path[r.lane].depth)
              const on = rowId(r) === selected?.id
              if (r.kind === 'layer')
                return (
                  <rect key={i} x={x(0) - 5} y={y(i) - 5} width={10} height={10} rx={2} fill={color} opacity={r.dim ? 0.35 : 1} stroke={on ? 'var(--foreground)' : 'none'} strokeWidth={2} />
                )
              if (r.kind === 'commit') {
                const hollow = forkPoints.has(r.commit.id)
                return (
                  <circle key={i} cx={x(r.lane)} cy={y(i)} r={hollow ? 5 : 4.5} fill={hollow ? 'var(--card)' : color} stroke={on ? 'var(--foreground)' : color} strokeWidth={hollow || on ? 2 : 0} />
                )
              }
              if (r.kind === 'empty')
                return <circle key={i} cx={x(r.lane)} cy={y(i)} r={4.5} fill="var(--card)" stroke={color} strokeWidth={1.5} strokeDasharray="2 2" />
              return null
            })}
          </svg>

          {rows.map((r, i) => (
            <RowLine
              key={rowId(r) ?? `${r.kind}-${i}`}
              row={r}
              top={i * ROW}
              indent={width}
              project={project}
              tree={tree}
              selected={rowId(r) === selected?.id}
              label={firstOfLane.get(i)}
              onSelect={onSelect}
              onFocus={onFocus}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

interface RowLineProps {
  row: Row
  top: number
  indent: number
  project: Project
  tree: ForkTree
  selected: boolean
  /** The Branch whose lane starts on this row, labelled once. */
  label?: ForkBranch
  onSelect: (item: HistoryItem) => void
  onFocus: (name: string) => void
}

function RowLine({ row, top, indent, project, tree, selected, label, onSelect, onFocus }: RowLineProps) {
  const style = { top, height: ROW, paddingLeft: indent + 4 }
  if (row.kind === 'earlier' || row.kind === 'empty')
    return (
      <div className="absolute inset-x-0 flex items-center pr-4 text-xs text-faint italic" style={style}>
        {row.kind === 'earlier' ? `${row.count} earlier ${row.of}` : 'No Commits yet: forked, nothing committed'}
      </div>
    )

  const id = row.kind === 'commit' ? row.commit.id : row.layer.id
  const message = row.kind === 'commit' ? row.commit.message : row.layer.message
  const when = row.kind === 'commit' ? row.commit.ago : row.layer.ago
  const by = row.kind === 'commit' ? row.commit.by : undefined
  const dim = row.kind === 'layer' && row.dim
  const shownForks = row.forks.slice(0, 1)

  return (
    <div className="absolute inset-x-0 flex items-center gap-2 pr-3" style={{ top, height: ROW, paddingLeft: indent }}>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        aria-current={selected ? 'true' : undefined}
        tabIndex={-1}
        onClick={() => onSelect({ kind: row.kind, id })}
        className={cn(
          'flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none',
          selected ? 'bg-accent' : 'hover:bg-muted/60',
        )}
      >
        <span className={cn('w-9 shrink-0 font-mono text-xs', dim ? 'text-faint' : 'text-foreground')}>{id}</span>
        {label && label.name !== 'main' && (
          <span
            role="link"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onFocus(label.name)
            }}
            className="max-w-[7.5rem] shrink-0 cursor-pointer truncate rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-current/30 ring-inset hover:underline"
            style={{ color: laneColor(label.depth) }}
          >
            {label.name}
          </span>
        )}
        {row.kind === 'commit' && (
          <span
            title={by ? `${by.agent} · ${project.sessions.find((s) => s.id === by.session)?.title ?? by.session}` : 'Made outside Connect'}
            className={cn('size-1.5 shrink-0 rounded-full', by ? AGENT_DOT[by.agent] : 'ring-1 ring-faint')}
          />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-[13px]', dim && 'text-faint')}>{message}</span>
        <span className="shrink-0 text-right text-xs whitespace-nowrap text-faint">{when.replace(' ago', '')}</span>
      </button>
      {shownForks.length > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          {shownForks.map((name) => {
            const kid = tree.branches.get(name)
            return (
              <button
                key={name}
                type="button"
                tabIndex={-1}
                onClick={() => onFocus(name)}
                title={`Open ${name}, forked here`}
                className={cn(
                  'flex max-w-[7.5rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] hover:bg-muted',
                  kid?.state === 'merged' ? 'text-faint' : 'text-muted-foreground',
                )}
              >
                <CornerDownRight aria-hidden="true" className="size-3 shrink-0" style={{ color: kid ? laneColor(kid.depth) : undefined }} />
                <span className="truncate">{name}</span>
              </button>
            )
          })}
          {row.forks.length > 1 && <span title={row.forks.slice(1).join(', ')} className="text-[11px] text-faint">+{row.forks.length - 1}</span>}
        </span>
      )}
    </div>
  )
}
