// Electron main process: windows, menus and updates only. pi and LayerFS
// will run in a separate host process, never here.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'LayerFS Connect',
    backgroundColor: '#F6F6F7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Links open in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dev aid: CONNECT_SHOT=<file.png> saves the loaded window, then quits.
  const shot = process.env.CONNECT_SHOT
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage()
        await writeFile(shot, image.toPNG())
        app.quit()
      }, 1000)
    })
  }

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServer) {
    void win.loadURL(devServer)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
