import { useEffect, useState } from 'react'
import { count, elapsed } from './preset-format'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import type { PresetJob } from '@/layerfs/demo-presets-api'
import './presets.css'

const names = { checking: 'Checking', resetting: 'Resetting', building: 'Building', verifying: 'Verifying' }
function readableLabel(value: string) {
  const match = /^(?:Completed: )?layerfs (workspace|sandbox|store|machine) (\w+) ([^ ]+)/.exec(value)
  if (!match) return value
  const [, family, operation, name] = match
  const verb = operation === 'unmount' ? 'Unmounting' : operation === 'close' ? 'Closing' : operation === 'remove' ? 'Removing' : operation === 'disconnect' ? 'Disconnecting' : operation === 'stop' ? 'Stopping' : operation === 'start' ? 'Starting' : operation
  return `${verb} ${family} ${name}`
}

export function PresetProgress({ job, compact = false }: { job: PresetJob; compact?: boolean }) {
  const [now, setNow] = useState(Date.now)
  const running = job.state === 'queued' || job.state === 'running'
  const complete = job.state === 'completed'
  useEffect(() => { if (!running) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [running])
  const stages = job.rebuild ? ['checking', 'resetting', 'building', 'verifying'] as const : job.command === 'setup' ? ['checking', 'building', 'verifying'] as const : ['checking', 'resetting', 'verifying'] as const
  const progress = job.progress
  const tasks = progress?.tasks ?? []
  const runningProjects = tasks.filter(task => task.state === 'running').length
  const completedProjects = tasks.filter(task => task.state === 'completed').length
  const failedProjects = tasks.filter(task => task.state === 'failed').length
  const stoppedProjects = tasks.filter(task => task.state === 'stopped').length
  const projectSummary = tasks.length ? `${runningProjects} ${runningProjects === 1 ? 'project' : 'projects'} running · ${completedProjects} / ${tasks.length} completed${failedProjects ? ` · ${failedProjects} failed` : ''}${stoppedProjects ? ` · ${stoppedProjects} stopped` : ''}` : undefined
  const stage = progress?.stage ?? 'checking'
  const index = Math.max(0, stages.findIndex(value => value === stage))
  const known = progress?.total != null && progress.total >= 0
  const fraction = complete ? 1 : known ? progress.total === 0 ? 1 : Math.min(1, progress.completed / progress.total!) : 0
  const label = complete ? job.rebuild || job.command === 'setup' ? 'Build complete' : 'Reset complete' : readableLabel(progress?.label ?? job.phase)
  return <div className={`preset-progress${compact ? ' preset-progress-compact' : ''}`} aria-live="polite">
    <div className="preset-progress-heading">{running ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : complete ? <Check aria-hidden className="size-4 text-success" /> : <CircleAlert aria-hidden className="size-4 text-destructive" />}<span>{label}</span>{running && known && <span className="preset-step-count">{count(progress.historyCompleted ?? progress.completed)} / {count(progress.historyTotal ?? progress.total!)} {progress.historyTotal != null ? "commands" : stage === "verifying" && tasks.length ? "projects" : "steps"}</span>}</div>
    {projectSummary && <p className="preset-project-progress-summary">{projectSummary}{job.started ? ` · ${elapsed(job.started, job.ended, now)} elapsed` : ""}</p>}
    {progress?.workspaceCoverage && <p className="preset-project-progress-summary">Workspace revisions: {count(progress.workspaceCoverage.completed)} / {count(progress.workspaceCoverage.required)} required · {progress.workspaceCoverage.total ? (100 * progress.workspaceCoverage.completed / progress.workspaceCoverage.total).toFixed(1) : '0'}% of authored revisions</p>}
    {(running || !complete) && <>
      <div className="preset-progress-rail" role="progressbar" aria-label="Operation stages" aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={known ? index + fraction : undefined} aria-valuetext={`${names[stage]}${known ? `, ${progress.completed} of ${progress.total} steps` : ', in progress'}${projectSummary ? `, ${projectSummary}` : ''}`}>
        {stages.map((value, step) => <span key={value} className={`preset-progress-segment${step === index && running && !known ? ' is-indeterminate' : ''}`}><span style={{ width: step < index ? '100%' : step === index ? `${fraction * 100}%` : '0%' }} /></span>)}
      </div>
      <div className="preset-progress-stages">{stages.map((value, step) => <span key={value} className={step === index ? 'is-current' : ''}>{names[value]}</span>)}</div>
    </>}
    {!running && !complete && <p className="preset-operation-error">{job.error?.message ?? job.phase}</p>}
  </div>
}
