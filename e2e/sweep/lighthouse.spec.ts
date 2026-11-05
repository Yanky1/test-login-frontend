import { chromium, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OUT, readState, type Finding, type Role } from './kit'
import { setTheme, signInContext } from './auth'

/** Lighthouse (desktop preset) on the five key pages. CLS and LCP are reported; over the "good" thresholds (CLS 0.1, LCP 2.5 s) they become findings. */
const PAGES: { name: string; role: Role; route: string }[] = [
  { name: 'login', role: 'anon', route: '/login' },
  { name: 'products', role: 'owner', route: '/products' },
  { name: 'orders', role: 'owner', route: '/orders' },
  { name: 'admin dashboard', role: 'superadmin', route: '/admin' },
  { name: 'pending screen', role: 'pending', route: '/signup/pending' },
]

test('lighthouse on key pages', async () => {
  test.setTimeout(20 * 60_000)
  const { default: lighthouse } = await import('lighthouse')
  const state = readState(), port = 9333, results: object[] = []
  for (const p of PAGES) {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'lh-')), { args: [`--remote-debugging-port=${port}`], baseURL: 'http://localhost:5173', executablePath: process.env.PW_CHROMIUM_PATH })
    await setTheme(ctx, 'light'); await signInContext(ctx, p.role, state.accounts[p.role])
    const page = await ctx.newPage(); await page.goto(p.route); await page.waitForLoadState('load')
    const r = await lighthouse(`http://localhost:5173${p.route}`, { port, output: 'json', onlyCategories: ['performance'], formFactor: 'desktop', screenEmulation: { disabled: true }, disableStorageReset: true, logLevel: 'error' })
    const a = r!.lhr.audits, lcp = Math.round((a['largest-contentful-paint'].numericValue ?? 0) / 100) / 10, cls = Math.round((a['cumulative-layout-shift'].numericValue ?? 0) * 1000) / 1000
    const findings: Partial<Finding>[] = []
    const base = { check: 'speed' as const, role: p.role, route: p.route, project: 'lighthouse', browser: 'chromium', viewport: 1350, theme: 'light' }
    if (cls > 0.1) findings.push({ ...base, rule: 'cls', message: `CLS ${cls} > 0.1 on ${p.name}` })
    if (lcp > 2.5) findings.push({ ...base, rule: 'lcp', message: `LCP ${lcp}s > 2.5s on ${p.name}` })
    results.push({ ...p, lcp, cls, score: Math.round((r!.lhr.categories.performance.score ?? 0) * 100), findings })
    await ctx.close()
  }
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true })
  fs.writeFileSync(path.join(OUT, 'data', 'lighthouse.json'), JSON.stringify(results, null, 1))
})
