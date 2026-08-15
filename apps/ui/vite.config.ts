import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev server proxies /api to the manager daemon (default port 4180).
export default defineConfig({
  plugins: [react()],
  // Relative asset base: the built UI is loaded from file:// in the Electron
  // shell (process.resourcesPath/ui-dist), where "/assets/..." would resolve
  // to the disk root and 404.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4180',
    },
  },
})
