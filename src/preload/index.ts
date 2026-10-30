// The renderer talks to the Connect host over HTTP, not through Electron IPC.
// The preload tells it which platform and CPU it runs on, and the host's
// address and token, which the main process passes as --connect-host=<JSON>
// ({ url, token }, or { error } when the host did not start).

import { contextBridge, ipcRenderer } from 'electron'

type HostAddress = { url: string; token: string } | { error: string }

function hostAddress(): HostAddress {
  const arg = process.argv.find((a) => a.startsWith('--connect-host='))
  if (!arg) return { error: 'The Connect host did not start.' }
  try {
    const value = JSON.parse(arg.slice('--connect-host='.length)) as Partial<{ url: string; token: string; error: string }>
    if (typeof value.url === 'string' && typeof value.token === 'string') return { url: value.url, token: value.token }
    return { error: typeof value.error === 'string' ? value.error : 'The Connect host did not start.' }
  } catch {
    return { error: 'The Connect host address could not be read.' }
  }
}

contextBridge.exposeInMainWorld('connect', {
  platform: process.platform, arch: process.arch, host: hostAddress(),
  chooseDirectory: (defaultPath?: string, locale?: 'zh-CN' | 'en') => ipcRenderer.invoke('connect:choose-directory', defaultPath, locale),
  // Tab shortcuts the window menu would take first (⌘W): the main process sends them here.
  onTabCommand: (listener: (command: string) => void) => {
    const handler = (_event: unknown, command: string) => listener(command)
    ipcRenderer.on('connect:tab-command', handler)
    return () => { ipcRenderer.removeListener('connect:tab-command', handler) }
  },
})
