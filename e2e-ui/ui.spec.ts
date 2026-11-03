import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR // set to capture screenshots (e.g. docs/screenshots)
const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } }
const login = { tokenType: 'Bearer', accessToken: 'tok', expiresIn: 900, refreshToken: '', sellerId: 's1', email: 'rivka@example.com', vendorName: 'Rivka Bakes', accountStatus: 'Active', roles: ['Seller'] }
const application = (status: string, draftStep = 3) => ({ sellerId: 's1', status, statusNote: null, draftStep, editable: true, marketplaceUrl: 'https://example.com',
  business: { vendorName: 'Rivka Bakes', contactName: 'Rivka', contactPhone: '5551234567', addressLine1: '1 Main St', addressLine2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false },
  kosher: { answers: {}, certificate: null }, legal: { termsVersion: null, termsAcceptedAt: null, sellerAgreementVersion: null, sellerAgreementAcceptedAt: null } })

async function mock(page: Page, opts: { authed?: boolean; status?: string; draftStep?: number; config?: object; phone?: object } = {}) {
  await page.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 15, warningSeconds: 60, refreshIntervalMinutes: 5, features: { apple: true }, turnstileSiteKey: 'stub', ...opts.config } }))
  await page.route('**/api/v1/**', (r) => {
    const u = new URL(r.request().url()).pathname.replace('/api/v1', '')
    if (u === '/auth/refresh') return opts.authed ? r.fulfill({ json: login }) : r.fulfill({ status: 401, json: {} })
    if (u === '/seller/application') return r.fulfill({ json: application(opts.status ?? 'PendingReview', opts.draftStep) })
    if (u === '/seller/field-config') return r.fulfill({ json: [] })
    if (u === '/account/me') return r.fulfill({ json: { email: login.email, emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 1, logins: ['Google'], sellerStatus: 'Pending', vendorName: 'Rivka Bakes' } })
    if (u === '/account/passkeys') return r.fulfill({ json: [{ id: 'p1', name: 'MacBook', createdAt: '2026-01-01T00:00:00Z' }] })
    if (u === '/account/sessions') return r.fulfill({ json: [{ id: 'x1', current: true, userAgent: 'Chrome on Mac', createdAt: '2026-11-01T00:00:00Z', lastActivityAt: '2026-11-01T00:00:00Z', ipAddress: null }] })
    if (u === '/account/2fa/setup') return r.fulfill({ json: { sharedKey: 'JBSW Y3DP EHPK 3PXP', otpAuthUri: 'otpauth://totp/Solvelt:rivka%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Solvelt' } })
    if (u === '/account/2fa/enable') return r.fulfill({ json: { recoveryCodes: ['A1B2C-D3E4F', 'G5H6J-K7L8M', 'N9P2Q-R3S4T', 'U5V6W-X7Y8Z', 'B2C3D-E4F5G', 'H6J7K-L8M9N', 'P2Q3R-S4T5U', 'V6W7X-Y8Z9A'] } })
    if (u === '/account/phone') return r.fulfill({ json: opts.phone ?? { hasNumber: false, numberEnding: null, hasPin: false } })
    if (u === '/channels/links/redeem') { const b = r.request().postDataJSON() as { token?: string }; return b.token === 'signup1' ? r.fulfill({ json: { purpose: 'signup', phoneEnding: '0123' } }) : r.fulfill({ status: 400, json: { title: 'This link is invalid or has expired.', code: 'invalid_link' } }) }
    if (u === '/public/config') return r.fulfill({ json: { turnstileSiteKey: 'stub' } })
    if (u === '/auth/login') return r.fulfill({ status: 401, json: { error: 'Invalid email or password', hint: { attemptsRemaining: 0, lastTry: false, captchaRequired: false, lockedUntil: new Date(Date.now() + 272_000).toISOString(), message: 'This account is temporarily locked.' } } })
    return r.fulfill({ json: {} })
  })
}

const screens: { name: string; path: string; authed?: boolean; status?: string; draftStep?: number; phone?: object; heading: RegExp; act?: (p: Page) => Promise<void> }[] = [
  { name: 'login', path: '/login', heading: /sign in/i },
  { name: 'login-locked', path: '/login', heading: /sign in/i, act: async (p) => {
    await p.getByLabel('Email').fill('rivka@example.com'); await p.getByLabel('Password', { exact: true }).fill('wrong-password-1')
    await p.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(p.getByText(/reset your password now/)).toBeVisible() } },
  { name: 'signup', path: '/signup', heading: /create your seller account/i },
  { name: 'verify', path: '/signup/verify', heading: /verify your email/i },
  { name: 'forgot', path: '/forgot-password', heading: /reset your password/i },
  { name: 'settings-2fa-setup', path: '/settings/security', authed: true, heading: /account settings/i, act: async (p) => {
    await p.getByRole('button', { name: 'Set up 2FA' }).click(); await expect(p.getByRole('img', { name: /QR code/ })).toBeVisible() } },
  { name: 'settings-recovery-codes', path: '/settings/security', authed: true, heading: /account settings/i, act: async (p) => {
    await p.getByRole('button', { name: 'Set up 2FA' }).click(); await p.getByLabel('Authentication code').fill('123456')
    await p.getByRole('button', { name: 'Enable 2FA' }).click(); await expect(p.getByLabel('Recovery codes', { exact: true })).toBeVisible()
    await expect(p.getByRole('button', { name: 'Done' })).toBeDisabled(); await p.getByLabel('I have saved my recovery codes').check()
    await expect(p.getByRole('button', { name: 'Done' })).toBeEnabled() } },
  { name: 'settings-phone-add', path: '/settings/security', authed: true, heading: /account settings/i, act: async (p) => {
    await p.getByRole('button', { name: 'Add a mobile number' }).click(); await expect(p.getByLabel('Mobile number')).toBeVisible() } },
  { name: 'settings-phone-set', path: '/settings/security', authed: true, phone: { hasNumber: true, numberEnding: '0123', hasPin: true }, heading: /account settings/i, act: async (p) => {
    await expect(p.getByText(/ending 0123 is verified/)).toBeVisible(); await expect(p.getByLabel('New PIN')).toBeVisible()
    await p.getByLabel('New PIN').fill('123456'); await expect(p.getByText(/Not a sequence like 123456/)).toBeVisible() } },
  { name: 'phone-link-finish', path: '/l/signup1', heading: /finish creating your account/i },
  { name: 'phone-link-expired', path: '/l/dead', heading: /this link can.t be used/i },
  { name: 'review', path: '/signup/review', authed: true, status: 'Draft', draftStep: 5, heading: /review your application/i },
  { name: 'pending', path: '/signup/pending', authed: true, heading: /pending/i },
  { name: 'pending-approved', path: '/signup/pending', authed: true, status: 'Approved', draftStep: 5, heading: /your application is approved/i },
  { name: 'pending-live', path: '/signup/pending', authed: true, status: 'Live', draftStep: 5, heading: /your shop is live/i },
  { name: 'settings-security', path: '/settings/security', authed: true, heading: /account settings/i, act: async (p) => { await expect(p.getByRole('heading', { name: /passkeys/i }).first()).toBeVisible() } },
]

