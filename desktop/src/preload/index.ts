import { contextBridge, ipcRenderer } from 'electron'
import type { CliAction } from '../../../shared/cli-activity'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  layerfs: {
    request: (method: string, path: string, body?: unknown, action?: CliAction) => ipcRenderer.invoke('layerfs:request', { method, path, body, action }),
    subscribe: () => ipcRenderer.invoke('layerfs:subscribe'),
    chooseDirectory: (start?: string) => ipcRenderer.invoke('layerfs:choose-directory', start),
    makeScratch: () => ipcRenderer.invoke('layerfs:scratch'),
    onStream: (listener: (message: unknown) => void) => {
      const on = (_event: unknown, message: unknown) => listener(message)
      ipcRenderer.on('layerfs:stream', on)
      return () => {
        ipcRenderer.off('layerfs:stream', on)
      }
    },
  },
})
