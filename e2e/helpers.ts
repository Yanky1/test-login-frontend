import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'

export const PASSWORD = 'Tr1cky-Horse-Battery!'
export const ADMIN = { email: 'admin@example.com', password: 'Qu1et-Marble-Fox-Test!' }
export const newEmail = () => `seller-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

export const baseConfig = {
  idleTimeoutMinutes: 15, warningSeconds: 60, refreshIntervalMinutes: 5, turnstileSiteKey: 'stub', features: { apple: false },
}

/** Every test gets a runtime config.json (Turnstile stub; long idle timeout unless a test overrides it). */
export const test = base.extend<{ config: Partial<typeof baseConfig> }>({
  config: [{}, { option: true }],
  page: async ({ page, config }, use) => {
    await page.route('**/config.json', (route) => route.fulfill({ json: { ...baseConfig, ...config } }))
    await use(page)
  },
})
export { expect }

export async function mailCode(request: APIRequestContext, to: string, kind = 'verify-code'): Promise<string> {
  let text = ''
  await expect.poll(async () => {
    const res = await request.get(`/api/test/emails?to=${encodeURIComponent(to)}&kind=${kind}`)
    const list = (await res.json()) as { Text: string; text?: string }[]
    text = list.at(-1)?.Text ?? list.at(-1)?.text ?? ''
    return text
  }, { timeout: 10_000 }).not.toBe('')
  return /\b(\d{6})\b/.exec(text)![1]
}

export async function lastMail(request: APIRequestContext, to: string, kind: string): Promise<string> {
  let text = ''
  await expect.poll(async () => {
    const res = await request.get(`/api/test/emails?to=${encodeURIComponent(to)}&kind=${kind}`)
    const list = (await res.json()) as { text: string }[]
    text = list.at(-1)?.text ?? ''
    return text
  }, { timeout: 10_000 }).not.toBe('')
  return text
}

/** Creates a verified seller through the API (fast path for tests that are not about signup). */
export async function createSeller(request: APIRequestContext, email = newEmail(), password = PASSWORD) {
  const res = await request.post('/api/v1/auth/signup', { data: { email, password, acceptTerms: true } })
  expect(res.status()).toBe(201)
  const login = await res.json()
  const code = await mailCode(request, email)
  const v = await request.post('/api/v1/auth/verify-email', { data: { code }, headers: { Authorization: `Bearer ${login.accessToken}` } })
  expect(v.ok()).toBeTruthy()
  return { email, password, sellerId: login.sellerId as string }
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', { data: ADMIN })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).accessToken
}

export async function setStatus(request: APIRequestContext, sellerId: string, status: string, note?: string) {
  const token = await adminToken(request)
  const res = await request.post(`/api/v1/admin/sellers/${sellerId}/status`, { data: { status, note }, headers: { Authorization: `Bearer ${token}` } })
  expect(res.ok(), await res.text()).toBeTruthy()
}

export async function uiLogin(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

/** The "Add a passkey?" offer appears after a successful password sign-in; close it if it shows up. */
export async function dismissPasskeyOffer(page: Page) {
  const notNow = page.getByRole('button', { name: 'Not now' })
  try { await notNow.click({ timeout: 3_000 }) } catch { /* not offered */ }
}
