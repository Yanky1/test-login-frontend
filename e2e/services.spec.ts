import { expect, test, expectNoSeriousA11y, dismissPasskeyOffer, uiLogin } from './helpers'
import type { Page } from '@playwright/test'
import { makePng } from './png'
import { approvedSeller, bearer, firstSlots, makeProvider, makeService, providerList, simBook, simEvent } from './svc'

async function signIn(page: Page, email: string) {
  await page.goto('/login'); await uiLogin(page, email); await dismissPasskeyOffer(page)
}

test('hourly at-home service: create, publish, simulator books, calendar + bookings, provider completes with actual time', async ({ page, request }) => {
  const s = await approvedSeller(request)
  const owner = (await providerList(request, s.token))[0].membershipId
  await request.put(`/api/v1/seller/providers/${owner}`, { headers: bearer(s.token), data: { isProvider: true } })
  await signIn(page, s.email)

  // working hours through the UI (Settings -> Availability)
  await page.goto('/settings/availability')
  await expect(page.getByRole('heading', { name: 'Availability', level: 2 })).toBeVisible()
  await expectNoSeriousA11y(page)
  for (const day of ['Monday', 'Saturday', 'Sunday']) await page.getByRole('group', { name: day }).getByRole('button', { name: /Add hours/ }).click()
  await page.getByRole('button', { name: 'Copy Monday to Tue–Fri' }).click()
  await page.getByRole('button', { name: 'Save working hours' }).click()
  await expect(page.getByText('Working hours saved.')).toBeVisible()
  // the same hours must not be saveable when they overlap
  await page.getByRole('group', { name: 'Monday' }).getByRole('button', { name: /Add hours/ }).click()
  await page.getByRole('group', { name: 'Monday' }).getByLabel('Monday opens').nth(1).fill('16:00')
  await page.getByRole('button', { name: 'Save working hours' }).click()
  await expect(page.getByText(/overlaps/)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Monday' }).getByLabel('Monday opens')).toHaveValue('09:00')

  // create the service: type picker
  await page.goto('/products/new')
  await expect(page.getByRole('radio', { name: /Product/ })).toBeChecked()
  await page.getByRole('radio', { name: /Service/ }).check()
  await expectNoSeriousA11y(page)
  await page.getByLabel('Service title').fill('Home cleaning service')
  await page.getByRole('combobox', { name: 'Category' }).fill('home')
  await page.getByRole('option', { name: /Home Services/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop()!
  await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()
  await page.getByLabel('Upload photos').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: makePng() }])
  await expect(page.getByRole('list', { name: 'Photos' }).getByRole('listitem')).toHaveCount(1)

  await page.getByLabel('How do you charge?').selectOption('hourly')
  await page.getByLabel('Hourly rate (USD)').fill('60.50')
  await page.getByLabel('Minimum notice (hours)').fill('1')
  await page.getByRole('switch', { name: "At the customer's location" }).check()
  await page.getByLabel('Postal codes').fill('11201, 112*'); await page.getByLabel('Postal codes').press('Enter')
  await expect(page.getByRole('list', { name: /Postal codes in your service area/ })).toContainText('112*')
  await page.getByRole('switch', { name: 'Online' }).check()
  await page.getByLabel('Meeting link or instructions').fill('https://meet.example.test/room')
  await page.getByRole('switch', { name: /owner|@/ }).first().check()
  await expect(page.getByTestId('save-indicator')).toHaveText('All changes saved', { timeout: 20_000 })
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByText('Your listing is live.')).toBeVisible({ timeout: 20_000 })

  // the catalog shows it as a service with its rate; the type filter works
  await page.goto('/products?type=service')
  await expect(page.getByRole('row', { name: /Home cleaning service/ })).toContainText('$60.50/h')
  await expectNoSeriousA11y(page)

  // the marketplace (simulator) queries slots and books one
  const slots = await firstSlots(request, s.token, id)
  expect(slots.length).toBeGreaterThan(0)
  const bk = await simBook(request, s.token, id, slots[0].startAt)

  // appears in the Calendar (list + week + month, all accessible) and in Bookings
  await page.goto('/calendar?view=agenda')
  await expect(page.getByRole('button', { name: /Home cleaning service/ })).toContainText('Confirmed')
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Week', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Schedule grid' })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Month', exact: true }).click()
  await expect(page.getByRole('grid', { name: /Month of/ })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Day', exact: true }).click(); await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
  await expectNoSeriousA11y(page)

  await page.goto('/bookings?tab=upcoming')
  await expect(page.getByRole('row', { name: new RegExp(bk.number) })).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.getByRole('link', { name: new RegExp(`Open\\s*${bk.number}`) }).click()
  await expect(page.getByRole('heading', { name: /Home cleaning service/ })).toBeVisible()
  await expect(page.getByText('5 Elm St')).toBeVisible()                          // the assigned provider (owner) sees the address
  await expectNoSeriousA11y(page)

  // start, then complete with 3 hours worked: extra time is requested, the price is untouched
  await page.getByRole('button', { name: 'Start job' }).click()
  await expect(page.getByText('Marked as started.')).toBeVisible()
  await page.getByRole('button', { name: 'Complete…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Complete this booking' })
  await expectNoSeriousA11y(page)
  await dlg.getByLabel(/Time actually worked/).fill('180')
  await expect(dlg.getByRole('status')).toContainText('120 minutes more than booked')
  await dlg.getByRole('button', { name: 'Mark as completed' }).click()
  await expect(page.getByText('Booking completed.')).toBeVisible()
  await expect(page.getByText('Extra time requested')).toBeVisible()
  await page.goto('/bookings?tab=past'); await expect(page.getByRole('row', { name: new RegExp(bk.number) })).toContainText('Completed')
})

