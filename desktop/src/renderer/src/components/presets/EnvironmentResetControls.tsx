import { useEffect, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { presetApi, reloadEnvironment, type EnvironmentResetPlan } from '@/layerfs/demo-presets-api'

interface Props {
  environment: string
  home: string
  busy: boolean
  onRefresh: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

export function EnvironmentResetControls({ environment, home, busy, onRefresh, open: controlledOpen, onOpenChange, hideTrigger = false }: Props) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const [plan, setPlan] = useState<EnvironmentResetPlan>()
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string>()
  const [requestId, setRequestId] = useState<string>()
  function changeOpen(next: boolean) {
    if (waiting) return
    setLocalOpen(next)
    onOpenChange?.(next)
  }
  useEffect(() => {
    if (!open || requestId) return
    let cancelled = false
    setWaiting(true); setError(undefined); setPlan(undefined)
    void presetApi.environmentPlan(environment).then(result => {
      if (!cancelled) setPlan(result)
    }, cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (!cancelled) setWaiting(false) })
    return () => { cancelled = true }
  }, [open, environment])
  async function reset() {
    if (!plan) return
    setWaiting(true); setError(undefined)
    const id = crypto.randomUUID(); setRequestId(id)
    try {
      await presetApi.resetEnvironment(environment, { requestId: id, expectedPlan: plan.signature, confirm: true, rebuild: false, sandboxes: false })
      reloadEnvironment()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause)); setPlan(undefined); onRefresh()
    } finally { setWaiting(false) }
  }
  async function reconcile() {
    if (!requestId) return
    setWaiting(true); setError(undefined)
    try {
      const result = await presetApi.operation(requestId)
      if (result.state === 'failed' || result.state === 'interrupted') {
        setError(result.error?.message ?? result.phase)
        setRequestId(undefined); onRefresh()
      } else reloadEnvironment()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setWaiting(false) }
  }
  const name = environment.charAt(0).toUpperCase() + environment.slice(1)
  return <>
    {!hideTrigger && <Button variant="outline" disabled={busy || waiting || !!requestId} onClick={() => changeOpen(true)}><RotateCcw />Reset</Button>}
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Reset {name}?</DialogTitle><DialogDescription>Remove all resources in this environment and clear its CLI Activity. Workspace changes, SQLite projects and history will be discarded.</DialogDescription></DialogHeader>
        {waiting && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{requestId ? 'Checking operation…' : 'Checking resources…'}</p>}
        {plan && <div className="space-y-3 text-sm">
          <p>{plan.remove.workspaces.length}{plan.unknownSandboxes.length ? '+' : ''} workspaces · {plan.remove.sandboxes.length} sandboxes · {plan.remove.stores.length} stores · {plan.remove.machines.length} custom machines</p>
          <p className="text-muted-foreground">The environment will be left empty. Built-in machine records, backups and remote PostgreSQL data remain.</p>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Cleanup details</summary><div className="mt-3 space-y-2">
            <p className="break-all font-mono">{home}</p>
            <p>Discard and unmount workspaces, close sandboxes, remove SQLite stores, disconnect PostgreSQL stores, remove custom machines, stop Docker, then verify cleanup.</p>
            {!!plan.startMachines.length && <p>Start machines to reach their data: {plan.startMachines.join(', ')}.</p>}
            {!!plan.unknownSandboxes.length && <p>Workspace counts are unavailable for {plan.unknownSandboxes.join(', ')}. Reset must inspect their workspaces before removing them.</p>}
            {!!plan.disconnect.length && <p>Disconnect: {plan.disconnect.join(', ')}. Remote databases are retained.</p>}
            <ul className="space-y-1 break-all font-mono">{Object.entries(plan.remove).flatMap(([kind, names]) => names.map(value => <li key={`${kind}/${value}`}>{kind}: {value}</li>))}</ul>
          </div></details>
        </div>}
        {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
        {requestId && <p className="text-sm text-muted-foreground">The request may already be running. Check its recorded status before starting another reset.</p>}
        <DialogFooter>
          <Button variant="outline" autoFocus disabled={waiting} onClick={() => changeOpen(false)}>Cancel</Button>
          {requestId ? <Button disabled={waiting} onClick={() => void reconcile()}>Check operation</Button> : <Button variant="destructive" disabled={waiting || busy || !plan} onClick={() => void reset()}>Reset</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
