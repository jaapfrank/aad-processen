import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Het gedeelde contract (/contract) is de bron van waarheid voor types + fixtures.
const contractDir = fileURLToPath(new URL('../contract', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  // Op gedeelde/Windows-mounts kan Vite's atomaire rename in node_modules
  // door een scanner worden geblokkeerd. Tests en CI kunnen daarom een eigen
  // tijdelijke cache gebruiken via SPG_VITE_CACHE_DIR.
  cacheDir: process.env.SPG_VITE_CACHE_DIR || 'node_modules/.vite',
  plugins: [react()],
  resolve: {
    alias: { '@contract': contractDir },
  },
  server: {
    // Sta imports buiten /frontend toe (we lezen types + fixtures uit /contract).
    fs: { allow: ['..'] },
    // Dev-proxy naar de .NET-backend; dit is de standaard databron.
    proxy: { '/api': 'http://localhost:5088' },
  },
})
