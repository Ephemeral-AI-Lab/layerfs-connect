import { Check, ChevronDown, CircleAlert, LoaderCircle, ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Refusal } from '@/components/layerfs/Refusal'
import { useMachineProgress } from '@/layerfs/use-machine-progress'
import './machine-progress.css'

const STAGE_LABELS: Record<string, string> = {
  'bundle-validation': 'Checking runtime compatibility',
  'sandbox-image': 'Preparing sandbox image',
  'worker-compatibility': 'Verifying worker connection',
}

function stageLabel(stage: string, platform: string) {
  if (stage === 'provider-and-worker') return platform === 'docker' ? 'Starting LayerFS worker' : 'Starting machine and worker'
  return STAGE_LABELS[stage] ?? stage.replaceAll(/[-_]/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

function duration(milliseconds: number) {
  const elapsed = Math.max(0, milliseconds / 1000)
  if (elapsed < 10) return `${elapsed.toFixed(1)}s`
  const seconds = Math.floor(elapsed)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** An observed machine operation, shared by its card, console and creation form. */
export function MachineProgress({ name, compact = false }: { name: string; compact?: boolean }) {
  const operation = useMachineProgress(name)
  const [now, setNow] = useState(Date.now)
  const running = operation?.status === 'running'
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running, operation?.id])
  if (!operation) return null

  const { status, platform, stages } = operation
  const success = status === 'success'
  const uncertain = status === 'uncertain'
  const failed = status === 'failed'
  const latest = stages.at(-1)
  const observed = new Map(stages.map(stage => [stage.stage, stage]))
  const completed = [...observed.values()].filter(stage => stage.state === 'completed')
  const title = success ? 'Startup completed'
    : uncertain ? 'Outcome needs inspection'
      : failed ? 'Startup needs attention'
        : operation.kind === 'create' ? 'Creating machine' : platform === 'docker' ? 'Starting worker' : 'Starting machine'
  const current = latest ? stageLabel(latest.stage, platform) : 'Preparing request…'
  const Icon = running ? LoaderCircle : success ? Check : CircleAlert
  const elapsed = duration((operation.endedAt ?? now) - operation.startedAt)

  return <section className="machine-progress" data-compact={compact || undefined} data-status={status} aria-label={`Startup progress for ${name}`}>
    <div className="machine-progress-heading">
      <div className="machine-progress-title" role="status" aria-live="polite" aria-atomic="true">
        <Icon aria-hidden="true" className={running ? 'machine-progress-spinner' : undefined} />
        <span>{title}</span>
      </div>
      <span className="machine-progress-elapsed" aria-label={`Elapsed time ${elapsed}`}>{elapsed}</span>
    </div>
    {!success && <p className="machine-progress-current" role="status" aria-live="polite" aria-atomic="true">
      {current}{latest?.state === 'completed' ? ' · complete' : latest?.state === 'failed' ? ' · failed' : ''}
    </p>}
    {uncertain && <p className="machine-progress-note">The final result could not be confirmed. Inspect the current state before trying again.</p>}
    {failed && <p className="machine-progress-note">Review the reported error before trying again.</p>}
    {operation.progressUnavailable && <p className="machine-progress-note">Progress updates are unavailable.{running ? ' The operation may still be running.' : ''}</p>}
    {completed.length > 0 && <details key={`${operation.id}-steps`} className="machine-progress-steps">
      <summary><ChevronDown aria-hidden="true" />{completed.length} {completed.length === 1 ? 'step' : 'steps'} completed</summary>
      <ul>{completed.map(stage => <li key={stage.stage}>
        <Check aria-hidden="true" /><span>{stageLabel(stage.stage, platform)}</span>
        {stage.elapsedMs != null && <span className="machine-progress-step-time">{duration(stage.elapsedMs)}</span>}
      </li>)}</ul>
    </details>}
    {(failed || uncertain) && operation.error != null && <details key={`${operation.id}-error`} className="machine-progress-error">
      <summary>Reported error</summary>
      <Refusal error={operation.error} compact />
    </details>}
    <Link className="machine-progress-activity" to={`/activity?action=${encodeURIComponent(operation.id)}`}>
      View CLI activity <ArrowUpRight aria-hidden="true" />
    </Link>
  </section>
}
