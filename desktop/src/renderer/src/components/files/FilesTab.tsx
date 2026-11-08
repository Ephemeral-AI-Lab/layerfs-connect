import { fill as t } from '@/lib/text'
import './files.css'

import { ChevronRight, FileText, Folder, FolderOpen, Link2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { SavedFileExplorer } from './SavedFileExplorer'
import { FileExplorerPreview } from './FileExplorerPreview'
import { previewEntries } from './file-preview-data'
import { SearchField } from './SearchField'
import { explain } from '@/components/layerfs/States'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { bytes, shortId } from '@/layerfs/format'
import { call, host } from '@/layerfs/client'
import { cn } from '@/lib/utils'
import type { BranchInfo, FsEntry } from '@/layerfs/host-api'

/** A small coloured badge per file type, so the tree scans quickly. */
function FileBadge({ entry }: { entry: Pick<FsEntry, 'name' | 'kind'> }) {
  const { name } = entry
  if (entry.kind === 'symlink') return <Link2 aria-hidden="true" className="size-4 shrink-0 text-faint" />
  const [text, tone] =
    name === 'package.json'
      ? ['npm', 'text-(--file-npm) bg-(--file-npm)/10']
      : name.endsWith('-lock.json') || name.endsWith('.lock')
        ? ['lock', 'text-faint bg-muted']
        : name === '.gitignore'
          ? ['git', 'text-(--file-git) bg-(--file-git)/10']
          : name.endsWith('.sh')
            ? ['$', 'text-success bg-success/10']
            : name.endsWith('.md')
              ? ['i', 'text-(--icon-accent) bg-primary/10']
              : /\.[cm]?[tj]sx?$/.test(name)
                ? [/\.[cm]?tsx?$/.test(name) ? 'TS' : 'JS', 'text-(--file-script) bg-(--file-script)/10']
                : name.endsWith('.json')
                  ? ['{}', 'text-warning bg-warning/10']
                  : name.endsWith('.py')
                    ? ['py', 'text-(--file-python) bg-(--file-python)/10']
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

/** The icon over an empty pane: a small raised tile. */
function EmptyMark({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="mb-1 flex size-10 items-center justify-center rounded-xl border bg-card text-faint shadow-[var(--highlight),var(--elev-1)]">
      <Icon aria-hidden="true" className="size-5" />
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
      <p role="status" style={pad} className="flex items-center gap-2 py-1.5 pr-3 text-xs text-faint">
        {t("Reading…")}
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
      <p style={pad} className="py-1 text-xs text-faint italic">{t("Empty folder")}</p>
    )
  return (
    <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? t("Files") : undefined}>
      {[...dir].sort(byKind).map((n) => {
        const expanded = open.has(n.path)
        const on = n.path === selected
        return (
          <li key={n.path} role="treeitem" aria-expanded={n.kind === 'dir' ? expanded : undefined} aria-selected={on}>
            <button
              type="button"
              data-active={on}
              onClick={() => (n.kind === 'dir' ? onToggle(n.path) : onOpenFile(n))}
              title={n.kind === 'dir' ? n.path : t("{value1} · {value2}", {value1: n.path, value2: bytes(n.size)})}
              style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
              className={cn(
                'flex h-8 w-full items-center gap-2 rounded-md pr-3 text-left text-[13px] outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                on ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
              )}
            >
              {n.kind === 'dir' ? (
                <>
                  <ChevronRight aria-hidden="true" data-open={expanded} className={cn("size-3.5 shrink-0 text-faint transition-transform", expanded && "rotate-90")} />
                  {expanded ? (
                    <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-(--icon-accent)/80" />
                  ) : (
                    <Folder
                      aria-hidden="true"
                      className={cn('size-4 shrink-0', n.name.startsWith('.') || n.name === 'node_modules' ? 'text-faint' : 'text-(--icon-accent)/80')}
                    />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  <FileBadge entry={n} />
                </>
              )}
              <span className={cn('truncate', on && 'font-medium')}>{n.name}</span>
            </button>
            {n.kind === 'dir' && expanded && <Tree path={n.path} depth={depth + 1} dirs={dirs} open={open} selected={selected} onToggle={onToggle} onOpenFile={onOpenFile} />}
          </li>
        )
      })}
    </ul>
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
  /** Renderer-only local fixtures for the SDK proposal visualization. */
  preview?: boolean
}

export function FilesTab({ project, branches, tick = 0, initialBranch, preview = false }: FilesTabProps) {
  const [ref, setRef] = useState(() => (initialBranch && branches.some((b) => b.name === initialBranch) ? initialBranch : branches.find((b) => b.name === 'main')?.name ?? branches[0]?.name ?? 'main'))
  const [latest, setLatest] = useState<string | undefined>()
  const [more, setMore] = useState<Record<string, number | null>>({})
  const [dirs, setDirs] = useState<Map<string, Dir>>(new Map())
  const [open, setOpen] = useState<Set<string>>(() => preview ? new Set(['/src', '/src/routes']) : new Set())
  const [snapshot, setSnapshot] = useState('latest')
  const pin = snapshot === 'latest' ? latest ?? branches.find(b => b.name === ref)?.head ?? undefined : snapshot
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const generation = useRef(0)
  const openRef = useRef(open)
  openRef.current = open

  const load = useCallback(
    (path: string, keep = false, pos = 0) => {
      const version = generation.current
      if (!keep) setDirs((all) => new Map(all).set(path, 'loading'))
      const entriesRead = preview ? Promise.resolve(previewEntries(ref, snapshot, path)) : host.list(project, ref, path, pin, pos).then(p => { setMore(m => ({ ...m, [path]: p.next })); return p.items })
      entriesRead.then(
        (entries) => { if (version === generation.current) setDirs((all) => new Map(all).set(path, pos ? [...(Array.isArray(all.get(path)) ? all.get(path) as FsEntry[] : []), ...entries] : entries)) },
        (e: unknown) => { if (version === generation.current) setDirs((all) => new Map(all).set(path, e instanceof Error ? e : new Error(String(e)))) },
      )
    },
    [project, ref, preview, snapshot, pin],
  )
  // A new ref starts from its root; the folders open stay open there.
  useEffect(() => {
    generation.current++
    setDirs(new Map())
    for (const path of ['/', ...openRef.current]) load(path)
    return () => { generation.current++ }
  }, [load])
  // A tick costs one branch.get; pinned browsing keeps its immutable roots.
  const firstTick = useRef(tick)
  useEffect(() => {
    if (tick === firstTick.current) return
    void call<{ saved_head?: { id: string }; head?: string; base: string }>('GET', `/api/projects/${encodeURIComponent(project)}/branches?branch=${encodeURIComponent(ref)}`).then(b => setLatest(b.saved_head?.id ?? b.head ?? b.base))
  }, [tick, project, ref])

  // The first time the root is read, open its README, the way a repository page does.
  const root = dirs.get('/')
  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current || !(root instanceof Array)) return
    greeted.current = true
    const readme = preview ? { path: '/src/routes/login.js' } : root.find((e) => e.kind === 'file' && /^readme(\.md|\.txt)?$/i.test(e.name))
    if (readme && tabs.length === 0) {
      setTabs([readme.path])
      setActive(readme.path)
    }
  }, [root, tabs.length, preview])

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
    <div className="files-frame grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(8rem,30%)_minmax(0,1fr)] overflow-hidden rounded-xl @min-[600px]/files:grid-cols-[13rem_minmax(0,1fr)] @min-[600px]/files:grid-rows-1">
      <aside aria-label={t("Files")} className="files-side flex min-h-0 flex-col border-b @min-[600px]/files:border-b-0 @min-[600px]/files:border-r">
        <div className="flex flex-col gap-2 border-b p-3">
          <Select value={ref} onValueChange={name => { setRef(name); setLatest(undefined); setSnapshot('latest') }}>
            <SelectTrigger aria-label={t("Branch")} title={branch?.head ?? undefined} className="w-full">
              <SelectValue>
                {ref}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t("Published")}</SelectLabel>
                <SelectItem value="main">
                  <span className="font-medium">{t("main")}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {shortId(branches.find((b) => b.name === 'main')?.head)}
                  </span>
                </SelectItem>
              </SelectGroup>
              {others.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t("Branches")}</SelectLabel>
                  {others.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      <span className={cn('font-medium', b.state === 'merged' && 'text-muted-foreground')}>{b.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {shortId(b.head)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          {!preview && <p className="fp-branch-context">Saved {shortId(pin)}{snapshot !== 'latest' && latest && latest !== snapshot ? ' · Newer version available' : ''}</p>}
          {preview && <p className="fp-branch-context">{ref === 'main' ? 'Project core content' : 'Working branch · based on main'}</p>}
          <SearchField label={t("Find in opened folders")} value={query} onChange={setQuery} size="sm" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          <div>
            {q ? (
              matches.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">{t("No file in the opened folders matches.")}</p>
              ) : (
                <ul aria-label={t("Matching files")}>
                  {matches.map((n) => (
                    <li key={n.path}>
                      <button
                        type="button"
                        data-active={n.path === active}
                        onClick={() => openFile(n)}
                        className={cn(
                          'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                          n.path === active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
                        )}
                      >
                        <FileBadge entry={n} />
                        <span className="truncate font-mono text-xs">{n.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <><Tree path="/" depth={0} dirs={dirs} open={open} selected={active} onToggle={toggle} onOpenFile={openFile} />{Object.entries(more).filter(([path, pos]) => pos != null && (path === '/' || open.has(path))).map(([path, pos]) => <button key={path} className="fp-context" onClick={() => load(path, true, pos!)}>Show more entries in {path}</button>)}</>
            )}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        <div
          role="tablist"
          aria-label={t("Open files")}
          className="relative flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-muted/25 px-1.5"
        >
          {tabs.map((p) => {
            const name = p.split('/').pop() ?? p
            const on = p === active
            return (
              <div
                key={p}
                role="tab"
                aria-selected={on}
                data-active={on}
                className={cn(
                  'group flex h-7 shrink-0 items-center gap-1 rounded-md pr-1 pl-2.5 text-[13px] transition-[background-color,color,box-shadow] duration-(--dur-fast)',
                  on ? 'bg-card text-foreground shadow-[var(--highlight),var(--elev-1)] ring-1 ring-foreground/[0.06]' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  title={p}
                  onClick={() => setActive(p)}
                  className="flex items-center gap-1.5 rounded text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileBadge entry={{ name, kind: 'file' }} />
                  {name}
                </button>
                <button
                  type="button"
                  aria-label={t("Close {value1}", {value1: p})}
                  onClick={() => closeFile(p)}
                  className={cn(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded text-faint outline-none transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
                    on ? 'opacity-70' : 'opacity-0 group-hover:opacity-70',
                  )}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
          {tabs.length === 0 && <span className="px-2 text-xs text-muted-foreground">{t("Read-only files")}</span>}
        </div>

        {active ? (
          preview ? <FileExplorerPreview key={`${project}:${ref}:${active}`} project={project} branch={ref} path={active} snapshot={snapshot} onSnapshot={setSnapshot} onOpenFile={path => openFile({ path, name: path.split('/').at(-1)!, kind: 'file', size: null })} /> : <SavedFileExplorer key={`${project}:${ref}:${active}:${pin}`} project={project} branch={ref} path={active} pin={pin} onPin={setSnapshot} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <EmptyMark icon={FileText} />
            <p className="text-sm font-medium">{t("Open a file from the tree")}</p>
          </div>
        )}
      </section>
    </div>
  )
}
