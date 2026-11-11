export const DEFAULT_HISTORY_LIMITS = Object.freeze({ concurrency: 12, perStore: 3, perProject: 3 })

/** Fair command-level admission. Dependencies never occupy a process slot. */
export async function runHistoryDAG(tasks, execute, { concurrency = DEFAULT_HISTORY_LIMITS.concurrency, perStore = DEFAULT_HISTORY_LIMITS.perStore, perProject = DEFAULT_HISTORY_LIMITS.perProject } = {}) {
  for (const [name, value] of Object.entries({ concurrency, perStore, perProject })) if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid history ${name}: ${value}`)
  const projects = tasks.map(task => {
    const nodes = new Map(task.steps.map(step => [step.key, { step, waiting: step.dependsOn.length, children: [] }]))
    if (nodes.size !== task.steps.length) throw new Error(`Duplicate history step in ${task.project}`)
    for (const node of nodes.values()) for (const dependency of node.step.dependsOn) {
      const parent = nodes.get(dependency)
      if (!parent) throw new Error(`Missing history dependency ${dependency}`)
      parent.children.push(node)
    }
    // Reject cycles before any mutation, independently of runtime completion.
    const counts = new Map([...nodes.values()].map(node => [node, node.waiting]))
    const roots = [...nodes.values()].filter(node => !node.waiting), queue = [...roots]
    for (let index = 0; index < queue.length; index++) for (const child of queue[index].children) {
      counts.set(child, counts.get(child) - 1); if (!counts.get(child)) queue.push(child)
    }
    if (queue.length !== nodes.size) throw new Error(`Cyclic history dependencies in ${task.project}`)
    return { task, ready: roots, running: 0 }
  })
  const active = new Set(), stores = new Map()
  let cursor = 0, failure
  while (true) {
    let launched = false
    if (!failure && active.size < concurrency) {
      for (let inspected = 0; inspected < projects.length; inspected++) {
        const index = (cursor + inspected) % projects.length, project = projects[index]
        if (!project.ready.length || project.running >= perProject || (stores.get(project.task.store) ?? 0) >= perStore) continue
        const node = project.ready.shift(), store = project.task.store
        project.running++; stores.set(store, (stores.get(store) ?? 0) + 1)
        const pending = Promise.resolve().then(() => execute(project.task, node.step)).then(() => {
          for (const child of node.children) if (--child.waiting === 0) project.ready.push(child)
        }, error => { failure ??= error }).finally(() => {
          project.running--; stores.set(store, stores.get(store) - 1); active.delete(pending)
        })
        active.add(pending); cursor = (index + 1) % projects.length; launched = true
        break
      }
    }
    if (launched) continue
    if (!active.size) break
    await Promise.race(active)
  }
  if (failure) throw failure
}
