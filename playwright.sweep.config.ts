import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import base from './playwright.config'

/**
 * UI sweep (e2e/sweep). Same real backend + Vite dev server as the E2E suite (Demo__Enabled=true), different projects:
 *   chromium at 320 / 375 / 768 / 1280 / 1920, firefox + webkit at 375 / 1280, chromium 200% zoom at 1280 (= 640 CSS px wide at 2x).
 * SWEEP_PROJECTS (comma list of project names) narrows a run; SWEEP_ROLES / SWEEP_MAX_ROUTES / SWEEP_MAX_CLICKS narrow it further (local debugging).
 * Docs: README "UI sweep", docs/DESIGN.md "UI sweep".
 */
const vp = (browser: 'chromium' | 'firefox' | 'webkit', width: number, extra: object = {}) => ({
  name: `${browser}-${width}`,
  testMatch: /sweep\.spec\.ts/,
  use: { ...devices[browser === 'chromium' ? 'Desktop Chrome' : browser === 'firefox' ? 'Desktop Firefox' : 'Desktop Safari'], viewport: { width, height: width <= 768 ? 800 : 900 }, ...extra },
})
const all = [
  ...[320, 375, 768, 1280, 1920].map((w) => vp('chromium', w)),
  ...[375, 1280].flatMap((w) => [vp('firefox', w), vp('webkit', w)]),
  { ...vp('chromium', 1280), name: 'chromium-1280-zoom200', use: { ...devices['Desktop Chrome'], viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 } },
  { name: 'lighthouse', testMatch: /lighthouse\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
]
const wanted = process.env.SWEEP_PROJECTS?.split(',')

export default defineConfig({
  ...base,
  testDir: './e2e/sweep',
  testMatch: /(sweep|lighthouse)\.spec\.ts/,
  testIgnore: [],
  globalSetup: './e2e/sweep/setup.ts',
  timeout: 3 * 60 * 60_000,         // one test = one role x theme over every discovered page
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 } },
  snapshotPathTemplate: path.join('e2e/sweep/__screenshots__', '{projectName}', '{arg}{ext}'),
  retries: 0,
  workers: Number(process.env.SWEEP_WORKERS ?? 1),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'sweep-out/playwright-report' }]],
  outputDir: 'sweep-out/test-results',
  use: { baseURL: 'http://localhost:5173', reducedMotion: 'reduce', launchOptions: base.use?.launchOptions },
  projects: wanted ? all.filter((p) => wanted.includes(p.name)) : all,
})
