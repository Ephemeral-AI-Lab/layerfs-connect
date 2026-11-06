// What the preload exposes to the renderer. `host` is the Connect host's
// address and token (host/README.md); absent when the host did not start.
// `mode` is which LayerFS the host runs (real, or the simulator); `setMode`
// restarts the host in the other mode and replaces this window.
interface Window {
  connect: {
    platform: string
    arch: string
    chooseDirectory: (defaultPath?: string, locale?: 'zh-CN' | 'en') => Promise<string | null>
    host?: { url: string; token: string } | { error: string }
    mode?: 'real' | 'sim'
    setMode?: (mode: 'real' | 'sim') => Promise<void>
  }
}
