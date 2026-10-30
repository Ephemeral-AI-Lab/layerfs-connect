// New project: a LayerFS project made by Init (POST /api/projects), empty or
// a copy of a folder. With layerfs#506 a Store holds many projects: the
// dialog puts it into a local SQLite Store the user picks, or a new one made
// first. A LayerFS build without Stores (storage().stores.available false, or
// no Storage view) makes one new Store per project, as before.
import { t, useI18n, getLocale } from '@/i18n'
import { Database, FilePlus2, FolderOpen, FolderPlus, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectInitJob, ProjectSummary, RemoteInfo, StoreInfo } from '@shared/host-api'

import { localStores, useStorageView } from '@/components/projects/store-facts'
import { StoreIcon, storeProviders } from '@/components/storage/identity/store-icon'
import { SyncPill } from '@/components/storage/sync/sync-pill'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { bytes } from '@/data/format'
import { HostError, host } from '@/host/client'
import { cn } from '@/lib/utils'

interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: ProjectSummary) => void
  initialFolder?: string
}

const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/
/** Store names (host/storage.js): lowercase letters, digits and hyphens, at most 32. */
const STORE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
/** The Select value for "make a new Store". */
const NEW_STORE = '__new__'
/** The Store a project last went into, so the next one defaults to it. */
const LAST_STORE = 'connect.newProject.store'

/** A project name as a Store name: _ and . as hyphens, at most 32. */
const storeName = (project: string) => project.replace(/[_.]+/g, '-').slice(0, 32).replace(/-+$/, '')

function lastStore(): string | null {
  try { return localStorage.getItem(LAST_STORE) } catch { return null }
}

function rememberStore(name: string) {
  try { localStorage.setItem(LAST_STORE, name) } catch { /* a remembered default only */ }
}
const STEPS: Record<ProjectInitJob['step'], string> = {
  scan: 'Reading source files…',
  volume: 'Preparing project storage…',
  import: 'Initializing project…',
  done: 'Project ready',
  failed: 'Project could not be created',
}

