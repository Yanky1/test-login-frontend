import { test, expect, createSeller, uiLogin, PASSWORD, baseConfig, dismissPasskeyOffer, mailCode } from './helpers'

async function virtualAuthenticator(page: import('@playwright/test').Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  return cdp
}

test('passkey: register after first sign-in, then sign in with it', async ({ page, request }) => {
  await virtualAuthenticator(page)
  // exercise the explicit button; conditional UI (autofill) is covered by the next test
  await page.addInitScript(() => { (PublicKeyCredential as unknown as { isConditionalMediationAvailable: () => Promise<boolean> }).isConditionalMediationAvailable = async () => false })
  const s = await createSeller(request)
  await page.goto('/login')
  await uiLogin(page, s.email)
  // "Add a passkey" is offered after the first password sign-in
  const dialog = page.getByRole('dialog', { name: 'Add a passkey?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Add a passkey' }).click()
  await expect(page.getByText(/Passkey added/)).toBeVisible()
  // manage passkeys: list, rename, delete is refused for the last method only when it is the last one
  await page.goto('/settings/security')
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible()
  await expect(page.getByText(/This device added/)).toBeVisible()
  page.once('dialog', (d) => d.accept('Work laptop'))
  await page.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByText(/Work laptop added/)).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login/)
  // sign in with the discoverable credential (no email typed)
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('.who')).toHaveText(s.email)
})

test('passkey: conditional UI signs in automatically with a discoverable credential', async ({ page, request }) => {
  await virtualAuthenticator(page)
  const s = await createSeller(request)
  await page.goto('/login')
  await uiLogin(page, s.email)
  await page.getByRole('dialog', { name: 'Add a passkey?' }).getByRole('button', { name: 'Add a passkey' }).click()
  await expect(page.getByText(/Passkey added/)).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  // the login page starts a conditional (autofill) request on load; the virtual authenticator answers it
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await expect(page.locator('.who')).toHaveText(s.email)
})

test('passkey: sign up with a passkey, verify, then change email with a step-up code', async ({ page, request }) => {
  await virtualAuthenticator(page)
  const email = `pk-${Date.now()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel(/I agree to the/).check()
  await page.getByRole('button', { name: 'Sign up with a passkey' }).click()
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveValue(email)
  await page.getByLabel('Verification code').fill(await mailCode(request, email))
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('heading', { name: 'Business details' })).toBeVisible()
  // passkey-only account (no password): changing the email needs a code from the CURRENT mailbox first
  await page.goto('/settings/security')
  const newEmail = `pk-new-${Date.now()}@example.com`
  await page.getByLabel('New email').fill(newEmail)
  await page.getByRole('button', { name: 'Send verification code' }).click()
  await expect(page.getByText(/We sent a confirmation code to/)).toBeVisible()
  await page.getByLabel(/Confirmation code/).fill('000000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/confirmation code isn't right/)).toBeVisible()
  await page.getByLabel(/Confirmation code/).fill(await mailCode(request, email, 'stepup-code'))
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(new RegExp(`We sent a code to ${newEmail}`))).toBeVisible()
  await page.getByLabel('Verification code').fill(await mailCode(request, newEmail, 'change-email-code'))
  await page.getByRole('button', { name: 'Confirm new email' }).click()
  await expect(page.getByText(/Email changed to/)).toBeVisible()
})

test('passkey sign-up binds the email: tampering with it between options and complete is rejected', async ({ page }) => {
  await virtualAuthenticator(page)
  const email = `bind-${Date.now()}@example.com`
  let status = 0
  await page.route('**/api/v1/auth/signup/passkey/complete', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    body.email = `victim-${Date.now()}@example.com` // attacker swaps in someone else's address
    const res = await route.fetch({ postData: JSON.stringify(body) })
    status = res.status()
    await route.fulfill({ response: res })
  })
  await page.goto('/signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel(/I agree to the/).check()
  await page.getByRole('button', { name: 'Sign up with a passkey' }).click()
  await expect.poll(() => status).toBe(400)
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toHaveCount(0)
})

test.describe('inactivity logout', () => {
  test.use({ config: { ...baseConfig, idleTimeoutMinutes: 0.15, warningSeconds: 5 } }) // 9 s idle, 5 s warning

  test('warning with countdown, auto logout, server session revoked, redirect back after login', async ({ page, request, context, playwright }) => {
    const s = await createSeller(request)
    await page.goto('/login?next=%2Fsettings%2Fprofile')
    await uiLogin(page, s.email)
    await dismissPasskeyOffer(page)
    await expect(page).toHaveURL(/\/settings\/profile$/)
    const cookies = await context.cookies()
    const rt = cookies.find((c) => c.name === 'sl_rt')
    expect(rt?.httpOnly).toBe(true)
    // no tokens in web storage
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    expect(storage).not.toMatch(/eyJ/)
    const warning = page.getByRole('alertdialog')
    await expect(warning).toBeVisible({ timeout: 15_000 })
    await expect(warning.getByText(/You will be logged out in 00:0\d/)).toBeVisible()
    await expect(page).toHaveURL(/\/login\?reason=idle&next=%2Fsettings%2Fprofile/, { timeout: 15_000 })
    await expect(page.getByText(/signed out because you were inactive/)).toBeVisible()
    // the server session is gone: refresh cookie no longer works
    const fresh = await playwright.request.newContext({ baseURL: 'http://localhost:5173' })
    const refresh = await fresh.post('/api/v1/auth/refresh', { data: { refreshToken: rt!.value } })
    expect(refresh.status()).toBe(401)
    // log in again -> back where we were
    await uiLogin(page, s.email)
    await dismissPasskeyOffer(page)
    await expect(page).toHaveURL(/\/settings\/profile$/)
  })

  test('"Stay signed in" keeps the session', async ({ page, request }) => {
    const s = await createSeller(request, undefined, PASSWORD)
    await page.goto('/login')
    await uiLogin(page, s.email)
    await dismissPasskeyOffer(page)
    await page.getByRole('button', { name: 'Stay signed in' }).click({ timeout: 15_000 })
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  })
})

test.describe('multiple tabs', () => {
  const idle = { ...baseConfig, idleTimeoutMinutes: 0.15, warningSeconds: 5 } // 9 s idle, 5 s warning
  test.use({ config: idle })

  test('activity in one tab keeps the idle tab signed in; with no activity both sign out together', async ({ page, context, request }) => {
    const s = await createSeller(request)
    await page.goto('/login?next=%2Fsettings%2Fprofile')
    await uiLogin(page, s.email)
    await dismissPasskeyOffer(page)
    await expect(page).toHaveURL(/\/settings\/profile$/)
    const other = await context.newPage()
    await other.route('**/config.json', (route) => route.fulfill({ json: idle }))
    await other.goto('/settings/profile')
    await expect(other.getByRole('heading', { name: 'Account settings' })).toBeVisible() // session restored from the shared refresh cookie
    // the user works in the first tab only for longer than the idle timeout: the second tab must not log anyone out
    for (let i = 0; i < 14; i++) { await page.mouse.move(20 + i * 5, 120); await page.waitForTimeout(1000) }
    await expect(other.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible()
    await expect(other.getByRole('heading', { name: 'Account settings' })).toBeVisible()
    // now nobody does anything: one coordinated logout takes both tabs to the login page
    await expect(page).toHaveURL(/\/login/, { timeout: 25_000 })
    await expect(other).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})
