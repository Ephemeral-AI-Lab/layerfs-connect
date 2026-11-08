// Fresh observations gate explicit recovery. They never turn a missing reply into success.
export async function inspectJob(lfs, job) {
  const at = Date.now()
  if (job.kind === 'backup') return { at, kind: 'backup', value: await lfs.backup.list(job.target), action: null }
  if (job.kind === 'restore') return { at, kind: 'restore', value: await lfs.store.get(job.store), action: null }
  const status = await lfs.store.status(job.store)
  const direction = job.kind === 'move' ? job.half ?? 'pull' : job.kind
  const expected = `store.${direction}`
  const machine = direction === 'pull' ? job.from : job.target
  let action = null
  if (status.state === 'idle' && job.outcome === 'failed' && job.phase !== 'retire') action = 'retry'
  const oldOp = job.observation?.value?.op ?? job.error?.detail?.op
  if (status.state === 'unresolved' && oldOp?.id && status.op?.id === oldOp.id && status.op?.name === oldOp.name && status.op?.name === expected) {
    const target = await lfs.machine.status(machine)
    if (target.state === 'running' || (machine === 'native' && target.state === 'ready')) action = 'resolve'
  }
  return { at, kind: 'transfer', value: status, direction, action }
}
