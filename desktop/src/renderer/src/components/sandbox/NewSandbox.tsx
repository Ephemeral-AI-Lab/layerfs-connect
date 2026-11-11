import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Refusal } from '@/components/layerfs/Refusal'
import { useStorageView } from '@/components/layerfs/StoreFacts'
import { host } from '@/layerfs/client'
import type { ProjectState } from '@/layerfs/host-api'
import '@/components/storage/storage.css'
import { SandboxImageFields, type SandboxImage } from './SandboxImageFields'

/**
 * New Sandbox: a name unique in the home, prefilled, and an image. A sqlite
 * project's Sandboxes run on its Store's machine (shown, fixed); a
 * PostgreSQL project chooses any machine whose `supports.postgresql_sandbox`
 * is true (#537 §8.6); the others are listed disabled with LayerFS's reason.
 */
export function NewSandbox({ project, state, taken, onMade }: { project: string; state: ProjectState; taken: string[]; onMade: () => void }) {
  const p = state.project
  const suggest = () => {
    const stem = `${p.name}`.replace(/[^a-z0-9_.-]/g, '-').slice(0, 50)
    for (let n = 1; ; n++) if (!taken.includes(`${stem}-${n}`)) return `${stem}-${n}`
  }
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [image, setImage] = useState<SandboxImage>()
  const [imageValid, setImageValid] = useState(true)
  const [machine, setMachine] = useState('native')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const submitting = useRef(false)
  const [observation, setObservation] = useState('')
  const uncertain = (error as { code?: string } | null)?.code === 'Unknown'
  const postgresql = p.kind === 'postgresql'
  const machines = useStorageView()?.machines ?? []
  const pgReason = (m: (typeof machines)[number]) => (m.supports?.postgresql_sandbox ? null : (m.supports?.reason ?? 'This machine does not run PostgreSQL Sandboxes'))
  const chosen = machines.find((m) => m.name === machine)
  const target = postgresql ? machine : p.machine ?? 'native'
  useEffect(() => { setImage(undefined); setImageValid(true) }, [target])
  // native by default (§7), else the first machine that runs PostgreSQL Sandboxes
  useEffect(() => {
    if (!postgresql || !chosen || !pgReason(chosen)) return
    const first = machines.find((m) => !pgReason(m))
    if (first) setMachine(first.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postgresql, machines.map((m) => `${m.name}:${m.supports?.postgresql_sandbox}`).join(',')])
  const make = async () => {
    if (submitting.current || uncertain || !imageValid) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await host.createSandbox(project, { name: name.trim(), ...(image ? { image } : {}), ...(postgresql ? { machine } : {}) })
      setOpen(false)
      onMade()
    } catch (e) {
      setError(e)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  if (!open) return <Button size="sm" variant="outline" className="h-7 rounded-lg-plus px-2.5 text-sm" onClick={() => { setName(suggest()); setImage(undefined); setImageValid(true); setError(null); setObservation(''); setOpen(true) }}><Plus className="size-3.5" />{'New Sandbox'}</Button>
  return <form className="flex w-full min-w-0 flex-wrap items-end gap-2 border-t border-border/70 px-5 py-3" onSubmit={(e) => { e.preventDefault(); void make() }}>
    <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">{'Name'}
      <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy || uncertain} className="h-8 rounded-lg-plus font-mono text-sm" autoFocus spellCheck={false} /></label>
    <SandboxImageFields key={target} machine={target} disabled={busy || uncertain} onChange={(value, valid) => { setImage(value); setImageValid(valid) }} />
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">{'Machine'}
      {postgresql ? (
        <select value={machine} disabled={busy || uncertain} onChange={(e) => setMachine(e.target.value)} className="h-8 rounded-lg-plus border bg-background px-2 text-sm">
          {(machines.length ? machines : [{ name: 'native', platform: 'native', state: null, supports: null }]).map((m) => {
            const why = machines.length ? pgReason(m) : null
            return <option key={m.name} value={m.name} disabled={!!why} title={why ?? undefined}>{why ? `${m.name} — ${why}` : m.name}</option>
          })}
        </select>
      ) : <span className="flex h-8 items-center rounded-lg-plus bg-muted/40 px-2.5 font-mono text-sm" title={'A sqlite project’s Sandboxes run on its Store’s machine'}>{p.machine ?? '?'}</span>}
    </label>
    <Button type="submit" size="sm" className="h-8 rounded-lg-plus" disabled={busy || uncertain || !imageValid || !name.trim() || (postgresql && !!chosen && !!pgReason(chosen))}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{busy ? 'Creating…' : 'Create'}</Button>
    <Button type="button" size="sm" variant="ghost" className="h-8 rounded-lg-plus" onClick={() => setOpen(false)} disabled={busy}>{'Cancel'}</Button>
    {error != null && <Refusal error={error} className="w-full text-destructive" />}
    {uncertain && <div className="w-full text-sm"><p>The creation outcome is uncertain. Read the Sandbox before acting again.</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => {
      setBusy(true)
      try { const current = await host.sandbox(name.trim()); setObservation(`Sandbox state: ${current.state ?? 'unknown'}`); onMade() }
      catch (e) { setObservation(e instanceof Error ? e.message : String(e)) }
      finally { setBusy(false) }
    }}>Read Sandbox</Button>{observation && <p role="status">{observation}</p>}</div>}
  </form>
}
