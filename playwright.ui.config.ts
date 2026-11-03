import { defineConfig } from '@playwright/test'

/** UI suite: mocked API (no backend needed) — visual states, axe accessibility checks, screenshots. */
export default defineConfig({
  testDir: './e2e-ui',
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {} },
  webServer: [
    { command: 'npm run dev -- --host localhost', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
    // production build, for tests that need the real index.html (e.g. under the README's CSP; the dev server injects inline scripts)
    { command: 'npm run build && npm run preview -- --host localhost --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
})
