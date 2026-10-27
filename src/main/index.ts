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
import { BrowserWindow, app, nativeTheme, shell } from 'electron'

type HostAddress = { url: string; token: string } | { error: string }

/** How long the host may take to print its ready line. */
const READY_MS = 20_000

let hostProcess: ChildProcess | null = null
let hostAddress: HostAddress = { error: 'The Connect host has not started.' }

/** Starts the host and answers its address, or why there is none. Never throws. */
function startHost(): Promise<HostAddress> {
  const dir = join(app.getAppPath(), 'host')
  const node = process.env.LAYERFS_CONNECT_NODE || 'node'
  return new Promise((resolve) => {
    let settled = false
    let lastErr = ''
    const done = (address: HostAddress) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if ('error' in address) console.error(`[host] ${address.error}`)
      resolve(address)
    }
    // stdin stays piped: the host exits when it closes (this process died)
    const child = spawn(node, ['--import', join(dir, 'resolve-layerfs.js'), join(dir, 'main.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
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

function stopHost() {
  const child = hostProcess
  if (!child) return
  hostProcess = null
  child.stdin?.end()
  child.kill('SIGTERM')
}

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
      additionalArguments: [`--connect-host=${JSON.stringify(hostAddress)}`],
    },
  })

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

void app.whenReady().then(async () => {
  // Dev aid: CONNECT_THEME=dark or light overrides the system setting.
  const theme = process.env.CONNECT_THEME
  if (!app.isPackaged && (theme === 'dark' || theme === 'light')) nativeTheme.themeSource = theme
  hostAddress = await startHost()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', stopHost)
