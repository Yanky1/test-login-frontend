import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Browser, Page } from '@playwright/test'
import { test, expect, expectNoSeriousA11y, baseConfig } from './helpers'
import { signedPost } from './adminKit'
import { bearer, mgr, orderAction, product, seller, signIn } from './ordersKit'
import { makePng } from './png'

type Seller = Awaited<ReturnType<typeof seller>>

/** A time zone where "now + 3 h" is still today, so a window later today is bookable and the route can start today whatever time the test runs. */
function pickZone() {
  const zones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London', 'Australia/Sydney', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata']
  for (const tz of zones) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map((p) => [p.type, p.value]))
    const mins = Number(parts.hour) * 60 + Number(parts.minute)
    if (mins >= 60 && mins <= 20 * 60) {
      const start = Math.ceil((mins + 90) / 5) * 5
      const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      return { tz, date: `${parts.year}-${parts.month}-${parts.day}`, start: hm(start), end: hm(start + 120) }
    }
  }
  throw new Error('no usable time zone')
}

async function configureViaUi(page: Page, z: ReturnType<typeof pickZone>) {
  await page.goto('/settings/delivery')
  await expect(page.getByRole('heading', { name: 'Local delivery', level: 2 })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByLabel('Offer local delivery').check()
  await page.getByLabel('Time zone').fill(z.tz)
  await page.getByLabel(/Same-day cutoff/).fill('23:59')
  await page.getByRole('button', { name: 'Add zone' }).click()
  const zone = page.getByRole('group', { name: 'Zone 1' })
  await zone.getByLabel('Name').fill('Brooklyn')
  await zone.getByLabel('Delivery fee ($)').fill('5')
  await zone.getByLabel(/Postcodes/).fill('11201, 112*')
  await page.getByRole('button', { name: 'Add window' }).click()
  const win = page.getByRole('group', { name: 'Window 1' })
  await win.getByLabel('From').fill(z.start); await win.getByLabel('To').fill(z.end); await win.getByLabel('Deliveries per window').fill('3')
  for (const d of ['Sun', 'Sat']) await page.getByRole('group', { name: 'Days for window 1' }).getByLabel(d).check()
  await page.getByRole('button', { name: 'Save delivery settings' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
}

async function windowId(request: APIRequestContext, s: Seller) {
  const r = await request.get('/api/v1/seller/delivery/settings', { headers: bearer(s.token) })
  return ((await r.json()).windows[0].id) as string
}

async function localOrder(request: APIRequestContext, s: Seller, productId: string, win: string, date: string) {
  const brand = ((await (await request.get('/api/v1/brands', { headers: bearer(s.token) })).json()) as { id: string }[])[0].id
  const r = await signedPost(request, '/api/internal/v1/orders', {
    marketplaceOrderId: 'MP-' + randomUUID().slice(0, 10).toUpperCase(), placedAt: new Date().toISOString(), currency: 'USD',
    buyer: { displayName: 'Jane Buyer', relayEmail: 'relay-abc@relay.solvelt.example', phone: '+1 555 000 1111' },
    shippingAddress: { name: 'Jane Buyer', line1: '1 Main St', line2: 'Apt 2', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', lat: 40.6928, lng: -73.9903 },
    shippingMethod: 'local', shippingSpeed: 'standard',
    lines: [{ marketplaceLineId: 'L1', sellerId: s.sellerId, brandId: brand, productId, quantity: 1, unitPriceCents: 1999 }],
    shipping: [{ sellerId: s.sellerId, brandId: brand, amountCents: 500 }],
    deliveries: [{ sellerId: s.sellerId, brandId: brand, method: 'local', windowId: win, date }],
  })
  expect(r.status(), await r.text()).toBe(201)
  const o = (await r.json()).orders[0]
  await orderAction(request, s.token, o.sellerOrderId, 'accept')
  return { id: o.sellerOrderId as string, number: o.number as string }
}

async function phone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: [] })
  await ctx.route('**/config.json', (route) => route.fulfill({ json: baseConfig }))
  return { ctx, page: await ctx.newPage() }
}

/** Shop + settings + a driver + one accepted local order the owner has assigned on the board. */
async function assigned(page: Page, request: APIRequestContext, browser: Browser, title: string) {
  const s = await seller(request)
  const productId = await product(request, s.token, title)
  const driverEmail = await mgr(request, s.token, 'Driver')
  const z = pickZone()
  await signIn(page, s.email, '/settings/delivery')
  await configureViaUi(page, z)
  const order = await localOrder(request, s, productId, await windowId(request, s), z.date)
  await page.goto('/delivery')
  await expect(page.getByRole('heading', { name: 'Local delivery', level: 1 })).toBeVisible()
  const row = page.getByRole('listitem').filter({ hasText: order.number })
  await expect(row).toBeVisible()
  await row.getByLabel(`Driver for ${order.number}`).selectOption({ index: 1 })
  await row.getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByText(`${order.number} assigned.`)).toBeVisible()
  const mobile = await phone(browser)
  await signIn(mobile.page, driverEmail, '/driver')
  await expect(mobile.page.getByRole('heading', { name: 'My deliveries' })).toBeVisible()
  return { s, order, z, driverEmail, ...mobile }
}

