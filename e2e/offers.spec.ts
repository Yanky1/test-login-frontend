import { expect, expectNoSeriousA11y, test } from './helpers'
import type { Page } from '@playwright/test'
import { seller, signIn } from './ordersKit'
import { brandOf, offerOrder, priced } from './offersKit'

async function bothThemes(page: Page, check: () => Promise<void>) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.evaluate((x) => { document.documentElement.dataset.theme = x }, scheme)
    await check()
  }
  await page.emulateMedia({ colorScheme: 'light' }); await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
}

test('a seller creates a quantity offer, sees the server preview, and a signed order with a tier discount and a free gift shows on the order and the packing slip (axe light + dark)', async ({ page, request }) => {
  test.setTimeout(180_000)
  const s = await seller(request)
  const blue = await priced(request, s.token, 'Prayer card, blue', 1.0)
  const gold = await priced(request, s.token, 'Prayer card, gold', 1.0)
  const wallet = await priced(request, s.token, 'Card wallet', 4.0, 5)
  const brand = await brandOf(request, s.token)

  await signIn(page, s.email, '/offers')
  await expect(page.getByRole('heading', { name: 'Offers', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No offers yet' })).toBeVisible()
  await expect(page.locator('a[href="/offers"]').first()).toBeAttached()                   // the seller nav has an Offers item
  await bothThemes(page, () => expectNoSeriousA11y(page))

  // create through the editor, keyboard-friendly labels only
  await page.getByRole('link', { name: /New offer/ }).click()
  await page.getByLabel('Name').fill('Card bundle')
  await page.getByRole('checkbox', { name: 'Prayer card, blue' }).check()
  await page.getByRole('checkbox', { name: 'Prayer card, gold' }).check()
  await page.getByLabel('Step 1: from quantity').fill('20')
  await page.getByLabel('Step 1: price each in dollars').fill('0.90')
  await page.getByRole('button', { name: 'Add gift' }).click()
  await page.getByLabel('Gift 1: product').selectOption({ label: 'Card wallet' })
  const preview = page.getByTestId('offer-preview')
  await expect(preview).toContainText('10 items: $10.00 + free Card wallet')
  await expect(preview).toContainText('20 items: $18.00 + free Card wallet')
  await expect(preview).toContainText('25 items: $22.50 + free Card wallet')
  await bothThemes(page, () => expectNoSeriousA11y(page))
  await page.getByRole('button', { name: 'Create offer' }).click()
  await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}$/)
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible()
  const offerId = /\/offers\/([0-9a-f-]{36})$/.exec(page.url())![1]

  // the marketplace mis-priced 19 cards at the 20-card tier: refused with the expected figures
  const bad = await offerOrder(request, s.sellerId, brand, [{ productId: blue, quantity: 19, unitPriceCents: 100, discountCents: 190, offerId }, { productId: wallet, quantity: 1, unitPriceCents: 0, isGift: true, giftOfOfferId: offerId }], [{ offerId, offerVersion: 1 }])
  expect(bad.status()).toBe(422)
  expect((await bad.json()).code).toBe('offer_mismatch')
  // 12 blue + 8 gold = 20 cards at $0.90 each, plus the free wallet
  const ok = await offerOrder(request, s.sellerId, brand, [
    { productId: blue, quantity: 12, unitPriceCents: 100, discountCents: 120, offerId },
    { productId: gold, quantity: 8, unitPriceCents: 100, discountCents: 80, offerId },
    { productId: wallet, quantity: 1, unitPriceCents: 0, isGift: true, giftOfOfferId: offerId },
  ], [{ offerId, offerVersion: 1 }])
  expect(ok.status(), await ok.text()).toBe(201)
  const order = (await ok.json()).orders[0] as { sellerOrderId: string; totalCents: number }
  expect(order.totalCents).toBe(1800)

  await page.goto(`/orders/${order.sellerOrderId}`)
  const items = page.getByRole('region', { name: 'Items' })
  const giftLine = items.getByRole('listitem').filter({ hasText: 'Card wallet' })
  await expect(giftLine.getByText('Free gift')).toBeVisible()
  await expect(items.getByRole('listitem').filter({ hasText: 'Prayer card, blue' }).getByText('Discount −$1.20')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Payment summary' }).getByText('$18.00').first()).toBeVisible()
  await bothThemes(page, () => expectNoSeriousA11y(page))
  await page.getByRole('button', { name: 'Packing slip' }).click()
  const slip = page.getByRole('article', { name: /Packing slip SO-/ })
  await expect(slip.getByRole('row').filter({ hasText: 'Card wallet' }).getByText('Free gift')).toBeVisible()
  await bothThemes(page, () => expectNoSeriousA11y(page))
  await page.keyboard.press('Escape')

  // end the offer with the confirm dialog (keyboard: Escape keeps it, the dialog button ends it)
  await page.goto(`/offers/${offerId}`)
  await page.getByRole('button', { name: 'End offer' }).click()
  const dlg = page.getByRole('dialog', { name: 'End this offer?' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('button', { name: 'End offer' })).toBeFocused()
  await bothThemes(page, () => expectNoSeriousA11y(page))
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
  await page.getByRole('button', { name: 'End offer' }).click()
  await page.getByRole('dialog', { name: 'End this offer?' }).getByRole('button', { name: 'End offer' }).click()
  await expect(page.getByText(/Ended offers can't be changed/)).toBeVisible()
  await page.goto('/offers')
  await expect(page.getByRole('listitem').filter({ hasText: 'Card bundle' }).getByText('Ended')).toBeVisible()
})
