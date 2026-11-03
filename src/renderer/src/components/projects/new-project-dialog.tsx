// New project (LayerFS 2.0): Init (POST /api/projects) of a folder or an
// empty source into an existing Store: a sqlite Store on any machine (Init
// reads the folder on this Mac and writes through the Store's machine, a VM's
// worker), a PostgreSQL Store, or a new sqlite Store made first on native
// (project.init never makes a Store). Init's progress comes from the host's
// job table. A project made on native can then have its Store pushed to
// another machine: the whole Store goes, every project in it.
import { t, useI18n, getLocale } from '@/i18n'
import { Database, FilePlus2, FolderOpen, FolderPlus, HardDriveUpload, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectInitJob, ProjectSummary, StoreRow } from '@shared/host-api'

import { initStores, reloadStorageView, useStorageView } from '@/components/projects/store-facts'
import { Refusal } from '@/components/refusal'
import { StoreIcon } from '@/components/storage/identity/store-icon'
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
  /** The Store to choose first (Storage's "Add project"). */
  initialStore?: string
}

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
/** project.init's steps (its on_progress), then the job's end. */
const STEPS: Record<string, string> = {
  scan: 'Reading source files…',
  files: 'Saving files…',
  tree: 'Building the tree…',
  publish: 'Publishing main…',
  seal: 'Finishing…',
  done: 'Project ready',
  failed: 'Project could not be created',
}

