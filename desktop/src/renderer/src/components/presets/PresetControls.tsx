import { useState } from 'react'
import { ArrowUpRight, Code2, LoaderCircle, Play, RotateCcw, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { presetApi, reloadEnvironment, type DemoPresets, type EnvironmentResetPlan, type PresetExecutionMode } from '@/layerfs/demo-presets-api'
import { PresetProgress } from './PresetProgress'
import { PresetScript } from './PresetScript'
import { PresetTopology } from './PresetTopology'
import type { PresetResource } from '@/layerfs/preset-resources'
import './presets.css'

const title = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)
type Confirmation = { target: string; build: boolean; sandboxes: boolean; executionMode: PresetExecutionMode; plan: EnvironmentResetPlan }
type PendingRequest = { target: string; requestId: string }

export function PresetControls({ data, onRefresh }: { data: DemoPresets; onRefresh: () => void }) {
  const preset = data.items.find(item => item.id === 'studio') ?? data.items[0]
  const [selectedMode, setSelectedMode] = useState<PresetExecutionMode>()
  const executionMode = selectedMode ?? preset.executionMode ?? 'filesystem'
  const sandboxes = executionMode === 'mixed'
  const modeReady = !!preset.contentReady && (preset.executionMode ?? 'filesystem') === executionMode
  const displayedPreset = modeReady === preset.contentReady ? preset : { ...preset, contentReady: modeReady }
  const [scriptResource, setScriptResource] = useState<PresetResource>()
  const [scriptOpen, setScriptOpen] = useState(false), [waiting, setWaiting] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [unknown, setUnknown] = useState<PendingRequest>(), [error, setError] = useState<string>()
  const disabled = waiting || data.busy || !!unknown
  const job = [...data.items.map(item => item.job), data.original.job].find(item => item?.state === 'queued' || item?.state === 'running') ?? preset.job

  async function prepare(build: boolean) {
    setWaiting(true); setError(undefined)
    try {
      const plan = build ? await presetApi.buildPlan(preset.id, sandboxes, executionMode) : await presetApi.environmentPlan(preset.id)
      setConfirmation({ target: preset.id, build, sandboxes, executionMode, plan }); onRefresh()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setWaiting(false) }
  }
  async function execute() {
    if (!confirmation) return
    const attempt = { target: confirmation.target, requestId: crypto.randomUUID() }
    setWaiting(true); setError(undefined)
    try {
      await presetApi.resetEnvironment(attempt.target, { requestId: attempt.requestId, expectedPlan: confirmation.plan.signature, confirm: true, rebuild: confirmation.build, sandboxes: confirmation.sandboxes, executionMode: confirmation.executionMode })
      setConfirmation(undefined); setUnknown(undefined); reloadEnvironment()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setConfirmation(undefined)
      // Transport loss must be reconciled by GET; never replay a destructive request.
      if (!(e instanceof Error && 'status' in e && Number(e.status) < 500)) setUnknown(attempt)
      onRefresh()
    } finally { setWaiting(false) }
  }
  async function reconcile() {
    if (!unknown) return
    setWaiting(true)
    try {
      const result = await presetApi.operation(unknown.requestId); setUnknown(undefined)
      if (result.state === 'failed' || result.state === 'interrupted') { setError(result.phase); onRefresh() }
      else reloadEnvironment()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setWaiting(false) }
  }
  async function activate(path = '/presets', target = preset.id) {
    setWaiting(true); setError(undefined)
    try { await presetApi.activate(target); reloadEnvironment(path) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setWaiting(false) }
  }
  const activityPath = job ? `/activity?operation=${encodeURIComponent(job.id)}${job.actionId ? `&action=${encodeURIComponent(job.actionId)}` : ''}` : '/activity'
  function viewActivity() {
    if (!job) return
    if (data.active === job.preset) window.location.hash = `#${activityPath}`
    else void activate(activityPath, job.preset)
  }
  return <div className="preset-workbench preset-library">
    <section className="preset-detail" aria-label={`${title(preset.id)} preset`}>
      <div className="preset-detail-heading"><h2>Studio</h2><Button variant="ghost" size="sm" disabled={disabled || !preset.initialized} onClick={() => void prepare(false)}><RotateCcw />Reset</Button></div>
      <p className="preset-intro">Eight projects with source files, feature branches, merges, and published releases.</p>
      <div className="preset-summary"><span>{preset.machines.length} {preset.machines.length === 1 ? 'machine' : 'machines'}</span><span>{preset.stores} {preset.stores === 1 ? 'store' : 'stores'}</span><span>{preset.projects} {preset.projects === 1 ? 'project' : 'projects'}</span></div>
      <fieldset className="preset-execution-mode" disabled={disabled}><legend>Execution mode</legend><div role="group" aria-label="Execution mode">{(['filesystem', 'mixed'] as const).map(mode => <Button key={mode} variant={executionMode === mode ? 'secondary' : 'ghost'} size="sm" aria-pressed={executionMode === mode} onClick={() => setSelectedMode(mode)}>{mode === 'mixed' ? 'Mixed' : 'Filesystem'}</Button>)}</div><p>{executionMode === 'mixed' ? 'At least 30% of authored revisions use workspace exec and commit. Each workspace runs two exec/commit pairs, then unmounts. Reuse sandboxes: at most 3 per project and 16 mounted workspaces per sandbox.' : 'Create revisions directly through the LayerFS file CLI.'}</p>{preset.initialized && (preset.settings?.executionMode ?? 'filesystem') !== executionMode && <p>Selected mode differs from the saved library. Build projects to apply it.</p>}</fieldset>
      {job && (job.state === 'queued' || job.state === 'running') && <div className="preset-topology-progress"><div className="preset-topology-progress-heading"><p>{job.rebuild || job.command === 'setup' ? 'Build' : 'Reset'} {title(job.preset)}</p>{job.actionId && <Button variant="ghost" size="sm" disabled={waiting || data.active !== job.preset && data.busy} onClick={viewActivity}><Terminal />CLI Activity</Button>}</div><PresetProgress job={job} /></div>}
      <PresetTopology key={preset.id} preset={displayedPreset} active={data.active === preset.id} onCommands={resource => { setScriptResource(resource); setScriptOpen(true) }} onActivity={(action, invocation) => { window.location.hash = `#/activity?operation=${encodeURIComponent(preset.job!.id)}&action=${encodeURIComponent(action)}&invocation=${encodeURIComponent(invocation)}` }} />
      <div className="preset-environment-note"><span>{title(preset.id)} environment · {data.active === preset.id ? 'Currently open' : 'Not open'}</span>{preset.initialized && data.active !== preset.id && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void activate()}>Open<ArrowUpRight /></Button>}</div>
      <div className="preset-build-actions"><Button variant="outline" disabled={waiting} onClick={() => { setScriptResource(undefined); setScriptOpen(true) }}><Code2 />View script</Button><Button disabled={disabled} onClick={() => void prepare(true)}><Play />Build projects</Button></div>
      <p className="preset-build-note">Build resets this environment, then creates the project library.</p>
      {waiting && !confirmation && <p role="status" className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />Checking environment…</p>}
      {error && <div role="alert" className="preset-request-error"><p className="preset-operation-error">{error}</p>{unknown && <div className="preset-operation-links"><Button variant="outline" size="sm" disabled={waiting} onClick={() => void reconcile()}>Check operation</Button><Button variant="ghost" size="sm" disabled={waiting || data.busy} onClick={() => { setUnknown(undefined); setError(undefined) }}>Dismiss</Button></div>}</div>}
      {job && <section className="preset-operation" aria-label="Preset operation"><p className="mb-3 text-xs text-muted-foreground">{job.rebuild || job.command === 'setup' ? job.state === 'completed' && !preset.contentReady ? 'Previous build' : 'Build' : 'Reset'} {title(job.preset)}</p>{job.state !== 'running' && job.state !== 'queued' && <PresetProgress job={job} />}
        <div className="preset-operation-links">{job.actionId && <Button variant="ghost" size="sm" disabled={waiting || data.active !== job.preset && data.busy} onClick={viewActivity}><Terminal />View CLI Activity</Button>}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Details</summary><p className="mt-2 break-all font-mono">{preset.home}</p>{job.cleanup && <p className="mt-2">{job.cleanup.verified ? 'Cleanup verified in LayerFS inventory.' : 'Cleanup has not been verified.'}</p>}{job.cleanup && 'warnings' in job.cleanup && job.cleanup.warnings.map((warning, i) => <p className="mt-2 break-words" key={i}>{warning}</p>)}{job.cleanup?.remaining?.map(remaining => <p className="mt-2 text-destructive" key={remaining}>{remaining}</p>)}<p className="mt-2">Built-in machine records, backups, and remote PostgreSQL data are retained.</p></details>
        </div>
      </section>}
    </section>
    <PresetScript resource={scriptResource} groups={preset.projectGroups ?? []} preset={preset.id} sandboxes={sandboxes} executionMode={executionMode} open={scriptOpen} onOpenChange={setScriptOpen} />
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !waiting) setConfirmation(undefined) }}><DialogContent><DialogHeader><DialogTitle>{confirmation?.build ? 'Build' : 'Reset'} {title(confirmation?.target ?? preset.id)}?</DialogTitle><DialogDescription>{confirmation?.build ? `Reset this environment, clear its CLI Activity, then build the ${confirmation?.executionMode === 'mixed' ? 'Mixed' : 'Filesystem'} project library.` : 'Empty this environment and clear its CLI Activity.'} Changes inside its stores and workspaces will be discarded.</DialogDescription></DialogHeader>
      {confirmation && <details className="preset-confirm-details"><summary>What will be reset</summary><p>{confirmation.plan.remove.stores.length} SQLite stores · {confirmation.plan.remove.sandboxes.length} sandboxes · {confirmation.plan.remove.workspaces.length} visible workspaces · {confirmation.plan.remove.machines.length} custom machines</p>{!!confirmation.plan.unknownSandboxes.length && <p>Inspect additional workspaces after starting their machines. Stop if inspection fails.</p>}{!!confirmation.plan.disconnect.length && <p>Disconnect PostgreSQL stores; retain their remote data.</p>}<p>Keep built-in native/Docker records and backups. Stop Docker after removing its resources.</p><p className="font-mono">{confirmation.plan.home}</p><ul>{Object.entries(confirmation.plan.remove).flatMap(([kind, names]) => names.map(name => <li key={`${kind}/${name}`}>{kind}: {name}</li>))}</ul></details>}
      <DialogFooter><Button variant="outline" autoFocus disabled={waiting} onClick={() => setConfirmation(undefined)}>Cancel</Button><Button variant="destructive" disabled={waiting || data.busy} onClick={() => void execute()}>{waiting ? 'Starting…' : confirmation?.build ? 'Reset and build' : 'Reset'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}
