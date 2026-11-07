// The way to the LayerFS host. In Electron every call goes through main
// (preload's window.desktop.layerfs), which owns the host and its token. In the
// browser preview (`pnpm web`) the page talks to its simulated host directly,
// at the address vite.web.config.ts puts in <meta name="lfs-host">.
export type LayerfsReply = { status: number; body: unknown }
export type LayerfsConnection = 'connecting' | 'connected' | 'reconnecting'
export type LayerfsStreamMessage = { kind: 'event'; event: unknown } | { kind: 'connection'; state: LayerfsConnection }

const desktop = window.desktop?.layerfs

const web = (() => {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="lfs-host"]')
  try {
    return meta ? (JSON.parse(meta.content) as { url: string; token: string }) : null
  } catch {
    return null
  }
})()

const streamListeners = new Set<(message: LayerfsStreamMessage) => void>()
let source: EventSource | null = null

export const connectBridge = {
  /** Which LayerFS the host runs: the browser preview always runs simulated. */
  mode: (desktop?.mode ?? 'sim') as 'sim' | 'real',
  async request(method: string, path: string, body?: unknown): Promise<LayerfsReply> {
    if (desktop) return desktop.request(method, path, body)
    if (!web) throw new Error('No LayerFS host: run the desktop app or `pnpm web`.')
    const res = await fetch(`${web.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${web.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  },
  async subscribe(): Promise<boolean> {
    if (desktop) return desktop.subscribe()
    if (!web || source) return true
    const emit = (message: LayerfsStreamMessage) => streamListeners.forEach((l) => l(message))
    emit({ kind: 'connection', state: 'connecting' })
    source = new EventSource(`${web.url}/api/events?token=${encodeURIComponent(web.token)}`)
    source.onopen = () => emit({ kind: 'connection', state: 'connected' })
    source.onerror = () => emit({ kind: 'connection', state: 'reconnecting' })
    source.onmessage = (m) => emit({ kind: 'event', event: JSON.parse(m.data) })
    return true
  },
  onStream(listener: (message: LayerfsStreamMessage) => void): () => void {
    if (desktop) return desktop.onStream((m) => listener(m as LayerfsStreamMessage))
    streamListeners.add(listener)
    return () => {
      streamListeners.delete(listener)
    }
  },
  /** A new empty scratch folder for a chat: main makes it, or the preview's dev server (vite.web.config.ts). */
  async makeScratch(): Promise<string> {
    if (desktop) return desktop.makeScratch()
    const res = await fetch('/__lfs/scratch', { method: 'POST' })
    if (!res.ok) throw new Error('Could not make a scratch folder.')
    return ((await res.json()) as { path: string }).path
  },
  /** A folder picked in the system dialog; null when cancelled or in the browser preview. */
  chooseDirectory: async (start?: string): Promise<string | null> => (desktop ? desktop.chooseDirectory(start) : null),
}
