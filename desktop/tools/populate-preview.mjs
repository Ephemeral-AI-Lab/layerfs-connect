// Additive, repeatable fixtures for the actual web-preview host. Never resets
// its world, touches real LayerFS, or starts a real VM/container.
// In the preview browser console:
//   const {populatePreview} = await import('/@fs' + '<checkout>/desktop/tools/populate-preview.mjs')
//   await populatePreview()
export async function populatePreview(report = console.log) {
  const endpoint = JSON.parse(document.querySelector('meta[name="lfs-host"]').content)
  const call = async (method, path, body) => {
    const res = await fetch(`${endpoint.url}/api/${path}`, {
      method, headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(`${path}: ${result.code} ${result.message}`)
    return result
  }
  // Both checks must pass before the first write. /sim is absent on real hosts.
  await call('GET', 'sim')
  if ((await call('GET', 'status')).mode !== 'sim') throw new Error('Simulated preview only')
  const enc = encodeURIComponent
  const wait = async (path, job) => {
    const deadline = Date.now() + 120_000
    while (!job.ended) {
      if (Date.now() > deadline) throw new Error(`${path}: timed out`)
      await new Promise(resolve => setTimeout(resolve, 300))
      job = await call('GET', `${path}/${enc(job.id)}`)
    }
    if (job.error) throw new Error(job.error.message)
  }
  let view = await call('GET', 'machines')
  const machines = [
    { name: 'build', platform: 'lima', cpus: 8, memory: 16 * 1024 ** 3, disk: 120 * 1024 ** 3 },
    { name: 'research', platform: 'lima', cpus: 6, memory: 24 * 1024 ** 3, disk: 160 * 1024 ** 3 },
    { name: 'edge', platform: 'microsandbox', cpus: 2, memory: 4 * 1024 ** 3, disk: 64 * 1024 ** 3 },
    { name: 'release', platform: 'apple-container', cpus: 4, memory: 8 * 1024 ** 3, disk: 64 * 1024 ** 3 },
    { name: 'spare', platform: 'lima', cpus: 2, memory: 4 * 1024 ** 3, disk: 32 * 1024 ** 3 },
  ]
  for (const machine of machines) {
    if (!view.machines.some(m => m.name === machine.name)) {
      report(`Creating simulated machine ${machine.name}`)
      await call('POST', 'machines', machine)
      if (machine.name === 'spare') await call('POST', 'machines/spare/stop')
    }
  }
  const stores = [
    { name: 'studio', machine: 'native', projects: { website: [3, 1], design: [2], docs: [0] } },
    { name: 'services', machine: 'docker', projects: { gateway: [4, 2], billing: [2], notifications: [1] } },
    { name: 'build-cache', machine: 'build', projects: { compiler: [5, 2, 0], sdk: [3, 1], cli: [2] } },
    { name: 'experiments', machine: 'research', projects: { embeddings: [4, 2], evaluation: [3], datasets: [1] } },
    { name: 'edge-apps', machine: 'edge', projects: { worker: [2, 1], scheduler: [1] } },
    { name: 'shipping', machine: 'release', projects: { desktop: [3, 1], updater: [2] } },
    { name: 'shared-demo', postgres: true, projects: { platform: [3, 2, 1], analytics: [2, 1] } },
  ]
  const branches = ['feature-auth', 'fix-cache', 'release-v2', 'perf-index', 'docs-refresh']
  const existing = await call('GET', 'storage')
  for (const store of stores) {
    let row = existing.stores.find(s => s.name === store.name)
    if (!row) {
      report(`Creating simulated Store ${store.name}`)
      await call('POST', store.postgres ? 'stores/postgresql' : 'stores', store.postgres
        ? { name: store.name, url: 'postgresql://demo@db.example.test:5432/connect', password: 'env:LAYERFS_DEMO_PG' }
        : { name: store.name })
    }
    for (const name of Object.keys(store.projects)) {
      const projects = await call('GET', 'projects')
      const key = `${store.name}/${name}`
      if (!projects.some(p => p.key === key || p.name === key)) {
        report(`Creating project ${key}`)
        await wait('project-inits', await call('POST', 'projects', { store: store.name, name }))
      }
    }
    if (!store.postgres && store.machine !== 'native' && (!row || row.machine === 'native')) {
      await wait('storage-jobs', await call('POST', `machines/${store.machine}/stores`, { store: store.name }))
    }
    for (const [project, counts] of Object.entries(store.projects)) {
      const key = `${store.name}/${project}`
      for (const [index, count] of counts.entries()) {
        const name = `demo-${project}-${index + 1}`
        view = await call('GET', 'machines')
        if (!view.sandboxes.some(s => s.name === name)) {
          const machine = store.postgres ? ['native', 'build', 'docker'][index] : store.machine
          report(`Creating ${name} on ${machine}`)
          await call('POST', `projects/${enc(key)}/sandboxes`, { name, machine,
            ...(machine === 'native' ? {} : { image: project === 'embeddings' ? 'python:3.12-slim' : 'node:24-bookworm' }) })
        }
        const detail = await call('GET', `sandboxes/${name}`)
        const state = await call('GET', `projects/${enc(key)}`)
        for (let n = 0; n < count; n++) {
          const ws = `workspace-${n + 1}`
          if (detail.workspaces.some(w => w.name === ws)) continue
          const branch = branches[n]
          await call('POST', `sandboxes/${name}/workspaces`, {
            name: ws, branch, fork: !state.branches.some(b => b.name === branch),
          })
          if (!state.branches.some(b => b.name === branch)) state.branches.push({ name: branch })
        }
      }
    }
  }
  const summary = await call('GET', 'sim')
  view = await call('GET', 'machines')
  return { machines: summary.machines, stores: summary.stores, projects: summary.projects,
    sandboxes: view.sandboxes.length, workspaces: view.sandboxes.reduce((sum, s) => sum + (s.workspaces ?? 0), 0) }
}
