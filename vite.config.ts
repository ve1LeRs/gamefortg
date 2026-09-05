import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages project site: https://ve1lers.github.io/gamefortg/
const base = process.env.GITHUB_ACTIONS ? '/gamefortg/' : '/'
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'build-version',
      transformIndexHtml(html) {
        return html.replaceAll('__BUILD_ID__', buildId)
      },
      writeBundle(options) {
        const dir = options.dir ?? 'dist'
        writeFileSync(
          join(dir, 'version.json'),
          JSON.stringify({ id: buildId, at: new Date().toISOString() }),
        )
      },
    },
  ],
  base,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
})
