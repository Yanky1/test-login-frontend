import { randomUUID } from 'node:crypto'
import { expect, expectNoSeriousA11y, test } from './helpers'
import { bearer, orderAction, product, seller, signIn, simulate, upsNumber } from './ordersKit'
import { signedPost, superAdmin, totp, uiStaffLogin } from './adminKit'

/** C19: a phone order paid through Sola, end to end against the real backend (signed marketplace events, no Sola or Stripe call). */
test('Sola phone order: provider labels for the seller, no Stripe respond button, and the staff Sola treasury with a recorded funding (axe)', async ({ page, request }) => {
  test.setTimeout(180_000)
  const s = await seller(request)
  await product(request, s.token, 'Phone order mug')
  const [o] = await simulate(request, s.token, 'single')
  await orderAction(request, s.token, o.id, 'accept')
  await orderAction(request, s.token, o.id, 'ship', { carrier: 'UPS', trackingNumber: upsNumber() })
  await orderAction(request, s.token, o.id, 'deliver')
  const detail = await (await request.get(`/api/v1/seller/orders/${o.id}`, { headers: bearer(s.token) })).json()
  const mid = detail.marketplaceOrderId as string
  const xRef = String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0')

  // the marketplace reports a verified Sola approval
  const cap = await signedPost(request, '/api/internal/v1/payment-events', { eventId: 'sola-cap-' + xRef, type: 'payment.captured',
    data: { kind: 'order', provider: 'sola', marketplaceOrderId: mid, sellerOrderNumber: o.number, paymentRef: xRef, currency: 'USD' } })
  expect(cap.status(), await cap.text()).toBe(200)

  await signIn(page, s.email, `/orders/${o.id}`)
  await expect(page.getByTestId('paid-with')).toContainText('Phone order (Sola)')
  await page.goto('/payments?tab=transactions')
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: o.number }) })
  await expect(row.getByText('Phone order (Sola)')).toBeVisible()
  await expectNoSeriousA11y(page)

  // a Sola chargeback: the seller sees it, debited, but there is nothing to answer in Stripe
  const cb = 'CB-' + randomUUID().slice(0, 8)
  const dp = await signedPost(request, '/api/internal/v1/payment-events', { eventId: 'sola-cb-' + cb, type: 'dispute.created',
    data: { provider: 'sola', disputeId: cb, marketplaceOrderId: mid, sellerOrderNumber: o.number, amountCents: 1000, feeCents: 1500, status: 'needs_response' } })
  expect(dp.status(), await dp.text()).toBe(200)
  await page.goto('/payments?tab=disputes')
  await expect(page.getByRole('cell', { name: 'Handled by Solvelt' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Respond in Stripe/i })).toHaveCount(0)
  await expect(page.getByText(/answered by Solvelt/)).toBeVisible()
  await expectNoSeriousA11y(page)

  // staff: the Sola treasury tab, and a funding recorded with the step-up (the figures are shared by every spec, so only the new row is checked)
  const sa = await superAdmin(request)
  await uiStaffLogin(page, sa, '/admin/payments/sola')
  await expect(page.getByRole('heading', { name: 'Sola treasury' })).toBeVisible()
  await expectNoSeriousA11y(page)
  const ref = 'E2E-SOLA-' + randomUUID().slice(0, 8)
  await page.getByRole('button', { name: 'Record a funding' }).click()
  const dlg = page.getByRole('dialog', { name: 'Record money moved from Sola to Stripe' })
  await dlg.getByLabel('Amount in minor units (cents)').fill('100')
  await dlg.getByLabel('Currency (ISO code)').fill('USD')
  await dlg.getByLabel('Bank or Sola batch reference').fill(ref)
  await dlg.getByLabel(/^Note/).fill('E2E: weekly move from Sola')
  await expectNoSeriousA11y(page)
  await dlg.getByRole('button', { name: 'Record the funding' }).click()
  const step = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await expect(step).toBeVisible()
  await step.getByLabel('Authenticator code').fill(totp(sa.secret))
  await step.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('The funding was recorded.')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Recorded fundings' }).getByText(ref)).toBeVisible()
})
