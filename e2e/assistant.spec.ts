import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test, expectNoSeriousA11y, createSeller, dismissPasskeyOffer, lastMail, setStatus, uiLogin, PASSWORD } from './helpers'
import { makePng } from './png'

const SHOTS = process.env.SHOTS_DIR
const INBOUND = 'e2e-inbound-secret-0123456789abcdef'
const business = { vendorName: 'Rivka Bakes', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false }

async function approvedSeller(request: APIRequestContext) {
  const s = await createSeller(request)
  const login = await request.post('/api/v1/auth/login', { data: { email: s.email, password: PASSWORD } })
  const h = { Authorization: `Bearer ${(await login.json()).accessToken}` }
  expect((await request.put('/api/v1/seller/application/business', { data: business, headers: h })).ok()).toBeTruthy()
  expect((await request.put('/api/v1/seller/application/kosher', { data: { answers: { sells_food: 'no' } }, headers: h })).ok()).toBeTruthy()
  expect((await request.post('/api/v1/seller/application/submit', { data: { acceptSellerAgreement: true }, headers: h })).ok()).toBeTruthy()
  await setStatus(request, s.sellerId, 'Approved')
  return { ...s, h }
}
type Seller = Awaited<ReturnType<typeof approvedSeller>>

async function activeProduct(request: APIRequestContext, s: Seller, title: string) {
  const cats = (await (await request.get('/api/v1/categories', { headers: s.h })).json()) as { id: string; slug: string }[]
  const created = await request.post('/api/v1/seller/products', { headers: s.h, data: { title, categoryId: cats.find((c) => c.slug === 'kitchen-dining')!.id } })
  expect(created.status()).toBe(201)
  const p = await created.json()
  const up = await request.post(`/api/v1/seller/products/${p.id}/images?alt=Front`, { headers: s.h, multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: makePng() } } })
  expect(up.status(), await up.text()).toBe(201)
  const cur = await (await request.get(`/api/v1/seller/products/${p.id}`, { headers: s.h })).json()
  const put = await request.put(`/api/v1/seller/products/${p.id}`, { headers: s.h, data: { ...cur, price: 19.99, quantity: 10, sku: 'SKU-' + Date.now(), noBarcode: true } })
  expect(put.ok(), await put.text()).toBeTruthy()
  expect((await request.post(`/api/v1/seller/products/${p.id}/status`, { headers: s.h, data: { status: 'active' } })).ok()).toBeTruthy()
  return { id: p.id as string, sellerId: s.sellerId }
}

/** A marketplace order placed 30 days ago, so it is already past its ship-by date. Signed like the real marketplace. */
async function lateOrder(request: APIRequestContext, s: Seller, productId: string) {
  const brand = ((await (await request.get('/api/v1/brands', { headers: s.h })).json()) as { id: string }[])[0].id
  const path = '/api/internal/v1/orders'
  const body = Buffer.from(JSON.stringify({
    marketplaceOrderId: 'MP-' + randomUUID().slice(0, 10).toUpperCase(), placedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), currency: 'USD',
    buyer: { displayName: 'Jane Buyer', relayEmail: 'relay-abc@relay.solvelt.example', phone: '+1 555 000 1111' },
    shippingAddress: { name: 'Jane Buyer', line1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US' },
    shippingMethod: 'Standard', shippingSpeed: 'standard',
    lines: [{ marketplaceLineId: 'L1', sellerId: s.sellerId, brandId: brand, productId, quantity: 1, unitPriceCents: 1999, discountCents: 0, taxCents: 0 }],
    shipping: [{ sellerId: s.sellerId, brandId: brand, amountCents: 500 }],
  }))
  const ts = Math.floor(Date.now() / 1000).toString(); const nonce = randomUUID().replace(/-/g, '')
  const canonical = `${ts}\n${nonce}\nPOST\n${path}\n${createHash('sha256').update(body).digest('hex')}`
  const sig = 'v1=' + createHmac('sha256', INBOUND).update(canonical).digest('hex')
  const r = await request.post(path, { data: body, headers: { 'Content-Type': 'application/json', 'X-Solvelt-Timestamp': ts, 'X-Solvelt-Nonce': nonce, 'X-Solvelt-Signature': sig } })
  expect(r.status(), await r.text()).toBe(201)
  const o = (await r.json()).orders[0]
  return { id: o.sellerOrderId as string, number: o.number as string }
}

async function signIn(page: Page, email: string) {
  await page.goto('/login'); await uiLogin(page, email); await dismissPasskeyOffer(page)
  await page.goto('/products')
}
const openAssistant = async (page: Page) => { await page.getByRole('button', { name: 'Assistant' }).click(); await expect(page.getByRole('dialog', { name: 'Solvelt Assistant' })).toBeVisible() }
const ask = async (page: Page, text: string) => { await page.getByLabel('Message the assistant').fill(text); await page.getByRole('button', { name: 'Send' }).click() }
const drafts = async (request: APIRequestContext, s: Seller) => ((await (await request.get('/api/v1/seller/products?status=draft', { headers: s.h })).json()) as { items: { title: string; status: string }[] }).items

