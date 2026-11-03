import { test, expect } from './helpers'
import type { Page } from '@playwright/test'
import { bearer, orderAction, product, seller, signIn, simulate } from './ordersKit'

const SHOTS = process.env.SHOTS_DIR // set to capture the screenshots, e.g. SHOTS_DIR=docs/screenshots
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const

test('screenshots of the Payments pages (desktop + mobile)', async ({ page, request }) => {
  test.skip(!SHOTS, 'set SHOTS_DIR to capture screenshots')
  test.setTimeout(180_000)
  const s = await seller(request)
  await product(request, s.token, 'Speckled stoneware mug')
  const deliver = async () => {
    const [o] = await simulate(request, s.token, 'single')
    await orderAction(request, s.token, o.id, 'accept'); await orderAction(request, s.token, o.id, 'ship', { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }); await orderAction(request, s.token, o.id, 'deliver')
    expect((await request.post(`/api/dev/payments/capture/${o.id}`)).ok()).toBeTruthy()
    return o
  }
  await signIn(page, s.email, '/payments')
  const shot = async (p: Page, name: string, view: string) => { await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/${name}-${view}.png`, fullPage: false }) }

  // 1. not set up yet
  for (const [view, size] of VIEWS) { await page.setViewportSize(size); await page.goto('/payments'); await expect(page.getByText('Not set up')).toBeVisible(); await shot(page, 'payments-onboarding', view) }
  // 2. set up, one order released + transferred, one pending
  expect((await request.post('/api/v1/seller/payments/onboarding', { headers: bearer(s.token), data: {} })).ok()).toBeTruthy()
  expect((await request.post(`/api/dev/payments/complete-onboarding/${s.sellerId}`)).ok()).toBeTruthy()
  const a = await deliver(); await deliver()
  await request.post(`/api/dev/payments/age-order/${a.id}`); expect((await request.post('/api/dev/payments/run')).ok()).toBeTruthy()
  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await page.goto('/payments'); await expect(page.getByTestId('bal-pending')).toBeVisible(); await shot(page, 'payments-overview', view)
    await page.goto('/payments?tab=transactions'); await expect(page.getByRole('link', { name: a.number }).first()).toBeVisible(); await shot(page, 'payments-transactions', view)
    await page.goto('/payments?tab=transfers'); await expect(page.getByRole('table', { name: 'Transfers' })).toBeVisible(); await shot(page, 'payments-transfers', view)
    await page.goto('/payments?tab=statements'); await expect(page.getByRole('table', { name: /statement/ })).toBeVisible(); await shot(page, 'payments-statements', view)
    await page.goto('/payments?tab=disputes'); await expect(page.getByText(/No disputes/)).toBeVisible(); await shot(page, 'payments-disputes', view)
  }
})