export function NewProjectDialog({ open, onOpenChange, onCreated, initialFolder = '' }: NewProjectDialogProps) {
  useI18n()
  const [name, setName] = useState('')
  const [source, setSource] = useState<'empty' | 'folder'>('empty')
  const [folder, setFolder] = useState(initialFolder)
  const [job, setJob] = useState<ProjectInitJob | null>(null)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [posting, setPosting] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [pollAttempt, setPollAttempt] = useState(0)
  const submitting = useRef(false)
  const chooser = useRef(false)
  const storage = useStorageView()
  /** Local SQLite Stores; null when the LayerFS build has none (one new Store per project), undefined while read. */
  const stores = storage === undefined ? undefined : localStores(storage)
  const [store, setStore] = useState('')
  const [newStore, setNewStore] = useState('')
  const [storeNamed, setStoreNamed] = useState(false)
  const callbacks = useRef({ onCreated, onOpenChange })
  callbacks.current = { onCreated, onOpenChange }
  const pendingJob = !!job && !job.ended
  const busy = posting || pendingJob
  const canClose = !posting && !browsing && (!pendingJob || !!pollError)
  const storeProblem = !stores || store !== NEW_STORE
    ? null
    : !newStore.trim()
      ? 'Name the new Store.'
      : !STORE_NAME.test(newStore.trim())
        ? 'Store names use 1–32 lowercase letters, numbers and hyphens, starting with a letter or number.'
        : stores.some((item) => item.name === newStore.trim())
          ? 'A Store has this name; choose it in the list instead.'
          : null

  useEffect(() => {
    if (!open || pendingJob) return
    setName('')
    setSource('empty')
    setFolder(initialFolder)
    setJob(null)
    setError('')
    setPollError('')
    setStore('')
    setNewStore('')
    setStoreNamed(false)
  }, [open])

  // the Store to offer first: the one the last project went into, else the first, else a new one
  const storeChoices = stores?.map((item) => item.name).join('\n')
  useEffect(() => {
    if (!open || !stores || store) return
    const last = lastStore()
    setStore(stores.some((item) => item.name === last) ? last! : (stores[0]?.name ?? NEW_STORE))
  }, [open, storeChoices, store])

  function receive(next: ProjectInitJob) {
    setJob(next)
    if (next.step === 'done' && next.project) {
      callbacks.current.onOpenChange(false)
      callbacks.current.onCreated(next.project)
    }
  }

  useEffect(() => {
    if (!open || !job || job.ended) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const id = job.id
    const poll = async () => {
      try {
        const next = await host.projectInit(id)
        if (!active) return
        setPollError('')
        receive(next)
        if (!next.ended) timer = setTimeout(poll, 1000)
      } catch (cause) {
        if (!active) return
        if (cause instanceof HostError && cause.status === 404) {
          setJob(null)
          setPollError('')
          setError('Creation status is no longer available. Refresh Projects to check its result before retrying.')
        } else setPollError((cause as Error).message)
      }
    }
    timer = setTimeout(poll, 500)
    return () => { active = false; clearTimeout(timer) }
  }, [open, job?.id, pollAttempt])

  async function browse() {
    if (chooser.current) return
    chooser.current = true
    setBrowsing(true)
    setError('')
    try {
      const chosen = await window.connect.chooseDirectory(folder.trim() || initialFolder || undefined, getLocale())
      if (chosen) setFolder(chosen)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      chooser.current = false
      setBrowsing(false)
    }
  }

  async function create() {
    if (submitting.current || busy || browsing) return
    const projectName = name.trim()
    if (!PROJECT_NAME.test(projectName)) {
      setError('Use 1–63 lowercase letters, numbers, dots, hyphens or underscores. Start and end with a letter or number.')
      return
    }
    if (source === 'folder' && !folder.trim()) {
      setError('Choose a folder to import.')
      return
    }
    // the Store field shows what is wrong with a new Store's name
    if (storeProblem) return
    submitting.current = true
    setPosting(true)
    setError('')
    setPollError('')
    setJob(null)
    try {
      // stores === null: a LayerFS build without Stores, where Init makes the project's own
      let into: string | undefined
      if (stores) {
        into = making ? newStore.trim() : store
        if (making) {
          await host.createStore(into)
          setStore(into)
        }
        rememberStore(into)
      }
      receive(await host.createProject({ name: projectName, ...(source === 'folder' ? { source: folder.trim() } : {}), ...(into ? { store: into } : {}) }))
    } catch (cause) {
      setError(cause instanceof HostError && cause.status === 404 && cause.code === 'not-found'
        ? 'Connect’s local service needs a restart to enable project creation. Quit and reopen Connect, then try again.'
        : (cause as Error).message)
    } finally {
      submitting.current = false
      setPosting(false)
    }
  }

  const making = !!stores && store === NEW_STORE
  const chosen = stores?.find((item) => item.name === store)
  const failure = error || (job?.step === 'failed' ? job.error?.message || 'Project initialization failed.' : '')
  const counts = job?.imported ?? job?.totals ?? job?.scanned

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || canClose) onOpenChange(next) }}>
      <DialogContent showCloseButton={canClose} className="flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden rounded-3xl p-0 [--dialog-inset:1.5rem] sm:max-w-[480px]">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-5">
          <DialogTitle className="flex items-start gap-2.5 text-base font-semibold">
            <span className="glass-liquid flex size-7 shrink-0 items-center justify-center rounded-lg text-primary"><FolderPlus className="size-4" /></span>
            <span className="min-w-0">{t("New project")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{t("A LayerFS workspace with its own history.")}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-5">
            <fieldset disabled={busy || browsing} className="min-w-0 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="new-project-name" className="text-xs">{t("Project name")}</Label>
                <Input id="new-project-name" value={name} maxLength={63} autoComplete="off" spellCheck={false} placeholder={t("my-project")} className="h-10 rounded-xl text-sm" onChange={(event) => { setName(event.target.value); if (!storeNamed) setNewStore(storeName(event.target.value.trim())); setError('') }} />
                <p className="text-[11px] leading-relaxed text-muted-foreground">{t("Lowercase letters, numbers, dots, hyphens and underscores.")}</p>
              </div>
              <fieldset className="min-w-0 space-y-2">
                <legend className="mb-2 text-xs font-medium">{t("Start with")}</legend>
                <div className="grid grid-cols-2 gap-2.5">
                  {([
                    { id: 'empty', label: 'Empty project', description: 'A clean workspace', icon: FilePlus2 },
                    { id: 'folder', label: 'Import folder', description: 'Copy existing files', icon: FolderOpen },
                  ] as const).map((option) => (
                    <label key={option.id} className="relative min-w-0 cursor-pointer has-disabled:cursor-default">
                      <input type="radio" name="project-source" value={option.id} checked={source === option.id} onChange={() => { setSource(option.id); setError('') }} className="peer sr-only" />
                      <span className={cn('flex min-w-0 flex-col gap-2 rounded-2xl border px-3.5 py-3 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30', source === option.id ? 'border-primary/30 bg-primary/[0.06]' : 'border-foreground/[0.08] bg-background/40 hover:bg-background/70')}>
                        <option.icon className={cn('size-4', source === option.id ? 'text-primary' : 'text-muted-foreground')} />
                        <span className="space-y-1"><span className="block text-xs font-medium">{t(option.label)}</span><span className="block text-[10.5px] text-muted-foreground">{t(option.description)}</span></span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {source === 'folder' && (
                <div className="space-y-2">
                  <Label htmlFor="new-project-folder" className="text-xs">{t("Source folder")}</Label>
                  <div className="flex min-w-0 gap-2">
                    <Input id="new-project-folder" value={folder} title={folder || undefined} autoComplete="off" spellCheck={false} placeholder={t("Choose a local folder…")} className="h-9 min-w-0 flex-1 font-mono text-xs md:text-xs" onChange={(event) => { setFolder(event.target.value); setError('') }} />
                    <Button type="button" variant="outline" size="sm" aria-label={t("Choose source folder")} className="h-9 rounded-xl text-xs" onClick={() => void browse()}>
                      {browsing ? <LoaderCircle className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}{browsing ? t("Opening…") : t("Browse")}
                    </Button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{t("Files are copied into the project. The original folder stays in place.")}</p>
                </div>
              )}
              {stores !== null && (
                <StoreField
                  stores={stores}
                  remotes={storage?.remotes.list ?? []}
                  value={store}
                  chosen={chosen}
                  newStore={newStore}
                  problem={storeProblem}
                  onChange={(value) => { setStore(value); setError('') }}
                  onNewStore={(value) => { setNewStore(value); setStoreNamed(true); setError('') }}
                />
              )}
            </fieldset>
            {busy && (
              <div role="status" className="mt-4 rounded-xl border border-primary/10 bg-primary/[0.04] px-3.5 py-3">
                <p className="flex items-center gap-2 text-xs font-medium"><LoaderCircle className="size-3.5 animate-spin text-primary" />{posting && !job ? t("Starting project…") : job ? t(STEPS[job.step]) : t("Creating project…")}</p>
                {counts && <p className="mt-1.5 pl-5.5 text-[11px] text-muted-foreground tabular-nums">{t("{count} files · {size}", {count: counts.files, size: bytes(counts.bytes)})}</p>}
              </div>
            )}
            {failure && <p role="alert" className="mt-4 break-words rounded-xl bg-destructive/[0.06] px-3.5 py-3 text-xs leading-relaxed text-destructive">{t(failure)}</p>}
            {pollError && (
              <div role="alert" className="mt-4 rounded-xl bg-warning/[0.06] px-3.5 py-3 text-xs leading-relaxed">
                <p className="font-medium">{t("Could not update creation status")}</p>
                <p className="mt-1 break-words text-muted-foreground">{pollError}</p>
                <p className="mt-1 text-muted-foreground">{t("Creation may still be running. Check its status before starting another project.")}</p>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-foreground/[0.06] bg-background/25 px-6 py-4">
            <span className="mr-auto flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <Database className="size-3.5 shrink-0" />
              <span className="truncate">{making ? t("New Store {store}", { store: newStore.trim() || '…' }) : chosen ? t("Store {store}", { store: chosen.name }) : t("Local SQLite")}</span>
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={!canClose} onClick={() => onOpenChange(false)}>{pendingJob ? t("Close") : t("Cancel")}</Button>
            {pollError ? (
              <Button type="button" size="sm" className="rounded-xl px-3.5" onClick={() => { setPollError(''); setPollAttempt((value) => value + 1) }}><RefreshCw className="size-3.5" />{t("Check status")}</Button>
            ) : (
              <Button type="submit" size="sm" className="rounded-xl px-3.5" disabled={busy || browsing || !name.trim() || stores === undefined}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{busy ? t("Creating…") : t("Create project")}</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface StoreFieldProps {
  stores: StoreInfo[] | undefined
  remotes: RemoteInfo[]
  value: string
  chosen: StoreInfo | undefined
  newStore: string
  problem: string | null
  onChange: (value: string) => void
  onNewStore: (value: string) => void
}

/** Where the project goes: a local SQLite Store (its mark, projects, size and sync state), or a new one named here. */
function StoreField({ stores, remotes, value, chosen, newStore, problem, onChange, onNewStore }: StoreFieldProps) {
  useI18n()
  const making = value === NEW_STORE
  const pending = value && !making && !chosen ? value : null
  return (
    <div className="space-y-2">
      <Label htmlFor="new-project-store" className="text-xs">{t("Store")}</Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={!stores}>
        <SelectTrigger id="new-project-store" type="button" className="w-full min-w-0 gap-2.5 rounded-xl border-foreground/[0.09] bg-background/55 px-3 text-xs shadow-none data-[size=default]:h-10 focus-visible:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/10 [&>svg:last-child]:size-3.5">
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left">
            {!stores ? (
              <span className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{t("Reading Stores…")}</span>
            ) : (
              <SelectValue placeholder={t("Choose a Store")}>
                {making ? (
                  <span className="flex min-w-0 items-center gap-2"><FolderPlus className="size-3.5 shrink-0 text-primary" /><span className="truncate">{t("New SQLite Store")}</span></span>
                ) : (
                  <span className="flex min-w-0 items-center gap-2">
                    <StoreIcon family="sqlite" providers={chosen ? storeProviders(chosen, remotes) : []} size="sm" className="[&>span]:size-6" />
                    <span className="truncate font-mono">{value}</span>
                  </span>
                )}
              </SelectValue>
            )}
          </span>
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={6} collisionPadding={16} className="glass-strong w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)] rounded-2xl bg-transparent shadow-xl ring-0 [&>div[data-position=popper]]:max-h-72">
          <SelectGroup className="p-1.5">
            {stores?.map((item) => (
              <SelectItem key={item.name} value={item.name} textValue={item.name} className="rounded-xl py-2 pr-8 pl-2.5 data-[state=checked]:bg-primary/[0.07] [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1">
                <StoreIcon family="sqlite" providers={storeProviders(item, remotes)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-medium">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground tabular-nums">
                    {t(item.projects.length === 1 ? "{count} project" : "{count} projects", { count: item.projects.length })} · {item.size ? bytes(item.size.bytes) : t("size unknown")}
                  </span>
                </span>
                <SyncPill state={item.sync.state} copy={item.link} compact className="shrink-0" />
              </SelectItem>
            ))}
            {pending && (
              <SelectItem value={pending} textValue={pending} className="rounded-xl py-2 pr-8 pl-2.5 font-mono text-xs">{pending}</SelectItem>
            )}
            {(stores?.length ?? 0) > 0 && <SelectSeparator className="mx-2 my-1 bg-foreground/[0.06]" />}
            <SelectItem value={NEW_STORE} textValue={t("New SQLite Store")} className="rounded-xl py-2.5 pr-8 pl-2.5 text-xs data-[state=checked]:bg-primary/[0.07]">
              <FolderPlus className="size-3.5 text-primary" />
              <span className="font-medium">{t("New SQLite Store…")}</span>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {making ? (
        <>
          <Input aria-label={t("New Store name")} value={newStore} maxLength={32} autoComplete="off" spellCheck={false} placeholder={t("my-store")} aria-invalid={!!problem} className="h-9 rounded-xl font-mono text-xs md:text-xs" onChange={(event) => onNewStore(event.target.value)} />
          <p className={cn('text-[11px] leading-relaxed', problem ? 'text-destructive' : 'text-muted-foreground')}>
            {problem ? t(problem) : t("A new SQLite Store in its own Docker volume; more projects can join it later.")}
          </p>
        </>
      ) : chosen ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {chosen.link
            ? t("It shares {store}’s file and its link: pushes to {remote} / {file} carry every project in it.", { store: chosen.name, remote: chosen.link.remote, file: chosen.link.file })
            : t("It shares {store}’s file: a push or pull moves every project in it.", { store: chosen.name })}
        </p>
      ) : null}
    </div>
  )
}
