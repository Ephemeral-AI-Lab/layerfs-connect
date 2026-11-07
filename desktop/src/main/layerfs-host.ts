// The LayerFS Connect host (../host, host/README.md): a Node child process
// serving Machines, Storage and projects on 127.0.0.1. Main owns it and its
// bearer token; the renderer reaches it only through the `layerfs:*` IPC
// channels (index.ts). Adapted from pi-desktop's electron/main/layerfs/host.ts.
//
// It starts on the first request, prints one ready line on stdout and exits
// when its stdin closes, so it never outlives this process. It runs simulated
// LayerFS unless LAYERFS_CONNECT_MODE=real, in a state folder of its own so it
// can run beside the current Connect app.
import { type ChildProcess, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export type LayerfsReply = { status: number; body: unknown }
export type LayerfsConnection = 'connecting' | 'connected' | 'reconnecting'
export type LayerfsStreamMessage = { kind: 'event'; event: unknown } | { kind: 'connection'; state: LayerfsConnection }

type Endpoint = { url: string; token: string; mode: string }

const READY_MS = 30_000
const RECONNECT_MS = 2_000

export const layerfsMode = (): 'sim' | 'real' => (process.env.LAYERFS_CONNECT_MODE === 'real' ? 'real' : 'sim')

function log(line: string): void {
  console.error(`[layerfs/host] ${line.trimEnd()}`)
}

export class LayerfsHost {
  private child: ChildProcess | null = null
  private endpoint: Promise<Endpoint> | null = null
  private stream: AbortController | null = null
  private closed = false

  /** `hostDir` is the repository's host/ folder; `onStream` gets every event and connection change. */
  constructor(
    private readonly hostDir: string,
    private readonly onStream: (message: LayerfsStreamMessage) => void,
  ) {}

  /** The host's address, starting the host on first use. */
  private start(): Promise<Endpoint> {
    if (this.closed) return Promise.reject(new Error('The LayerFS host is closed.'))
    this.endpoint ??= new Promise<Endpoint>((resolve, reject) => {
      const mode = layerfsMode()
      const args = [join(this.hostDir, 'main.js')]
      // Real mode keeps the host's own state (the user's LayerFS home); sim gets a folder of its own.
      if (mode === 'sim') args.push('--state', join(homedir(), '.layerfs-connect-desktop-sim'))
      // System node, as the current app does: the real LayerFS addon is built for it, not for Electron.
      const node = process.env.LAYERFS_CONNECT_NODE || 'node'
      const child = spawn(node, args, {
        env: { ...process.env, LAYERFS_CONNECT_MODE: mode, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '16' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      const timer = setTimeout(() => {
        reject(new Error('The LayerFS host did not start in time.'))
        child.kill()
      }, READY_MS)
      createInterface({ input: child.stderr! }).on('line', (line) => log(line.replace(/^\[host\] /, '')))
      const lines = createInterface({ input: child.stdout! })
      lines.once('line', (line) => {
        clearTimeout(timer)
        try {
          const ready = JSON.parse(line) as Endpoint & { ready: boolean; error?: string }
          if (!ready.ready) throw new Error(ready.error ?? 'The LayerFS host did not start.')
          log(`ready on ${ready.url} (${ready.mode})`)
          resolve({ url: ready.url, token: ready.token, mode: ready.mode })
        } catch (error) {
          reject(error)
        }
        lines.on('line', (more) => log(more))
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`The LayerFS host could not start (${node}): ${error.message}`))
      })
      child.on('exit', (code, signal) => {
        clearTimeout(timer)
        log(`exited (${code ?? signal})`)
        this.child = null
        this.endpoint = null
        this.stream?.abort()
        this.stream = null
        if (!this.closed) this.onStream({ kind: 'connection', state: 'reconnecting' })
        reject(new Error('The LayerFS host exited.'))
      })
    })
    this.endpoint.catch(() => {
      this.endpoint = null
    })
    return this.endpoint
  }

  /** One HTTP call to the host. A refusal resolves with its status; only a missing host rejects. */
  async request(method: string, path: string, body?: unknown): Promise<LayerfsReply> {
    if (!path.startsWith('/api/')) throw new Error('LayerFS host paths start with /api/.')
    const { url, token } = await this.start()
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const value = await res.json().catch(() => ({}))
    return { status: res.status, body: value }
  }

  /** Opens the host's event stream (once) and forwards each event until close. */
  async subscribe(): Promise<void> {
    if (this.stream || this.closed) return
    const controller = new AbortController()
    this.stream = controller
    this.onStream({ kind: 'connection', state: 'connecting' })
    try {
      const { url, token } = await this.start()
      const res = await fetch(`${url}/api/events?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      if (!res.ok || !res.body) throw new Error(`event stream: ${res.status}`)
      this.onStream({ kind: 'connection', state: 'connected' })
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        let end = buffer.indexOf('\n\n')
        while (end >= 0) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              this.onStream({ kind: 'event', event: JSON.parse(line.slice(6)) })
            } catch {
              log(`dropped an event that was not JSON: ${line.slice(0, 120)}`)
            }
          }
          end = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) log(`event stream ended: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (this.stream === controller) this.stream = null
    if (!this.closed && !controller.signal.aborted) {
      this.onStream({ kind: 'connection', state: 'reconnecting' })
      setTimeout(() => void this.subscribe(), RECONNECT_MS)
    }
  }

  close(): void {
    this.closed = true
    this.stream?.abort()
    this.stream = null
    this.child?.stdin?.end()
  }
}
