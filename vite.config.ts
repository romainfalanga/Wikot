import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

// BUILD_ID injecté à la compilation (Date.now() au top-level d'un Worker
// Cloudflare retourne 0 — interdit "I/O au module scope"). On le fige
// donc ici, dans le bundle, à chaque `npm run build`.
const BUILD_ID = String(Date.now())

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID)
  },
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
