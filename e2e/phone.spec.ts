import { createHmac } from 'node:crypto'
import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect, PASSWORD, createSeller, uiLogin, dismissPasskeyOffer, expectNoSeriousA11y } from './helpers'

const BACKEND = 'http://localhost:5080'
const SIGNING_KEY = 'e2e-phone-signing-key'
const PIN = '739204'
const newPhone = () => `+1415555${String(1000 + Math.floor(Math.random() * 8999))}`

/** Posts a provider-signed SMS webhook straight to the backend (the same signature SignalWire/Twilio would send). */
async function inboundSms(request: APIRequestContext, from: string, body: string) {
  const url = `${BACKEND}/api/v1/channels/sms/inbound`
  const form: Record<string, string> = { MessageSid: `SM${Date.now()}${Math.floor(Math.random() * 1e6)}`, From: from, To: '+14155550000', Body: body }
  const data = url + Object.keys(form).sort().map((k) => k + form[k]).join('')
  const sig = createHmac('sha1', SIGNING_KEY).update(data).digest('base64')
  const res = await request.post(url, { form, headers: { 'X-Twilio-Signature': sig } })
  expect(res.ok()).toBeTruthy()
  return res.text()
}

async function smsTo(request: APIRequestContext, to: string, n: number): Promise<string> {
  let text = ''
  await expect.poll(async () => {
    const list = (await (await request.get(`/api/test/sms?to=${encodeURIComponent(to)}`)).json()) as { text?: string; Text?: string }[]
    const m = list[list.length - 1]
    text = list.length >= n ? (m?.text ?? m?.Text ?? '') : ''
    return text
  }, { timeout: 10_000 }).not.toBe('')
  return text
}

async function addNumberAndPin(page: Page, request: APIRequestContext, email: string, phone: string) {
  await page.goto('/login')
  await uiLogin(page, email)
  await dismissPasskeyOffer(page)
  await page.goto('/settings/security')
  await page.getByRole('button', { name: 'Add a mobile number' }).click()
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByLabel('Password to confirm', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Text me a code' }).click()
  await page.getByLabel('Verification code').fill((await smsTo(request, phone, 1)).match(/\b(\d{6})\b/)![1])
  await page.getByRole('button', { name: 'Verify number' }).click()
  await expect(page.getByText(/is verified/).first()).toBeVisible()
  await page.getByLabel('PIN', { exact: true }).fill(PIN)
  await page.getByLabel('Confirm PIN', { exact: true }).fill(PIN)
  await page.getByLabel('Password to confirm PIN change').fill(PASSWORD)
  await page.getByRole('button', { name: 'Set PIN' }).click()
  await expect(page.getByText('Phone PIN saved. We emailed you a notice.')).toBeVisible()
}

test('add a verified mobile number and a phone PIN in Settings, then sign in by text', async ({ page, request }) => {
  const { email } = await createSeller(request)
  const phone = newPhone()
  await addNumberAndPin(page, request, email, phone)
  await expectNoSeriousA11y(page)
  // weak PINs are refused before anything is sent
  await page.getByLabel('New PIN').fill('123456'); await page.getByLabel('Confirm PIN', { exact: true }).fill('123456')
  await page.getByLabel('Password to confirm PIN change').fill(PASSWORD)
  await page.getByRole('button', { name: 'Change PIN' }).click()
  await expect(page.getByText(/meets the rules/)).toBeVisible()
  // the same account now signs in by text: LOGIN -> code + PIN -> STATUS
  expect(await inboundSms(request, phone, 'LOGIN')).toContain('6-digit code')
  const code = (await smsTo(request, phone, 2)).match(/\b(\d{6})\b/)![1]
  expect(await inboundSms(request, phone, `${code} ${PIN}`)).toContain('Signed in')
  expect(await inboundSms(request, phone, 'STATUS')).toContain('not yet submitted')
  // removing the number needs the password and also removes the PIN
  await page.getByRole('button', { name: 'Remove number' }).click()
  await page.getByLabel('Password to confirm', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Remove number' }).click()
  await expect(page.getByText('Mobile number and phone PIN removed.')).toBeVisible()
  await expect(page.getByText('Add and verify a mobile number first.')).toBeVisible()
})

test('a texted reset link opens /l/<token>, lands on the reset page and works once', async ({ page, request }) => {
  const { email } = await createSeller(request)
  const phone = newPhone()
  await addNumberAndPin(page, request, email, phone)
  await page.context().clearCookies() // a different browser: no session
  expect(await inboundSms(request, phone, 'RESET')).toContain('texted a password reset link')
  const link = (await smsTo(request, phone, 2)).match(/https?:\/\/\S+\/l\/\S+/)![0]
  const path = new URL(link).pathname
  await page.goto(path)
  await expect(page).toHaveURL(/\/reset-password\?email=/)
  await expectNoSeriousA11y(page)
  await page.getByLabel('New password', { exact: true }).fill('N3w-Phone-Reset-Pass!')
  await page.getByLabel('Confirm new password').fill('N3w-Phone-Reset-Pass!')
  await page.getByRole('button', { name: 'Reset password' }).click()
  await expect(page.getByText(/password (was )?(reset|changed|updated)|sign in/i).first()).toBeVisible()
  // single use: the same link is dead now
  await page.goto(path)
  await expect(page.getByText(/invalid, has expired or was already used/)).toBeVisible()
  await expectNoSeriousA11y(page)
})
