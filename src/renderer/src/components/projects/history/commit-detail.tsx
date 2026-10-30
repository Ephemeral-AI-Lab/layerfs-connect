import { t, useI18n } from '@/i18n'
import './history.css'

import { FileMinus, FilePen, FilePlus, FileSymlink, GitCommitHorizontal, type LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import { revealStyle } from '@/components/motion'
import { AgentDot, laneColor } from '@/components/projects/history/branch-tree'
import type { HistoryItem } from '@/components/projects/history/lineage-graph'
import { HashChip } from '@/components/projects/history/parts'
import { Chip } from '@/components/storage/chips'
import type { FileChange, ForkTree } from '@/data/forks'
import { shortId, when } from '@/data/format'
import { cn } from '@/lib/utils'

const CHANGE: Record<string, { icon: LucideIcon; tone: string; bg: string; label: string; sign: string }> = {
  added: { icon: FilePlus, tone: 'text-success', bg: 'bg-success/10', label: 'added', sign: '+' },
  deleted: { icon: FileMinus, tone: 'text-destructive', bg: 'bg-destructive/10', label: 'deleted', sign: '−' },
  removed: { icon: FileMinus, tone: 'text-destructive', bg: 'bg-destructive/10', label: 'removed', sign: '−' },
  modified: { icon: FilePen, tone: 'text-warning', bg: 'bg-warning/10', label: 'modified', sign: '~' },
  changed: { icon: FilePen, tone: 'text-warning', bg: 'bg-warning/10', label: 'changed', sign: '~' },
  renamed: { icon: FileSymlink, tone: 'text-primary', bg: 'bg-primary/10', label: 'renamed', sign: '→' },
}
const changeOf = (kind: string) =>
  CHANGE[kind.toLowerCase()] ?? { icon: FilePen, tone: 'text-muted-foreground', bg: 'bg-muted', label: kind, sign: '·' }

/** A path's folder, faint, then its name. */
function PathName({ path }: { path: string }) {
  useI18n()
  const at = path.lastIndexOf('/')
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
      {at >= 0 && <span className="text-faint">{path.slice(0, at + 1)}</span>}
      {path.slice(at + 1)}
    </span>
  )
}

