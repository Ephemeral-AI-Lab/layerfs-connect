// The Storage view and project list of a simulated host (data/compute-sim.ts),
// so Storage and Projects draw the same sample home Machines does: each
// machine's sqlite Stores with their projects (the Sandboxes' projects first),
// a PostgreSQL Store, a bucket with backups, and a push in flight to the
// first running VM. Nothing here is sent to a host.

import type { Simulation } from '@/data/compute-sim'
import type { BackupFile, ProjectSummary, StorageJob, StorageView, StoreRow } from '@shared/host-api'

const NAMES = ['app', 'web', 'api', 'docs', 'site', 'jobs', 'notes', 'lab']
const HOUR = 3_600_000

/** A Store's project names: those its Sandboxes work on, then sample names, `count` in all. */
const namesOf = (store: string, count: number, from: string[]) => {
  const own = [...new Set(from.filter((k) => k.startsWith(`${store}/`)).map((k) => k.slice(store.length + 1)))]
  return [...own, ...NAMES.filter((n) => !own.includes(n))].slice(0, Math.max(count, own.length))
}

const cache = new WeakMap<Simulation, { storage: StorageView; projects: ProjectSummary[] }>()

function build(sim: Simulation) {
  const at = Date.now()
  const v = sim.view
  if (!v.available) return { storage: { machines: [], stores: [], buckets: [], jobs: [], at }, projects: [] }
  const keys = v.sandboxes.map((b) => b.project ?? '')
  const machines = v.machines.map((m) => ({ name: m.name, platform: m.platform, state: v.status[m.name]?.state ?? m.state, supports: m.supports ?? null }))
  const running = (name: string) => ['ready', 'running'].includes(machines.find((m) => m.name === name)?.state ?? '')
  // a push leaves from the home and the Store stays there until LayerFS records it on the target
  const target = machines.find((m) => m.name !== 'native' && running(m.name) && m.supports?.sqlite !== false)?.name ?? null
  // (a push is refused while the Store's projects have Sandboxes)
  const pushTo = target ? v.stores.find((s) => s.machine === 'native' && !keys.some((k) => k.startsWith(`${s.name}/`))) : undefined
  const sqlite: StoreRow[] = v.stores.map((s, i) => {
    const down = running(s.machine) ? null : `${s.machine} is ${machines.find((m) => m.name === s.machine)?.state ?? 'not answering'}`
    const busy = s === pushTo
    return {
      name: s.name,
      kind: 'sqlite',
      machine: s.machine,
      projects: namesOf(s.name, s.projects, keys),
      created: at - (i + 2) * 24 * HOUR,
      size: s.size === null ? null : { bytes: s.size, file: Math.round(s.size * 0.93), wal: Math.round(s.size * 0.07) },
      state: down ? 'down' : busy ? 'busy' : keys.some((k) => k.startsWith(`${s.name}/`)) ? 'in_use' : 'idle',
      op: busy ? { id: 'op-sim-push', name: 'store.push', phase: 'send', started: at - 90_000, uncertain: false } : null,
      refusal: null,
      holders: 0,
      down,
      links: i % 2 === 0 ? [{ bucket: 'r2-main', file: `${s.name}.lfs`, last: { op: 'backup', at: at - (i + 1) * 5 * HOUR, bytes: s.size } }] : [],
      job: busy ? 'sim-push' : null,
    }
  })
  const pg: StoreRow = { name: 'pg', kind: 'postgresql', machine: null, projects: namesOf('pg', 1, keys), created: at - 9 * 24 * HOUR, size: null, state: 'idle', op: null, refusal: null, holders: 0, down: null, links: [], job: null, postgresql: { target: 'app@db.internal:5432/layerfs', reachable: true, version: '16.4', latencyMs: 3, error: null } }
  const stores = [...sqlite, pg]
  const files: BackupFile[] = sqlite.flatMap((s, i) =>
    s.links.map((l) => ({ file: l.file, store: s.name, state: i === 0 ? 'current' : i % 4 === 2 ? 'store_changed' : 'current', bytes: s.size?.bytes ?? null, modified: l.last?.at ?? null, reason: null })),
  )
  files.push({ file: 'old-demo.lfs', store: null, state: 'unlinked', bytes: 12e6, modified: at - 30 * 24 * HOUR, reason: null })
  const jobs: StorageJob[] = pushTo
    ? [
        { id: 'sim-push', kind: 'push', store: pushTo.name, target: target!, file: null, started: at - 90_000, ended: null, phase: 'send', done: Math.round((pushTo.size ?? 1e9) * 0.4), total: pushTo.size ?? 1e9, error: null, result: null },
        // its earlier jobs, for its page's Activity
        { id: 'sim-push-failed', kind: 'push', store: pushTo.name, target: target!, file: null, started: at - 12 * 60_000, ended: at - 11 * 60_000, phase: 'verify', done: null, total: pushTo.size, error: { code: 'Failed', message: 'the copy on the machine does not match the snapshot it was sent from', phase: 'verify', detail: null }, result: null },
        { id: 'sim-backup-done', kind: 'backup', store: pushTo.name, target: 'r2-main', file: `${pushTo.name}.lfs`, started: at - 40 * 60_000, ended: at - 38 * 60_000, phase: 'upload', done: null, total: pushTo.size, error: null, result: null },
      ]
    : []
  // a busy home (many Stores): one job of each other kind on the Stores that are free
  const free = v.stores.filter((s) => s !== pushTo && s.machine === 'native' && !keys.some((k) => k.startsWith(`${s.name}/`)))
  if (target && v.stores.length >= 6 && free.length >= 3) {
    const [moved, backedUp, byCli] = free
    jobs.push(
      { id: 'sim-move-failed', kind: 'move', store: moved.name, target, from: 'lima-dev', half: 'push', file: null, started: at - 5 * 60_000, ended: at - 3 * 60_000, phase: 'send', done: null, total: moved.size, error: { code: 'Unavailable', message: `machine ${target} stopped answering while the file was sent`, phase: 'send', detail: null, note: 'pulled' }, result: null },
      { id: 'sim-backup', kind: 'backup', store: backedUp.name, target: 'r2-main', file: `${backedUp.name}.lfs`, started: at - 70_000, ended: at - 8_000, phase: 'upload', done: null, total: backedUp.size, error: null, result: null },
    )
    const row = sqlite.find((s) => s.name === byCli.name)!
    Object.assign(row, { state: 'busy', op: { id: 'op-sim-cli', name: 'store.push', phase: 'verify', started: at - 3 * 60_000, uncertain: false } })
  }
  const storage: StorageView = { machines, stores, buckets: [{ name: 'r2-main', provider: 'r2', listed: at - 10 * 60_000, files, error: null, stores: sqlite.filter((s) => s.links.length).map((s) => s.name) }], jobs, at }
  const projects: ProjectSummary[] = stores.flatMap((s) =>
    s.projects.map((name, j) => ({ name, key: `${s.name}/${name}`, store: s.name, kind: s.kind, machine: s.machine, created: (s.created ?? at) + j * HOUR, storeState: s.state, storeOp: s.op ?? null, storeDown: s.down, refusal: null })),
  )
  return { storage, projects }
}

const built = (sim: Simulation) => {
  let b = cache.get(sim)
  if (!b) cache.set(sim, (b = build(sim)))
  return b
}

/** GET /api/storage on a simulated host. */
export const simStorage = (sim: Simulation): StorageView => built(sim).storage
/** The project list of a simulated host. */
export const simProjects = (sim: Simulation): ProjectSummary[] => built(sim).projects
