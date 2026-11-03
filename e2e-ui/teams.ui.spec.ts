import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR // set to capture screenshots (e.g. docs/screenshots)
const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } }
const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const acct = (id: string, name: string, role: string, status: string, brandCount: number) => ({ sellerId: id, vendorName: name, role, accountStatus: status, brandCount })
const brand = (id: string, name: string, over: object = {}) => ({ id, name, slug: name.toLowerCase().replace(/ /g, '-'), description: null, contactEmail: null, website: null, status: 'Active', isDefault: false, hasLogo: false, logoUrl: null, ...over })
const BRANDS = [brand('b1', 'Rivka Bakes', { description: 'Challah, cakes and cookies baked fresh every Thursday.', website: 'https://example.com/rivka' }), brand('b2', 'Rivka Sweets', { description: 'Gift boxes and holiday treats.' }), brand('b3', 'Old Pastries', { status: 'Archived' })]
const MEMBERS = [
  { id: 'm0', userId: 'u0', email: 'rivka@example.com', role: 'Owner', status: 'Active', allBrands: true, brands: [], createdAt: '2026-10-01T00:00:00Z', lastActiveAt: '2026-11-03T08:00:00Z', isMe: true },
  { id: 'm1', userId: 'u1', email: 'dov@example.com', role: 'Admin', status: 'Active', allBrands: true, brands: [], createdAt: '2026-10-05T00:00:00Z', lastActiveAt: '2026-11-02T08:00:00Z', isMe: false },
  { id: 'm2', userId: 'u2', email: 'miriam@example.com', role: 'Manager', status: 'Active', allBrands: false, brands: [{ id: 'b2', name: 'Rivka Sweets' }], createdAt: '2026-10-09T00:00:00Z', lastActiveAt: null, isMe: false },
  { id: 'm3', userId: 'u3', email: 'yossi@example.com', role: 'Viewer', status: 'Active', allBrands: true, brands: [], createdAt: '2026-10-12T00:00:00Z', lastActiveAt: '2026-10-30T08:00:00Z', isMe: false },
]
const INVITES = [{ id: 'i1', email: 'new.hire@example.com', role: 'Manager', allBrands: false, brands: [{ id: 'b1', name: 'Rivka Bakes' }], status: 'Pending', expiresAt: '2026-11-09T00:00:00Z', lastSentAt: '2026-11-02T00:00:00Z', sendCount: 1 }]