function Changes({ changes }: { changes: FileChange[] }) {
  useI18n()
  if (changes.length === 0)
    return <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-faint">{t("LayerFS listed no changed paths with this entry.")}</p>
  // One tally per kind, in the order they first appear.
  const tally = new Map<string, number>()
  for (const ch of changes) tally.set(changeOf(ch.kind).label, (tally.get(changeOf(ch.kind).label) ?? 0) + 1)
  return (
    <Section
      title={t(changes.length === 1 ? "{count} path changed" : "{count} paths changed", {count: changes.length})}
      aside={
        <span className="flex gap-2 font-mono text-[11px] tabular-nums">
          {[...tally].map(([label, n]) => {
            const c = changeOf(label)
            return (
              <span key={label} title={t("{value1} {value2}", {value1: n, value2: label})} className={c.tone}>
                {c.sign}
                {n}
              </span>
            )
          })}
        </span>
      }
    >
      <ul className="overflow-hidden rounded-xl border bg-card shadow-[var(--highlight)]">
        {changes.map((ch, i) => {
          const c = changeOf(ch.kind)
          return (
            <li
              key={`${ch.kind}:${ch.path}`}
              className="reveal flex items-center gap-2.5 border-t px-2.5 py-1.5 transition-colors first:border-t-0 hover:bg-muted/50"
              style={revealStyle(i + 2)}
            >
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', c.bg)}>
                <c.icon aria-hidden="true" className={cn('size-3', c.tone)} />
              </span>
              <PathName path={ch.path} />
              <span className={cn('shrink-0 text-[11px]', c.tone)}>{t(c.label)}</span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** A titled part of the detail. */
function Section({ title, aside, children, index = 1 }: { title: string; aside?: ReactNode; children: ReactNode; index?: number }) {
  useI18n()
  return (
    <div className="reveal flex flex-col gap-1.5" style={revealStyle(index)}>
      <div className="flex items-center gap-2">
        <h4 className="hist-eyebrow">{title}</h4>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      {children}
    </div>
  )
}

/** A Branch name in its lane colour, opening its lineage. */
function BranchLink({ name, depth, quiet, children, onFocus }: { name: string; depth: number; quiet?: boolean; children?: ReactNode; onFocus: (name: string) => void }) {
  useI18n()
  return (
    <button
      type="button"
      onClick={() => onFocus(name)}
      title={t("Open {value1}", {value1: name})}
      className={cn(
        'lane-chip flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
        quiet && 'opacity-60',
      )}
      style={{ '--lane': laneColor(depth) } as CSSProperties}
    >
      <span className="truncate">{name}</span>
      {children}
    </button>
  )
}

interface CommitDetailProps {
  tree: ForkTree
  item?: HistoryItem
  onFocus: (name: string) => void
}

/** The selected Commit or Layer: who made it, where it sits, what it changed. */
export function CommitDetail({ tree, item, onFocus }: CommitDetailProps) {
  useI18n()
  const commit = item?.kind === 'commit' ? tree.commits.get(item.id) : undefined
  const layer = item?.kind === 'layer' ? tree.layers.find((l) => l.id === item.id) : undefined
  if (!commit && !layer)
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl border bg-card text-faint shadow-[var(--highlight),var(--elev-1)]">
          <GitCommitHorizontal aria-hidden="true" className="size-5" />
        </span>
        <p className="text-sm text-muted-foreground">{t("Pick a Commit or a Layer to see what it changed.")}</p>
      </div>
    )

  const id = commit?.id ?? layer?.id ?? ''
  const at = commit?.at ?? layer?.at
  const branch = commit ? tree.branches.get(commit.branch) : tree.branches.get('main')
  const forks = [...tree.branches.values()].filter((b) => b.forkedFrom?.id === id)
  const isHead = commit && branch?.commits[0]?.id === commit.id
  const mergedFrom = commit?.merged ? tree.commits.get(commit.merged) : undefined
  const from = layer?.from ? tree.branches.get(layer.from) : undefined

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="reveal">
        <div className="flex flex-wrap items-center gap-1.5">
          <HashChip id={id} on className="text-xs" />
          {layer && <Chip tone="neutral">{t("Layer on main")}</Chip>}
          {layer && layer.id === tree.layers[0]?.id && <Chip tone="info">{t("Head of main")}</Chip>}
          {isHead && <Chip tone="info">{t("Head")}</Chip>}
          {commit?.merged && <Chip tone="neutral">{t("Merge")}</Chip>}
        </div>
        <h3 className="mt-2.5 text-[15px] leading-snug font-semibold tracking-[-0.01em] break-words">{commit?.message ?? layer?.message}</h3>
      </div>

      <dl className="reveal grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-xl border bg-card/60 px-3 py-2.5 text-[13px] shadow-[var(--highlight)]" style={revealStyle(1)}>
        {commit ? (
          <>
            <dt className="text-xs text-faint">{t("On")}</dt>
            <dd className="flex min-w-0">{branch && <BranchLink name={branch.name} depth={branch.depth} onFocus={onFocus} />}</dd>
            <dt className="text-xs text-faint">{t("By")}</dt>
            <dd className="min-w-0">
              {commit.by ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <AgentDot tree={tree} agent={commit.by} />
                  <span className="truncate">{commit.by}</span>
                </span>
              ) : (
                <span className="text-faint italic">{t("no agent recorded")}</span>
              )}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-xs text-faint">{t("From")}</dt>
            <dd className="flex min-w-0 text-muted-foreground">
              {from ? (
                <BranchLink name={from.name} depth={from.depth} onFocus={onFocus} />
              ) : (
                <span>{tree.layers[tree.layers.length - 1]?.id === layer?.id ? t("Init") : t("Published to main")}</span>
              )}
            </dd>
          </>
        )}
        <dt className="text-xs text-faint">{t("When")}</dt>
        <dd className="truncate text-muted-foreground tabular-nums" title={when(at)}>
          {commit?.ago ?? layer?.ago}
        </dd>
        <dt className="text-xs text-faint">{t("Id")}</dt>
        <dd className="truncate font-mono text-xs text-muted-foreground" title={id}>
          {id}
        </dd>
      </dl>

      {mergedFrom && (
        <Section title={t("Merged in")} index={2}>
          <div className="flex">
            <BranchLink name={mergedFrom.branch} depth={tree.branches.get(mergedFrom.branch)?.depth ?? 1} onFocus={onFocus}>
              <span className="font-mono font-normal opacity-70">{shortId(mergedFrom.id)}</span>
            </BranchLink>
          </div>
        </Section>
      )}

      {forks.length > 0 && (
        <Section title={t("Forked here")} index={2} aside={<span className="text-[11px] text-faint tabular-nums">{forks.length}</span>}>
          <div className="flex flex-wrap gap-1.5">
            {forks.map((b) => (
              <BranchLink key={b.name} name={b.name} depth={b.depth} quiet={b.state === 'merged'} onFocus={onFocus}>
                <span className="font-mono font-normal opacity-70">+{b.commits.length}</span>
              </BranchLink>
            ))}
          </div>
        </Section>
      )}

      {commit ? (
        <Changes changes={commit.changes} />
      ) : (
        <p className="reveal text-xs leading-relaxed text-faint" style={revealStyle(2)}>{t("A Layer is main's whole tree at a publish; its Commits hold the changes.")}</p>
      )}
    </div>
  )
}
