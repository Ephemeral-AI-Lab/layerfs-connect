// New project: a LayerFS project made by Init (the host's POST /api/projects,
// which runs LayerFS's project.init), empty or from a folder the user picks.
// Init imports a copy of the folder; the dialog follows the Init job until it
// ends, then hands the new project's name back.
// With layerfs#506 a Store holds many projects: the dialog picks the local
// SQLite Store the project goes into, or makes a new one first. A LayerFS
// build without Stores keeps one new Store per project, as before.
import type { InitJob, RemoteInfo, StoreInfo } from '@shared/host-api'
import { FolderOpen, FolderPlus, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { normalizeView } from '@/components/storage/view'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { bytes } from '@/data/format'
import { host } from '@/host/client'
import { cn } from '@/lib/utils'

const POLL_MS = 500
/** LayerFS project names: lowercase letters, digits, _ . -, starting and ending alphanumeric, at most 63. */
const NAME = /^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/
/** Store names (host/storage.js): lowercase letters, digits and hyphens, at most 32. */
const STORE = /^[a-z0-9][a-z0-9-]{0,31}$/
/** The Select value for "make a new Store". */
const NEW = '__new__'
/** The Store a project last went into, so the next one defaults to it. */
const LAST = 'connect.newProject.store'

/** A project name as a Store name: _ and . as hyphens, at most 32. */
export function storeName(project: string): string {
  return project.replace(/[_.]+/g, '-').slice(0, 32).replace(/-+$/, '')
}

function lastStore(): string | null {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}

function rememberStore(name: string) {
  try {
    localStorage.setItem(LAST, name)
  } catch {
    // a remembered default only
  }
}

/** A folder's name as a project name: lowercase, other characters as dashes, trimmed to fit. */
export function projectName(folder: string): string {
  const base = folder.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 63)
    .replace(/[^a-z0-9]+$/, '')
}

const STEP: Record<InitJob['step'], string> = {
  scan: 'Counting the folder',
  volume: 'Making the Store volume',
  import: 'Importing',
  done: 'Done',
  failed: 'Failed',
}

