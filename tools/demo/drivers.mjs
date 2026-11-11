import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { execute } from '../../host/cli/spawn.js'
import { discover } from '../../host/cli/capabilities.js'
import { activityContext } from '../../host/activity/context.js'
import { invocationIdentity } from '../../host/activity/recorder.js'

const enc = encodeURIComponent
export class CliDriver {
  constructor(spec, report = () => {}) { this.spec = spec; this.report = report }
  discover() { return discover(this.spec) }
  async invoke(argv, { input, read = false, onInvocation } = {}) {
    if (process.exitCode === 130) throw Object.assign(new Error('Demo operation interrupted; inspect status before continuing.'), { code: 'Interrupted' })
    this.report(`CLI: layerfs ${argv.join(' ')}`)
    const call = `${argv[0]}.${argv[1]}`
    const storeRead = read && ['file', 'branch', 'commit', 'project'].includes(argv[0]) ? argv[2]?.split('/')[0] : undefined
    const pending = execute(this.spec, argv, { input, read, storeRead, ...(this.concurrency ? { concurrency: this.concurrency, concurrencyGroup: activityContext()?.action?.id } : {}), timeout: 120000, onProgress: progress => { if (progress.phase) this.report(`  ${call}: ${progress.phase}`) } })
    const identity = invocationIdentity(pending)
    try { if (identity) onInvocation?.(identity) } catch (error) {
      // The command is already admitted and may have mutated LayerFS. Custody
      // persistence failure must not release the operation lock before its child.
      // Consume either outcome, then retain the original journal error.
      try { await pending } catch { /* The journal failure remains authoritative. */ }
      throw error
    }
    return pending
  }
}

/** Reuses the host operations behind desktop controls; CLI-only history stays explicit. */
export class DesktopDriver extends CliDriver {
  async connect() {
    let endpoint
    try { endpoint = JSON.parse(readFileSync(resolve(this.spec.state, 'host.json'), 'utf8')) } catch { throw new Error('No running desktop/preview host for this demo state. Start "preview" with this preset first, then use --via desktop.') }
    const url = new URL(endpoint.url)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || !endpoint.token) throw new Error('Invalid local demo host receipt.')
    this.endpoint = endpoint
    const status = await this.request('GET', '/api/status')
    if (status.mode !== 'real' || realpathSync(status.settings?.home) !== realpathSync(this.spec.home) || realpathSync(status.settings?.cli) !== realpathSync(this.spec.cli)) throw new Error('Desktop host home or CLI does not match the fixture configuration. Restart the preview with this demo state and CLI.')
  }
  async request(method, path, body) {
    const action = activityContext()?.action
    this.report(`Desktop operation: ${method} ${path}`)
    let res
    try { res = await fetch(`${this.endpoint.url}${path}`, { method, headers: { authorization: `Bearer ${this.endpoint.token}`, 'content-type': 'application/json', ...(action ? { 'x-lfs-action': encodeURIComponent(JSON.stringify(action)) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) }) }
    catch { throw Object.assign(new Error('The desktop operation lost its response. Inspect status before another action.'), { code: 'Unknown', transport: 'transport-unknown' }) }
    let result
    try { result = await res.json() } catch { throw Object.assign(new Error('The desktop response was incomplete. Inspect status before another action.'), { code: 'Unknown', transport: 'transport-unknown' }) }
    if (!res.ok) throw Object.assign(new Error(result.message ?? `Desktop operation returned HTTP ${res.status}`), { code: result.code, transport: result.transport ?? 'refusal', detail: result.detail })
    return result
  }
  async job(path, initial) {
    const deadline = Date.now() + 120000
    let job = initial
    while (!job.ended) {
      if (Date.now() >= deadline) throw Object.assign(new Error('Desktop job is still running. Inspect status; do not replay it.'), { code: 'Unknown', transport: 'transport-unknown' })
      await new Promise(resolve => setTimeout(resolve, 250))
      job = await this.request('GET', `${path}/${enc(job.id)}`)
    }
    if (job.error) throw Object.assign(new Error(job.error.message), job.error)
    return job.result ?? job.project ?? job
  }
  async invoke(argv, options = {}) {
    const [family, call, name, extra] = argv
    if (options.read) return super.invoke(argv, options)
    if (family === 'machine') {
      if (call === 'create') {
        const flag = key => argv[argv.indexOf(key) + 1]
        return this.request('POST', '/api/machines', { name, platform: extra, cpus: Number(flag('--cpus')), memory: flag('--memory'), disk: flag('--disk') })
      }
      if (call === 'start' || call === 'stop') return this.request('POST', `/api/machines/${enc(name)}/${call}`)
      if (call === 'remove') return this.request('DELETE', `/api/machines/${enc(name)}`)
    }
    if (family === 'store') {
      if (call === 'create') return this.request('POST', '/api/stores', { name })
      if (call === 'remove') return this.request('DELETE', `/api/stores/${enc(name)}?confirm=${enc(name)}`)
      if (call === 'push' || call === 'pull') return this.job('/api/storage-jobs', await this.request('POST', `/api/stores/${enc(name)}/${call}`, call === 'push' ? { machine: extra } : {}))
    }
    if (family === 'project' && call === 'init') {
      const [store, project] = name.split('/')
      return this.job('/api/project-inits', await this.request('POST', '/api/projects', { store, name: project, source: extra }))
    }
    if (family === 'sandbox') {
      if (call === 'create') return this.request('POST', `/api/projects/${enc(name)}/sandboxes`, { name: extra, machine: argv[4] })
      if (call === 'close') return this.request('DELETE', `/api/sandboxes/${enc(name)}`)
    }
    if (family === 'workspace') {
      if (call === 'mount') return this.request('POST', `/api/sandboxes/${enc(name)}/workspaces`, { branch: extra, name: argv[argv.indexOf('--name') + 1] })
      if (call === 'unmount') return this.request('DELETE', `/api/workspaces/${enc(name)}?discard=1`)
    }
    this.report('  No matching desktop control; using the real CLI for fixture history/configuration.')
    return super.invoke(argv, options)
  }
}
