import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Worker serves the API and the Radarr/Sonarr feeds. During `vite dev` these
// paths are proxied to the deployed Worker so the UI can be developed against
// real data without running wrangler.
const API_ORIGIN = process.env.VITE_API_ORIGIN ?? 'https://watcharr.lunarwerx.com'
const PROXIED_PATHS = ['/api', '/auth', '/radarr', '/sonarr']

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // The Worker serves this directory through its ASSETS binding, so the built
    // SPA ships in the same deploy as the API rather than as a separate Pages
    // project sitting in front of it.
    outDir: './dist',
    emptyOutDir: true,
  },
  server: {
    proxy: Object.fromEntries(
      PROXIED_PATHS.map((path) => [
        path,
        { target: API_ORIGIN, changeOrigin: true, secure: true },
      ]),
    ),
  },
})
