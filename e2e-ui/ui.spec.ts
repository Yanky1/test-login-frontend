import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR // set to capture screenshots (e.g. docs/screenshots)
const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } }
const login = { tokenType: 'Bearer', accessToken: 'tok', expiresIn: 900, refreshToken: '', sellerId: 's1', email: 'rivka@example.com', vendorName: 'Rivka Bakes', accountStatus: 'Active', roles: ['Seller'] }
const application = (status: string, draftStep = 3) => ({ sellerId: 's1', status, statusNote: null, draftStep, editable: true, marketplaceUrl: 'https://example.com',
  business: { vendorName: 'Rivka Bakes', contactName: 'Rivka', contactPhone: '5551234567', addressLine1: '1 Main St', addressLine2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false },
  kosher: { answers: {}, certificate: null }, legal: { termsVersion: null, termsAcceptedAt: null, sellerAgreementVersion: null, sellerAgreementAcceptedAt: null } })

async function mock(page: Page, opts: { authed?: boolean; status?: string; config?: object } = {}) {
  await page.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 15, warningSeconds: 60, refreshIntervalMinutes: 5, features: { apple: true }, turnstileSiteKey: 'stub', ...opts.config } }))
  await page.route('**/api/v1/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace('/api/v1', '')
    if (u === '/auth/refresh') return opts.authed ? r.fulfill({ json: login }) : r.fulfill({ status: 401, json: {} })
    if (u === '/seller/application') return r.fulfill({ json: application(opts.status ?? 'PendingReview') })
    if (u === '/seller/field-config') return r.fulfill({ json: [] })
    if (u === '/account/me') return r.fulfill({ json: { email: login.email, emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 1, logins: ['Google'], sellerStatus: 'Pending', vendorName: 'Rivka Bakes' } })
    if (u === '/account/passkeys') return r.fulfill({ json: [{ id: 'p1', name: 'MacBook', createdAt: '2026-01-01T00:00:00Z' }] })
    if (u === '/account/sessions') return r.fulfill({ json: [{ id: 'x1', current: true, device: 'Chrome on Mac', lastSeen: '2026-11-01T00:00:00Z' }] })
    if (u === '/public/config') return r.fulfill({ json: { turnstileSiteKey: 'stub' } })
    if (u === '/auth/login') return r.fulfill({ status: 401, json: { error: 'Invalid email or password', hint: { attemptsRemaining: 0, lastTry: false, captchaRequired: false, lockedUntil: new Date(Date.now() + 272_000).toISOString(), message: 'This account is temporarily locked.' } } })
    return r.fulfill({ json: {} })
  })
}

const screens: { name: string; path: string; authed?: boolean; status?: string; heading: RegExp; act?: (p: Page) => Promise<void> }[] = [
  { name: 'login', path: '/login', heading: /sign in/i },
  { name: 'login-locked', path: '/login', heading: /sign in/i, act: async (p) => {
    await p.getByLabel('Email').fill('rivka@example.com'); await p.getByLabel('Password', { exact: true }).fill('wrong-password-1')
    await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p.getByText(/reset your password now/)).toBeVisible() } },
  { name: 'signup', path: '/signup', heading: /create your seller account/i },
  { name: 'verify', path: '/signup/verify', heading: /verify your email/i },
  { name: 'forgot', path: '/forgot-password', heading: /reset your password/i },
  { name: 'pending', path: '/signup/pending', authed: true, heading: /pending/i },
  { name: 'settings-security', path: '/settings/security', authed: true, heading: /account settings/i, act: async (p) => { await expect(p.getByRole('heading', { name: /passkeys/i }).first()).toBeVisible() } },
]

for (const [vp, size] of Object.entries(viewports)) {
  for (const theme of ['light', 'dark'] as const) {
    for (const s of screens) {
      test(`${s.name} @${vp} ${theme}: renders and has no serious a11y violations`, async ({ page }) => {
        await page.setViewportSize(size)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await mock(page, { authed: s.authed, status: s.status })
        await page.goto(s.path)
        await expect(page.getByRole('heading', { name: s.heading }).first()).toBeVisible()
        await s.act?.(page)
        // no horizontal scroll at this width
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
        if (SHOTS && theme === 'light') await page.screenshot({ path: `${SHOTS}/${s.name}-${vp}.png`, fullPage: true })
      })
    }
  }
}

test('idle-logout modal is accessible and shows a countdown', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page, { authed: true, status: 'PendingReview', config: { idleTimeoutMinutes: 1, warningSeconds: 59 } })
  await page.goto('/signup/pending')
  const dlg = page.getByRole('alertdialog')
  await expect(dlg).toBeVisible({ timeout: 10_000 })
  await expect(dlg).toContainText(/You will be logged out in 00:\d\d/)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/idle-modal-desktop.png` })
})

test('dark-mode toggle persists', async ({ page }) => {
  await mock(page)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/)
  const t = await page.locator('html').getAttribute('data-theme')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', t!)
})
