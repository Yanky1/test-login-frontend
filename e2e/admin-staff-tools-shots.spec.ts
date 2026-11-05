import { test, expect } from './helpers'
import { bearer, product, seller } from './ordersKit'
import { signedPost, staffMember, uiStaffLogin } from './adminKit'
import type { Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR      // e.g. SHOTS_DIR=docs/screenshots/admin-staff-tools
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const

test('screenshots of the staff tools pages (desktop + mobile)', async ({ page, request }) => {
  test.skip(!SHOTS, 'set SHOTS_DIR to capture screenshots')
  test.setTimeout(240_000)
  const s = await seller(request)
  await request.post('/api/v1/seller/demo-data', { headers: bearer(s.token), data: {} })
  const mug = await product(request, s.token, 'Designer-brand mug (looks fake)')
  await signedPost(request, `/api/internal/v1/listings/${mug}/reports`, { reason: 'Counterfeit item reported by a buyer' })
  const sa = await staffMember(request, 'SuperAdmin')

  const shot = async (p: Page, name: string, view: string) => { await p.waitForTimeout(500); await p.screenshot({ path: `${SHOTS}/${name}-${view}.png`, fullPage: false }) }
  const nav = (p: Page, name: string) => p.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name, exact: true }).click()
  const reason = (p: Page, text: string) => p.getByRole('dialog').getByLabel(/^(Reason|Warning text)/).fill(text)

  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await uiStaffLogin(page, sa, '/admin/login')
    await nav(page, 'Sellers'); await page.getByLabel('Search').fill(s.sellerId)
    await expect(page.getByRole('link', { name: 'Acme Co' })).toHaveCount(1); await page.getByRole('link', { name: 'Acme Co' }).click()
    const tabs = page.getByRole('tablist', { name: 'Seller areas' })
    await expect(tabs).toBeVisible(); await shot(page, 'seller-tabs', view)
    await tabs.getByRole('tab', { name: 'Payments' }).click(); await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible(); await shot(page, 'seller-payments', view)
    await page.getByRole('button', { name: 'Adjust balance' }).click(); await page.getByRole('dialog').getByLabel('Amount in minor units (cents)').fill('2500'); await reason(page, 'Goodwill credit'); await shot(page, 'payments-adjust-dialog', view)
    await page.keyboard.press('Escape')
    await tabs.getByRole('tab', { name: 'Shipping' }).click(); await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible(); await shot(page, 'seller-shipping', view)
    await tabs.getByRole('tab', { name: 'Local delivery' }).click(); await expect(page.getByRole('heading', { name: 'Delivery settings' })).toBeVisible(); await shot(page, 'seller-delivery', view)
    await nav(page, 'Payments'); await expect(page.getByRole('heading', { name: 'Transfers to sellers' })).toBeVisible(); await shot(page, 'payments-transfers', view)
    await page.getByRole('tab', { name: 'Reconciliation' }).click(); await expect(page.getByRole('heading', { name: 'Reconciliation flags' })).toBeVisible(); await shot(page, 'payments-reconciliation', view)
    await nav(page, 'Shipping'); await expect(page.getByRole('heading', { name: 'Label refunds that are not finished' })).toBeVisible(); await shot(page, 'shipping-refunds', view)
    await page.getByRole('tab', { name: 'Exceptions' }).click(); await expect(page.getByRole('heading', { name: /Orders needing attention/ })).toBeVisible(); await shot(page, 'shipping-exceptions', view)
    await nav(page, 'Moderation'); await expect(page.getByRole('table', { name: 'Moderation queue' })).toBeVisible(); await shot(page, 'moderation-queue', view)
    await page.getByRole('link', { name: 'Reported listing' }).first().click(); await expect(page.getByRole('button', { name: 'Hide content' }).first()).toBeVisible(); await shot(page, 'moderation-detail', view)
    await page.getByRole('button', { name: 'Hide content' }).first().click(); await reason(page, 'Counterfeit confirmed'); await shot(page, 'moderation-hide-dialog', view)
    await page.keyboard.press('Escape')
    if (view === 'mobile') {                    // leave no open report behind: other specs read the oldest open report of the shared e2e database
      await page.getByRole('button', { name: 'Dismiss' }).click(); await reason(page, 'E2E cleanup')
      await page.getByRole('dialog').getByRole('button', { name: 'Dismiss' }).click(); await expect(page.getByText('Report dismissed.')).toBeVisible()
    }
    await page.goto('/admin/login')
  }
})
