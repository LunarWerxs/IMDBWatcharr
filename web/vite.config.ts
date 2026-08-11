import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Worker serves the API and the Radarr/Sonarr feeds. During `vite dev` these
// paths are proxied to the deployed Worker so the UI can be developed against
// real data without running wrangler.
const API_ORIGIN = process.env.VITE_API_ORIGIN ?? 'https://watcharr.lunarwerx.com'
const PROXIED_PATHS = ['/api', '/auth', '/radarr', '/sonarr']

// The published app version, read from the repo root package.json (the one
// `npm run deploy` / wrangler treat as canonical), not web/package.json's own
// unused 0.0.0 placeholder. Baked in at build time as an anonymous build
// stamp for the visit ping (see src/lib/analytics.ts) - never anything that
// identifies a person.
const rootPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
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
