import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src/renderer/src'),
        '@shared': resolve(import.meta.dirname, 'src/shared'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
