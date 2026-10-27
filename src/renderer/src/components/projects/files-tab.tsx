import { ChevronRight, FileText, Folder, FolderOpen, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { CodeView } from '@/components/projects/code-view'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { branchesFor, forkTreeFor } from '@/data/forks'
import { type TreeNode, blameFor, fileText, treeFor } from '@/data/repo'
import type { Project } from '@/data/sample'
import { cn } from '@/lib/utils'

/** A small coloured badge per file type, so the tree scans quickly. */
function FileBadge({ name }: { name: string }) {
  const [text, tone] =
    name === 'package.json'
      ? ['npm', 'text-[#c4502a] bg-[#c4502a]/10']
      : name.endsWith('-lock.json')
        ? ['lock', 'text-faint bg-muted']
        : name === '.gitignore'
          ? ['git', 'text-[#e0703a] bg-[#e0703a]/10']
          : name.endsWith('.sh')
            ? ['$', 'text-success bg-success/10']
            : name.endsWith('.md')
              ? ['i', 'text-primary bg-primary/10']
              : /\.tsx?$/.test(name)
                ? ['TS', 'text-[#2d5bb5] bg-[#2d5bb5]/10']
                : name.endsWith('.json')
                  ? ['{}', 'text-warning bg-warning/10']
                  : ['', '']
  if (!text) return <FileText aria-hidden="true" className="size-4 shrink-0 text-faint" />
  return (
    <span
      aria-hidden="true"
      className={cn('flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-0.5 font-mono text-[8.5px] font-semibold', tone)}
    >
      {text}
    </span>
  )
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => (n.kind === 'dir' ? flatten(n.children ?? []) : [n]))
}

interface TreeProps {
  nodes: TreeNode[]
  depth: number
  open: Set<string>
  selected?: string
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
}

