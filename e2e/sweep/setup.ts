import { chromium, request as pwRequest, type FullConfig } from '@playwright/test'
import fs from 'node:fs'
import { createSeller, PASSWORD } from '../helpers'
import { superAdmin, staffMember } from '../adminKit'
import { bearer, mgr, seller, tokenFor } from '../ordersKit'
import { signInContext, setTheme } from './auth'
import { settle } from './checks'
import { matchRoute, routeDefs, seeds } from './routes'
import { STATE_DIR, STATE_FILE, type Account, type Role, type SweepState } from './kit'

const business = { vendorName: 'Sweep Demo Co', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false }
const MAX_PER_ROLE = Number(process.env.SWEEP_MAX_ROUTES ?? 160)

/**
 * Global setup: creates every account through the real API (demo data on, seeded the same way every run), then finds each role's pages:
 * the seeds from the router config, plus every router-matching link on those pages (detail pages and tabs), capped per pattern.
 */
export default async function setup(config: FullConfig) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:5173'
  const api = await pwRequest.newContext({ baseURL })
  const accounts: SweepState['accounts'] = { anon: { email: '', password: '' } }

  const o = await seller(api)
  const fill = async (token: string) => { const r = await api.post('/api/v1/seller/demo-data', { data: {}, headers: bearer(token) }); if (!r.ok()) throw new Error(`demo fill failed ${r.status()}`) }
  await fill(o.token)
  accounts.owner = { email: o.email, password: PASSWORD }
  for (const [role, name] of [['admin', 'Admin'], ['manager', 'Manager'], ['viewer', 'Viewer'], ['driver', 'Driver']] as const) {
    accounts[role] = { email: await mgr(api, o.token, name), password: PASSWORD }   // Staff-level seller role = Admin (the product has Owner, Admin, Manager, Viewer, Driver)
  }
  const p = await createSeller(api); const pt = await tokenFor(api, p.email)
  for (const [step, data] of [['business', business], ['kosher', { answers: { sells_food: 'no' } }]] as const) {
    if (!(await api.put(`/api/v1/seller/application/${step}`, { data, headers: bearer(pt) })).ok()) throw new Error(`pending seller ${step} failed`)
  }
  if (!(await api.post('/api/v1/seller/application/submit', { data: { acceptSellerAgreement: true }, headers: bearer(pt) })).ok()) throw new Error('pending seller submit failed')
  await fill(pt)
  accounts.pending = { email: p.email, password: PASSWORD }
  const sa = await superAdmin(api); accounts.superadmin = { email: sa.email, password: sa.password, secret: sa.secret }
  for (const [role, r] of [['support', 'Support'], ['moderator', 'Moderator'], ['readonly', 'ReadOnly']] as const) {
    const s = await staffMember(api, r); accounts[role] = { email: s.email, password: s.password, secret: s.secret }
  }
  await api.dispose()

  // ---- discover the pages of every role
  const defs = routeDefs()
  const browser = await chromium.launch(config.projects[0].use.launchOptions ?? {})
  const routes: SweepState['routes'] = {}
  const only = process.env.SWEEP_ROLES?.split(',')
  for (const role of Object.keys(accounts) as Role[]) {
    if (only && !only.includes(role)) continue
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
    await setTheme(ctx, 'light'); await signInContext(ctx, role, accounts[role])
    const page = await ctx.newPage()
    const queue = seeds(defs), seen = new Set<string>(), finals = new Set<string>(), perPattern = new Map<string, number>()
    while (queue.length && finals.size < MAX_PER_ROLE) {
      const url = queue.shift()!
      if (seen.has(url)) continue
      seen.add(url)
      await page.goto(url, { waitUntil: 'load' }).catch(() => undefined)
      await settle(page)
      const here = new URL(page.url())
      const final = here.pathname + (here.pathname.startsWith('/admin') || here.pathname.startsWith('/settings') ? '' : '')
      if (!matchRoute(here.pathname, defs) || finals.has(final)) continue
      const m = matchRoute(here.pathname, defs)!
      const cap = m.param === 'tab' ? 14 : 2
      if (!finals.has(final)) {
        if ((perPattern.get(m.pattern) ?? 0) >= cap) continue
        perPattern.set(m.pattern, (perPattern.get(m.pattern) ?? 0) + 1); finals.add(final)
      }
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href))
      for (const h of hrefs) { try { const u = new URL(h); if (u.origin === here.origin && matchRoute(u.pathname, defs)) queue.push(u.pathname) } catch { /* not a URL */ } }
    }
    routes[role] = [...finals].sort()
    await ctx.close()
  }
  await browser.close()
  fs.writeFileSync(STATE_FILE, JSON.stringify({ accounts, routes } satisfies SweepState, null, 1))
  console.log('sweep routes per role:', Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, v?.length])))
}
