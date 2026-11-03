import { test, expect, createSeller, expectNoSeriousA11y, uiLogin, dismissPasskeyOffer, PASSWORD } from './helpers'
import { bearer, product, seller, tokenFor } from './ordersKit'
import { apiLogin, apiStepUp, insertDeadLetter, placeOrder, signedPost, staffMember, superAdmin, uiStaffLogin } from './adminKit'
import { makePng } from './png'

const business = { vendorName: 'Acme Kosher Bakery', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false }

/** A seller who finished the wizard WITH a kosher certificate and waits for review. */
async function applicant(request: import('@playwright/test').APIRequestContext) {
  const s = await createSeller(request)
  const token = await tokenFor(request, s.email)
  const h = bearer(token)
  expect((await request.put('/api/v1/seller/application/business', { data: business, headers: h })).ok()).toBeTruthy()
  const k = await request.put('/api/v1/seller/application/kosher', { headers: h, data: { answers: { sells_food: 'yes', food_types: 'Bakery', is_kosher: 'yes', kosher_agency: 'OU' } } })
  expect(k.ok(), await k.text()).toBeTruthy()
  const up = await request.post('/api/v1/seller/application/kosher/certificate', { headers: h, multipart: { file: { name: 'certificate.png', mimeType: 'image/png', buffer: makePng(600, 400) } } })
  expect(up.ok(), await up.text()).toBeTruthy()
  const sub = await request.post('/api/v1/seller/application/submit', { headers: h, data: { acceptSellerAgreement: true } })
  expect(sub.ok(), await sub.text()).toBeTruthy()
  return s
}

test('staff signs in with two-factor, reviews an application with its certificate and approves it; the seller sees Approved', async ({ page, request }) => {
  const s = await applicant(request)
  const mod = await staffMember(request, 'Moderator')

  await page.goto('/admin')                                            // not signed in: sent to the staff sign-in
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByLabel('Email').fill(mod.email)
  await page.getByLabel('Password', { exact: true }).fill('Wrong-Passw0rd-Test!x')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Sign-in failed. Check your email and password.')).toBeVisible()   // one generic message
  await uiStaffLogin(page, mod)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expectNoSeriousA11y(page)

  await page.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name: 'Applications', exact: true }).click()
  await page.getByLabel('Search business or email').fill(s.email)
  await page.getByRole('link', { name: 'Acme Kosher Bakery' }).click()
  await expect(page.getByRole('heading', { name: 'Acme Kosher Bakery', level: 1 })).toBeVisible()
  await expect(page.getByText('Kosher certifying agency')).toBeVisible()
  await expect(page.locator('dd', { hasText: /^OU$/ })).toBeVisible()
  await expect(page.getByText('2026-01').first()).toBeVisible()                                  // terms / agreement versions
  const cert = page.getByRole('img', { name: 'Uploaded certificate certificate.png' })
  await expect(cert).toBeVisible()
  await expect.poll(() => cert.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)   // the real file came through the API with the staff token
  await expectNoSeriousA11y(page)

  await page.getByRole('button', { name: 'Approve' }).click()
  const dlg = page.getByRole('dialog', { name: 'Approve this application' })
  await dlg.getByRole('button', { name: 'Approve' }).click()
  await expect(dlg.getByText('Write at least 5 characters.')).toBeVisible()                      // a reason is required
  await dlg.getByLabel('Reason (internal, kept in the audit log)').fill('Certificate checked with the OU')
  await dlg.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Application approved.')).toBeVisible()

  // the seller signs in and is Approved (lands in the catalog)
  const sellerPage = await page.context().newPage()
  await sellerPage.route('**/config.json', (route) => route.fulfill({ json: { idleTimeoutMinutes: 15, warningSeconds: 60, refreshIntervalMinutes: 5, turnstileSiteKey: 'stub', features: { apple: false } } }))
  await sellerPage.goto('/login'); await uiLogin(sellerPage, s.email, PASSWORD); await dismissPasskeyOffer(sellerPage)
  await expect(sellerPage).toHaveURL(/\/products/)
  const status = await (await request.get('/api/v1/seller/application', { headers: bearer(await tokenFor(request, s.email)) })).json()
  expect(status.status).toBe('Approved')
})