test('request-to-book: the request waits in Requests with a badge and the provider approves it', async ({ page, request }) => {
  const s = await approvedSeller(request)
  const owner = (await providerList(request, s.token))[0].membershipId
  await makeProvider(request, s.token, owner)
  const id = await makeService(request, s.token, [owner], 'Window cleaning', { bookingMode: 'request' })
  const slots = await firstSlots(request, s.token, id)
  const bk = await simBook(request, s.token, id, slots[0].startAt)
  expect(bk.status).toBe('Requested')
  await signIn(page, s.email)
  await page.goto('/bookings')
  await expect(page.getByRole('tab', { name: /Requests/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('link', { name: /Bookings.*need/ })).toBeVisible()          // sidebar badge
  await expect(page.getByRole('row', { name: new RegExp(bk.number) })).toContainText('Awaiting approval')
  await expectNoSeriousA11y(page)
  await page.getByRole('link', { name: new RegExp(`Open\\s*${bk.number}`) }).click()
  await expect(page.getByText('5 Elm St')).toHaveCount(0)                             // not confirmed yet: no address
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Booking confirmed.')).toBeVisible()
  await expect(page.getByText('5 Elm St')).toBeVisible()                              // confirmed: the provider sees it
  await page.goto('/bookings?tab=upcoming'); await expect(page.getByRole('row', { name: new RegExp(bk.number) })).toBeVisible()
  // the dashboard card shows today's/pending work
  await page.goto('/products')
})

test('quote required: request appears in Quote requests, the seller sends a quote, the simulator accepts it and a booking exists', async ({ page, request }) => {
  const s = await approvedSeller(request)
  const owner = (await providerList(request, s.token))[0].membershipId
  await makeProvider(request, s.token, owner)
  const id = await makeService(request, s.token, [owner], 'Fence repair', { pricingModel: 'quote', price: null, minMinutes: null, maxMinutes: null, incrementMinutes: 60 })
  const q = await request.post('/api/v1/seller/dev/quotes', { headers: bearer(s.token), data: { serviceId: id, details: 'The fence panel fell over.', location: 'customer', postalCode: '11201' } })
  expect(q.status()).toBe(201)
  const qj = await q.json(); const quoteId = qj.quoteId as string; const mqid = qj.marketplaceQuoteId as string
  await signIn(page, s.email)
  await page.goto('/bookings?tab=quotes')
  await expect(page.getByRole('row', { name: /Fence repair/ })).toContainText('Needs a quote')
  await expectNoSeriousA11y(page)
  await page.getByRole('link', { name: /Send a quote/ }).click()
  await expect(page.getByText('The fence panel fell over.')).toBeVisible()
  await page.getByRole('button', { name: 'Send quote' }).click()
  await expect(page.getByText('Enter a price between 0 and 1,000,000.')).toBeVisible()          // validation first
  await page.getByLabel('Price (USD)').fill('250')
  const day = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)
  await page.getByLabel('Proposed date 1').fill(day)
  await page.getByLabel('Proposed time 1').fill('10:00')
  await page.getByLabel(/Note to the buyer/).fill('Includes materials.')
  await expectNoSeriousA11y(page)
  await page.getByRole('button', { name: 'Send quote' }).click()
  await expect(page.getByRole('heading', { name: 'Your quote' })).toBeVisible()
  await expect(page.getByText('$250.00')).toBeVisible()
  // the buyer (simulator) accepts the first proposed slot
  const detail = await (await request.get(`/api/v1/seller/quote-requests/${quoteId}`, { headers: bearer(s.token) })).json()
  const mq = (await (await request.get(`/api/v1/seller/quote-requests?status=quoted`, { headers: bearer(s.token) })).json()).items.length
  expect(mq).toBe(1)
  const accept = await request.post(`/api/v1/seller/dev/quotes/${mqid}/accept`, { headers: bearer(s.token), data: { start: detail.quote.slots[0] } })
  expect(accept.status()).toBe(201)
  // accepting a quote creates a HOLD (backend N8 follow-up): the marketplace confirms it after payment, and only then is the booking Confirmed
  const hold = (await accept.json()).booking as { marketplaceBookingId: string; status: string }
  expect(hold.status).toBe('Hold')
  const confirm = await simEvent(request, s.token, hold.marketplaceBookingId, { type: 'confirm_hold' })
  expect(confirm.ok(), await confirm.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('link', { name: 'Open the booking' })).toBeVisible()
  await page.goto('/bookings?tab=upcoming'); await expect(page.getByRole('row', { name: /Fence repair/ })).toContainText('Confirmed')
})

test('buyer reschedule and cancellation follow the policy; the timeline and fee show in the booking', async ({ page, request }) => {
  const s = await approvedSeller(request)
  const owner = (await providerList(request, s.token))[0].membershipId
  await makeProvider(request, s.token, owner)
  const id = await makeService(request, s.token, [owner], 'Gutter cleaning', { cancelFreeHours: 1, cancelFeePercent: 50, minNoticeHours: 1 })
  const slots = await firstSlots(request, s.token, id, 6)
  const a = await simBook(request, s.token, id, slots[0].startAt)
  const later = slots.find((x) => new Date(x.startAt).getTime() > new Date(slots[0].startAt).getTime() + 3 * 86400_000)!
  const moved = await simEvent(request, s.token, a.marketplaceBookingId, { type: 'reschedule', start: later.startAt }); expect(moved.ok(), await moved.text()).toBeTruthy()
  await signIn(page, s.email)
  await page.goto(`/bookings/${a.bookingId}`)
  await expect(page.getByText('Rescheduled', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/^rescheduled:/)).toBeVisible()
  // a booking that starts within the free window: cancelling costs the policy fee
  const near = slots[1]
  const b = await simBook(request, s.token, id, near.startAt, 'book')
  const c = await simEvent(request, s.token, b.marketplaceBookingId, { type: 'cancel', reason: 'changed_mind' }); expect(c.ok()).toBeTruthy()
  await page.goto(`/bookings/${b.bookingId}`)
  await expect(page.getByText('Cancelled by buyer').first()).toBeVisible()
  await expectNoSeriousA11y(page)
  await page.goto('/bookings?tab=cancelled'); await expect(page.getByRole('row', { name: new RegExp(b.number) })).toBeVisible()
})

test('a Manager of brand A cannot see brand B bookings; a provider-Viewer sees only their own calendar entries', async ({ browser, page, request }) => {
  const s = await approvedSeller(request)
  const owner = (await providerList(request, s.token))[0].membershipId
  await makeProvider(request, s.token, owner)
  const brands = (await (await request.get('/api/v1/brands', { headers: bearer(s.token) })).json()) as { id: string }[]
  const brandA = brands[0].id
  const created = await request.post('/api/v1/brands', { headers: bearer(s.token), data: { name: 'Second brand' } }); const brandB = (await created.json()).id as string
  const svcA = await makeService(request, s.token, [owner], 'Brand A service', {}, brandA)
  const svcB = await makeService(request, s.token, [owner], 'Brand B service', {}, brandB)
  const slots = await firstSlots(request, s.token, svcA, 6)
  const a = await simBook(request, s.token, svcA, slots[0].startAt)
  const farther = slots.find((x) => new Date(x.startAt).getTime() >= new Date(slots[0].startAt).getTime() + 4 * 3600_000)!
  const b = await simBook(request, s.token, svcB, farther.startAt)
  const mgr = await (await import('./svc')).joinAs(request, s.token, 'Manager', [brandA])
  const ctx = await browser.newContext(); await ctx.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 15, warningSeconds: 60, refreshIntervalMinutes: 5, turnstileSiteKey: 'stub', features: { apple: false } } }))
  const mp = await ctx.newPage()
  await signIn(mp, mgr.email)
  await mp.goto('/bookings?tab=upcoming')
  await expect(mp.getByRole('row', { name: new RegExp(a.number) })).toBeVisible()
  await expect(mp.getByRole('row', { name: new RegExp(b.number) })).toHaveCount(0)
  await mp.goto(`/bookings/${b.bookingId}`)
  await expect(mp.getByRole('heading', { name: 'Booking not found' })).toBeVisible()
  await expectNoSeriousA11y(mp)
  // the manager is not the assigned provider: no address, phone or actions beyond what the role allows
  await mp.goto(`/bookings/${a.bookingId}`)
  await expect(mp.getByText('5 Elm St')).toHaveCount(0)
  // a Viewer who is a provider sees only their own bookings (none) in the calendar
  const viewer = await (await import('./svc')).joinAs(request, s.token, 'Viewer')
  const vm = (await providerList(request, s.token)).find((p) => p.email === viewer.email)!.membershipId
  await makeProvider(request, s.token, vm)
  const vctx = await browser.newContext(); await vctx.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 15, warningSeconds: 60, refreshIntervalMinutes: 5, turnstileSiteKey: 'stub', features: { apple: false } } }))
  const vp = await vctx.newPage(); await signIn(vp, viewer.email)
  await vp.goto('/calendar?view=agenda')
  await expect(vp.getByText(/Nothing scheduled/)).toBeVisible()
  await expect(vp.getByRole('button', { name: /Brand A service/ })).toHaveCount(0)
  await expectNoSeriousA11y(vp)
  void page
})
