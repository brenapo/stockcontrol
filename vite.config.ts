/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://localhost:3000', xfwd: true } } },
  build: { sourcemap: false },
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
})
