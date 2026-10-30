// What the preload exposes to the renderer. `host` is the Connect host's
// address and token (host/README.md); absent when the host did not start.
interface Window {
  connect: {
    platform: string
    arch: string
    chooseDirectory: (defaultPath?: string, locale?: 'zh-CN' | 'en') => Promise<string | null>
    host?: { url: string; token: string } | { error: string }
    /** Tab commands from the main process ('close' for ⌘W); returns the unsubscribe. Absent outside Electron. */
    onTabCommand?: (listener: (command: string) => void) => () => void
  }
}