interface Opts { accounts?: object[]; active?: string | null; invites?: object[]; preview?: object | null; role?: string }
async function mock(page: Page, o: Opts = {}) {
  const accounts = o.accounts ?? [acct(A, 'Rivka Bakes', o.role ?? 'Owner', 'Live', 2), acct(B, 'Rivka Wholesale', 'Viewer', 'PendingReview', 1)]
  const active = o.active === undefined ? A : o.active
  const login = { tokenType: 'Bearer', accessToken: 'tok', expiresIn: 900, refreshToken: '', sellerId: active ?? '', email: 'rivka@example.com', vendorName: 'Rivka Bakes', accountStatus: 'Active', roles: ['Seller'], activeAccountId: active, accounts }
  await page.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 15, warningSeconds: 60, refreshIntervalMinutes: 5, features: { apple: false }, turnstileSiteKey: 'stub' } }))
  await page.route('**/api/v1/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace('/api/v1', '')
    if (u === '/auth/refresh') return r.fulfill({ json: login })
    if (u === '/session') return r.fulfill({ json: { activeAccountId: active, vendorName: 'Rivka Bakes', accountStatus: null, role: o.role ?? 'Owner', accounts } })
    if (u === '/account/invitations') return r.fulfill({ json: o.invites ?? [] })
    if (u === '/brands') return r.fulfill({ json: BRANDS.filter((b) => b.status === 'Active') })
    if (u === '/team/members') return r.fulfill({ json: MEMBERS })
    if (u === '/team/invitations') return r.fulfill({ json: INVITES })
    if (u === '/account/me') return r.fulfill({ json: { email: 'rivka@example.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 1, logins: [], sellerStatus: 'Live', vendorName: 'Rivka Bakes' } })
    if (u.startsWith('/invitations/')) return o.preview ? r.fulfill({ json: o.preview }) : r.fulfill({ status: 404, json: {} })
    return r.fulfill({ json: {} })
  })
}
// (the brands page asks for archived brands too)
async function mockBrandsPage(page: Page) {
  await page.route('**/api/v1/brands?includeArchived=true', (r) => r.fulfill({ json: BRANDS }))
}

const preview = (state = 'pending') => ({ state, email: 'miriam@example.com', accountName: 'Rivka Bakes', role: 'Manager', allBrands: false, brands: ['Rivka Sweets'], expiresAt: '2026-11-09T00:00:00Z' })

const screens: { name: string; path: string; opts: Opts; heading: RegExp; act?: (p: Page) => Promise<void> }[] = [
  { name: 'choose-account', path: '/', opts: { active: null, invites: [{ id: 'i9', accountName: 'Cohen Judaica', role: 'Manager', expiresAt: '2026-11-09T00:00:00Z' }] }, heading: /choose an account/i },
  { name: 'no-accounts', path: '/', opts: { active: null, accounts: [], invites: [{ id: 'i9', accountName: 'Cohen Judaica', role: 'Viewer', expiresAt: '2026-11-09T00:00:00Z' }] }, heading: /not part of any seller account/i },
  { name: 'team', path: '/settings/team', opts: {}, heading: /account settings/i, act: async (p) => { await expect(p.getByRole('heading', { name: 'Team members' })).toBeVisible(); await expect(p.getByRole('cell', { name: /^(Member )?dov@example\.com$/ })).toBeVisible() } },
  { name: 'team-invite-modal', path: '/settings/team', opts: {}, heading: /account settings/i, act: async (p) => { await p.getByRole('button', { name: 'Invite a team member' }).click(); await p.getByLabel('Role').selectOption('Manager'); await p.getByLabel('Only selected brands').check() } },
  { name: 'brands', path: '/settings/brands', opts: { role: 'Admin' }, heading: /account settings/i, act: async (p) => { await expect(p.getByRole('list', { name: 'Brands', exact: true })).toBeVisible() } },
  { name: 'brand-edit-modal', path: '/settings/brands', opts: { role: 'Admin' }, heading: /account settings/i, act: async (p) => { await p.getByRole('button', { name: 'Add a brand' }).click(); await p.getByLabel('Brand name').fill('Rivka Kids') } },
  { name: 'account-switcher', path: '/settings/profile', opts: {}, heading: /account settings/i, act: async (p) => { await p.getByRole('button', { name: /Rivka Bakes/ }).first().click(); await expect(p.getByRole('group', { name: 'Switch account' })).toBeVisible() } },
  { name: 'invite-new-user', path: '/invite/tok', opts: { preview: preview() }, heading: /you're invited/i },
  { name: 'invite-expired', path: '/invite/tok', opts: { preview: preview('expired') }, heading: /has expired/i },
]

for (const [vp, size] of Object.entries(viewports)) {
  for (const theme of ['light', 'dark'] as const) {
    for (const s of screens) {
      test(`${s.name} @${vp} ${theme}: renders and has no serious a11y violations`, async ({ page }) => {
        await page.setViewportSize(size)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        const signedOut = s.path.startsWith('/invite/')
        await mock(page, s.opts)
        await mockBrandsPage(page)
        if (signedOut) await page.route('**/api/v1/auth/refresh', (r) => r.fulfill({ status: 401, json: {} }))
        await page.goto(s.path)
        await expect(page.getByRole('heading', { name: s.heading }).first()).toBeVisible()
        await s.act?.(page)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
        if (SHOTS && theme === 'light') await page.screenshot({ path: `${SHOTS}/${s.name}-${vp}.png`, fullPage: true })
      })
    }
  }
}
