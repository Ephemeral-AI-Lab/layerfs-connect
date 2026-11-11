/** Resource ceilings are independent of the selected CLI process concurrency. */
export const MIXED_RECIPE_VERSION = 2
export const MIXED_REVISIONS_PER_SESSION = 2
export const MIXED_CAPACITY = Object.freeze({ sandboxLimit: 3, workspaceLimit: 16 })
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
export const mixedSandboxName = name => `demo-mix-${name}-1`

/** Compile real CLI lifecycle steps; commits retain their original recipe identity. */
export function mixedHistorySteps(steps, name) {
  const sandbox = mixedSandboxName(name), project = steps[0].argv[2]
  const result = [], unmounts = new Map()
  const createKey = 'mixed.sandbox.create'
  const create = { key: createKey, argv: ['sandbox', 'create', project, sandbox], dependsOn: [steps.filter(step => !step.key.startsWith('dense.')).at(-1).key], lane: 'sandbox', resource: { family: 'sandbox', name: sandbox } }
  const selected = step => /^dense\.\d+\.a\.write\./.test(step.key) || /^dense\.\d+\.b\.write\./.test(step.key) && Number(step.key.split('.').at(-1)) <= 16
  const sessions = new Map()
  let created = false
  for (const step of steps) {
    if (!created && step.key.startsWith('dense.')) { result.push(create); created = true }
    if (!selected(step)) { result.push({ ...step, dependsOn: [...(step.dependsOn ?? [])] }); continue }
    const [prefix, cycle, lane, , indexText] = step.key.split('.'), index = Number(indexText)
    const batch = String(Math.ceil(index / MIXED_REVISIONS_PER_SESSION)).padStart(3, '0')
    const session = `${prefix}.${cycle}.${lane}.session.${batch}`, workspace = `${lane}-${cycle}-${batch}`
    const ws = `${sandbox}:${workspace}`
    if (!sessions.has(session)) {
      const mount = `${session}.mount`
      sessions.set(session, mount)
      result.push({ key: mount, argv: ['workspace', 'mount', sandbox, step.argv[3], '--name', workspace], lane, dependsOn: [...step.dependsOn, createKey] })
    }
    const execKey = `${step.key}.exec`
    const body = `printf '%s' ${quote(step.input)} > ${quote(step.argv[4].replace(/^\//, ''))}`
    result.push({ key: execKey, argv: ['workspace', 'exec', ws, body, '--exec-id', `${name}-${cycle}-${lane}-${index}`, '--events'], lane, dependsOn: (index - 1) % MIXED_REVISIONS_PER_SESSION === 0 ? [sessions.get(session)] : step.dependsOn, expect: { kind: 'exit:0', exitCode: 0 } })
    result.push({ ...step, argv: ['workspace', 'commit', ws, '--message', step.argv[step.argv.indexOf('--message') + 1]], input: undefined, historyArgv: step.argv, workspaceRevision: true, dependsOn: [execKey] })
    if (index % MIXED_REVISIONS_PER_SESSION === 0) {
      const unmount = `${session}.unmount`
      result.push({ key: unmount, argv: ['workspace', 'unmount', ws], lane, dependsOn: [step.key], expect: { kind: 'Unmounted' } })
      unmounts.set(step.key, unmount)
    }
  }
  // Every downstream writer/merge waits for clean detach, without changing
  // the commit identities used by exact-head publication receipts.
  for (const step of result) if (step.argv[1] !== 'unmount') step.dependsOn = (step.dependsOn ?? []).map(key => unmounts.get(key) ?? key)
  // The create's dependency is on the completed base recipe, never itself.
  return result
}

/** Persistent pool: allocate up to 16 distinct workspace leases before growing. */
export class MixedSandboxPool {
  constructor(project, { sandboxLimit = 3, workspaceLimit = 16 } = {}) {
    if (!Number.isInteger(sandboxLimit) || sandboxLimit < 1 || sandboxLimit > 3 || !Number.isInteger(workspaceLimit) || workspaceLimit < 1 || workspaceLimit > 16) throw new Error('Mixed pool exceeds 3 sandboxes or 16 workspaces per sandbox.')
    this.project = project; this.sandboxLimit = sandboxLimit; this.workspaceLimit = workspaceLimit; this.boxes = new Map()
  }
  acquire(workspace) {
    for (const [sandbox, leases] of this.boxes) if (leases.has(workspace)) return sandbox
    let entry = [...this.boxes].find(([, leases]) => leases.size < this.workspaceLimit)
    if (!entry) {
      if (this.boxes.size >= this.sandboxLimit) throw Object.assign(new Error('All mixed sandbox workspace slots are occupied.'), { code: 'Capacity' })
      const sandbox = `demo-mix-${this.project.split('/').at(-1)}-${this.boxes.size + 1}`
      entry = [sandbox, new Set()]; this.boxes.set(...entry)
    }
    entry[1].add(workspace); return entry[0]
  }
  release(sandbox, workspace) { this.boxes.get(sandbox)?.delete(workspace) }
}
