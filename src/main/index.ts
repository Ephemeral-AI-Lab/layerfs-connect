// Electron main process: windows, menus and updates only. LayerFS runs in the
// Connect host, a separate Node process (host/README.md) this process starts
// before the first window: system node runs host/main.js, which prints one
// ready line with its address and token. The window gets that address (or
// why there is none) as --connect-host=<JSON>; the renderer then talks to the
// host over HTTP, never through Electron IPC. The host exits when its stdin
// closes, and is killed on quit.

import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'

type HostAddress = ({ url: string; token: string } | { error: string }) & { mode: 'real' }

/** The app icon (the soft-matte handshake tile at 1024 px): the window's on Linux and Windows, the Dock's on macOS. */
const ICON = join(__dirname, '../../resources/icon.png')

/** How long the host may take to print its ready line. */
const READY_MS = 20_000

/** How long a stopping host may take to exit before a switch goes on without it. */
const STOP_MS = 15_000

let hostProcess: ChildProcess | null = null
let hostAddress: HostAddress = { error: 'The Connect host has not started.', mode: 'real' }
/** Starts the real host and reports its address or startup error. */
function startHost(): Promise<HostAddress> {
  const dir = join(app.getAppPath(), 'host')
  const node = process.env.LAYERFS_CONNECT_NODE || 'node'
  return new Promise((resolve) => {
    let settled = false
    let lastErr = ''
    const done = (answer: { url: string; token: string } | { error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if ('error' in answer) console.error(`[host] ${answer.error}`)
      resolve({ ...answer, mode: 'real' })
    }
    // stdin stays piped: the host exits when it closes (this process died).
    // Every LayerFS call runs once on the libuv threadpool and long execs hold a
    // thread each, so the host gets more than the default 4.
    const child = spawn(node, [join(dir, 'main.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '16' },
    })
    hostProcess = child
    const timer = setTimeout(() => done({ error: `The Connect host did not start within ${READY_MS / 1000} s.` }), READY_MS)
    child.on('error', (error) => done({ error: `The Connect host could not start (${node}): ${error.message}` }))
    child.on('exit', (code, signal) => {
      if (hostProcess === child) hostProcess = null
      console.error(`[host] exited (${signal ?? `code ${code}`})`)
      done({ error: `The Connect host exited before it was ready (${signal ?? `code ${code}`})${lastErr ? `: ${lastErr}` : ''}` })
    })
    createInterface({ input: child.stderr! }).on('line', (line) => {
      console.error(`[host] ${line.replace(/^\[host\] /, '')}`)
      if (line.trim()) lastErr = line.trim()
    })
    const lines = createInterface({ input: child.stdout! })
    lines.once('line', (line) => {
      try {
        const ready = JSON.parse(line) as { ready?: boolean; url?: string; token?: string; error?: string }
        if (ready.ready && ready.url && ready.token) {
          console.log(`[host] ready at ${ready.url}`)
          done({ url: ready.url, token: ready.token })
        } else done({ error: ready.error ?? 'The Connect host did not start.' })
      } catch {
        done({ error: `The Connect host printed an unexpected line: ${line.slice(0, 200)}` })
      }
      // later stdout lines are logs too
      lines.on('line', (more) => console.log(`[host] ${more}`))
    })
  })
}

/** Asks the host to exit; answers once it has, or after STOP_MS. */
function stopHost(): Promise<void> {
  const child = hostProcess
  if (!child) return Promise.resolve()
  hostProcess = null
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once('exit', () => resolve())
    setTimeout(resolve, STOP_MS).unref()
  })
  child.stdin?.end()
  child.kill('SIGTERM')
  return exited
}

/** Standard application menus. */
function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(bounds?: Electron.Rectangle): BrowserWindow {
  const isMac = process.platform === 'darwin'

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: isMac ? '' : 'LayerFS Connect',
    icon: ICON,
    backgroundColor: isMac ? '#00000000' : '#F4F4F2',
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    titleBarOverlay: isMac
      ? false
      : {
          color: '#F4F4F2',
          symbolColor: '#18181b',
          height: 38,
        },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      additionalArguments: [`--connect-host=${JSON.stringify(hostAddress)}`],
    },
  })

  if (!isMac && win.setTitleBarOverlay) {
    const updateOverlay = () => {
      if (win.isDestroyed()) return
      win.setTitleBarOverlay({
        color: '#F4F4F2',
        symbolColor: '#18181b',
        height: 38,
      })
    }
    nativeTheme.on('updated', updateOverlay)
  }

  win.once('ready-to-show', () => win.show())

  // Links open in the default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dev aid: CONNECT_DEBUG_HOST=1 logs the host address the renderer got.
  if (!app.isPackaged && process.env.CONNECT_DEBUG_HOST === '1') {
    win.webContents.once('did-finish-load', async () => {
      const seen = await win.webContents.executeJavaScript('JSON.stringify(window.connect.host)')
      console.log(`[debug] renderer window.connect.host = ${String(seen).replace(/"token":"[0-9a-f]+"/, '"token":"<hex>"')}`)
    })
  }

  // Dev aid: CONNECT_SHOT=<file.png> saves the loaded window, then quits.
  const shot = process.env.CONNECT_SHOT
  if (shot) {
    win.once('ready-to-show', () => {
      setTimeout(async () => {
        // CONNECT_SCROLL=<px> scrolls the page's scrolling panes first.
        const scroll = Number(process.env.CONNECT_SCROLL ?? 0)
        if (scroll > 0) {
          await win.webContents.executeJavaScript(
            `for (const e of document.querySelectorAll('*')) if (getComputedStyle(e).overflowY === 'auto' && e.scrollHeight > e.clientHeight) e.scrollTop = ${scroll}`,
          )
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
        // CONNECT_EVAL=<js> runs in the page first (awaited) and prints its result.
        if (process.env.CONNECT_EVAL) console.log(`[eval] ${await win.webContents.executeJavaScript(process.env.CONNECT_EVAL)}`)
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

void app.whenReady().then(async () => {
  ipcMain.handle('connect:choose-directory', async (event, defaultPath?: string, locale?: 'zh-CN' | 'en') => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('The Connect window is no longer available.')
    owner.focus()
    const result = await dialog.showOpenDialog(owner, {
      title: locale === 'zh-CN' ? '选择工作目录' : 'Choose working directory',
      buttonLabel: locale === 'zh-CN' ? '使用此文件夹' : 'Use folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  // a packaged app takes its icon from the bundle; unpackaged, the Dock would show Electron's
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(ICON)
  // one light theme: native menus, dialogs and the title bar ignore the system's dark setting
  nativeTheme.themeSource = 'light'
  buildMenu()
  hostAddress = await startHost()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => void stopHost())