export function NewProjectDialog({ open, onOpenChange, taken, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; taken: Set<string>; onCreated: (name: string) => void }) {
  const [source, setSource] = useState<'empty' | 'folder'>('empty')
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [named, setNamed] = useState(false)
  const [job, setJob] = useState<InitJob>()
  const [error, setError] = useState<string>()
  /** Local SQLite Stores, or null when the LayerFS build has none (one new Store per project). */
  const [stores, setStores] = useState<StoreInfo[] | null>(null)
  const [remotes, setRemotes] = useState<RemoteInfo[]>([])
  const [store, setStore] = useState<string>(NEW)
  const [newStore, setNewStore] = useState('')
  const [storeNamed, setStoreNamed] = useState(false)
  const ids = { name: useId(), folder: useId(), store: useId(), newStore: useId() }
  const canPick = typeof window.connect.pickFolder === 'function'

  // a fresh form each time it opens
  useEffect(() => {
    if (!open) return
    setSource('empty')
    setFolder('')
    setName('')
    setNamed(false)
    setJob(undefined)
    setError(undefined)
    setNewStore('')
    setStoreNamed(false)
    let stop = false
    host.storage().then(
      (answer) => {
        if (stop) return
        const view = normalizeView(answer)
        const local = view.stores.available ? view.stores.list.filter((s) => s.kind === 'sqlite') : null
        setStores(local)
        setRemotes(view.remotes.list)
        const last = lastStore()
        setStore(local?.some((s) => s.name === last) ? last! : (local?.[0]?.name ?? NEW))
      },
      () => !stop && setStores(null),
    )
    return () => {
      stop = true
    }
  }, [open])

  // follow the Init until it ends
  const running = job && !job.ended ? job.id : null
  useEffect(() => {
    if (!running) return
    let stop = false
    const timer = setInterval(async () => {
      try {
        const next = await host.initJob(running)
        if (stop) return
        setJob(next)
        if (next.step === 'done') onCreated(next.name)
        if (next.step === 'failed') setError(next.error?.message ?? 'Init failed')
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e))
      }
    }, POLL_MS)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [running])

  const takeName = (next: string) => {
    setName(next)
    if (!storeNamed) setNewStore(storeName(next))
  }
  const takeFolder = (path: string) => {
    setFolder(path)
    if (!named) takeName(projectName(path))
  }
  const pick = async () => {
    const path = await window.connect.pickFolder?.()
    if (path) {
      setSource('folder')
      takeFolder(path)
    }
  }

  const nameProblem = !name ? null : !NAME.test(name) ? 'Lowercase letters, digits, _ . and -, starting and ending with a letter or digit' : taken.has(name) ? 'A project has this name' : null
  const folderProblem = source === 'folder' && folder && !folder.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(folder) ? 'An absolute path' : null
  const making = stores !== null && store === NEW
  const storeProblem = !making || !newStore ? null : !STORE.test(newStore) ? 'Lowercase letters, digits and hyphens, at most 32' : stores.some((s) => s.name === newStore) ? 'A Store has this name; choose it above instead' : null
  const ready = !!name && !nameProblem && (source === 'empty' || (!!folder && !folderProblem)) && (!making || (!!newStore && !storeProblem))
  const busy = !!running

  const create = async () => {
    if (!ready || busy) return
    setError(undefined)
    try {
      // stores === null: a LayerFS build without Stores, where Init makes the project's own
      let into: string | undefined
      if (stores !== null) {
        into = making ? newStore : store
        if (making) {
          await host.createStore(into)
          setStores([...stores, normalizeView({ stores: { available: true, list: [{ name: into, kind: 'sqlite' }] } }).stores.list[0]])
          setStore(into)
        }
        rememberStore(into)
      }
      setJob(await host.createProject(name, source === 'folder' ? folder : undefined, into))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const counts = job?.imported ?? job?.totals ?? job?.scanned
  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            {stores === null
              ? 'A LayerFS project of its own: empty, or a copy of a folder. Changes in the folder later do not reach the project.'
              : 'Empty, or a copy of a folder, in a Store you choose. Changes in the folder later do not reach the project.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div role="radiogroup" aria-label="Start from" className="grid grid-cols-2 gap-2">
            {(
              [
                ['empty', FolderPlus, 'Empty', 'main with no files'],
                ['folder', FolderOpen, 'From a folder', 'Import its files'],
              ] as const
            ).map(([value, Icon, label, about]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={source === value}
                disabled={busy}
                onClick={() => (value === 'folder' && !folder && canPick ? void pick() : setSource(value))}
                className={cn(
                  'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                  source === value ? 'border-primary/50 bg-primary/[0.06] ring-1 ring-primary/20' : 'border-border hover:bg-accent',
                )}
              >
                <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', source === value ? 'text-primary' : 'text-muted-foreground')} />
                <span>
                  <span className="block text-[13.5px] font-medium">{label}</span>
                  <span className="block text-[12px] text-muted-foreground">{about}</span>
                </span>
              </button>
            ))}
          </div>

          {source === 'folder' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.folder} className="text-[13px] font-medium">
                Folder
              </label>
              <div className="flex gap-2">
                <Input id={ids.folder} value={folder} onChange={(e) => takeFolder(e.target.value)} placeholder="/Users/you/my-app" disabled={busy} className="font-mono text-[12.5px]" />
                {canPick && (
                  <Button type="button" variant="outline" onClick={() => void pick()} disabled={busy}>
                    Choose…
                  </Button>
                )}
              </div>
              <p className={cn('text-[12px]', folderProblem ? 'text-destructive' : 'text-muted-foreground')}>
                {folderProblem ?? 'Everything in it is imported, node_modules and .git included.'}
              </p>
            </div>
          )}

          {stores !== null && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.store} className="text-[13px] font-medium">
                Store
              </label>
              <Select value={store} onValueChange={setStore} disabled={busy}>
                <SelectTrigger id={ids.store} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      <StoreIcon family="sqlite" providers={storeProviders(s, remotes)} size="sm" className="scale-[0.8]" />
                      <span className="font-mono text-[13px]">{s.name}</span>
                      <span className="text-[12px] text-muted-foreground tabular-nums">
                        {s.projects.length === 1 ? '1 project' : `${s.projects.length} projects`} · {s.size ? bytes(s.size.bytes) : 'size unknown'}
                      </span>
                      <SyncPill state={s.sync.state} compact className="ml-1" />
                    </SelectItem>
                  ))}
                  {stores.length > 0 && <SelectSeparator />}
                  <SelectItem value={NEW}>
                    <FolderPlus aria-hidden="true" className="size-3.5 text-primary" />
                    New SQLite Store…
                  </SelectItem>
                </SelectContent>
              </Select>
              {making ? (
                <>
                  <Input
                    id={ids.newStore}
                    aria-label="New Store name"
                    value={newStore}
                    onChange={(e) => {
                      setNewStore(e.target.value)
                      setStoreNamed(true)
                    }}
                    placeholder="my-store"
                    disabled={busy}
                    className="font-mono text-[13px]"
                    aria-invalid={!!storeProblem}
                  />
                  <p className={cn('text-[12px]', storeProblem ? 'text-destructive' : 'text-muted-foreground')}>
                    {storeProblem ?? 'A new SQLite Store in its own Docker volume; more projects can join it later.'}
                  </p>
                </>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  It shares this Store’s file and its link: a push or pull moves every project in it
                  {(() => {
                    const chosen = stores.find((x) => x.name === store)
                    return chosen?.link ? `, so it travels with ${chosen.name}’s pushes to ${chosen.link.remote} / ${chosen.link.file}.` : '.'
                  })()}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className="text-[13px] font-medium">
              Name
            </label>
            <Input
              id={ids.name}
              value={name}
              onChange={(e) => {
                takeName(e.target.value)
                setNamed(true)
              }}
              placeholder="my-project"
              disabled={busy}
              autoFocus
              className="font-mono text-[13px]"
              aria-invalid={!!nameProblem}
            />
            {nameProblem && <p className="text-[12px] text-destructive">{nameProblem}</p>}
          </div>

          {job && (
            <div role="status" className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px]">
              {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary" />}
              <span className="font-medium">{STEP[job.step]}</span>
              {counts && (
                <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
                  {counts.files} files · {bytes(counts.bytes)}
                </span>
              )}
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