function Tree({ nodes, depth, open, selected, onToggle, onOpenFile }: TreeProps) {
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Files' : undefined}>
      {nodes.map((n) => {
        const expanded = open.has(n.path)
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.kind === 'dir' ? expanded : undefined} aria-selected={n.path === selected}>
            <button
              type="button"
              onClick={() => (n.kind === 'dir' ? onToggle(n.path) : onOpenFile(n.path))}
              style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
              className={cn(
                'flex w-full items-center gap-2 py-1 pr-3 text-left text-[13px] outline-none focus-visible:bg-muted',
                n.path === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
              )}
            >
              {n.kind === 'dir' ? (
                <>
                  <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-faint transition-transform', expanded && 'rotate-90')} />
                  {expanded ? (
                    <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-primary/80" />
                  ) : (
                    <Folder aria-hidden="true" className={cn('size-4 shrink-0', n.name.startsWith('.') || n.name === 'node_modules' ? 'text-faint' : 'text-primary/80')} />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  <FileBadge name={n.name} />
                </>
              )}
              <span className="truncate">{n.name}</span>
            </button>
            {n.kind === 'dir' && expanded && (
              <Tree nodes={n.children ?? []} depth={depth + 1} open={open} selected={selected} onToggle={onToggle} onOpenFile={onOpenFile} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function FilesTab({ project, initialMode = 'file' }: { project: Project; initialMode?: 'file' | 'blame' }) {
  const tree = useMemo(() => treeFor(project), [project])
  const branches = branchesFor(project)
  const layers = forkTreeFor(project).layers
  const [ref, setRef] = useState('main')
  const [open, setOpen] = useState<Set<string>>(new Set(['/app']))
  const [tabs, setTabs] = useState<string[]>(['/serve.sh'])
  const [active, setActive] = useState<string | undefined>('/serve.sh')
  const [mode, setMode] = useState<'file' | 'blame'>(initialMode)
  const [query, setQuery] = useState('')

  const text = active ? fileText(project, active) : undefined
  const blame = useMemo(
    () => (active && text !== undefined && mode === 'blame' ? blameFor(project, active, text.split('\n').length) : undefined),
    [project, active, text, mode],
  )
  const refLabel = branches.find((b) => b.name === ref)
    ? `${ref} · ${branches.find((b) => b.name === ref)?.head}`
    : `${ref} · ${layers.find((l) => l.id === ref)?.message ?? ''}`

  const openFile = (path: string) => {
    setTabs((all) => (all.includes(path) ? all : [...all, path]))
    setActive(path)
  }
  const closeFile = (path: string) => {
    const next = tabs.filter((p) => p !== path)
    setTabs(next)
    if (active === path) setActive(next[next.length - 1])
  }
  const matches = query.trim() ? flatten(tree).filter((n) => n.path.toLowerCase().includes(query.trim().toLowerCase())) : []

  return (
    <div className="grid h-[calc(100svh-13.5rem)] min-h-[28rem] grid-cols-[17rem_minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card">
      <aside className="flex min-h-0 flex-col border-r">
        <div className="flex flex-col gap-2 border-b p-3">
          <Select value={ref} onValueChange={setRef}>
            <SelectTrigger aria-label="Ref" className="w-full">
              <SelectValue>{refLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Branches</SelectLabel>
                {branches.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    <span className="font-medium">{b.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{b.head}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Layers on main</SelectLabel>
                {layers.slice(0, 6).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    <span className="font-mono text-xs">{l.id}</span>
                    <span className="max-w-48 truncate text-muted-foreground">{l.message}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              aria-label="Find files"
              placeholder="Find files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 pl-7 text-[13px]"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {query.trim() ? (
            matches.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No file paths match.</p>
            ) : (
              <ul aria-label="Matching files">
                {matches.map((n) => (
                  <li key={n.path}>
                    <button
                      type="button"
                      onClick={() => openFile(n.path)}
                      className={cn('flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-muted/70', n.path === active && 'bg-accent')}
                    >
                      <FileBadge name={n.name} />
                      <span className="truncate font-mono text-xs">{n.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Tree
              nodes={tree}
              depth={0}
              open={open}
              selected={active}
              onToggle={(p) =>
                setOpen((all) => {
                  const next = new Set(all)
                  if (next.has(p)) next.delete(p)
                  else next.add(p)
                  return next
                })
              }
              onOpenFile={openFile}
            />
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div role="tablist" aria-label="Open files" className="flex min-h-10 items-end gap-0.5 overflow-x-auto border-b bg-muted/30 px-2 pt-1.5">
          {tabs.map((p) => (
            <div
              key={p}
              role="tab"
              aria-selected={p === active}
              className={cn(
                'group flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-[13px]',
                p === active ? 'border-border bg-card' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <button type="button" onClick={() => setActive(p)} className="flex items-center gap-1.5 font-mono text-xs outline-none">
                <FileBadge name={p.split('/').pop() ?? p} />
                {p.split('/').pop()}
              </button>
              <button
                type="button"
                aria-label={`Close ${p}`}
                onClick={() => closeFile(p)}
                className="rounded p-0.5 text-faint opacity-60 hover:bg-muted hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>

        {active ? (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-2">
              <div role="radiogroup" aria-label="View" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
                {(['file', 'blame'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'rounded-md px-2.5 py-0.5 text-xs font-medium capitalize',
                      mode === m ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <span className="truncate font-mono text-xs text-muted-foreground">{active}</span>
              {text !== undefined && (
                <span className="ml-auto shrink-0 text-xs text-faint">
                  {text.split('\n').length - 1} lines · at {ref}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {text !== undefined ? (
                <CodeView path={active} text={text} blame={blame} />
              ) : (
                <p className="p-6 text-sm text-muted-foreground">This sample has no contents for {active}.</p>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <FileText aria-hidden="true" className="size-6 text-faint" />
            <p className="text-sm font-medium">Open a file from the tree</p>
            <p className="text-xs text-muted-foreground">Files open read-only, at the ref picked above the tree.</p>
          </div>
        )}
      </section>
    </div>
  )
}
