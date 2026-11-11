// The renderer talks to the Connect host over HTTP, not through Electron IPC.
// The preload tells it which platform and CPU it runs on, and the host's
// address and token, which the main process passes as --connect-host=<JSON>
// ({ url, token }, or { error } when the host did not start).

import { contextBridge, ipcRenderer } from 'electron'

type HostAddress = { url: string; token: string } | { error: string }
type Mode = 'real'

function read(): { host: HostAddress; mode: Mode } {
  const arg = process.argv.find((a) => a.startsWith('--connect-host='))
  if (!arg) return { host: { error: 'The Connect host did not start.' }, mode: 'real' }
  try {
    const value = JSON.parse(arg.slice('--connect-host='.length)) as Partial<{ url: string; token: string; error: string; mode: string }>
    const mode: Mode = 'real'
    if (typeof value.url === 'string' && typeof value.token === 'string') return { host: { url: value.url, token: value.token }, mode }
    return { host: { error: typeof value.error === 'string' ? value.error : 'The Connect host did not start.' }, mode }
  } catch {
    return { host: { error: 'The Connect host address could not be read.' }, mode: 'real' }
  }
}

const { host, mode } = read()

contextBridge.exposeInMainWorld('connect', {
  platform: process.platform, arch: process.arch, host, mode,
  chooseDirectory: (defaultPath?: string, locale?: 'zh-CN' | 'en') => ipcRenderer.invoke('connect:choose-directory', defaultPath, locale),
})
