import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { LayerfsHost, type LayerfsStreamMessage } from './layerfs-host'
import type { CliAction } from '../../../shared/cli-activity'

const isMac = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null

// Packaged apps carry their own host, production dependencies and Node runtime.
// Development keeps using the repository's host/ folder beside desktop/.
const hostDir = app.isPackaged
  ? join(process.resourcesPath, 'backend', 'host')
  : join(app.getAppPath(), '..', 'host')
const runtimeBin = app.isPackaged ? join(process.resourcesPath, 'runtime', 'bin') : null
const host = new LayerfsHost(hostDir, (message: LayerfsStreamMessage) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('layerfs:stream', message)
}, runtimeBin)
app.once('will-quit', () => host.close())

const fromMainWindow = (event: Electron.IpcMainInvokeEvent) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('layerfs: not the main window')
}

/** The renderer's only way to the LayerFS host: { status, body } for each call. */
ipcMain.handle('layerfs:request', (event, input: unknown) => {
  fromMainWindow(event)
  const { method, path, body, action } = (input ?? {}) as { method?: unknown; path?: unknown; body?: unknown; action?: CliAction }
  if (typeof method !== 'string' || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) throw new Error('layerfs:request: bad method')
  if (typeof path !== 'string') throw new Error('layerfs:request: bad path')
  return host.request(method, path, body, action)
})
ipcMain.handle('layerfs:subscribe', (event) => {
  fromMainWindow(event)
  void host.subscribe()
  return true
})
// A new chat's scratch workspace: an empty folder of its own under the app's data folder.
ipcMain.handle('layerfs:scratch', async (event) => {
  fromMainWindow(event)
  const dir = join(app.getPath('userData'), 'scratch', randomUUID())
  await mkdir(dir, { recursive: true })
  return dir
})
ipcMain.handle('layerfs:choose-directory', async (event, start?: string) => {
  fromMainWindow(event)
  const picked = await dialog.showOpenDialog(mainWindow!, { defaultPath: start, properties: ['openDirectory', 'createDirectory'] })
  return picked.canceled ? null : (picked.filePaths[0] ?? null)
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: isMac ? '' : 'LayerFS Connect',
    // macOS: the sidebar is native vibrancy; the renderer paints the main pane itself.
    backgroundColor: isMac ? '#00000000' : '#FFFFFF',
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    titleBarOverlay: isMac ? false : { color: '#FFFFFF', symbolColor: '#18181b', height: 44 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
    },
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.once('ready-to-show', () => win.show())
  // Headless checks: CAPTURE_PATH=/tmp/x.png saves the page once loaded, then quits.
  // CAPTURE_HASH picks the route (e.g. /storage); CAPTURE_DELAY_MS waits for data (default 4000).
  const capture = process.env.CAPTURE_PATH
  if (capture) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage()
        await writeFile(capture, image.toPNG())
        app.quit()
      }, Number(process.env.CAPTURE_DELAY_MS) || 4000)
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const hash = process.env.CAPTURE_HASH
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ''}`)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
