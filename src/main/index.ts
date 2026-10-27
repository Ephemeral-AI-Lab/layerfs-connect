// Electron main process: windows, menus and updates only. pi and LayerFS
// will run in a separate host process, never here.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, nativeTheme, shell } from 'electron'

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
        // CONNECT_SCROLL=<px> scrolls the page's scrolling panes first.
        const scroll = Number(process.env.CONNECT_SCROLL ?? 0)
        if (scroll > 0) {
          await win.webContents.executeJavaScript(
            `for (const e of document.querySelectorAll('*')) if (getComputedStyle(e).overflowY === 'auto' && e.scrollHeight > e.clientHeight) e.scrollTop = ${scroll}`,
          )
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
        const image = await win.webContents.capturePage()
        await writeFile(shot, image.toPNG())
        app.quit()
        // CONNECT_SHOT_DELAY=<ms> waits longer, to catch a later frame.
      }, Number(process.env.CONNECT_SHOT_DELAY ?? 1000))
    })
  }

  // Dev aid: CONNECT_VIEW=storage/gd-team opens on that page.
  const view = app.isPackaged ? undefined : process.env.CONNECT_VIEW
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServer) {
    void win.loadURL(view ? `${devServer}#${view}` : devServer)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), view ? { hash: view } : undefined)
  }
  return win
}

void app.whenReady().then(() => {
  // Dev aid: CONNECT_THEME=dark or light overrides the system setting.
  const theme = process.env.CONNECT_THEME
  if (!app.isPackaged && (theme === 'dark' || theme === 'light')) nativeTheme.themeSource = theme
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
