import { ChevronRight, FileQuestion, FileText, Folder, FolderOpen, Link2, LoaderCircle, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CodeView } from '@/components/projects/code-view'
import { LoadError, Loading, explain } from '@/components/projects/states'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { bytes, shortId } from '@/data/format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { cn } from '@/lib/utils'
import type { BranchInfo, FsEntry } from '@shared/host-api'

/** A small coloured badge per file type, so the tree scans quickly. */
function FileBadge({ entry }: { entry: Pick<FsEntry, 'name' | 'kind'> }) {
  const { name } = entry
  if (entry.kind === 'symlink') return <Link2 aria-hidden="true" className="size-4 shrink-0 text-faint" />
  const [text, tone] =
    name === 'package.json'
      ? ['npm', 'text-[#c4502a] bg-[#c4502a]/10']
      : name.endsWith('-lock.json') || name.endsWith('.lock')
        ? ['lock', 'text-faint bg-muted']
        : name === '.gitignore'
          ? ['git', 'text-[#e0703a] bg-[#e0703a]/10']
          : name.endsWith('.sh')
            ? ['$', 'text-success bg-success/10']
            : name.endsWith('.md')
              ? ['i', 'text-primary bg-primary/10']
              : /\.[cm]?[tj]sx?$/.test(name)
                ? [/\.[cm]?tsx?$/.test(name) ? 'TS' : 'JS', 'text-[#2d5bb5] bg-[#2d5bb5]/10']
                : name.endsWith('.json')
                  ? ['{}', 'text-warning bg-warning/10']
                  : name.endsWith('.py')
                    ? ['py', 'text-[#3572a5] bg-[#3572a5]/10']
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

/** A folder's entries, its read in progress, or why it failed. */
type Dir = FsEntry[] | 'loading' | Error

const byKind = (a: FsEntry, b: FsEntry) =>
  Number(b.kind === 'dir') - Number(a.kind === 'dir') || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

interface TreeProps {
  path: string
  depth: number
  dirs: Map<string, Dir>
  open: Set<string>
  selected?: string
  onToggle: (path: string) => void
  onOpenFile: (entry: FsEntry) => void
}

function Tree({ path, depth, dirs, open, selected, onToggle, onOpenFile }: TreeProps) {
  const dir = dirs.get(path)
  const pad = { paddingLeft: `${0.5 + depth * 1 + (depth > 0 ? 1.375 : 0)}rem` }
  if (dir === undefined || dir === 'loading')
    return (
      <p style={pad} className="flex items-center gap-2 py-1 text-xs text-faint">
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" /> Reading…
      </p>
    )
  if (dir instanceof Error)
    return (
      <p style={pad} className="py-1 pr-3 text-xs text-destructive" title={dir.message}>
        {explain(dir, 'this folder').title}
      </p>
    )
  if (dir.length === 0)
    return (
      <p style={pad} className="py-1 text-xs text-faint italic">
        Empty folder
      </p>
    )
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Files' : undefined}>
      {[...dir].sort(byKind).map((n) => {
        const expanded = open.has(n.path)
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.kind === 'dir' ? expanded : undefined} aria-selected={n.path === selected}>
            <button
              type="button"
              onClick={() => (n.kind === 'dir' ? onToggle(n.path) : onOpenFile(n))}
              title={n.kind === 'dir' ? n.path : `${n.path} · ${bytes(n.size)}`}
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
                    <Folder
                      aria-hidden="true"
                      className={cn('size-4 shrink-0', n.name.startsWith('.') || n.name === 'node_modules' ? 'text-faint' : 'text-primary/80')}
                    />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  <FileBadge entry={n} />
                </>
              )}
              <span className="truncate">{n.name}</span>
            </button>
            {n.kind === 'dir' && expanded && (
              <Tree path={n.path} depth={depth + 1} dirs={dirs} open={open} selected={selected} onToggle={onToggle} onOpenFile={onOpenFile} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function FileBody({ project, branch, path, tick }: { project: string; branch: string; path: string; tick: number }) {
  const q = useHostQuery(() => host.file(project, branch, path), [project, branch, path, tick])
  // A file read for another ref or path is not this one's.
  const data = q.data?.path === path ? q.data : undefined
  return (
    <>
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
        <span className="ml-auto shrink-0 text-xs text-faint">
          {data &&
            (data.text !== null ? `${data.text.split('\n').length - (data.text.endsWith('\n') ? 1 : 0)} lines · ` : '')}
          {data && `${bytes(data.size)} · `}at {branch}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {!data ? (
          q.error ? (
            <LoadError error={q.error} what={path} onRetry={q.reload} className="m-6" />
          ) : (
            <Loading label="Reading the file" />
          )
        ) : data.text !== null ? (
          <CodeView path={path} text={data.text} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FileQuestion aria-hidden="true" className="size-6 text-faint" />
            <p className="text-sm font-medium">{data.binary ? 'A binary file' : 'Too large to show'}</p>
            <p className="text-xs text-muted-foreground">
              {bytes(data.size)}
              {data.binary ? '; only text files open here.' : '; files over 1 MiB open only their size.'}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

interface FilesTabProps {
  /** The LayerFS project. */
  project: string
  branches: BranchInfo[]
  /** Changes when the run moved on, so open folders and the file reload. */
  tick?: number
  /** Dev aid: the Branch to open on. */
  initialBranch?: string
}

export function FilesTab({ project, branches, tick = 0, initialBranch }: FilesTabProps) {
  const [ref, setRef] = useState(() => (initialBranch && branches.some((b) => b.name === initialBranch) ? initialBranch : 'main'))
  const [dirs, setDirs] = useState<Map<string, Dir>>(new Map())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const openRef = useRef(open)
  openRef.current = open

  const load = useCallback(
    (path: string, keep = false) => {
      if (!keep) setDirs((all) => new Map(all).set(path, 'loading'))
      host.list(project, ref, path).then(
        (entries) => setDirs((all) => new Map(all).set(path, entries)),
        (e: unknown) => setDirs((all) => new Map(all).set(path, e instanceof Error ? e : new Error(String(e)))),
      )
    },
    [project, ref],
  )
  // A new ref starts from its root; the folders open stay open there.
  useEffect(() => {
    setDirs(new Map())
    for (const path of ['/', ...openRef.current]) load(path)
  }, [load])
  // As the run moves on, reread what is on screen in place.
  const firstTick = useRef(tick)
  useEffect(() => {
    if (tick === firstTick.current) return
    for (const path of ['/', ...openRef.current]) load(path, true)
  }, [tick, load])

  // The first time the root is read, open its README, the way a repository page does.
  const root = dirs.get('/')
  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current || !(root instanceof Array)) return
    greeted.current = true
    const readme = root.find((e) => e.kind === 'file' && /^readme(\.md|\.txt)?$/i.test(e.name))
    if (readme && tabs.length === 0) {
      setTabs([readme.path])
      setActive(readme.path)
    }
  }, [root, tabs.length])

  const toggle = (path: string) => {
    const next = new Set(open)
    if (next.has(path)) next.delete(path)
    else {
      next.add(path)
      if (!(dirs.get(path) instanceof Array)) load(path)
    }
    setOpen(next)
  }
  const openFile = (entry: FsEntry) => {
    setTabs((all) => (all.includes(entry.path) ? all : [...all, entry.path]))
    setActive(entry.path)
  }
  const closeFile = (path: string) => {
    const next = tabs.filter((p) => p !== path)
    setTabs(next)
    if (active === path) setActive(next[next.length - 1])
  }

  const q = query.trim().toLowerCase()
  const loaded = [...dirs.values()].flatMap((d) => (d instanceof Array ? d : []))
  const matches = q ? loaded.filter((n) => n.kind !== 'dir' && n.path.toLowerCase().includes(q)).slice(0, 200) : []
  const branch = branches.find((b) => b.name === ref)
  const others = branches.filter((b) => b.name !== 'main')

  return (
    <div className="grid h-[calc(100svh-13.5rem)] min-h-[28rem] grid-cols-[17rem_minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card">
      <aside className="flex min-h-0 flex-col border-r">
        <div className="flex flex-col gap-2 border-b p-3">
          <Select value={ref} onValueChange={setRef}>
            <SelectTrigger aria-label="Branch" className="w-full">
              <SelectValue>
                {ref} {branch?.head && <span className="font-mono text-xs text-muted-foreground">· {shortId(branch.head)}</span>}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Published</SelectLabel>
                <SelectItem value="main">
                  <span className="font-medium">main</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {shortId(branches.find((b) => b.name === 'main')?.head)}
                  </span>
                </SelectItem>
              </SelectGroup>
              {others.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Branches</SelectLabel>
                  {others.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      <span className={cn('font-medium', b.state === 'merged' && 'text-muted-foreground')}>{b.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {b.state === 'open' ? `+${b.commits}` : b.state}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input
              aria-label="Find in opened folders"
              placeholder="Find in opened folders"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 pl-7 text-[13px]"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {q ? (
            matches.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No file in the opened folders matches.</p>
            ) : (
              <ul aria-label="Matching files">
                {matches.map((n) => (
                  <li key={n.path}>
                    <button
                      type="button"
                      onClick={() => openFile(n)}
                      className={cn('flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-muted/70', n.path === active && 'bg-accent')}
                    >
                      <FileBadge entry={n} />
                      <span className="truncate font-mono text-xs">{n.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <Tree path="/" depth={0} dirs={dirs} open={open} selected={active} onToggle={toggle} onOpenFile={openFile} />
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div role="tablist" aria-label="Open files" className="flex min-h-10 items-end gap-0.5 overflow-x-auto border-b bg-muted/30 px-2 pt-1.5">
          {tabs.map((p) => {
            const name = p.split('/').pop() ?? p
            return (
              <div
                key={p}
                role="tab"
                aria-selected={p === active}
                className={cn(
                  'group flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-[13px]',
                  p === active ? 'border-border bg-card' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <button type="button" title={p} onClick={() => setActive(p)} className="flex items-center gap-1.5 font-mono text-xs outline-none">
                  <FileBadge entry={{ name, kind: 'file' }} />
                  {name}
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
            )
          })}
        </div>

        {active ? (
          <FileBody project={project} branch={ref} path={active} tick={tick} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <FileText aria-hidden="true" className="size-6 text-faint" />
            <p className="text-sm font-medium">Open a file from the tree</p>
            <p className="text-xs text-muted-foreground">Files open read-only, at the Branch picked above the tree.</p>
          </div>
        )}
      </section>
    </div>
  )
}