const snap = async (p: Page, name: string) => { if (process.env.SHOTS) await p.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true }) }

test('configure zone and windows, dispatch, driver delivers with photo and signature on a phone, order Delivered, timeline shows the local statuses', async ({ page, request, browser }) => {
  const { s, order, page: phonePage, ctx } = await assigned(page, request, browser, 'Local mug')
  await expectNoSeriousA11y(page)
  await snap(page, 'delivery-board-desktop')

  // driver: start the route, first stop is next, then deliver with a photo and a signature
  await expectNoSeriousA11y(phonePage)
  await phonePage.getByRole('button', { name: 'Allow sharing' }).click()
  await phonePage.getByRole('button', { name: 'Start route' }).click()
  const stop = phonePage.getByRole('button', { name: /Stop 1, Out for delivery, 1 Main St/ })
  await expect(stop).toBeVisible()
  await snap(phonePage, 'driver-stops-mobile')
  await stop.click()
  await expect(phonePage.getByRole('link', { name: 'Navigate' })).toHaveAttribute('href', /maps\.google\.com/)
  await expect(phonePage.getByRole('link', { name: 'Call Jane' })).toBeVisible()
  await phonePage.getByRole('button', { name: 'Delivered' }).click()
  await phonePage.getByLabel('Recipient name (optional)').fill('Jane')
  await phonePage.getByLabel(/^Photo/).setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: makePng(400, 300) })
  const canvas = phonePage.getByRole('img', { name: /Signature/ })
  const box = (await canvas.boundingBox())!
  await phonePage.mouse.move(box.x + 20, box.y + 40); await phonePage.mouse.down(); await phonePage.mouse.move(box.x + 120, box.y + 80, { steps: 8 }); await phonePage.mouse.move(box.x + 200, box.y + 30, { steps: 8 }); await phonePage.mouse.up()
  await expectNoSeriousA11y(phonePage)
  await snap(phonePage, 'driver-deliver-mobile')
  await phonePage.getByRole('button', { name: 'Confirm delivery' }).click()
  await expect(phonePage.getByRole('button', { name: /Stop 1, Delivered/ })).toBeVisible()
  // once finished the stop no longer shows the address
  await expect(phonePage.getByText('1 Main St')).toHaveCount(0)

  // owner: order Delivered and the tracking timeline shows the local statuses; proof is available
  await page.goto(`/orders/${order.id}`)
  await expect(page.getByText('Delivered').first()).toBeVisible()
  const tl = page.getByRole('region', { name: 'Local delivery tracking' })
  await expect(tl.getByRole('list', { name: 'Tracking history' }).getByRole('listitem')).toHaveText([/Assigned to a driver/, /On its way/, /Out for delivery/, /Delivered/])
  await expect(tl.getByText('to Jane')).toBeVisible()
  await tl.getByRole('button', { name: 'Show photo' }).click()
  await expect(tl.getByRole('img', { name: 'Photo of the delivery' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await snap(page, 'delivery-order-tracking-desktop')
  const o = await (await request.get(`/api/v1/seller/orders/${order.id}`, { headers: bearer(s.token) })).json()
  expect(o.status).toBe('Delivered'); expect(o.shipments[0].method).toBe('local')
  await ctx.close()
})

test('failed attempt: the board flags it, the driver tries again and then delivers', async ({ page, request, browser }) => {
  const { order, page: phonePage, ctx } = await assigned(page, request, browser, 'Retry mug')
  await phonePage.getByRole('button', { name: 'Start route' }).click()
  await phonePage.getByRole('button', { name: /Stop 1/ }).click()
  await phonePage.getByRole('button', { name: 'Failed attempt' }).click()
  await phonePage.getByRole('button', { name: 'Save failed attempt' }).click()
  await expect(phonePage.getByText('Choose a reason.')).toBeVisible()
  await phonePage.getByLabel('Reason').selectOption('no_one_home')
  await phonePage.getByLabel('Note (optional)').fill('Rang twice')
  await phonePage.getByRole('button', { name: 'Save failed attempt' }).click()
  await expect(phonePage.getByRole('button', { name: /Stop 1, Failed attempt/ })).toBeVisible()

  await page.goto('/delivery')
  const row = page.getByRole('listitem').filter({ hasText: order.number })
  await expect(row.getByText(/Needs attention: no one home/)).toBeVisible()
  await expectNoSeriousA11y(page)

  await phonePage.getByRole('button', { name: /Stop 1/ }).click()
  await phonePage.getByRole('button', { name: 'Try again' }).click()
  await expect(phonePage.getByRole('button', { name: /Stop 1, Out for delivery/ })).toBeVisible()
  await phonePage.getByRole('button', { name: /Stop 1/ }).click()
  await phonePage.getByRole('button', { name: 'Delivered' }).click()
  await phonePage.getByLabel('Left at the door').check()
  await phonePage.getByLabel(/^Photo/).setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: makePng(300, 300) })
  await phonePage.getByRole('button', { name: 'Confirm delivery' }).click()
  await expect(phonePage.getByRole('button', { name: /Stop 1, Delivered/ })).toBeVisible()
  await page.goto(`/orders/${order.id}`)
  const tl = page.getByRole('region', { name: 'Local delivery tracking' })
  await expect(tl.getByText('Delivery attempt failed')).toBeVisible()
  await expect(tl.getByText('Delivered', { exact: true }).first()).toBeVisible()
  await ctx.close()
})

