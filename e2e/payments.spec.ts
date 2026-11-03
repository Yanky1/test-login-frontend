import { expect, expectNoSeriousA11y, test } from './helpers'
import { bearer, mgr, orderAction, product, seller, signIn, simulate } from './ordersKit'

const money = (c: number) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

test('payments: onboarding, order -> delivery -> release -> transfer, refund reduces the balance, statement CSV (axe on every screen)', async ({ page, request }) => {
  test.setTimeout(180_000)
  const s = await seller(request)
  await product(request, s.token, 'Payments mug')
  const [o] = await simulate(request, s.token, 'single')
  await orderAction(request, s.token, o.id, 'accept')
  await orderAction(request, s.token, o.id, 'ship', { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' })
  await orderAction(request, s.token, o.id, 'deliver')
  const net = ((await (await request.get(`/api/v1/seller/orders/${o.id}`, { headers: bearer(s.token) })).json()).money.netCents) as number
  expect(net).toBeGreaterThan(0)

  // ---- onboarding states
  await signIn(page, s.email, '/payments')
  await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible()
  await expect(page.getByText('Not set up')).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.route('https://connect.fake-stripe.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe</title>hosted setup' }))
  await page.getByRole('button', { name: 'Set up payouts' }).click()
  await expect(page).toHaveURL(/connect\.fake-stripe\.test\/setup\/acct_fake_/)
  await page.goto('/payments?onboarding=return')
  await expect(page.getByText('Setup in progress').or(page.getByText('Action needed'))).toBeVisible()
  expect((await request.post(`/api/dev/payments/complete-onboarding/${s.sellerId}`)).ok()).toBeTruthy()
  await page.goto('/payments')
  await expect(page.getByText('Active')).toBeVisible()
  await expect(page.getByText(/ending in 4242/)).toBeVisible()
  await expectNoSeriousA11y(page)

  // ---- simulated order -> payment captured -> delivery aged -> release -> transfer
  expect((await request.post(`/api/dev/payments/capture/${o.id}`)).ok()).toBeTruthy()
  await page.goto('/payments')
  await expect(page.getByTestId('bal-pending')).toHaveText(money(net))
  await expect(page.getByTestId('bal-available')).toHaveText('$0.00')
  expect((await request.post(`/api/dev/payments/age-order/${o.id}`)).ok()).toBeTruthy()
  const run = await request.post('/api/dev/payments/run')
  expect(run.ok()).toBeTruthy()
  await page.goto('/payments')
  await expect(page.getByTestId('bal-pending')).toHaveText('$0.00')
  await expect(page.getByTestId('bal-transit')).toHaveText(money(net))

  await page.getByRole('tab', { name: 'Transactions' }).click()
  await expect(page.getByRole('link', { name: o.number }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Transfer to Stripe', exact: true })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByLabel('Type').selectOption('sale')
  await expect(page.getByRole('cell', { name: 'Transfer to Stripe', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: o.number }).first().click()
  await expect(page).toHaveURL(new RegExp(`/orders/${o.id}`))

  await page.goto('/payments?tab=transfers')
  await expect(page.getByRole('table', { name: 'Transfers' }).getByText('sent')).toBeVisible()
  await expectNoSeriousA11y(page)

  // ---- a refund after the money left reduces the balance (negative until recovered)
  const refund = await request.post(`/api/dev/payments/refund/${o.id}`, { data: { amountCents: 500 } })
  expect(refund.ok(), await refund.text()).toBeTruthy()
  await page.goto('/payments')
  await expect(page.getByText(/balance is negative/i)).toBeVisible()
  await expect(page.getByTestId('bal-available')).not.toHaveText('$0.00')
  await page.goto('/payments?tab=transactions')
  await page.getByLabel('Type').selectOption('refund')
  await expect(page.getByRole('cell', { name: 'Refund', exact: true })).toBeVisible()

  // ---- statement + CSV
  await page.goto('/payments?tab=statements')
  await expect(page.getByRole('table', { name: /statement/ })).toBeVisible()
  await expectNoSeriousA11y(page)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  expect(dl.suggestedFilename()).toMatch(/^statement-\d{4}-\d{2}\.csv$/)

  await page.goto('/payments?tab=disputes')
  await expect(page.getByText(/No disputes/)).toBeVisible()
})

test('payments: a Manager sees no Payments in the menu and the API refuses them; an Admin can read but not start onboarding', async ({ page, request }) => {
  const s = await seller(request)
  const manager = await mgr(request, s.token, 'Manager')
  const admin = await mgr(request, s.token, 'Admin')
  await signIn(page, manager, '/orders')
  await expect(page.getByRole('navigation', { name: 'Seller' }).getByRole('link', { name: 'Orders' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Seller' }).getByRole('link', { name: 'Payments' })).toHaveCount(0)
  const mt = (await (await request.post('/api/v1/auth/login', { data: { email: manager, password: 'Tr1cky-Horse-Battery!' } })).json()).accessToken as string
  expect((await request.get('/api/v1/seller/payments/summary', { headers: bearer(mt) })).status()).toBe(403)

  await page.context().clearCookies()
  await signIn(page, admin, '/payments')
  await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible()
  await expect(page.getByText(/only the account owner/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /set up payouts/i })).toHaveCount(0)
})
