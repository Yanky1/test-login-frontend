import { createSeller, dismissPasskeyOffer, expect, expectNoSeriousA11y, test, uiLogin } from './helpers'
import type { APIRequestContext, Page } from '@playwright/test'
import { bearer, tokenFor } from './ordersKit'

// Real backend started with Demo__Enabled=true (playwright.config.ts). SHOTS_DIR=docs/screenshots/demo-data also writes the screenshots.
const SHOTS = process.env.SHOTS_DIR
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const
const business = { vendorName: 'Demo Bakery', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false }

/** A seller whose application is submitted and waiting for review (not approved). */
async function pendingSeller(request: APIRequestContext) {
  const s = await createSeller(request)
  const token = await tokenFor(request, s.email)
  expect((await request.put('/api/v1/seller/application/business', { data: business, headers: bearer(token) })).ok()).toBeTruthy()
  expect((await request.put('/api/v1/seller/application/kosher', { data: { answers: { sells_food: 'no' } }, headers: bearer(token) })).ok()).toBeTruthy()
  expect((await request.post('/api/v1/seller/application/submit', { data: { acceptSellerAgreement: true }, headers: bearer(token) })).ok()).toBeTruthy()
  return { ...s, token }
}

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/${name}-${view}.png`, fullPage: false })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
}

test('demo data: pending account -> approve (test button) -> fill -> data on every page -> remove -> empty again (axe on the new screens)', async ({ page, request }) => {
  test.setTimeout(240_000)
  const s = await pendingSeller(request)
  await page.goto('/login'); await uiLogin(page, s.email); await dismissPasskeyOffer(page)

  // ---- pending-approval screen: TEST MODE badge, fill card with the note, approve button
  await expect(page).toHaveURL(/\/signup\/pending/)
  await expect(page.locator('header.app-header').getByText('TEST MODE')).toBeVisible()
  const card = page.getByRole('region', { name: /Fill with demo data/ })
  await expect(card).toBeVisible()
  await expect(card.getByText(/appear in your lists after approval/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this account (test mode)' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await shot(page, 'pending-approve-and-fill')

  // the confirm dialog is accessible and Cancel changes nothing
  await page.getByRole('button', { name: 'Approve this account (test mode)' }).click()
  const dlg = page.getByRole('dialog', { name: 'Approve this account?' })
  await expect(dlg).toBeVisible()
  await expectNoSeriousA11y(page)
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(dlg).toBeHidden()
  await expect(page).toHaveURL(/\/signup\/pending/)

  // ---- approve: the full portal opens
  await page.getByRole('button', { name: 'Approve this account (test mode)' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, approve it' }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('navigation', { name: 'Seller' }).getByRole('link', { name: 'Orders' })).toBeVisible()
  expect((await request.get('/api/v1/seller/application', { headers: bearer(s.token) })).ok()).toBeTruthy()
  expect((await (await request.get('/api/v1/seller/application', { headers: bearer(s.token) })).json()).status).toBe('Approved')

  // ---- empty dashboard: the fill card
  const fillCard = page.getByRole('region', { name: /Fill with demo data/ })
  await expect(fillCard).toBeVisible()
  await expectNoSeriousA11y(page)
  await shot(page, 'fill-card')
  await fillCard.getByRole('button', { name: 'Fill with demo data' }).click()
  await expect(page.getByRole('heading', { name: 'Demo data added' })).toBeVisible({ timeout: 60_000 })
  await expectNoSeriousA11y(page)

  // ---- products, orders, bookings, quotes, payments show data (with the Demo pill)
  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Add your first product' })).toHaveCount(0)
  await expect(page.getByRole('table').locator('.chip.demo').first()).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.goto('/orders')
  await expect(page.getByRole('table').locator('.chip.demo').first()).toBeVisible()
  await expectNoSeriousA11y(page)
  await shot(page, 'filled-dashboard')
  await page.getByRole('table').getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1 }).locator('xpath=following-sibling::*[contains(@class,"demo")]').first()).toBeVisible()
  await expectNoSeriousA11y(page)

  await page.goto('/bookings')
  for (const tab of ['Requests', 'Upcoming', 'Past']) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
    if (await page.locator('table .chip.demo').count()) break
  }
  await expect(page.locator('table .chip.demo').first()).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('tab', { name: /^Quote requests/ }).click()
  await expect(page.locator('table .chip.demo').first()).toBeVisible()

  await page.goto('/payments?tab=transactions')
  await expect(page.getByRole('table', { name: 'Transactions' }).getByRole('row')).not.toHaveCount(1)   // header + at least one ledger row
  await expectNoSeriousA11y(page)

  await page.goto('/messages')
  await expect(page.locator('.conv-list .chip.demo').first()).toBeVisible()

  // ---- Settings -> Test tools
  await page.goto('/settings/test-tools')
  await expect(page.getByRole('heading', { name: 'Test tools', level: 2 })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Demo records in this account' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fill with demo data' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Approve this account/ })).toHaveCount(0)   // already approved
  await expectNoSeriousA11y(page)
  await shot(page, 'test-tools')

  // ---- remove: confirm dialog, then everything is empty again
  await page.getByRole('button', { name: 'Remove demo data' }).click()
  const rm = page.getByRole('dialog', { name: 'Remove demo data?' })
  await expectNoSeriousA11y(page)
  await rm.getByRole('button', { name: 'Cancel' }).click()
  await expect(rm).toBeHidden()
  await page.getByRole('button', { name: 'Remove demo data' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, remove demo data' }).click()
  await expect(page.getByText('This account has no demo data.')).toBeVisible({ timeout: 60_000 })
  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Add your first product' })).toBeVisible()
  await expect(page.getByRole('region', { name: /Fill with demo data/ })).toBeVisible()   // empty again: the card is back
  await page.goto('/orders')
  await expect(page.getByRole('table')).toHaveCount(0)
  await expectNoSeriousA11y(page)
})

test('demo data: dark mode screens are axe clean', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const s = await pendingSeller(request)
  await page.goto('/login'); await uiLogin(page, s.email); await dismissPasskeyOffer(page)
  await expect(page.getByRole('button', { name: 'Approve this account (test mode)' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Approve this account (test mode)' }).click()
  await expectNoSeriousA11y(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, approve it' }).click()
  await expect(page.getByRole('region', { name: /Fill with demo data/ })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Fill with demo data' }).click()
  await expect(page.getByRole('heading', { name: 'Demo data added' })).toBeVisible({ timeout: 60_000 })
  await page.goto('/orders')
  await expect(page.locator('table .chip.demo').first()).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.goto('/settings/test-tools')
  await expect(page.getByRole('heading', { name: 'Test tools', level: 2 })).toBeVisible()
  await expectNoSeriousA11y(page)
})

test('demo data: filling works for a pending account without approving it, and a second fill is refused with 409', async ({ request }) => {
  const s = await pendingSeller(request)
  const h = bearer(s.token)
  const status = await request.get('/api/v1/seller/demo-data', { headers: h })
  expect(status.ok()).toBeTruthy()
  expect((await status.json()).exists).toBe(false)
  expect((await request.post('/api/v1/seller/demo-data', { headers: h, data: {} })).status()).toBe(201)   // works for a pending account, and does not approve it
  expect((await (await request.get('/api/v1/seller/application', { headers: h })).json()).status).not.toBe('Approved')
  const again = await request.post('/api/v1/seller/demo-data', { headers: h, data: {} })
  expect(again.status()).toBe(409)
  expect((await again.json()).code).toBe('demo_data_exists')
})
