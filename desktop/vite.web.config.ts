// The renderer alone in a browser, for quick layout checks and headless
// screenshots: `pnpm web`, then http://localhost:5288/#/machines (?mac=1 for
// macOS spacing). It starts a simulated LayerFS host of its own (../host, in a
// temporary state folder) and hands the page its address in <meta name="lfs-host">.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function simulatedHost(): Plugin {
  let endpoint: Promise<{ url: string; token: string }> | null = null
  const state = process.env.LFS_STATE || mkdtempSync(join(tmpdir(), 'lfs-desktop-web-'))
  const start = () =>
    (endpoint ??= new Promise((resolveReady, reject) => {
      const child = spawn('node', [resolve(import.meta.dirname, '../host/main.js'), '--state', state], {
        env: { ...process.env, LAYERFS_CONNECT_MODE: 'sim' },
        stdio: ['pipe', 'pipe', 'inherit'],
      })
      createInterface({ input: child.stdout! }).once('line', (line) => {
        const ready = JSON.parse(line) as { ready: boolean; url: string; token: string; error?: string }
        if (ready.ready) resolveReady({ url: ready.url, token: ready.token })
        else reject(new Error(ready.error))
      })
      child.on('exit', (code) => reject(new Error(`host exited ${code}`)))
    }))
  return {
    name: 'lfs-simulated-host',
    apply: 'serve',
    // a new chat's scratch folder (the desktop app makes these in main)
    configureServer(server) {
      server.middlewares.use('/__lfs/scratch', (req, res) => {
        if (req.method !== 'POST') return void (res.statusCode = 405, res.end())
        const path = join(state, 'scratch', randomUUID())
        mkdirSync(path, { recursive: true })
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ path }))
      })
    },
    async transformIndexHtml(html) {
      const host = await start()
      const content = JSON.stringify(host).replace(/"/g, '&quot;')
      return html.replace('<head>', `<head><meta name="lfs-host" content="${content}" />`)
    },
  }
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') } },
  plugins: [react(), tailwindcss(), simulatedHost()],
  server: {
    port: 5288,
    strictPort: true,
    // WALLPAPER_DIR lets ?wallpaper=/@fs/<dir>/<file> preview a local image.
    fs: { allow: [import.meta.dirname, ...(process.env.WALLPAPER_DIR ? [process.env.WALLPAPER_DIR] : [])] },
  },
})
