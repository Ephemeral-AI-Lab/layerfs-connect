import { t, useI18n, getLocale } from '@/i18n'
import { Database, FilePlus2, FolderOpen, FolderPlus, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectInitJob, ProjectSummary } from '@shared/host-api'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  const callbacks = useRef({ onCreated, onOpenChange })
  callbacks.current = { onCreated, onOpenChange }
  const pendingJob = !!job && !job.ended
  const busy = posting || pendingJob
  const canClose = !posting && !browsing && (!pendingJob || !!pollError)

  useEffect(() => {
    if (!open || pendingJob) return
    setName('')
    setSource('empty')
    setFolder(initialFolder)
    setJob(null)
    setError('')
    setPollError('')
  }, [open])

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
    submitting.current = true
    setPosting(true)
    setError('')
    setPollError('')
    setJob(null)
    try {
      receive(await host.createProject({ name: projectName, ...(source === 'folder' ? { source: folder.trim() } : {}) }))
    } catch (cause) {
      setError(cause instanceof HostError && cause.status === 404 && cause.code === 'not-found'
        ? 'Connect’s local service needs a restart to enable project creation. Quit and reopen Connect, then try again.'
        : (cause as Error).message)
    } finally {
      submitting.current = false
      setPosting(false)
    }
  }

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
                <Input id="new-project-name" value={name} maxLength={63} autoComplete="off" spellCheck={false} placeholder={t("my-project")} className="h-10 rounded-xl text-sm" onChange={(event) => { setName(event.target.value); setError('') }} />
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
            <span className="mr-auto flex items-center gap-1.5 text-[11px] text-muted-foreground"><Database className="size-3.5" />{t("Local SQLite")}</span>
            <Button type="button" variant="ghost" size="sm" disabled={!canClose} onClick={() => onOpenChange(false)}>{pendingJob ? t("Close") : t("Cancel")}</Button>
            {pollError ? (
              <Button type="button" size="sm" className="rounded-xl px-3.5" onClick={() => { setPollError(''); setPollAttempt((value) => value + 1) }}><RefreshCw className="size-3.5" />{t("Check status")}</Button>
            ) : (
              <Button type="submit" size="sm" className="rounded-xl px-3.5" disabled={busy || browsing || !name.trim()}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{busy ? t("Creating…") : t("Create project")}</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
