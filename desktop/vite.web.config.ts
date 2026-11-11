// The renderer alone in a browser, for quick layout checks and headless
// screenshots: `pnpm web`, then http://127.0.0.1:1025/#/machines (?mac=1 for
// macOS spacing). Uses the shared real CLI host with private preview state.
// Set LAYERFS_CONNECT_CLI explicitly before starting.
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { WebHosts } from './tools/web-host'

function previewHost(env: NodeJS.ProcessEnv): Plugin {
  const hosts = new WebHosts(resolve(import.meta.dirname, '../host/main.js'), env)
  return {
    name: 'lfs-preview-host',
    apply: 'serve',
    // Dispose only this plugin's host. A reused HTTP server can emit close
    // after the replacement plugin has already been configured during restart.
    closeBundle() { hosts.close() },
    configureServer(server) {
      server.middlewares.use('/__lfs/', async (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return }
        if (req.headers['x-lfs-preview'] !== hosts.controlToken) { res.statusCode = 403; res.end('{}'); return }
        try {
          const url = new URL(req.url!, 'http://127.0.0.1')
          if (url.pathname === '/scratch') {
            res.end(JSON.stringify({ path: hosts.scratch() }))
          } else { res.statusCode = 404; res.end('{}') }
        } catch (error) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Preview host unavailable.' }))
        }
      })
    },
    async transformIndexHtml(html) {
      const host = { ...await hosts.start(), controlToken: hosts.controlToken }
      const content = JSON.stringify(host).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      return html.replace('<head>', `<head><meta name="lfs-host" content="${content}" />`)
    },
  }
}

export default defineConfig(({ mode }) => {
  // Keep machine-local CLI, bundle and preview state paths out of renderer env.
  const env = { ...loadEnv(mode, import.meta.dirname, ''), ...process.env }
  // Explicit local preview pins can be changed while Vite is running. An old
  // inherited launch environment must not keep selecting a superseded CLI.
  const pinFile = resolve(import.meta.dirname, '.env.local')
  const pins = existsSync(pinFile) ? parseEnv(readFileSync(pinFile, 'utf8')) : {}
  for (const key of ['LFS_STATE', 'LAYERFS_CONNECT_CLI', 'LAYERFS_CONNECT_DAEMON', 'LAYERFS_BUNDLE', 'XDG_CACHE_HOME']) {
    if (pins[key] !== undefined) env[key] = pins[key]
  }
  return {
  root: resolve(import.meta.dirname, 'src/renderer'),
  envDir: import.meta.dirname,
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') } },
  plugins: [react(), tailwindcss(), previewHost(env)],
  server: {
    host: '127.0.0.1',
    port: 1025,
    strictPort: true,
    // WALLPAPER_DIR lets ?wallpaper=/@fs/<dir>/<file> preview a local image.
    fs: { allow: [import.meta.dirname, ...(process.env.WALLPAPER_DIR ? [process.env.WALLPAPER_DIR] : [])] },
  },
  }
})
