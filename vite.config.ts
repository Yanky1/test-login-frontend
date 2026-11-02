import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const target = process.env.VITE_API_TARGET ?? 'http://localhost:5080'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target, changeOrigin: false } } },
  preview: { port: 5173, strictPort: true, proxy: { '/api': { target, changeOrigin: false } } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
