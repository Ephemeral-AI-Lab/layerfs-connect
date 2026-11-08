import { useEffect, useRef, useState } from 'react'
import { Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { doctorApi, type DoctorJob, type DoctorRequest } from '@/layerfs/doctor-api'
import { DoctorReport } from './DoctorReport'

export function DoctorAction({ target, name, label = 'Diagnose' }: DoctorRequest & { label?: string }) {
  const [open, setOpen] = useState(false)
  return <><Button size="sm" variant="outline" onClick={() => setOpen(true)}><Stethoscope className="size-3.5" />{label}</Button><DoctorPanel open={open} onOpenChange={setOpen} request={{ target, ...(name ? { name } : {}) }} /></>
}
export function DoctorPanel({ open, onOpenChange, request }: { open: boolean; onOpenChange: (open: boolean) => void; request: DoctorRequest }) {
  const [job, setJob] = useState<DoctorJob | null>(null)
  const [history, setHistory] = useState<DoctorJob[]>([])
  const [quick, setQuick] = useState(false)
  const [writeTest, setWriteTest] = useState(false)
  const [timeout, setTimeoutValue] = useState('')
  const [error, setError] = useState('')
  const [launching, setLaunching] = useState(false)
  const [now, setNow] = useState(Date.now())
  const key = useRef(crypto.randomUUID())
  const busy = launching || job?.state === 'queued' || job?.state === 'running'
  useEffect(() => { if (open) void doctorApi.list().then(setHistory, e => setError(e.message)) }, [open])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return
    const timer = setInterval(() => { setNow(Date.now()); void doctorApi.get(job.id).then(setJob, e => setError(e.message)) }, 1000)
    return () => clearInterval(timer)
  }, [job?.id, job?.state])
  const launch = async () => {
    setLaunching(true); setError('')
    try {
      const input = { ...request, ...(request.target === 'store.integrity' ? { quick } : {}), ...(request.target === 'backup.connection' ? { write_test: writeTest } : {}), ...(timeout ? { timeout } : {}) }
      const next = await doctorApi.launch(input, key.current)
      setJob(next); key.current = crypto.randomUUID()
    } catch (e) { setError((e as Error).message) }
    finally { setLaunching(false) }
  }
  const recent = history.filter(j => j.request.target === request.target && j.request.name === request.name)
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>Doctor · {request.name ?? 'this host'}</DialogTitle></DialogHeader>
    <p className="text-sm text-muted-foreground">{request.target}. Explicit diagnosis; connection checks do not prove integrity. Leaving this panel keeps the run active. Host shutdown can interrupt it.</p>
    {request.target === 'store.integrity' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={quick} disabled={busy} onChange={e => setQuick(e.target.checked)} />Quick integrity (reduced coverage; Full is the default)</label>}
    {request.target === 'backup.connection' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={writeTest} disabled={busy} onChange={e => setWriteTest(e.target.checked)} />Test upload and cleanup: creates and removes a temporary object version.</label>}
    <label className="flex flex-wrap items-center gap-2 text-sm">Optional time budget<input className="rounded border px-2 py-1" placeholder="e.g. 30s" value={timeout} disabled={busy} onChange={e => setTimeoutValue(e.target.value)} /></label>
    <Button onClick={() => void launch()} disabled={busy}>{busy ? 'Diagnosis in progress…' : 'Run diagnosis'}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {job && <div className="space-y-3 border-t pt-3">{job.simulated && <p className="text-sm text-warning">Simulated report — no live resource checked</p>}<p className="text-sm">{job.state}{busy && job.started ? ` · ${Math.max(0, Math.floor((now - job.started) / 1000))}s elapsed` : ''}</p>{job.error && <p role="alert">{job.error}</p>}{job.report && <DoctorReport report={job.report} />}</div>}
    {recent.length > 0 && <details><summary className="cursor-pointer text-sm">Previous dated reports ({recent.length})</summary><p className="text-xs text-muted-foreground">Past observations may be stale after configuration or lifecycle changes.</p>{recent.map(j => <button key={j.id} className="block py-2 text-sm underline" onClick={() => void doctorApi.get(j.id).then(setJob, e => setError(e.message))}>{new Date(j.created).toLocaleString()} · {j.request.quick ? 'quick' : j.request.write_test ? 'write-test' : j.request.target} · {j.state}</button>)}</details>}
  </DialogContent></Dialog>
}