for (const [vp, size] of Object.entries(viewports)) {
  for (const theme of ['light', 'dark'] as const) {
    for (const s of screens) {
      test(`${s.name} @${vp} ${theme}: renders and has no serious a11y violations`, async ({ page }) => {
        await page.setViewportSize(size)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await mock(page, { authed: s.authed, status: s.status, draftStep: s.draftStep, phone: s.phone })
        await page.goto(s.path)
        await expect(page.getByRole('heading', { name: s.heading }).first()).toBeVisible()
        await s.act?.(page)
        // no horizontal scroll at this width
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
        if (SHOTS && (theme === 'light' || ['login', 'signup', 'settings-security', 'pending'].includes(s.name)))
          await page.screenshot({ path: `${SHOTS}/${s.name}-${vp}${theme === 'dark' ? '-dark' : ''}.png`, fullPage: true })
      })
    }
  }
}

for (const [vp, size] of Object.entries(viewports)) test(`idle-logout modal @${vp} is accessible and shows a countdown`, async ({ page }) => {
  await page.setViewportSize(size)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mock(page, { authed: true, status: 'PendingReview', config: { idleTimeoutMinutes: 1, warningSeconds: 59 } })
  await page.goto('/signup/pending')
  const dlg = page.getByRole('alertdialog')
  await expect(dlg).toBeVisible({ timeout: 10_000 })
  await expect(dlg).toContainText(/You will be logged out in 00:\d\d/)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/idle-modal-${vp}.png` })
})

test('dark-mode toggle flips the theme and persists across reloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await mock(page)
  await page.goto('/login')
  const html = page.locator('html')
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'light')
})

// README CSP: script-src 'self' blocks inline scripts, so the saved theme must be applied by an external script.
const README_CSP = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; frame-ancestors 'none'"
test('saved theme is applied under the README CSP (production build, no inline-script violations)', async ({ page }) => {
  const blocked: string[] = []
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text()) && /script/i.test(m.text())) blocked.push(m.text()) })
  await page.emulateMedia({ colorScheme: 'light' })
  await mock(page)
  await page.route('http://localhost:4173/**', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const res = await route.fetch()
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': README_CSP } })
  })
  await page.goto('http://localhost:4173/login')
  await page.getByRole('button', { name: 'Dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(blocked).toEqual([])
})

// React applies style={{…}} through the CSSOM (element.style), which CSP style-src does not block; only style attributes
// in HTML markup are blocked. Prove it for real: serve the production build with the README CSP and check the widths apply.
test('inline style widths (progress bar, skeleton) apply under the README CSP with no violation reports', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI} @ ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} sample=${e.sample}`))
  })
  const consoleCsp: string[] = []
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text()) })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await mock(page, { authed: true, status: 'Draft', draftStep: 3 })
  // hold /account/me so the Settings skeleton stays on screen
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  await page.route('**/api/v1/account/me', async (r) => { await gate; await r.fulfill({ json: { email: login.email, emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus: 'Pending', vendorName: 'Rivka Bakes' } }) })
  await page.route('http://localhost:4173/**', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const res = await route.fetch()
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': README_CSP } })
  })
  // 1) wizard progress bar: step 3 of 6 = 50% of the track
  await page.goto('http://localhost:4173/signup/business')
  const fill = page.locator('.progress-fill')
  await expect(fill).toBeVisible()
  const bar = await fill.evaluate((el) => ({ inline: (el as HTMLElement).style.width, w: el.getBoundingClientRect().width, track: el.parentElement!.getBoundingClientRect().width }))
  expect(bar.inline).toMatch(/%$/)
  expect(bar.w / bar.track).toBeGreaterThan(0.45)
  expect(bar.w / bar.track).toBeLessThan(0.55)
  // 2) settings skeleton: the three lines have different widths (90/75/60%)
  await page.goto('http://localhost:4173/settings/security')
  const lines = page.locator('.skeleton')
  await expect(lines).toHaveCount(4)
  const widths = await lines.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)))
  expect(new Set(widths).size).toBeGreaterThan(1)
  release()
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible()
  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
  expect([...violations, ...consoleCsp]).toEqual([])
})
