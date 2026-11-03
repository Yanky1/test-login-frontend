import AxeBuilder from '@axe-core/playwright'
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
  expect(res.status()).toBe(202) // no session until the mailbox is proven
  const code = await mailCode(request, email)
  const v = await request.post('/api/v1/auth/verify-email', { data: { email, code } })
  expect(v.ok()).toBeTruthy()
  const login = await v.json()
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

/** Fails on any serious or critical WCAG 2.2 AA violation on the current screen. */
export async function expectNoSeriousA11y(page: Page) {
  // Let entrance animations (fade/rise) finish: scanning mid-fade measures blended colours and flakes colour-contrast.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity))
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}
