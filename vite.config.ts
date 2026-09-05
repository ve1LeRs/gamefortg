import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages project site: https://ve1lers.github.io/gamefortg/
const base = process.env.GITHUB_ACTIONS ? '/gamefortg/' : '/'

export default defineConfig({
  plugins: [react()],
  base,
})
