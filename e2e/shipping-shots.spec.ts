import { test, expect } from './helpers'
import type { Page } from '@playwright/test'
import { buyerEvent, orderAction, product, seller, signIn, simulate, upsNumber } from './ordersKit'
import { acceptedOrder, buyLabel, shippingSetup, track } from './shippingKit'

const SHOTS = process.env.SHOTS_DIR // set to capture the screenshots, e.g. SHOTS_DIR=docs/screenshots
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const

test('screenshots of the shipping pages (desktop + mobile)', async ({ page, request }) => {
  test.skip(!SHOTS, 'set SHOTS_DIR to capture screenshots')
  test.setTimeout(240_000)
  const s = await seller(request)
  await product(request, s.token, 'Speckled stoneware mug', 30); await product(request, s.token, 'Linen napkins', 30)
  const { packageId } = await shippingSetup(request, s.token)
  const shot = async (p: Page, name: string, view: string) => { await p.waitForTimeout(500); await p.screenshot({ path: `${SHOTS}/${name}-${view}.png`, fullPage: false }) }
  await signIn(page, s.email, '/settings/shipping')

  // a profile so the rates card has content
  await page.getByRole('button', { name: 'Add a rate profile' }).click()
  const pr = page.getByRole('dialog', { name: 'Add a rate profile' }); await pr.getByLabel(/Free shipping from/).fill('75'); await pr.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Rate profile saved.')).toBeVisible()
  for (const [view, size] of VIEWS) { await page.setViewportSize(size); await page.goto('/settings/shipping'); await expect(page.getByRole('heading', { name: 'Ship-from addresses' })).toBeVisible(); await shot(page, 'shipping-settings', view) }

  // orders: one bought + moving, one delivered-problem, one waiting, one return
  const moving = await acceptedOrder(request, s.token); const l1 = await buyLabel(request, s.token, moving.id, packageId)
  await track(request, l1.trackingNumber, 'pre_transit'); await new Promise((r) => setTimeout(r, 1100)); await track(request, l1.trackingNumber, 'in_transit', 'Departed facility')
  const problem = await acceptedOrder(request, s.token); const l2 = await buyLabel(request, s.token, problem.id, packageId); await track(request, l2.trackingNumber, 'failure', 'Address not found')
  const waiting = await acceptedOrder(request, s.token); await acceptedOrder(request, s.token)

  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await page.goto('/orders?tab=all'); await expect(page.getByRole('link', { name: moving.number }).first()).toBeVisible(); await shot(page, 'shipping-orders-list', view)
    await page.goto(`/orders/${moving.id}`); await expect(page.getByRole('heading', { name: 'Tracking and labels' })).toBeVisible()
    await page.getByRole('heading', { name: 'Tracking and labels' }).scrollIntoViewIfNeeded(); await shot(page, 'shipping-tracking-timeline', view)
    await page.goto(`/orders/${problem.id}`); await expect(page.getByText(/This order needs attention\./)).toBeVisible(); await page.getByText(/This order needs attention\./).scrollIntoViewIfNeeded(); await shot(page, 'shipping-delivery-problem', view)

    await page.goto(`/orders/${waiting.id}`)
    await page.getByRole('button', { name: 'Ship order' }).first().click()
    const dlg = page.getByRole('dialog', { name: /^Ship order SO-/ })
    await dlg.getByLabel(/Weight of the items/).fill('500'); await dlg.getByRole('button', { name: 'Get shipping rates' }).click(); await expect(dlg.getByText('Recommended')).toBeVisible()
    await dlg.getByText('Recommended').scrollIntoViewIfNeeded(); await shot(page, 'shipping-buy-label-rates', view)
    await page.keyboard.press('Escape')
  }

  // label bought (desktop + mobile on fresh orders), bulk, return
  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    const o = await acceptedOrder(request, s.token)
    await page.goto(`/orders/${o.id}`); await page.getByRole('button', { name: 'Ship order' }).first().click()
    const dlg = page.getByRole('dialog', { name: /^Ship order SO-/ })
    await dlg.getByLabel(/Weight of the items/).fill('500'); await dlg.getByRole('button', { name: 'Get shipping rates' }).click()
    await dlg.getByRole('button', { name: /^Buy label · / }).click(); await expect(dlg.getByText(/^Label bought for/)).toBeVisible(); await shot(page, 'shipping-label-bought', view)
    await dlg.getByRole('button', { name: 'Done' }).click()
  }
  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await acceptedOrder(request, s.token); await acceptedOrder(request, s.token)
    await page.goto('/orders')
    const rows = view === 'mobile' ? page.locator('.pcards input[type=checkbox]') : page.locator('table tbody input[type=checkbox]')
    await expect(rows.nth(1)).toBeVisible(); await rows.nth(0).check(); await rows.nth(1).check()
    await page.getByRole('button', { name: 'Buy labels' }).click()
    const d = page.getByRole('dialog', { name: /^Buy labels for/ }); await d.getByLabel(/Weight of the items/).fill('400'); await shot(page, 'shipping-bulk-labels', view)
    await d.getByRole('button', { name: /^Buy \d+ labels?$/ }).click(); await expect(d.getByText(/labels? bought\./)).toBeVisible(); await shot(page, 'shipping-bulk-labels-done', view)
    await d.getByRole('button', { name: 'Done' }).click()
  }
  const [ro] = await simulate(request, s.token, 'multi')
  await orderAction(request, s.token, ro.id, 'accept'); await orderAction(request, s.token, ro.id, 'ship', { carrier: 'UPS', trackingNumber: upsNumber() }); await orderAction(request, s.token, ro.id, 'deliver'); await buyerEvent(request, s.token, ro.id, 'return_request')
  await page.setViewportSize(VIEWS[0][1]); await page.goto(`/orders/${ro.id}`); await page.getByRole('button', { name: 'Approve return' }).click(); await expect(page.getByText('Return approved.')).toBeVisible()
  for (const [view, size] of [...VIEWS].reverse()) {   // mobile first: buying the label (desktop) removes the button
    await page.setViewportSize(size); await page.goto(`/orders/${ro.id}`)
    await page.getByRole('button', { name: 'Send a prepaid return label' }).click(); const d = page.getByRole('dialog', { name: 'Send a prepaid return label' })
    await d.getByLabel(/Weight of the items/).fill('450'); await shot(page, 'shipping-return-label', view)
    if (view === 'mobile') { await page.keyboard.press('Escape'); continue }
    await d.getByRole('button', { name: 'Buy and send the return label' }).click(); await expect(d.getByText(/Return label bought for/)).toBeVisible(); await d.getByRole('button', { name: 'Done' }).click()
  }
})