test('"Add a draft product for a challah board": action card, Confirm, the product exists as a Draft', async ({ page, request }) => {
  const s = await approvedSeller(request)
  await signIn(page, s.email)
  await openAssistant(page)
  await expect(page.getByLabel('Message the assistant')).toBeFocused()
  await ask(page, 'Add a draft product for a challah board, $25, 10 in stock')

  const card = page.getByRole('region', { name: /Proposed action/ })
  await expect(card.getByRole('heading', { name: 'Do this?' })).toBeVisible()
  await expect(card.getByText('$25.00', { exact: true })).toBeVisible(); await expect(card.getByText('Challah board').first()).toBeVisible()
  await expect(card.getByText(/Nothing has changed yet/)).toBeVisible()
  expect((await drafts(request, s)).filter((d) => /challah/i.test(d.title))).toHaveLength(0) // nothing exists before Confirm
  await expectNoSeriousA11y(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assistant-card-desktop.png` })

  await card.getByRole('button', { name: /Confirm/ }).click()
  await expect(card.getByRole('heading', { name: 'Done' })).toBeVisible()
  const made = (await drafts(request, s)).filter((d) => /challah board/i.test(d.title))
  expect(made).toHaveLength(1); expect(made[0].status).toBe('Draft')
  await expectNoSeriousA11y(page)
})

test('a cancelled action changes nothing', async ({ page, request }) => {
  const s = await approvedSeller(request)
  await signIn(page, s.email); await openAssistant(page)
  await ask(page, 'Add a draft product for a challah board, $25, 10 in stock')
  const card = page.getByRole('region', { name: /Proposed action/ })
  await card.getByRole('button', { name: /Cancel/ }).click()
  await expect(card.getByRole('heading', { name: 'Cancelled' })).toBeVisible()
  await expect(card.getByRole('button', { name: /Confirm/ })).toHaveCount(0)
  expect((await drafts(request, s)).filter((d) => /challah/i.test(d.title))).toHaveLength(0)
})

test('"Which orders are late?" answers with a link to the order; keyboard and axe', async ({ page, request }) => {
  const s = await approvedSeller(request)
  const p = await activeProduct(request, s, 'Speckled stoneware coffee mug')
  const order = await lateOrder(request, s, p.id)
  await signIn(page, s.email)
  await page.getByRole('button', { name: 'Assistant' }).focus(); await page.keyboard.press('Enter')
  await expect(page.getByLabel('Message the assistant')).toBeFocused()
  await page.getByLabel('Message the assistant').fill('Which orders are late?'); await page.keyboard.press('Enter')
  const link = page.getByRole('link', { name: `Order ${order.number}` })
  await expect(link).toBeVisible({ timeout: 20_000 })
  await expect(link).toHaveAttribute('href', `/orders/${order.id}`)
  await expect(page.getByText(/Looking up your orders/)).toBeVisible()
  await expectNoSeriousA11y(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assistant-answer-desktop.png` })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Solvelt Assistant' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Assistant' })).toBeFocused()
})

test('a Viewer is told the role is read-only and gets no action buttons', async ({ page, request }) => {
  const owner = await approvedSeller(request)
  const email = `viewer-${Date.now()}@example.com`
  const inv = await request.post('/api/v1/team/invitations', { headers: owner.h, data: { email, role: 'viewer' } })
  expect(inv.status()).toBe(202)
  const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(await lastMail(request, email, 'team-invitation'))![1]
  const join = await request.post(`/api/v1/invitations/${token}/join`, { data: { password: PASSWORD, acceptTerms: true } })
  expect(join.ok()).toBeTruthy()
  await signIn(page, email)
  await openAssistant(page)
  await expect(page.getByText(/Viewer\) can look things up but can.t make changes/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Add a draft product/ })).toHaveCount(0)
  await ask(page, 'Add a draft product for a challah board, $25, 10 in stock')
  await expect(page.getByText(/role/i).last()).toBeVisible()
  await expect(page.getByRole('button', { name: /Confirm/ })).toHaveCount(0)
  expect((await drafts(request, owner)).filter((d) => /challah/i.test(d.title))).toHaveLength(0)
  await expectNoSeriousA11y(page)
})

test('on a phone the assistant is full screen, keeps focus inside and passes axe in dark mode', async ({ page, request }) => {
  const s = await approvedSeller(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await signIn(page, s.email); await openAssistant(page)
  const panel = page.getByRole('dialog', { name: 'Solvelt Assistant' })
  const box = await panel.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(389); expect(box!.height).toBeGreaterThanOrEqual(843)
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.getElementById('assistant-panel')!.contains(document.activeElement))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoSeriousA11y(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assistant-empty-mobile.png` })
  await ask(page, 'Add a draft product for a challah board, $25, 10 in stock')
  await expect(page.getByRole('region', { name: /Proposed action/ })).toBeVisible()
  await expectNoSeriousA11y(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/assistant-card-mobile.png` })
})
