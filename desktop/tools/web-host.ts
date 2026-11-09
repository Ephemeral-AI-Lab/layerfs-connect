// Browser preview hosts: independent homes, explicit CLI, no mutation replay.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export type Mode = 'sim' | 'real'
export type Endpoint = { url: string; token: string; mode: Mode }
export const parseMode = (value: string | null): Mode => {
  if (value === null || value === 'sim') return 'sim'
  if (value === 'real') return 'real'
  throw new Error('Choose simulated or real LayerFS.')
}

export class WebHosts {
  readonly controlToken = randomUUID()
  readonly root: string
  private hosts = new Map<Mode, Promise<Endpoint>>()
  private children = new Set<ChildProcess>()
  private stopped = new Set<Mode>()
  constructor(private entry: string, private env: NodeJS.ProcessEnv = process.env) {
    this.root = env.LFS_STATE || mkdtempSync(join(tmpdir(), 'lfs-desktop-web-'))
  }
  start(mode: Mode): Promise<Endpoint> {
    if (this.stopped.has(mode)) return Promise.reject(new Error('The preview host stopped. Restart the preview before switching to this mode.'))
    const existing = this.hosts.get(mode)
    if (existing) return existing
    if (mode === 'real' && !this.env.LAYERFS_CONNECT_CLI) {
      return Promise.reject(new Error('Set LAYERFS_CONNECT_CLI to an absolute pinned CLI path and restart the preview.'))
    }
    const endpoint = new Promise<Endpoint>((resolveReady, reject) => {
      const child = spawn(process.execPath, [this.entry, '--state', join(this.root, mode)], {
        env: { ...this.env, LAYERFS_CONNECT_MODE: mode }, stdio: ['pipe', 'pipe', 'pipe'],
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
          if (ready.mode !== mode || !ready.url || !ready.token) throw new Error()
          clearTimeout(timer)
          resolveReady({ url: ready.url, token: ready.token, mode })
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
        this.stopped.add(mode)
        // Keep the failed endpoint: an explicit preview restart reconciles host loss.
        reject(new Error(failure))
      })
    })
    this.hosts.set(mode, endpoint)
    return endpoint
  }
  scratch(mode: Mode): string {
    const path = join(this.root, mode, 'scratch', randomUUID())
    mkdirSync(path, { recursive: true, mode: 0o700 })
    return path
  }
  close(): void {
    // Closing stdin invokes the host's normal shutdown. Retain state for reconciliation.
    for (const child of this.children) child.stdin?.end()
  }
}
