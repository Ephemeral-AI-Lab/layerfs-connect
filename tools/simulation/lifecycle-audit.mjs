/** Verify recorded workspace admission boundaries, using actual host journal times. */
export function auditLifecycleAdmission(journal) {
  const started = new Map(), finished = new Map(), sandboxes = new Map()
  for (const event of journal) {
    if (event.type === 'step.started' && event.argv?.[0] === 'workspace') {
      if (started.has(event.step)) throw new Error(`Duplicate workspace attempt: ${event.step}`)
      started.set(event.step, event)
    }
    if (event.type === 'step.completed') {
      if (finished.has(event.step)) throw new Error(`Duplicate completed step: ${event.step}`)
      finished.set(event.step, event)
    }
  }
  let checkedWorkspaceCalls = 0
  for (const [key, event] of started) {
    const operation = event.argv[1]
    if (['exec_cancel', 'exec-cancel'].includes(operation)) continue
    const completion = finished.get(key)
    if (!completion) throw new Error(`Workspace call has no confirmed completion: ${key}`)
    const sandbox = String(event.argv[2] ?? '').split(':')[0]
    const start = Date.parse(event.at), end = Date.parse(completion.at)
    if (!sandbox || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error(`Invalid workspace interval: ${key}`)
    const intervals = sandboxes.get(sandbox) ?? []
    sandboxes.set(sandbox, intervals)
    intervals.push({ key, start, end, exclusive: ['mount', 'unmount'].includes(operation) })
    checkedWorkspaceCalls++
  }
  for (const [sandbox, intervals] of sandboxes) {
    const boundaries = intervals.flatMap(interval => interval.end === interval.start ? [] : [{ ...interval, at: interval.start, delta: 1 }, { ...interval, at: interval.end, delta: -1 }])
    // At journal resolution, a completion at t releases admission before a start at t.
    boundaries.sort((left, right) => left.at - right.at || left.delta - right.delta)
    const active = new Map()
    let exclusive = 0
    for (const boundary of boundaries) {
      if (boundary.delta < 0) { active.delete(boundary.key); if (boundary.exclusive) exclusive--; continue }
      if (boundary.exclusive && active.size || !boundary.exclusive && exclusive) throw new Error(`Workspace lifecycle overlap in ${sandbox}: ${boundary.key} overlaps ${[...active.keys()].join(', ')}`)
      active.set(boundary.key, boundary)
      if (boundary.exclusive) exclusive++
    }
  }
  return { checkedSandboxCount: sandboxes.size, checkedWorkspaceCalls, lifecycleAdmissionVerified: true }
}
