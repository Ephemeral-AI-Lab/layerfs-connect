// The renderer alone in a browser, for quick layout checks and headless
// screenshots: `pnpm web`, then http://127.0.0.1:1025/#/machines (?mac=1 for
// macOS spacing). The mode selector uses independent simulated and real hosts
// in private preview state; real mode requires LAYERFS_CONNECT_CLI.
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { WebHosts, parseMode } from './tools/web-host'

function previewHost(): Plugin {
  const hosts = new WebHosts(resolve(import.meta.dirname, '../host/main.js'))
  return {
    name: 'lfs-preview-host',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('close', () => hosts.close())
      server.middlewares.use('/__lfs/', async (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return }
        if (req.headers['x-lfs-preview'] !== hosts.controlToken) { res.statusCode = 403; res.end('{}'); return }
        try {
          const url = new URL(req.url!, 'http://127.0.0.1')
          const mode = parseMode(url.searchParams.get('mode'))
          if (url.pathname === '/mode') {
            await hosts.start(mode)
            res.end(JSON.stringify({ mode }))
          } else if (url.pathname === '/scratch') {
            res.end(JSON.stringify({ path: hosts.scratch(mode) }))
          } else { res.statusCode = 404; res.end('{}') }
        } catch (error) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Preview host unavailable.' }))
        }
      })
    },
    async transformIndexHtml(html, ctx) {
      const mode = parseMode(new URL(ctx.originalUrl ?? '/', 'http://127.0.0.1').searchParams.get('mode'))
      const host = { ...await hosts.start(mode), controlToken: hosts.controlToken }
      const content = JSON.stringify(host).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      return html.replace('<head>', `<head><meta name="lfs-host" content="${content}" />`)
    },
  }
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') } },
  plugins: [react(), tailwindcss(), previewHost()],
  server: {
    host: '127.0.0.1',
    port: 1025,
    strictPort: true,
    // WALLPAPER_DIR lets ?wallpaper=/@fs/<dir>/<file> preview a local image.
    fs: { allow: [import.meta.dirname, ...(process.env.WALLPAPER_DIR ? [process.env.WALLPAPER_DIR] : [])] },
  },
})
