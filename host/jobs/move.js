// Transfer failures retain the CLI's declared authority. Never infer rollback.
export function failureOutcome(error, phase) {
  if (error?.code === 'Unknown' || (error?.transport && error.transport !== 'refusal') || ['install', 'record'].includes(phase)) return 'unknown'
  if (error?.code === 'Interrupted') return 'interrupted'
  return 'failed'
}

export function transferSummary(job) {
  if (job.outcome === 'unknown') return 'Outcome unknown · Inspect'
  if (job.outcome === 'interrupted') return 'Interrupted · Final result unavailable'
  if (!job.error) return null
  if (job.phase === 'retire') return job.kind === 'pull' || job.half === 'pull'
    ? 'On Home; source copy not removed'
    : `Moved to ${job.target}; old copy on Home not removed`
  if (job.kind === 'move' && job.half === 'push') return 'Pulled to Home; push failed (certain)'
  return null
}
