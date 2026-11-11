import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { CliInventory } from './cli/inventory.js'
import { activityRecorder } from './activity/recorder.js'
import { withActivity } from './activity/context.js'
import { liveReceipt, fixtureBusy } from './demo-presets/admission.js'

const sorted = items => [...items].sort((a, b) => a.name.localeCompare(b.name))
const builtIn = name => ['native', 'docker'].includes(name)
const save = (file, value) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, file) }

/** General reset of one explicitly selected home. Never selects by fixture ownership. */
export class EnvironmentReset extends CliInventory {
  constructor({ spec, driver, report = () => {}, progress = () => {} }) { super(driver); this.spec = spec; this.report = report; this.progress = progress; this.lock = join(spec.state, 'demo-fixtures.lock') }
  identity() {
    const id = JSON.parse(readFileSync(join(this.spec.home, 'layerfs.json'), 'utf8')).id
    if (!id) throw new Error('The selected environment has no valid LayerFS home identity.')
    return id
  }
  async plan() {
    const homeId = this.identity(), machines = sorted(await this.inventory('machine')), stores = sorted(await this.inventory('store')), sandboxes = sorted(await this.inventory('sandbox'))
    for (const row of [...machines, ...stores, ...sandboxes]) if (row.op) throw fixtureBusy(`${row.name} has an active or unresolved operation. Inspect its status before resetting.`)
    const workspaces = [], unknownSandboxes = [], workspaceGroups = []
    for (const box of sandboxes) {
      const detail = await this.sandboxDetails(box.name, { allowDown: true })
      if (detail.incomplete) unknownSandboxes.push(box.name)
      else {
        const names = detail.workspaces.map(ws => ws.ws)
        workspaces.push(...names); workspaceGroups.push({ sandbox: box.name, workspaces: names })
      }
    }
    const remove = { stores: stores.filter(s => s.kind !== 'postgresql').map(s => s.name), sandboxes: sandboxes.map(s => s.name), machines: machines.filter(m => !builtIn(m.name)).map(m => m.name), workspaces: workspaces.sort() }
    const disconnect = stores.filter(s => s.kind === 'postgresql').map(s => s.name)
    const startMachines = [...new Set([...stores, ...sandboxes].map(r => r.machine).filter(name => name && name !== 'native'))].filter(name => !['running', 'ready'].includes(machines.find(m => m.name === name)?.state)).sort()
    const detectedMachines = machines.map(({ name, state, platform }) => ({ name, state, platform }))
    const plan = { home: this.spec.home, homeId, remove, disconnect, unknownSandboxes, workspaceGroups, startMachines, detectedMachines, projects: stores.reduce((n, s) => n + (s.projects?.length ?? 0), 0), stopDocker: machines.some(m => m.name === 'docker' && !['stopped', 'ready'].includes(m.state)), scope: 'environment' }
    const identities = [machines, stores, sandboxes].map(rows => rows.map(({ name, id, created, machine, kind, projects }) => ({ name, id, created, machine, kind, projects })))
    const signature = createHash('sha256').update(JSON.stringify({ ...plan, identities })).digest('hex')
    return { ...plan, signature }
  }
  async remaining() {
    const stores = await this.inventory('store'), sandboxes = await this.inventory('sandbox'), machines = await this.inventory('machine')
    return [...stores.map(r => `store ${r.name}`), ...sandboxes.map(r => `sandbox ${r.name}`), ...machines.filter(m => !builtIn(m.name)).map(r => `machine ${r.name}`), ...machines.filter(m => m.name === 'docker' && !['stopped', 'ready'].includes(m.state)).map(() => 'running Docker worker')]
  }
  async run({ expectedPlan, onReady, assertIdle, afterCleanup }) {
    mkdirSync(this.spec.state, { recursive: true, mode: 0o700 })
    let fd
    try { fd = openSync(this.lock, 'wx', 0o600) } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (liveReceipt(this.lock)) throw fixtureBusy('Another preset or environment reset is running.')
      throw fixtureBusy('A previous operation left a stale lock. Inspect its status and receipt before removing the lock and resetting.')
    }
    const action = { id: randomUUID(), name: 'environment.reset', label: 'Reset LayerFS environment', target: this.spec.home, origin: 'user', page: '/presets' }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, actionId: action.id })); closeSync(fd)
    const recorder = activityRecorder(this.spec.state)
    let receipt
    try {
      this.progress({ stage: 'checking', completed: 0, total: null, label: 'Checking environment inventory' })
      await assertIdle()
      await this.driver.discover()
      const plan = await this.plan()
      if (plan.signature !== expectedPlan) throw Object.assign(new Error('The environment changed since confirmation. Review the reset plan again.'), { code: 'Conflict', status: 409 })
      let clearError
      try { await recorder.clear() } catch (e) { if (!e.activityCleared) throw e; clearError = e }
      this.report('Previous CLI Activity in this environment was cleared.')
      receipt = { ...plan, actionId: action.id, verified: false, completed: [], remaining: [], warnings: [], at: Date.now() }
      const file = join(this.spec.state, 'environment-reset.json')
      save(file, receipt)
      const cleanup = await withActivity({ state: this.spec.state, action }, async () => {
        recorder.record(action, 'action.received')
        try {
          await onReady?.(action)
          if (clearError) throw new Error(`Previous history was cleared, but some old log files could not be removed: ${clearError.message}. Resource cleanup has not started. Inspect the activity directory before resetting again.`)
          let completed = 0
          const total = plan.unknownSandboxes.length ? null : plan.startMachines.length + Object.values(plan.remove).reduce((n, rows) => n + rows.length, 0) + plan.disconnect.length + Number(plan.stopDocker || plan.startMachines.includes('docker'))
          this.progress({ stage: 'resetting', completed, total, label: 'Removing detected resources' })
          const mutate = async argv => {
            this.progress({ stage: 'resetting', completed, total, label: `layerfs ${argv.join(' ')}` })
            this.report(`CLI: layerfs ${argv.join(' ')}`)
            const result = await this.driver.invoke(argv)
            receipt.completed.push(argv); completed++
            this.progress({ stage: 'resetting', completed, total, label: `Completed: layerfs ${argv.join(' ')}` })
            if (result?.note || result?.left) receipt.warnings.push(result.note ?? result.left)
            save(file, receipt); return result
          }
          this.report('Starting machines needed to reach their resources')
          for (const machine of plan.startMachines) await mutate(['machine', 'start', machine])
          this.report('Unmounting workspaces and closing sandboxes')
          const workspaces = []
          for (const name of plan.remove.sandboxes) {
            const box = await this.sandboxDetails(name)
            for (const workspace of box.workspaces) { workspaces.push(workspace.ws); await mutate(['workspace', 'unmount', workspace.ws, '--discard']) }
            await mutate(['sandbox', 'close', name])
          }
          receipt.remove.workspaces = workspaces
          this.report('Removing stores and disconnecting PostgreSQL stores')
          for (const name of plan.remove.stores) await mutate(['store', 'remove', name])
          for (const name of plan.disconnect) await mutate(['store', 'disconnect', name])
          this.report('Removing custom machines and stopping Docker')
          for (const name of plan.remove.machines) await mutate(['machine', 'remove', name])
          const docker = (await this.inventory('machine')).find(m => m.name === 'docker')
          if (docker && !['stopped', 'ready'].includes(docker.state)) await mutate(['machine', 'stop', 'docker'])
          this.progress({ stage: 'verifying', completed: 0, total: 1, label: 'Verifying empty environment' })
          this.report('Verifying empty environment against LayerFS inventory')
          if (this.identity() !== plan.homeId) throw new Error('The LayerFS home identity changed during reset.')
          receipt.remaining = await this.remaining()
          if (receipt.remaining.length) throw new Error(`Environment reset verification failed: ${receipt.remaining.join(', ')}. Inspect CLI Activity before continuing.`)
          this.progress({ stage: 'verifying', completed: 1, total: 1, label: 'Empty environment verified' })
          receipt.verified = true; receipt.ended = Date.now(); save(file, receipt)
          recorder.record(action, 'action.finished', { status: 200, cleanup: receipt })
          return receipt
        } catch (e) {
          try { receipt.remaining = await this.remaining() } catch (readError) { receipt.warnings.push(`Remaining inventory could not be read: ${readError.message}`) }
          receipt.error = { code: e.code ?? 'Failed', message: e.message }; receipt.ended = Date.now(); save(file, receipt)
          recorder.record(action, 'action.finished', { status: 500, error: true, code: e.code ?? 'Failed', cleanup: receipt })
          throw e
        } finally { await recorder.flush() }
      })
      // Build continues under this same lease, after the reset action is flushed.
      return afterCleanup ? await afterCleanup(cleanup, action.id) : cleanup
    } finally { unlinkSync(this.lock) }
  }
}
