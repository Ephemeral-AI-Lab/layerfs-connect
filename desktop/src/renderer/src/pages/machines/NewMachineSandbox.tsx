import { useRef, useState } from 'react'
import { LoaderCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Refusal } from '@/components/layerfs/Refusal'
import { host } from '@/layerfs/client'
import type { MachineInfo } from '@/layerfs/host-api'
import { useHostQuery } from '@/layerfs/use-host'
import { SandboxImageFields, type SandboxImage } from '@/components/sandbox/SandboxImageFields'

export function NewMachineSandbox({ machine, taken, disabled, onChanged }: { machine: MachineInfo; taken: string[]; disabled: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button size="sm" variant="outline" disabled={disabled} title={disabled ? 'Start the machine before creating a Sandbox' : undefined} onClick={() => setOpen(true)}><Plus className="size-3.5" />New Sandbox</Button>
    {open && <CreateDialog machine={machine} taken={taken} onClose={() => setOpen(false)} onChanged={onChanged} />}
  </>
}

function CreateDialog({ machine, taken, onClose, onChanged }: { machine: MachineInfo; taken: string[]; onClose: () => void; onChanged: () => void }) {
  const projects = useHostQuery(() => host.projects(), [])
  const eligible = (projects.data ?? []).filter(p => p.kind === 'sqlite' ? p.machine === machine.name && machine.supports?.sqlite !== false : p.kind === 'postgresql' && machine.supports?.postgresql_sandbox === true)
  const [project, setProject] = useState('')
  const [name, setName] = useState('')
  const [image, setImage] = useState<SandboxImage>()
  const [imageValid, setImageValid] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [observation, setObservation] = useState('')
  const submitting = useRef(false)
  const uncertain = (error as { code?: string } | null)?.code === 'Unknown'
  const choose = (key: string) => {
    setProject(key)
    const stem = (eligible.find(p => p.key === key)?.name ?? 'sandbox').replace(/[^a-z0-9_.-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 50) || 'sandbox'
    for (let n = 1; ; n++) if (!taken.includes(`${stem}-${n}`)) { setName(`${stem}-${n}`); break }
    setError(null)
  }
  const valid = /^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/.test(name) && !['native', 'docker'].includes(name) && !taken.includes(name)
  const make = async () => {
    if (submitting.current || uncertain || !valid || !imageValid || !eligible.some(p => p.key === project)) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await host.createSandbox(project, { name, machine: machine.name, ...(image ? { image } : {}) })
      onClose()
    } catch (e) { setError(e) }
    finally { submitting.current = false; setBusy(false); onChanged() }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[calc(100svh-2rem)] overflow-y-auto">
      <DialogHeader><DialogTitle>New Sandbox</DialogTitle><DialogDescription>Create a Sandbox on {machine.name}. SQLite projects must have their Store on this machine; PostgreSQL projects require machine support.</DialogDescription></DialogHeader>
      <form className="flex min-w-0 flex-col gap-4" onSubmit={e => { e.preventDefault(); void make() }}>
        {projects.error ? <><Refusal error={projects.error} /><Button type="button" variant="outline" onClick={projects.reload}>Retry loading projects</Button></> : projects.loading ? <p role="status">Loading projects…</p> : eligible.length === 0 ? <p role="status">No eligible projects. Create a project in a Store on {machine.name}, move its SQLite Store here, or connect a supported PostgreSQL Store.</p> : <>
          <label className="flex flex-col gap-1.5 text-sm">Project<select className="h-9 w-full min-w-0 rounded-lg border bg-background px-2" value={project} disabled={busy || uncertain} onChange={e => choose(e.target.value)} required><option value="" disabled>Choose a project</option>{eligible.map(p => <option key={p.key} value={p.key}>{p.key}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 text-sm">Name<Input value={name} onChange={e => setName(e.target.value)} disabled={busy || uncertain} spellCheck={false} required maxLength={63} aria-invalid={!!name && !valid} /><span className="text-xs text-muted-foreground">1–63 lowercase letters, digits, dots, underscores or hyphens. Start and end with a letter or digit; use a unique name.</span></label>
          <SandboxImageFields key={machine.name} machine={machine.name} disabled={busy || uncertain} onChange={(value, valid) => { setImage(value); setImageValid(valid) }} />
          <p className="text-sm text-muted-foreground">Machine: {machine.name}</p>
        </>}
        {error != null && <Refusal error={error} />}
        {uncertain && <div className="text-sm"><p>The creation outcome is uncertain. Read the Sandbox before creating another.</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
          setBusy(true)
          try { const current = await host.sandbox(name); setObservation(`Sandbox state: ${current.state ?? 'unknown'}`); onChanged() }
          catch (e) { setObservation(e instanceof Error ? e.message : String(e)) }
          finally { setBusy(false) }
        }}>Read Sandbox</Button>{observation && <p role="status">{observation}</p>}</div>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || uncertain || projects.loading || !!projects.error || !valid || !imageValid || !eligible.some(p => p.key === project)}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{busy ? 'Creating…' : 'Create Sandbox'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
