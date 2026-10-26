// The renderer will talk to the host over its own protocol, not through
// Electron IPC. The preload only tells it which platform it runs on.

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('connect', { platform: process.platform })