export function NewProjectDialog({ open, onOpenChange, onCreated, initialFolder = '', initialStore }: NewProjectDialogProps) {
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
  /** The Stores Init can go into (any sqlite Store, PostgreSQL); undefined while read, null without a view. */
  const stores = storage === undefined ? undefined : initStores(storage)
  /** The project made, while the optional "Move Store to…" step shows. */
  const [made, setMade] = useState<ProjectSummary | null>(null)
  const [moveTo, setMoveTo] = useState('')
  const [moving, setMoving] = useState(false)
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
    setStore(initialStore ?? '')
    setNewStore('')
    setStoreNamed(false)
    setMade(null)
    setMoveTo('')
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
      callbacks.current.onCreated(next.project)
      // a sqlite Store on native can be pushed to another machine now; with none but native, there is nowhere to go
      if (next.project.kind === 'sqlite' && next.project.machine === 'native' && (storage?.machines.length ?? 0) > 1) setMade(next.project)
      else callbacks.current.onOpenChange(false)
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
    if (!projectName) {
      setError('Name the project.')
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
      const into = making ? newStore.trim() : store
      if (making) {
        await host.createStore(into)
        setStore(into)
      }
      rememberStore(into)
      receive(await host.createProject({ name: projectName, store: into, ...(source === 'folder' ? { source: folder.trim() } : {}) }))
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
  const counts = job?.progress
  const moveStore = async () => {
    if (!made || !moveTo) return
    setMoving(true)
    setError('')
    try {
      await host.pushStore(made.store, moveTo)
      onOpenChange(false)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || canClose) onOpenChange(next) }}>
      <DialogContent showCloseButton={canClose} className="flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden rounded-3xl p-0 [--dialog-inset:1.5rem] sm:max-w-[480px]">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-5">
          <DialogTitle className="flex items-start gap-2.5 text-base font-semibold">
            <span className="glass-liquid flex size-7 shrink-0 items-center justify-center rounded-lg text-(--icon-accent)"><FolderPlus className="size-4" /></span>
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
                        <option.icon className={cn('size-4', source === option.id ? 'text-(--icon-accent)' : 'text-muted-foreground')} />
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
                  value={store}
                  chosen={chosen}
                  newStore={newStore}
                  problem={storeProblem}
                  onChange={(value) => { setStore(value); setError('') }}
                  onNewStore={(value) => { setNewStore(value); setStoreNamed(true); setError('') }}
                />
              )}
              {!making && chosen?.state === 'down' && chosen.machine && <StartFirst machine={chosen.machine} />}
            </fieldset>
            {busy && (
              <div role="status" className="mt-4 rounded-xl border border-primary/10 bg-primary/[0.04] px-3.5 py-3">
                <p className="flex items-center gap-2 text-xs font-medium"><LoaderCircle className="size-3.5 animate-spin text-primary" />{posting && !job ? t("Starting project…") : job ? t(STEPS[job.step] ?? job.step) : t("Creating project…")}</p>
                {counts && <p className="mt-1.5 pl-5.5 text-[11px] text-muted-foreground tabular-nums">{t("{count} files · {size}", {count: counts.files, size: bytes(counts.bytes)})}</p>}
              </div>
            )}
            {made && (
              <div className="mt-4 space-y-2.5 rounded-2xl border border-foreground/[0.08] bg-background/40 px-3.5 py-3">
                <p className="text-xs font-medium">{t("{project} is ready on native.", { project: made.key })}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{t("Push its Store to another machine? The whole Store goes, every project in it, and their Sandboxes then run there.")}</p>
                <div className="flex gap-2">
                  <Select value={moveTo || undefined} onValueChange={setMoveTo}>
                    <SelectTrigger type="button" className="h-9 flex-1 rounded-xl text-xs"><SelectValue placeholder={t("Keep it on native")} /></SelectTrigger>
                    <SelectContent>
                      {(storage?.machines ?? []).filter((m) => m.name !== 'native' && m.supports?.sqlite !== false).map((m) => <SelectItem key={m.name} value={m.name}>{m.name} ({m.platform})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" className="h-9 rounded-xl" disabled={!moveTo || moving} onClick={() => void moveStore()}>{moving ? <LoaderCircle className="size-3.5 animate-spin" /> : <HardDriveUpload className="size-3.5" />}{t("Push Store")}</Button>
                </div>
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
              <span className="truncate">{making ? t("New Store {store}", { store: newStore.trim() || '…' }) : chosen ? t("Store {store}", { store: chosen.name }) : t("Choose a Store")}</span>
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={!canClose || moving} onClick={() => onOpenChange(false)}>{pendingJob || made ? t("Close") : t("Cancel")}</Button>
            {made ? null : pollError ? (
              <Button type="button" size="sm" className="rounded-xl px-3.5" onClick={() => { setPollError(''); setPollAttempt((value) => value + 1) }}><RefreshCw className="size-3.5" />{t("Check status")}</Button>
            ) : (
              <Button type="submit" size="sm" className="rounded-xl px-3.5" disabled={busy || browsing || !name.trim() || !stores || (!making && !store)}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{busy ? t("Creating…") : t("Create project")}</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface StoreFieldProps {
  stores: StoreRow[] | undefined
  value: string
  chosen: StoreRow | undefined
  newStore: string
  problem: string | null
  onChange: (value: string) => void
  onNewStore: (value: string) => void
}

/** Where the project goes: a sqlite Store on any machine or a PostgreSQL Store (its mark, projects and size), or a new sqlite Store named here. */
function StoreField({ stores, value, chosen, newStore, problem, onChange, onNewStore }: StoreFieldProps) {
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
                  <span className="flex min-w-0 items-center gap-2"><FolderPlus className="size-3.5 shrink-0 text-(--icon-accent)" /><span className="truncate">{t("New SQLite Store")}</span></span>
                ) : (
                  <span className="flex min-w-0 items-center gap-2">
                    <StoreIcon family={chosen?.kind ?? 'sqlite'} size="sm" className="[&>span]:size-6" />
                    <span className="truncate">{value}</span>
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
                <StoreIcon family={item.kind} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground tabular-nums">
                    {t(item.projects.length === 1 ? "{count} project" : "{count} projects", { count: item.projects.length })} · {item.kind === 'postgresql' ? 'PostgreSQL' : item.size ? bytes(item.size.bytes) : t("size unknown")}
                  </span>
                </span>
              </SelectItem>
            ))}
            {pending && (
              <SelectItem value={pending} textValue={pending} className="rounded-xl py-2 pr-8 pl-2.5 text-xs">{pending}</SelectItem>
            )}
            {(stores?.length ?? 0) > 0 && <SelectSeparator className="mx-2 my-1 bg-foreground/[0.06]" />}
            <SelectItem value={NEW_STORE} textValue={t("New SQLite Store")} className="rounded-xl py-2.5 pr-8 pl-2.5 text-xs data-[state=checked]:bg-primary/[0.07]">
              <FolderPlus className="size-3.5 text-(--icon-accent)" />
              <span className="font-medium">{t("New SQLite Store…")}</span>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {making ? (
        <>
          <Input aria-label={t("New Store name")} value={newStore} maxLength={32} autoComplete="off" spellCheck={false} placeholder={t("my-store")} aria-invalid={!!problem} className="h-9 rounded-xl text-xs md:text-xs" onChange={(event) => onNewStore(event.target.value)} />
          <p className={cn('text-[11px] leading-relaxed', problem ? 'text-destructive' : 'text-muted-foreground')}>
            {problem ? t(problem) : t("A new sqlite Store on native; more projects can join it later, and it can be pushed to any machine.")}
          </p>
        </>
      ) : chosen ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {chosen.kind === 'postgresql'
            ? t("It goes into the database {store}; its Sandboxes run on any machine that supports PostgreSQL Sandboxes.", { store: chosen.name })
            : t("It shares {store}’s file on {machine}: a push, pull or backup carries every project in it.", { store: chosen.name, machine: chosen.machine ?? '?' })}
        </p>
      ) : null}
    </div>
  )
}

/**
 * U3: a Store whose machine is stopped is down, and Init into it is refused.
 * Nothing starts a machine on its own: the dialog asks, and Start runs
 * machine.start; the Storage view is read again when it answers.
 */
function StartFirst({ machine }: { machine: string }) {
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState<unknown>(null)
  const start = async () => {
    setStarting(true)
    setFailed(null)
    try {
      await host.startMachine(machine)
      reloadStorageView()
    } catch (e) {
      setFailed(e)
    } finally {
      setStarting(false)
    }
  }
  return (
    <div role="status" className="space-y-2 rounded-xl bg-warning/[0.06] px-3.5 py-3 text-xs leading-relaxed">
      <p>{t("{machine} is stopped, so this Store is down. Start it to add a project here.", { machine })}</p>
      <Button type="button" size="sm" variant="outline" className="h-8 rounded-xl" disabled={starting} onClick={() => void start()}>
        {starting && <LoaderCircle className="size-3.5 animate-spin" />}
        {t("Start {machine}", { machine })}
      </Button>
      {failed != null && <Refusal error={failed} className="text-destructive" />}
    </div>
  )
}
