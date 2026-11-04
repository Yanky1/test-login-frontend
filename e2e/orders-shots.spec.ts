import { test, expect } from './helpers'
import type { Page } from '@playwright/test'
import { bearer, buyerEvent, orderAction, product, seller, signIn, simulate, upsNumber } from './ordersKit'

const SHOTS = process.env.SHOTS_DIR
const DARK = process.env.SHOT_THEME === 'dark' // SHOT_THEME=dark captures the dark variants (files get a -dark suffix)
 // set to capture the screenshots, e.g. SHOTS_DIR=docs/screenshots
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const

test('screenshots of the orders and messages pages (desktop + mobile)', async ({ page, request }) => {
  if (DARK) await page.emulateMedia({ colorScheme: 'dark' })
  test.skip(!SHOTS, 'set SHOTS_DIR to capture screenshots')
  test.setTimeout(180_000)
  const s = await seller(request)
  await product(request, s.token, 'Speckled stoneware mug'); await product(request, s.token, 'Linen napkin set')
  const a = (await simulate(request, s.token, 'multi'))[0]            // stays New
  const b = (await simulate(request, s.token, 'multi'))[0]            // part shipped, with a message and a cancel request
  await orderAction(request, s.token, b.id, 'accept')
  const detail = await (await request.get(`/api/v1/seller/orders/${b.id}`, { headers: bearer(s.token) })).json()
  await orderAction(request, s.token, b.id, 'ship', { carrier: 'UPS', trackingNumber: upsNumber(), lines: [{ lineId: detail.lines[0].id, quantity: 1 }] })
  await buyerEvent(request, s.token, b.id, 'message', { text: 'Hi! Can you ship before Friday?' })
  const c = (await simulate(request, s.token, 'single'))[0]
  await buyerEvent(request, s.token, c.id, 'cancel_request')
  await request.post('/api/v1/seller/message-templates', { headers: bearer(s.token), data: { title: 'Shipping soon', body: 'Thanks for your order, it ships tomorrow.' } })

  const shot = async (p: Page, name: string, view: string) => { await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${name}-${view}${DARK ? '-dark' : ''}.png`, fullPage: false }) }
  await signIn(page, s.email, '/orders')
  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await page.goto('/orders?tab=all'); await expect(page.getByRole('link', { name: a.number }).first()).toBeVisible(); await shot(page, 'orders-list', view)
    await page.goto(`/orders/${b.id}`); await expect(page.getByRole('heading', { name: /^Order SO-/, level: 1 })).toBeVisible(); await shot(page, 'order-detail', view)
    await page.getByRole('button', { name: 'Ship order' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await shot(page, 'order-ship-dialog', view)
    await page.keyboard.press('Escape')
    await page.goto(`/orders/${c.id}`); await expect(page.getByText('Cancellation requested').first()).toBeVisible(); await shot(page, 'order-cancel-request', view)
    await page.goto('/messages'); await expect(page.getByRole('heading', { name: 'Messages', level: 1 })).toBeVisible()
    await page.getByRole('link', { name: /Test Buyer|Jane/ }).first().click(); await expect(page.getByLabel('Your reply')).toBeVisible(); await shot(page, 'messages', view)
    await page.goto('/settings/notifications'); await expect(page.getByRole('heading', { name: 'Email notifications' })).toBeVisible(); await shot(page, 'settings-notifications', view)
  }
})