test('a Driver cannot open /orders or /products, and the server refuses them too', async ({ page, request, browser }) => {
  const s = await seller(request)
  const driverEmail = await mgr(request, s.token, 'Driver')
  const mobile = await phone(browser)
  await signIn(mobile.page, driverEmail, '/orders')
  await expect(mobile.page).toHaveURL(/\/driver$/)
  await expect(mobile.page.getByRole('heading', { name: 'My deliveries' })).toBeVisible()
  await mobile.page.goto('/products')
  await expect(mobile.page).toHaveURL(/\/driver$/)
  await expect(mobile.page.getByText('No deliveries assigned to you right now.')).toBeVisible()
  const token = await mobile.page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('sl_csrf='))?.slice(8) ?? ''), 'Content-Type': 'application/json' }, body: '{}' })
    return ((await r.json()) as { accessToken: string }).accessToken
  })
  for (const url of ['/api/v1/seller/orders', '/api/v1/seller/products', '/api/v1/seller/payments/balance']) expect((await request.get(url, { headers: bearer(token) })).status()).toBe(403)
  await mobile.ctx.close(); void page
})

test('offline queue: a delivery made without network is kept and sent when the connection is back', async ({ page, request, browser }) => {
  const { s, order, page: phonePage, ctx } = await assigned(page, request, browser, 'Offline mug')
  await phonePage.getByRole('button', { name: 'Start route' }).click()
  await phonePage.getByRole('button', { name: /Stop 1/ }).click()
  await ctx.setOffline(true)
  await phonePage.getByRole('button', { name: 'Delivered' }).click()
  await phonePage.getByLabel('Left at the door').check()
  await phonePage.getByLabel(/^Photo/).setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: makePng(300, 300) })
  await phonePage.getByRole('button', { name: 'Confirm delivery' }).click()
  await expect(phonePage.getByRole('button', { name: /Stop 1, Delivered/ })).toBeVisible()
  await expect(phonePage.getByRole('status').filter({ hasText: /Offline · 2 waiting to send/ })).toBeVisible()
  await snap(phonePage, 'driver-offline-mobile')
  const before = await (await request.get(`/api/v1/seller/orders/${order.id}`, { headers: bearer(s.token) })).json()
  expect(before.status).toBe('Shipped')                              // nothing reached the server yet
  await ctx.setOffline(false)
  await phonePage.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(phonePage.getByRole('status').filter({ hasText: /^Online$/ })).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await (await request.get(`/api/v1/seller/orders/${order.id}`, { headers: bearer(s.token) })).json()).status, { timeout: 20_000 }).toBe('Delivered')
  await ctx.close()
})
