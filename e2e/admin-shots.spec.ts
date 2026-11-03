import { test, expect, createSeller } from './helpers'
import { bearer, product, seller, tokenFor } from './ordersKit'
import { insertDeadLetter, placeOrder, signedPost, staffMember, totp, uiStaffLogin } from './adminKit'
import { makePng } from './png'
import type { Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR // e.g. SHOTS_DIR=docs/screenshots
const VIEWS = [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const

test('screenshots of the staff admin pages (desktop + mobile)', async ({ page, request }) => {
  test.skip(!SHOTS, 'set SHOTS_DIR to capture screenshots')
  test.setTimeout(240_000)

  // data to show: an application with a certificate, a reported listing, an order, a dead letter
  const applicant = await createSeller(request)
  const at = await tokenFor(request, applicant.email); const ah = bearer(at)
  await request.put('/api/v1/seller/application/business', { headers: ah, data: { vendorName: 'Maple & Rye Bakery', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false } })
  await request.put('/api/v1/seller/application/kosher', { headers: ah, data: { answers: { sells_food: 'yes', food_types: 'Bakery', is_kosher: 'yes', kosher_agency: 'OU' } } })
  await request.post('/api/v1/seller/application/kosher/certificate', { headers: ah, multipart: { file: { name: 'ou-certificate.png', mimeType: 'image/png', buffer: makePng(600, 420) } } })
  await request.post('/api/v1/seller/application/submit', { headers: ah, data: { acceptSellerAgreement: true } })
  const s = await seller(request)
  const mug = await product(request, s.token, 'Designer-brand mug (looks fake)')
  await product(request, s.token, 'Linen napkin set')
  await signedPost(request, `/api/internal/v1/listings/${mug}/reports`, { reason: 'Counterfeit item reported by a buyer' })
  const order = await placeOrder(request, { sellerId: s.sellerId, h: bearer(s.token) }, mug)
  const dead = insertDeadLetter()
  const sa = await staffMember(request, 'SuperAdmin')

  const shot = async (p: Page, name: string, view: string) => { await p.waitForTimeout(500); await p.screenshot({ path: `${SHOTS}/admin-${name}-${view}.png`, fullPage: false }) }
  const nav = (p: Page, name: string) => p.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name, exact: true }).click()

  for (const [view, size] of VIEWS) {
    await page.setViewportSize(size)
    await page.goto('/admin/login'); await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible(); await shot(page, 'login', view)
    await page.getByLabel('Email').fill(sa.email); await page.getByLabel('Password', { exact: true }).fill(sa.password)
    await page.getByRole('button', { name: 'Continue' }).click(); await expect(page.getByLabel('Authenticator code')).toBeVisible(); await shot(page, 'login-code', view)
    await page.getByLabel('Authenticator code').fill(totp(sa.secret)); await page.getByRole('button', { name: 'Verify and sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible(); await expect(page.getByText('Applications waiting for review')).toBeVisible(); await shot(page, 'dashboard', view)

    await nav(page, 'Applications'); await page.getByLabel('Search business or email').fill(applicant.email)
    await expect(page.getByRole('link', { name: 'Maple & Rye Bakery' })).toHaveCount(1); await shot(page, 'applications', view)
    await page.getByRole('link', { name: 'Maple & Rye Bakery' }).click(); await expect(page.getByRole('img', { name: /Uploaded certificate/ })).toBeVisible(); await shot(page, 'application-detail', view)
    await page.getByRole('button', { name: 'Approve' }).click(); await expect(page.getByRole('dialog', { name: 'Approve this application' })).toBeVisible(); await shot(page, 'reason-dialog', view)
    await page.keyboard.press('Escape')

    await nav(page, 'Sellers'); await page.getByLabel('Search').fill(s.sellerId); await expect(page.getByRole('link', { name: 'Acme Co' })).toHaveCount(1)
    await page.getByRole('link', { name: 'Acme Co' }).click(); await expect(page.getByRole('heading', { name: 'Members and roles' })).toBeVisible(); await shot(page, 'seller-detail', view)

    await nav(page, 'Users'); await page.getByLabel('Email, phone or user id').fill(s.email); await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('heading', { name: s.email, level: 1 })).toBeVisible(); await shot(page, 'user-detail', view)

    await nav(page, 'Moderation'); await expect(page.getByRole('link', { name: 'Reported listing' }).first()).toBeVisible(); await shot(page, 'moderation', view)
    await page.getByRole('link', { name: 'Reported listing' }).first().click(); await expect(page.getByRole('heading', { name: 'Listing (read-only)' })).toBeVisible(); await shot(page, 'moderation-detail', view)

    await nav(page, 'Support lookups'); await page.getByRole('textbox', { name: 'Find orders' }).fill(order.number); await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('link', { name: order.number }).click(); await expect(page.getByText('J*** B***').first()).toBeVisible(); await shot(page, 'lookup-masked', view)
    await page.getByRole('button', { name: 'Reveal personal data' }).click(); await page.getByLabel('Reason, with the ticket reference').fill('Ticket 8812: buyer asks about a missing parcel')
    await shot(page, 'reveal-dialog', view)
    await page.getByRole('dialog').getByRole('button', { name: 'Reveal' }).click(); await expect(page.getByText('Personal data is shown. This view was recorded in the audit log.')).toBeVisible(); await shot(page, 'lookup-revealed', view)

    await nav(page, 'Integrations'); await page.getByRole('button', { name: new RegExp(`Details for order.accepted ${dead.aggregate}`) }).click(); await expect(page.locator('pre.adm-pre')).toBeVisible(); await shot(page, 'integrations', view)
    await nav(page, 'Audit log'); await expect(page.getByRole('rowheader').first()).toBeVisible(); await shot(page, 'audit', view)
    await nav(page, 'Platform settings'); await expect(page.getByText('Marketplace fee')).toBeVisible(); await shot(page, 'settings', view)
    await page.getByRole('heading', { name: 'Branching preview' }).scrollIntoViewIfNeeded(); await shot(page, 'settings-fields', view)
    await nav(page, 'Staff'); await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible(); await shot(page, 'staff', view)
    await page.getByRole('button', { name: 'Sign out' }).click(); await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible()
  }
})