test('a Support member cannot reach Super-admin pages, in the menu or by URL', async ({ page, request }) => {
  const support = await staffMember(request, 'Support')
  await uiStaffLogin(page, support)
  const nav = page.getByRole('navigation', { name: 'Staff areas' })
  await expect(nav.getByRole('link', { name: 'Support lookups' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0)
  await page.goto('/admin/login')                                                               // a reload loses the in-memory staff token on purpose
  await uiStaffLogin(page, support)
  await page.getByRole('link', { name: 'Platform settings' }).click()
  await expect(page.getByRole('heading', { name: 'Platform settings' })).toBeVisible()
  await expect(page.getByLabel('Fee in basis points (100 = 1%)')).toHaveCount(0)                  // read-only for Support
  await expect(page.getByRole('button', { name: 'Save questions' })).toHaveCount(0)
  // typing the URL of the Staff page: the app reloads, the in-memory session is gone, so sign in again and try to open it
  await uiStaffLogin(page, support, '/admin/login')
  await page.evaluate(() => { history.pushState({}, '', '/admin/staff'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.getByRole('heading', { name: 'You don’t have access to this page' })).toBeVisible()
  await expectNoSeriousA11y(page)
  // and the server refuses too, whatever the UI shows
  const token = await apiLogin(request, support)
  expect((await request.get('/api/v1/admin/staff', { headers: bearer(token) })).status()).toBe(403)
  expect((await request.get('/api/v1/admin/settings', { headers: bearer(token) })).status()).toBe(200)
  expect((await request.put('/api/v1/admin/settings/fee', { headers: bearer(token), data: { feeBasisPoints: 100, reason: 'try' } })).status()).toBe(403)
})

test('a seller token is refused by the admin API and a staff token by the seller API', async ({ request }) => {
  const s = await seller(request)
  expect((await request.get('/api/v1/admin/dashboard', { headers: bearer(s.token) })).status()).toBe(403)
  const ro = await staffMember(request, 'ReadOnly')
  const token = await apiLogin(request, ro)
  expect((await request.get('/api/v1/admin/dashboard', { headers: bearer(token) })).status()).toBe(200)
  expect((await request.get('/api/v1/seller/products', { headers: bearer(token) })).status()).toBe(401)
})

test('a moderator hides a reported listing; the seller sees the reason and cannot reactivate it', async ({ page, request }) => {
  const s = await seller(request)
  const productId = await product(request, s.token, 'Designer-brand mug (fake)')
  const rep = await signedPost(request, `/api/internal/v1/listings/${productId}/reports`, { reason: 'Counterfeit item reported by a buyer' })
  expect(rep.status(), await rep.text()).toBe(200)
  const mod = await staffMember(request, 'Moderator')
  await uiStaffLogin(page, mod)
  await page.getByRole('link', { name: 'Moderation' }).click()
  await page.getByRole('link', { name: 'Reported listing' }).first().click()
  await expect(page.getByRole('heading', { name: 'Reported listing', level: 1 })).toBeVisible()
  await expect(page.getByText('Counterfeit item reported by a buyer').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Listing (read-only)' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Hide listing' }).click()
  const dlg = page.getByRole('dialog', { name: 'Hide this listing' })
  await dlg.getByLabel('Reason (shown to the seller)').fill('Counterfeit brand name in the title')
  await dlg.getByRole('button', { name: 'Hide listing' }).click()
  await expect(page.getByRole('button', { name: 'Unhide listing' })).toBeVisible()
  const doc = await (await request.get(`/api/v1/seller/products/${productId}`, { headers: bearer(s.token) })).json()
  expect(doc.status).toBe('Inactive')
  expect(doc.moderation).toMatchObject({ hidden: true, reason: 'Counterfeit brand name in the title' })
  const again = await request.post(`/api/v1/seller/products/${productId}/status`, { headers: bearer(s.token), data: { status: 'active' } })
  expect(again.status()).toBe(409)
})

test('support retries a dead-lettered event with a reason; it shows in the audit log', async ({ page, request }) => {
  const dead = insertDeadLetter()
  const support = await staffMember(request, 'Support')
  await uiStaffLogin(page, support)
  await page.getByRole('link', { name: 'Integrations' }).click()
  await expect(page.getByRole('heading', { name: 'Integration health' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`Details for order.accepted ${dead.aggregate}`) }).click()
  const preview = page.locator('pre.adm-pre')
  await expect(preview).toContainText('[redacted]')
  await expect(preview).not.toContainText('jane@example.com')                                      // the payload preview is redacted by the server
  await expect(preview).not.toContainText('1 Main St')
  await expect(page.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0)                       // Support may retry, not discard
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Retry delivery' }).click()
  const dlg = page.getByRole('dialog', { name: 'Retry this event' })
  await dlg.getByLabel('Reason (kept in the audit log)').fill('Marketplace endpoint is back')
  await dlg.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('The event is queued again.')).toBeVisible()
  const token = await apiLogin(request, support)
  const pending = await (await request.get('/api/v1/admin/integrations/outbox?status=pending&pageSize=100', { headers: bearer(token) })).json()
  expect(pending.items.map((i: { id: string }) => i.id.toUpperCase())).toContain(dead.id)

  // a Super admin finds the action in the audit log with filters
  const sa = await superAdmin(request)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await uiStaffLogin(page, sa)
  await page.getByRole('link', { name: 'Audit log' }).click()
  await page.getByLabel('Action').fill('outbox.retried')
  await page.getByLabel('Staff actions only').check()
  await page.getByRole('button', { name: 'Apply filters' }).click()
  const row = page.getByRole('row', { name: /admin\.outbox\.retried/ }).filter({ hasText: 'Marketplace endpoint is back' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('Support')
  await page.getByLabel('Action').fill('no.such.action')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page.getByText('No events match these filters.')).toBeVisible()
  await expectNoSeriousA11y(page)
})

test('personal data is masked in support lookups; reveal needs a reason and is audited', async ({ page, request }) => {
  const s = await seller(request)
  const productId = await product(request, s.token, 'Lookup mug')
  const order = await placeOrder(request, { sellerId: s.sellerId, h: bearer(s.token) }, productId)
  const support = await staffMember(request, 'Support')
  await uiStaffLogin(page, support)
  await page.getByRole('link', { name: 'Support lookups' }).click()
  await page.getByRole('textbox', { name: 'Find orders' }).fill(order.number)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('link', { name: order.number }).click()
  await expect(page.getByText('Buyer name').locator('xpath=following-sibling::dd')).toHaveText('J*** B***')
  await expect(page.getByText('Jane Buyer')).toHaveCount(0)
  await expect(page.getByText(/1 Main St/)).toHaveCount(0)
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Reveal personal data' }).click()
  const dlg = page.getByRole('dialog', { name: 'Reveal personal data' })
  await dlg.getByRole('button', { name: 'Reveal' }).click()
  await expect(dlg.getByText('Write at least 5 characters.')).toBeVisible()
  await dlg.getByLabel('Reason, with the ticket reference').fill('Ticket 8812: buyer asks about a missing parcel')
  await dlg.getByRole('button', { name: 'Reveal' }).click()
  await expect(page.getByText('Personal data is shown. This view was recorded in the audit log.')).toBeVisible()
  await expect(page.getByText('Buyer name').locator('xpath=following-sibling::dd')).toHaveText('Jane Buyer')
  await expect(page.getByText(/1 Main St/)).toBeVisible()
  // audited: who, the reason, never the values
  const sa = await superAdmin(request)
  const token = await apiLogin(request, sa)
  const audit = await (await request.get(`/api/v1/admin/audit?action=pii.revealed&target=${order.id}`, { headers: bearer(token) })).json()
  expect(audit.items).toHaveLength(1)
  expect(audit.items[0]).toMatchObject({ actorRole: 'Support', targetType: 'order', reason: 'Ticket 8812: buyer asks about a missing parcel' })
  expect(JSON.stringify(audit.items[0])).not.toContain('Jane')
})

test('closing an account asks for the authenticator code again (step-up) and signs the seller out', async ({ page, request }) => {
  const s = await seller(request)
  const sa = await staffMember(request, 'SuperAdmin')
  await uiStaffLogin(page, sa)
  await page.getByRole('link', { name: 'Sellers' }).click()
  await page.getByLabel('Search').fill(s.sellerId)
  await page.getByRole('link', { name: 'Acme Co' }).click()
  await expect(page.getByRole('heading', { name: 'Acme Co', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Close account' }).click()
  const dlg = page.getByRole('dialog', { name: 'Close this account' })
  await dlg.getByLabel('Reason (kept in the audit log)').fill('Owner asked for closure by phone')
  await dlg.getByRole('button', { name: 'Close account' }).click()
  const step = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await expect(step).toBeVisible()
  await step.getByLabel('Authenticator code').fill('000000')
  await step.getByRole('button', { name: 'Confirm' }).click()
  await expect(step.getByText('That code isn’t right.')).toBeVisible()
  await step.getByLabel('Authenticator code').fill((await import('./adminKit')).totp(sa.secret))
  await step.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('Account closed.')).toBeVisible()
  expect((await request.get('/api/v1/seller/products', { headers: bearer(s.token) })).status()).toBe(401)   // the seller's sessions ended
})

test('staff management: a Super admin invites, the invitee accepts and sets up two-factor in the browser', async ({ page, request }) => {
  const sa = await staffMember(request, 'SuperAdmin')
  await uiStaffLogin(page, sa)
  await page.getByRole('link', { name: 'Staff', exact: true }).click()
  await page.getByRole('button', { name: 'Invite staff member' }).click()
  const email = `invitee-${Date.now()}@example.com`
  const dlg = page.getByRole('dialog', { name: 'Invite a staff member' })
  await dlg.getByLabel('Email').fill(email)
  await dlg.getByLabel('Role').selectOption('Moderator')
  await dlg.getByLabel('Reason (kept in the audit log)').fill('New trust and safety hire')
  await dlg.getByRole('button', { name: 'Send invitation' }).click()
  const step = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await step.getByLabel('Authenticator code').fill((await import('./adminKit')).totp(sa.secret))
  await step.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByText('Invitation sent.')).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(email) })).toBeVisible()
  await expectNoSeriousA11y(page)

  // the invitee, in a fresh browser context, opens the emailed link
  let text = ''
  await expect.poll(async () => { const r = await request.get(`/api/test/emails?to=${encodeURIComponent(email)}&kind=staff-invite`); const l = (await r.json()) as { Text?: string; text?: string }[]; text = l.at(-1)?.Text ?? l.at(-1)?.text ?? ''; return text }).not.toBe('')
  const link = /(https?:\/\/[^\s]+\/admin\/accept-invite\?[^\s]+)/.exec(text)![1]
  const other = await page.context().browser()!.newContext(); const p2 = await other.newPage()
  await p2.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:5173'))
  await expect(p2.getByRole('heading', { name: 'Join the Solvelt staff team' })).toBeVisible()
  await p2.getByLabel('Password').fill('Invitee-Passw0rd-Test!x')
  await p2.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(p2.getByText(/Your staff account is ready/)).toBeVisible()
  await p2.getByLabel('Password', { exact: true }).fill('Invitee-Passw0rd-Test!x')
  await p2.getByRole('button', { name: 'Continue' }).click()
  await expect(p2.getByRole('heading', { name: 'Set up two-factor authentication' })).toBeVisible()   // no access without a second factor
  await p2.getByRole('button', { name: 'Show my setup code' }).click()
  const key = (await p2.locator('code.adm-key').textContent())!
  const { totp } = await import('./adminKit')
  await p2.getByLabel('Code from the app').fill(totp(key))
  await p2.getByRole('button', { name: 'Turn on two-factor' }).click()
  await expect(p2.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10)
  await p2.getByRole('button', { name: /I saved them/ }).click()
  await p2.getByLabel('Authenticator code').fill(totp(key))
  await p2.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(p2.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(p2.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name: 'Moderation' })).toBeVisible()
  await other.close()
})

test('accessibility sweep of every admin page (light and dark) for a Super admin', async ({ page, request }) => {
  test.setTimeout(180_000)
  const sa = await staffMember(request, 'SuperAdmin')
  await uiStaffLogin(page, sa)
  const pages: [string, string][] = [['Dashboard', 'Dashboard'], ['Applications', 'Seller applications'], ['Sellers', 'Seller accounts'], ['Users', 'Users'], ['Moderation', 'Moderation'],
    ['Support lookups', 'Support lookups'], ['Integrations', 'Integration health'], ['Audit log', 'Audit log'], ['Platform settings', 'Platform settings'], ['Staff', 'Staff']]
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.evaluate((s) => { document.documentElement.dataset.theme = s }, scheme)
    for (const [link, heading] of pages) {
      await page.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name: link, exact: true }).click()
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
      await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
      await expectNoSeriousA11y(page)
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })                                         // phone width: no horizontal page scroll
  for (const [link, heading] of pages) {
    await page.getByRole('navigation', { name: 'Staff areas' }).getByRole('link', { name: link, exact: true }).click()
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${heading} scrolls horizontally on a phone`).toBe(true)
  }
  await apiStepUp(request, await apiLogin(request, sa), sa)
})
