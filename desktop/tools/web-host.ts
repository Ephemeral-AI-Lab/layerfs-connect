// Browser preview hosts: independent homes, explicit CLI, no mutation replay.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export type Endpoint = { url: string; token: string; mode: 'real' }

export class WebHosts {
  readonly controlToken = randomUUID()
  readonly root: string
  private endpoint: Promise<Endpoint> | null = null
  private children = new Set<ChildProcess>()
  private stopped = false
  constructor(private entry: string, private env: NodeJS.ProcessEnv = process.env) {
    this.root = env.LFS_STATE || mkdtempSync(join(tmpdir(), 'lfs-desktop-web-'))
  }
  start(): Promise<Endpoint> {
    if (this.stopped) return Promise.reject(new Error('The preview host stopped. Restart the preview to reconnect.'))
    const existing = this.endpoint
    if (existing) return existing
    if (!this.env.LAYERFS_CONNECT_CLI) {
      return Promise.reject(new Error('Set LAYERFS_CONNECT_CLI to an absolute pinned CLI path and restart the preview.'))
    }
    const endpoint = new Promise<Endpoint>((resolveReady, reject) => {
      const child = spawn(process.execPath, [this.entry, '--state', this.root], {
        env: { ...this.env }, stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.children.add(child)
      let failure = 'The preview host could not start. Check its configuration and restart the preview.'
      const timer = setTimeout(() => {
        reject(new Error('The preview host did not start within 30 seconds. Restart the preview.'))
        child.kill()
      }, 30_000)
      createInterface({ input: child.stderr! }).on('line', line => {
        if (/\bCliUnavailable\b/.test(line)) failure = 'LayerFS CLI unavailable. Set LAYERFS_CONNECT_CLI to an absolute pinned CLI path and restart the preview.'
        if (/\bCliIncompatible\b/.test(line)) failure = 'LayerFS CLI incompatible. Configure a supported CLI and matching LAYERFS_CONNECT_DAEMON, then restart the preview.'
      })
      createInterface({ input: child.stdout! }).once('line', line => {
        try {
          const ready = JSON.parse(line) as Endpoint & { ready: boolean }
          // A refusal exits itself; allow stderr to drain before reporting it.
          if (!ready.ready) return
          if (ready.mode !== 'real' || !ready.url || !ready.token) throw new Error()
          clearTimeout(timer)
          resolveReady({ url: ready.url, token: ready.token, mode: 'real' })
        } catch {
          // Keep the startup bound armed even if SIGTERM shutdown stalls.
          // Classify after close, when stderr has drained. Never expose raw errors.
          child.kill()
        }
      })
      child.once('error', () => { clearTimeout(timer); reject(new Error(failure)) })
      child.once('close', () => {
        clearTimeout(timer)
        this.children.delete(child)
        this.stopped = true
        // Keep the failed endpoint: an explicit preview restart reconciles host loss.
        reject(new Error(failure))
      })
    })
    this.endpoint = endpoint
    return endpoint
  }
  scratch(): string {
    const path = join(this.root, 'scratch', randomUUID())
    mkdirSync(path, { recursive: true, mode: 0o700 })
    return path
  }
  close(): void {
    // A pending HTML transform must not launch a host after Vite disposes us.
    this.stopped = true
    // Closing stdin invokes the host's normal shutdown. Retain state for reconciliation.
    for (const child of this.children) child.stdin?.end()
  }
}
