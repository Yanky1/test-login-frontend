import { test, expect } from './helpers'
import type { Page } from '@playwright/test'
import { seller, signIn } from './ordersKit'
import { brandOf, offerOrder, priced } from './offersKit'

const SHOTS = process.env.SHOTS_DIR // e.g. SHOTS_DIR=docs/screenshots/offers
const DARK = process.env.SHOT_THEME === 'dark'
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const

test('screenshots of the offers pages (desktop + mobile)', async ({ page, request }) => {
  test.skip(!SHOTS, 'set SHOTS_DIR to capture screenshots')
  test.setTimeout(180_000)
  if (DARK) await page.emulateMedia({ colorScheme: 'dark' })
  const s = await seller(request)
  const blue = await priced(request, s.token, 'Prayer card, blue', 1.0)
  await priced(request, s.token, 'Prayer card, gold', 1.0)
  const wallet = await priced(request, s.token, 'Card wallet', 4.0, 5)
  const pack = await priced(request, s.token, 'Card pack', 2.0, 5)
  const brand = await brandOf(request, s.token)
  const shot = async (p: Page, name: string, view: string) => { await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${name}-${view}${DARK ? '-dark' : ''}.png`, fullPage: false }) }

  await signIn(page, s.email, '/offers/new')
  await page.getByLabel('Name').fill('Blitz cards bundle')
  for (const t of ['Prayer card, blue', 'Prayer card, gold']) await page.getByRole('checkbox', { name: t }).check()
  await page.getByLabel('Step 1: from quantity').fill('20'); await page.getByLabel('Step 1: price each in dollars').fill('0.90')
  for (const [i, label] of [[1, 'Card wallet'], [2, 'Card pack']] as const) { await page.getByRole('button', { name: 'Add gift' }).click(); await page.getByLabel(`Gift ${i}: product`).selectOption({ label }) }
  await expect(page.getByTestId('offer-preview')).toContainText('20 items: $18.00')
  for (const [view, size] of VIEWS) { await page.setViewportSize(size); await shot(page, 'offers-editor', view) }
  await page.getByRole('button', { name: 'Create offer' }).click()
  await expect(page.getByText('Version 1')).toBeVisible()
  const offerId = /\/offers\/([0-9a-f-]{36})$/.exec(page.url())![1]
  const r = await offerOrder(request, s.sellerId, brand, [{ productId: blue, quantity: 20, unitPriceCents: 100, discountCents: 200, offerId },
    { productId: wallet, quantity: 1, unitPriceCents: 0, isGift: true, giftOfOfferId: offerId }, { productId: pack, quantity: 1, unitPriceCents: 0, isGift: true, giftOfOfferId: offerId }], [{ offerId, offerVersion: 1 }])
  expect(r.status(), await r.text()).toBe(201)
  const orderId = (await r.json()).orders[0].sellerOrderId as string

  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await page.goto('/offers'); await expect(page.getByRole('link', { name: 'Blitz cards bundle' })).toBeVisible(); await shot(page, 'offers-list', view)
    await page.goto(`/offers/${offerId}`); await page.getByRole('button', { name: 'End offer' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await shot(page, 'offers-end-confirm', view)
    await page.keyboard.press('Escape')
    await page.goto(`/orders/${orderId}`); await expect(page.getByText('Free gift').first()).toBeVisible(); await shot(page, 'offers-order-gift', view)
  }
})
