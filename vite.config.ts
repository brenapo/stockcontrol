/// <reference types="vitest/config" />
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// One id per build: the app compares it with /version.json to offer "New version — update",
// and the service worker uses it to drop old cached files.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || Date.now().toString(36)

const stampBuild = (): Plugin => ({
  name: 'stamp-build',
  apply: 'build',
  closeBundle() {
    writeFileSync('dist/version.json', JSON.stringify({ build: BUILD_ID }))
    const sw = readFileSync('dist/sw.js', 'utf8')
    writeFileSync('dist/sw.js', sw.replace("const VERSION = 'dev'", `const VERSION = '${BUILD_ID}'`))
  },
})

export default defineConfig({
  plugins: [react(), stampBuild()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { proxy: { '/api': { target: 'http://localhost:3000', xfwd: true } } },
  build: { sourcemap: false },
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
})
