import { test, expect, expectNoSeriousA11y } from './helpers'
import { bearer, product, seller } from './ordersKit'
import { signedPost, staffMember, totp, uiStaffLogin } from './adminKit'
import type { Page } from '@playwright/test'

// Real backend (Demo__Enabled=true): a Super admin signs in with two-factor and uses the staff tools for payments, shipping, local delivery and moderation.
const nav = (p: Page, name: string) => p.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name, exact: true }).click()
const reason = (p: Page, text: string) => p.getByRole('dialog').getByLabel(/^(Reason|Warning text)/).fill(text)

test('Super admin opens a seller’s payments, shipping and delivery tabs, holds and releases payouts, adjusts the balance (step-up); axe on every page', async ({ page, request }) => {
  test.setTimeout(180_000)
  const s = await seller(request)
  const h = bearer(s.token)
  const fill = await request.post('/api/v1/seller/demo-data', { headers: h, data: {} })
  expect([201, 409]).toContain(fill.status())                      // demo data gives the seller orders, shipments and deliveries to look at
  const sa = await staffMember(request, 'SuperAdmin')

  await uiStaffLogin(page, sa)
  await nav(page, 'Sellers')
  await page.getByLabel('Search').fill(s.sellerId)
  await expect(page.getByRole('link', { name: 'Acme Co' })).toHaveCount(1)          // the search has narrowed the list to this seller
  await page.getByRole('link', { name: 'Acme Co' }).click()
  const tabs = page.getByRole('tablist', { name: 'Seller areas' })
  await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Payments', 'Shipping', 'Local delivery'])
  await expectNoSeriousA11y(page)

  // payments tab: hold, then release
  await tabs.getByRole('tab', { name: 'Payments' }).click()
  await expect(page.getByRole('heading', { name: 'Balances' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Place payout hold' }).click()
  const dlg = page.getByRole('dialog', { name: 'Hold this seller’s payouts' })
  await expectNoSeriousA11y(page)
  await dlg.getByRole('button', { name: 'Place hold' }).click()
  await expect(dlg.getByText('Write at least 5 characters.')).toBeVisible()        // the confirm dialog needs a reason
  await reason(page, 'E2E: chargeback risk')
  await dlg.getByRole('button', { name: 'Place hold' }).click()
  await expect(page.getByText('Payouts are on hold.')).toBeVisible()
  await expect(page.getByText(/On hold since/)).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Release hold' }).click()
  await reason(page, 'E2E: checked with the seller')
  await page.getByRole('dialog').getByRole('button', { name: 'Release hold' }).click()
  await expect(page.getByText('The payout hold was released.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Place payout hold' })).toBeVisible()

  // a manual adjustment needs a step-up: the API answers step_up_required, the panel asks for the authenticator code, then the write is retried
  await page.getByRole('button', { name: 'Adjust balance' }).click()
  const adj = page.getByRole('dialog', { name: 'Manual balance adjustment' })
  await adj.getByLabel('Currency (ISO code)').fill('USD')
  await adj.getByLabel('Amount in minor units (cents)').fill('2500')
  await reason(page, 'E2E: goodwill credit')
  await adj.getByRole('button', { name: 'Credit the seller' }).click()
  const step = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await expect(step).toBeVisible()
  await step.getByLabel('Authenticator code').fill(totp(sa.secret))
  await step.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('The adjustment was recorded.')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Ledger entries' }).getByRole('rowheader', { name: 'adjustment' })).toBeVisible()  // the ledger shows it

  // shipping and delivery tabs
  await tabs.getByRole('tab', { name: 'Shipping' }).click()
  await expect(page.getByRole('heading', { name: 'Shipments' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await tabs.getByRole('tab', { name: 'Local delivery' }).click()
  await expect(page.getByRole('heading', { name: 'Delivery settings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent deliveries' })).toBeVisible()
  await expectNoSeriousA11y(page)
  const access = page.getByRole('button', { name: 'Access proof' }).first()
  if (await access.count()) {                                                  // proof of delivery: break-glass, nothing shown before the reveal
    await expect(page.getByRole('img')).toHaveCount(0)
    await access.click()
    await expectNoSeriousA11y(page)
    await reason(page, 'E2E ticket 1: proof check')
    await page.getByRole('dialog').getByRole('button', { name: 'Reveal proof' }).click()
    await expect(page.getByRole('heading', { name: /Proof of delivery for/ })).toBeVisible()
    await expectNoSeriousA11y(page)
    await page.getByRole('button', { name: 'Hide proof' }).click()
    await expect(page.getByRole('heading', { name: /Proof of delivery for/ })).toHaveCount(0)
  }

  // platform-wide lists
  await nav(page, 'Payments')
  for (const t of ['Transfers', 'Payouts', 'Accounts past due', 'Reconciliation', 'Unallocated disputes']) {
    await page.getByRole('tab', { name: t }).click()
    await expect(page.getByRole('heading', { name: t === 'Accounts past due' ? 'Accounts with requirements past due' : /./, level: 2 }).first()).toBeVisible()
    await expectNoSeriousA11y(page)
  }
  await nav(page, 'Shipping')
  for (const t of ['Label refunds', 'Exceptions', 'Webhook failures']) {
    await page.getByRole('tab', { name: t }).click()
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
    await expectNoSeriousA11y(page)
  }
})

test('Super admin decides a reported listing with hide-content and the listing is hidden', async ({ page, request }) => {
  test.setTimeout(120_000)
  const s = await seller(request)
  const mug = await product(request, s.token, 'Designer-brand mug (looks fake)')
  const rep = await signedPost(request, `/api/internal/v1/listings/${mug}/reports`, { reason: 'Counterfeit item reported by a buyer' })
  expect(rep.status()).toBe(200)
  const sa = await staffMember(request, 'SuperAdmin')
  await uiStaffLogin(page, sa)
  await nav(page, 'Moderation')
  await expect(page.getByRole('heading', { name: 'Moderation', level: 1 })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('link', { name: 'Reported listing' }).first().click()
  await expect(page.getByRole('heading', { name: 'Reported listing', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Warn seller' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove content' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Hide content' }).first().click()
  const dlg = page.getByRole('dialog', { name: 'Hide the reported content' })
  await expectNoSeriousA11y(page)
  await reason(page, 'E2E: counterfeit confirmed')
  await dlg.getByLabel(/Message for the person who reported it/).fill('Thank you, we hid the listing.')
  await dlg.getByRole('button', { name: 'Hide content' }).click()
  await expect(page.getByText('The content was hidden.')).toBeVisible()
  await expect(page.getByText(/Resolved: hidden/)).toBeVisible()
  await expectNoSeriousA11y(page)
  // the listing is hidden by staff on the seller's side too
  const detail = await (await request.get(`/api/v1/seller/products/${mug}`, { headers: bearer(s.token) })).json()
  expect(JSON.stringify(detail)).toMatch(/hidden|moderat/i)
})

test('the new staff pages pass axe in dark mode too', async ({ page, request }) => {
  test.setTimeout(150_000)
  await page.emulateMedia({ colorScheme: 'dark' })
  const s = await seller(request)
  const mug = await product(request, s.token, 'Dark-mode mug')
  await signedPost(request, `/api/internal/v1/listings/${mug}/reports`, { reason: 'Reported for the dark-mode check' })
  const sa = await staffMember(request, 'SuperAdmin')
  await uiStaffLogin(page, sa)
  await nav(page, 'Sellers')
  await page.getByLabel('Search').fill(s.sellerId)
  await expect(page.getByRole('link', { name: 'Acme Co' })).toHaveCount(1)
  await page.getByRole('link', { name: 'Acme Co' }).click()
  const tabs = page.getByRole('tablist', { name: 'Seller areas' })
  for (const [tab, heading] of [['Payments', 'Balances'], ['Shipping', 'Shipments'], ['Local delivery', 'Delivery settings']] as const) {
    await tabs.getByRole('tab', { name: tab }).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expectNoSeriousA11y(page)
  }
  await tabs.getByRole('tab', { name: 'Payments' }).click()
  await page.getByRole('button', { name: 'Adjust balance' }).click()
  await expect(page.getByRole('dialog', { name: 'Manual balance adjustment' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.keyboard.press('Escape')
  await nav(page, 'Payments'); await expect(page.getByRole('heading', { name: 'Transfers to sellers' })).toBeVisible(); await expectNoSeriousA11y(page)
  await nav(page, 'Shipping'); await expect(page.getByRole('heading', { name: 'Label refunds that are not finished' })).toBeVisible(); await expectNoSeriousA11y(page)
  await nav(page, 'Moderation')
  await page.getByRole('link', { name: 'Reported listing' }).first().click()
  await expect(page.getByRole('heading', { name: 'Reported listing', level: 1 })).toBeVisible()
  await expectNoSeriousA11y(page)
  // leave no open report behind: other specs read the oldest open report of the shared e2e database
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await reason(page, 'E2E cleanup')
  await page.getByRole('dialog').getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByText('Report dismissed.')).toBeVisible()
})
