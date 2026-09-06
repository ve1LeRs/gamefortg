import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
      closeBundle() {
        // Alternate entry so Telegram can drop a stale cached root HTML shell.
        const dist = join(process.cwd(), 'dist')
        const src = join(dist, 'index.html')
        if (!existsSync(src)) return
        const playDir = join(dist, 'play')
        mkdirSync(playDir, { recursive: true })
        copyFileSync(src, join(playDir, 'index.html'))
        for (const name of ['favicon.svg', 'bot-avatar.png']) {
          const file = join(dist, name)
          if (existsSync(file)) copyFileSync(file, join(playDir, name))
        }
      },
    },
  ],
  base,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
})
