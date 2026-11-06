import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.SHOTS_DIR
const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } }
const login = { tokenType: 'Bearer', accessToken: 'tok', expiresIn: 900, refreshToken: '', sellerId: 's1', email: 'rivka@example.com', vendorName: 'Rivka Cleaning', accountStatus: 'Approved', roles: ['Seller'], activeAccountId: 's1', accounts: [{ sellerId: 's1', vendorName: 'Rivka Cleaning', role: 'Owner', accountStatus: 'Approved', brandCount: 1 }] }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const NY = 'America/New_York'
const ME = 'm1'; const OTHER = 'm2'

const svc = { pricingModel: 'hourly', price: 60, minMinutes: 60, maxMinutes: 480, incrementMinutes: 30, defaultDurationMinutes: 120, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, minNoticeHours: 24, maxAdvanceDays: 60, slotGranularityMinutes: 30,
  online: true, onlineInstructions: 'https://meet.example.com/rivka', atCustomer: true, serviceArea: { postalCodes: ['11201', '11215', '112*'], radius: { baseAddress: '1 Main St, Brooklyn', lat: 40.69, lng: -73.99, distance: 8, unit: 'km' } }, travelFee: 10, travelBufferMinutes: 30, atSeller: false, sellerAddress: null,
  bookingMode: 'request', approvalHours: 24, intake: [{ id: 'pets', label: 'Any pets at home?', type: 'yesno', required: true }, { id: 'size', label: 'Home size', type: 'choice', options: ['Studio', '1-2 bedrooms', '3+ bedrooms'], required: false }], requirements: 'Please clear the counters.',
  addOns: [{ id: 'oven', name: 'Inside the oven', price: 25, extraMinutes: 30 }], cancelFreeHours: 24, cancelFeePercent: 50, maxReschedules: 2, noShowFeePercent: 100, assignmentRule: 'leastbusy', readyProviders: 1 }
const product = (over: object = {}) => ({
  id: 's1', type: 'Service', service: svc, status: 'Draft', brandId: 'b1', brandName: 'Rivka Cleaning', categoryId: 'c1', version: 3, title: 'Home cleaning, 2 hours, eco products', handle: null, condition: 'New', conditionNote: null, sku: null,
  price: null, compareAtPrice: null, salePrice: null, saleStart: null, saleEnd: null, cost: null, quantity: 0, lowStockAlert: null, allowBackorder: false, maxPerOrder: null, barcode: null, noBarcode: false,
  bullets: ['Eco-friendly products', 'Insured and vetted staff'], description: 'A thorough clean of your whole home.', weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, handlingDays: null,
  shipping: { standardEnabled: true, standardPrice: null, expressEnabled: false, expressPrice: null, freeOver: null }, localPickup: false, returnsDays: null, returnsCondition: null, warrantyMonths: null, warrantyNote: null, searchTerms: 'cleaning house', metaTitle: null, metaDescription: null,
  hasVariants: false, attributes: {}, margin: null, currentPrice: null, onSale: false, available: 0, barcodeCheck: null, descriptionHtml: '', options: [], variants: [], images: [{ id: 'i1', url: '/api/v1/seller/products/s1/images/i1/file', alt: 'Cleaner with supplies', isMain: true, variantId: null, width: 1400, height: 1400, size: 90000, lowResolution: false }], faqs: [],
  attributeConfig: [], qualityScore: 78, canPublish: true, issues: [{ key: 'requirements', section: 'booking', severity: 'recommended', message: 'Tell buyers how to prepare.' }], createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-02T00:00:00Z', publishedAt: null, ...over,
})

const day = (d: number) => `2030-01-${String(d).padStart(2, '0')}`
const bk = (id: string, d: number, h: number, mins: number, over: object = {}) => ({ id, number: `BK-2030-00000${id.slice(-1)}`, status: 'Confirmed', title: 'Home cleaning', serviceId: 's1', brandId: 'b1', providerId: ME, startAt: `${day(d)}T${String(h + 5).padStart(2, '0')}:00:00Z`, endAt: new Date(Date.parse(`${day(d)}T${String(h + 5).padStart(2, '0')}:00:00Z`) + mins * 60000).toISOString(), location: 'customer', buyerName: 'Jane Buyer', canAct: true, ...over })
const calendar = {
  from: '2030-01-07T05:00:00Z', to: '2030-01-14T05:00:00Z', accountTimeZone: NY, combined: true,
  providers: [{ membershipId: ME, email: 'rivka@example.com', timeZone: NY, isMe: true }, { membershipId: OTHER, email: 'dov@example.com', timeZone: NY, isMe: false }],
  blocks: [{ id: 'b1', providerId: ME, kind: 'busy', startAt: '2030-01-10T17:00:00Z', endAt: '2030-01-10T18:00:00Z', allDay: false, note: 'Dentist' }, { id: 'b2', providerId: OTHER, kind: 'timeoff', startAt: '2030-01-11T05:00:00Z', endAt: '2030-01-12T05:00:00Z', allDay: true, note: 'Holiday' }],
  workingHours: [7, 8, 9, 10, 11].map((d) => ({ providerId: ME, start: `${day(d)}T14:00:00Z`, end: `${day(d)}T22:00:00Z` })),
  bookings: [bk('bk1', 9, 10, 120), bk('bk2', 9, 11, 90, { providerId: OTHER, status: 'Requested', title: 'Window cleaning', buyerName: 'Sam Doe' }), bk('bk3', 8, 9, 60, { status: 'InProgress' }), bk('bk4', 10, 13, 180, { location: 'online', title: 'Online consultation', buyerName: null }), bk('bk5', 7, 15, 60, { status: 'Completed' })],
}
const detail = (o: object = {}) => ({
  id: 'bk1', number: 'BK-2030-000001', status: 'Requested', version: 2, serviceId: 's1', serviceTitle: 'Home cleaning, 2 hours, eco products', brandId: 'b1', providerId: ME, providerEmail: 'rivka@example.com', providerTimeZone: NY, isMine: true, location: 'customer',
  startAt: '2030-01-09T15:00:00Z', endAt: '2030-01-09T17:00:00Z', durationMinutes: 120, approvalDeadline: '2030-01-08T15:00:00Z', proposedStartAt: null, rescheduleRequestedStartAt: null, rescheduleCount: 0,
  pricing: { model: 'hourly', rateCents: 6000, priceCents: 12000, addOnsCents: 2500, travelFeeCents: 1000, totalCents: 15500, cancellationFeeCents: 0, additionalChargeCents: 0, actualMinutes: null },
  policy: { cancelFreeHours: 24, cancelFeePercent: 50, maxReschedules: 2, noShowFeePercent: 100, incrementMinutes: 30, approvalHours: 24 }, addOns: [{ id: 'oven', name: 'Inside the oven', priceCents: 2500, extraMinutes: 30 }],
  intake: [{ id: 'pets', question: 'Any pets at home?', answer: 'Yes, a cat' }, { id: 'size', question: 'Home size', answer: '1-2 bedrooms' }],
  customer: { name: 'Jane Buyer', phone: '+1 555 010 0000', address: { line1: '1 Main St', line2: 'Apt 2', city: 'Brooklyn', region: 'NY', postalCode: '11201' }, postalCode: '11201', visible: true, redacted: false }, onlineInstructions: null, sellerAddress: null, requirements: 'Please clear the counters.',
  timeline: [{ at: '2030-01-01T10:00:00Z', type: 'booking.requested', actor: 'buyer', text: null }, { at: '2030-01-01T10:05:00Z', type: 'booking.message', actor: 'buyer', text: 'Can you bring a ladder?' }],
  actions: { approve: true, decline: true, propose: true, reschedule: false, cancel: true, start: false, complete: false, noShow: false, reassign: true, decideReschedule: false }, createdAt: '2030-01-01T10:00:00Z', ...o,
})
const list = { items: [
  { id: 'bk1', number: 'BK-2030-000001', status: 'Requested', serviceId: 's1', serviceTitle: 'Home cleaning, 2 hours, eco products', brandId: 'b1', providerId: ME, location: 'customer', startAt: '2030-01-09T15:00:00Z', endAt: '2030-01-09T17:00:00Z', totalCents: 15500, approvalDeadline: '2030-01-08T15:00:00Z', rescheduleRequested: false, isMine: true, buyerName: 'Jane Buyer' },
  { id: 'bk2', number: 'BK-2030-000002', status: 'Requested', serviceId: 's1', serviceTitle: 'Window cleaning', brandId: 'b1', providerId: OTHER, location: 'online', startAt: '2030-01-10T16:00:00Z', endAt: '2030-01-10T17:30:00Z', totalCents: 9000, approvalDeadline: '2030-01-09T10:00:00Z', rescheduleRequested: true, isMine: false, buyerName: 'Sam Doe' }], total: 2, page: 1, pageSize: 20 }
const quoteReq = { id: 'q1', status: 'Requested', serviceId: 's2', serviceTitle: 'Fence repair', brandId: 'b1', location: 'customer', buyerName: 'Sam Doe', details: 'Two panels of my back fence fell over in the storm. Wood, about 2 m high.', postalCode: '11201', preferredTimes: ['2030-01-12T14:00:00Z'], address: { line1: '5 Elm St', city: 'Brooklyn', postalCode: '11201' }, phone: '+1 555 010 0000', quote: null, bookingId: null, declineReason: null, createdAt: '2030-01-05T10:00:00Z', version: 1 }

async function mock(page: Page) {
  await page.route('**/config.json', (r) => r.fulfill({ json: { idleTimeoutMinutes: 60, warningSeconds: 60, refreshIntervalMinutes: 5, features: { apple: false }, turnstileSiteKey: 'stub' } }))
  await page.route('**/api/v1/**', (r) => {
    const u = new URL(r.request().url()); const p = u.pathname.replace('/api/v1', ''); const m = r.request().method()
    if (p === '/auth/refresh') return r.fulfill({ json: login })
    if (/\/images\/.+\/file$/.test(p)) return r.fulfill({ body: PNG, contentType: 'image/png' })
    if (p === '/brands') return r.fulfill({ json: [{ id: 'b1', name: 'Rivka Cleaning', isDefault: true }] })
    if (p === '/categories') return r.fulfill({ json: [{ id: 'c1', parentId: null, name: 'Home Services', slug: 'home-services', path: 'Local Services › Home Services', leaf: true }] })
    if (/^\/categories\/.+\/attributes$/.test(p)) return r.fulfill({ json: [] })
    if (p === '/seller/bookings/counts') return r.fulfill({ json: { requests: 2, today: 1, upcoming: 4, quoteRequests: 1, needsAction: 3 } })
    if (p === '/seller/providers' && m === 'GET') return r.fulfill({ json: { accountTimeZone: NY, providers: [{ membershipId: ME, email: 'rivka@example.com', role: 'Owner', isProvider: true, timeZone: null, effectiveTimeZone: NY, reminderDayBefore: true, reminderHourBefore: false, icsActive: true, isMe: true }, { membershipId: OTHER, email: 'dov@example.com', role: 'Manager', isProvider: true, timeZone: 'America/Los_Angeles', effectiveTimeZone: 'America/Los_Angeles', reminderDayBefore: true, reminderHourBefore: true, icsActive: false, isMe: false }] } })
    if (/^\/seller\/providers\/.+\/availability$/.test(p)) return r.fulfill({ json: { timeZone: NY, weekly: [1, 2, 3, 4, 5].map((d) => ({ day: d, intervals: d === 3 ? [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }] : [{ start: '09:00', end: '17:00' }] })), overrides: [{ date: '2030-12-24', intervals: [{ start: '10:00', end: '13:00' }] }, { date: '2030-12-25', intervals: [] }] } })
    if (p === '/seller/calendar/ics') return r.fulfill({ json: { active: false, createdAt: null } })
    if (/^\/seller\/providers\/.+\/blocks$/.test(p)) return r.fulfill({ json: { blocks: [{ id: 'b9', providerId: ME, kind: 'timeoff', startAt: '2030-07-01T04:00:00Z', endAt: '2030-07-08T04:00:00Z', allDay: true, note: 'Summer holiday' }] } })
    if (p === '/seller/calendar') return r.fulfill({ json: calendar })
    if (p === '/seller/products' && m === 'GET') return r.fulfill({ json: { items: [{ id: 's1', type: 'Service', priceModel: 'hourly', durationMinutes: 120, title: 'Home cleaning, 2 hours, eco products', sku: null, status: 'Active', brandId: 'b1', brandName: 'Rivka Cleaning', categoryId: 'c1', price: 60, currentPrice: 60, onSale: false, quantity: 0, hasVariants: false, variantCount: 0, qualityScore: 78, canPublish: true, needsAttention: false, lowStock: false, version: 1, updatedAt: '2030-01-02T00:00:00Z', thumbnailUrl: '/api/v1/seller/products/s1/images/i1/file' },
      { id: 's2', type: 'Service', priceModel: 'quote', durationMinutes: 180, title: 'Fence repair', sku: null, status: 'Draft', brandId: 'b1', brandName: 'Rivka Cleaning', categoryId: 'c1', price: null, currentPrice: null, onSale: false, quantity: 0, hasVariants: false, variantCount: 0, qualityScore: 40, canPublish: false, needsAttention: true, lowStock: false, version: 1, updatedAt: '2030-01-02T00:00:00Z', thumbnailUrl: null }], total: 2, page: 1, pageSize: 100, counts: { all: 2, draft: 1, active: 1, inactive: 0, archived: 0, outOfStock: 0, attention: 1 } } })
    if (/^\/seller\/products\/s1(\/.*)?$/.test(p)) return r.fulfill({ json: product() })
    if (/^\/seller\/services\/.+\/providers$/.test(p)) return r.fulfill({ json: { providers: [{ membershipId: ME, email: 'rivka@example.com', role: 'Owner', timeZone: NY, eligible: true }, { membershipId: OTHER, email: 'dov@example.com', role: 'Manager', timeZone: 'America/Los_Angeles', eligible: false }] } })
    if (p === '/seller/bookings' && m === 'GET') return r.fulfill({ json: list })
    if (/^\/seller\/bookings\/bk1\/messages$/.test(p)) return r.fulfill({ json: { messages: [{ id: 'm1', direction: 'buyer', text: 'Can you bring a ladder?', createdAt: '2030-01-01T10:05:00Z', mine: false }, { id: 'm2', direction: 'seller', text: 'Yes, no problem.', createdAt: '2030-01-01T11:00:00Z', mine: true }] } })
    if (/^\/seller\/bookings\/bk1$/.test(p)) return r.fulfill({ json: detail() })
    if (p === '/seller/quote-requests') return r.fulfill({ json: { items: [quoteReq], total: 1, page: 1, pageSize: 20 } })
    if (/^\/seller\/quote-requests\/q1$/.test(p)) return r.fulfill({ json: quoteReq })
    return r.fulfill({ json: {} })
  })
}

const screens: { name: string; path: string; heading: RegExp; act?: (p: Page) => Promise<void> }[] = [
  { name: 'service-new', path: '/products/new', heading: /what are you selling/i, act: async (p) => { await p.getByRole('radio', { name: /Service/ }).check() } },
  { name: 'service-edit', path: '/products/s1', heading: /home cleaning/i, act: async (p) => { await expect(p.getByRole('heading', { name: 'Where it happens' })).toBeVisible(); await expect(p.getByRole('heading', { name: 'Ready to publish?' })).toBeVisible() } },
  { name: 'products-services', path: '/products?type=service', heading: /^products$/i, act: async (p) => { await expect(p.locator('text=Quote required >> visible=true').first()).toBeVisible() } },
  { name: 'calendar-week', path: '/calendar?view=week&date=2030-01-09', heading: /^calendar$/i, act: async (p) => { await expect(p.getByRole('region', { name: 'Schedule grid' })).toBeVisible() } },
  { name: 'calendar-day', path: '/calendar?view=day&date=2030-01-09', heading: /^calendar$/i, act: async (p) => { await expect(p.getByRole('region', { name: 'Schedule grid' })).toBeVisible() } },
  { name: 'calendar-month', path: '/calendar?view=month&date=2030-01-09', heading: /^calendar$/i, act: async (p) => { await expect(p.getByRole('grid', { name: /Month of/ })).toBeVisible() } },
  { name: 'calendar-list', path: '/calendar?view=agenda&date=2030-01-07', heading: /^calendar$/i, act: async (p) => { await expect(p.getByRole('list', { name: 'Schedule as a list' })).toBeVisible() } },
  { name: 'calendar-booking', path: '/calendar?view=agenda&date=2030-01-07', heading: /^calendar$/i, act: async (p) => { await p.getByRole('button', { name: /Home cleaning/ }).first().click(); await expect(p.getByRole('dialog')).toBeVisible() } },
  { name: 'calendar-block', path: '/calendar?view=agenda&date=2030-01-07', heading: /^calendar$/i, act: async (p) => { await p.getByRole('button', { name: /Block time/ }).click(); await expect(p.getByRole('dialog', { name: 'Block time' })).toBeVisible() } },
  { name: 'availability', path: '/settings/availability', heading: /account settings/i, act: async (p) => { await expect(p.getByRole('group', { name: 'Wednesday' })).toBeVisible(); await expect(p.getByRole('heading', { name: 'Calendar feed', exact: true })).toBeVisible() } },
  { name: 'bookings-requests', path: '/bookings', heading: /^bookings$/i, act: async (p) => { await expect(p.getByRole('link', { name: /Open\s*BK-2030-000001/ })).toBeVisible() } },
  { name: 'quote-requests', path: '/bookings?tab=quotes', heading: /^bookings$/i, act: async (p) => { await expect(p.getByRole('link', { name: /Send a quote/ })).toBeVisible() } },
  { name: 'booking-detail', path: '/bookings/bk1', heading: /home cleaning/i, act: async (p) => { await expect(p.getByRole('heading', { name: 'Timeline' })).toBeVisible(); await expect(p.getByText('Yes, no problem.')).toBeVisible() } },
  { name: 'booking-cancel', path: '/bookings/bk1', heading: /home cleaning/i, act: async (p) => { await p.getByRole('button', { name: /Cancel booking/ }).click(); await expect(p.getByRole('dialog', { name: 'Cancel this booking' })).toBeVisible() } },
  { name: 'quote-composer', path: '/bookings/quotes/q1', heading: /quote for fence repair/i, act: async (p) => { await expect(p.getByRole('heading', { name: 'Write your quote' })).toBeVisible() } },
]

for (const [vp, size] of Object.entries(viewports)) {
  for (const theme of ['light', 'dark'] as const) {
    for (const s of screens) {
      test(`${s.name} @${vp} ${theme}: renders, fits the width and has no serious a11y violations`, async ({ page }) => {
        await page.setViewportSize(size)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await mock(page)
        await page.goto(s.path)
        await expect(page.getByRole('heading', { name: s.heading }).first()).toBeVisible()
        await s.act?.(page)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 160) + ' ' + n.any.map((a) => a.message).join(';')).join(' | ')}`)).toEqual([])
        if (SHOTS && (theme === 'light' || s.name.startsWith('calendar-'))) await page.screenshot({ path: `${SHOTS}/${s.name}-${vp}${theme === 'dark' ? '-dark' : ''}.png`, fullPage: !s.name.startsWith('calendar-') || s.name === 'calendar-list' })
      })
    }
  }
}

test('320px wide: calendar, availability, bookings and the booking detail do not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 }); await mock(page)
  for (const path of ['/calendar?view=agenda&date=2030-01-07', '/calendar?view=month&date=2030-01-09', '/settings/availability', '/bookings', '/bookings/bk1', '/bookings/quotes/q1', '/products/s1']) {
    await page.goto(path); await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.waitForLoadState('networkidle'); await expect(page.locator('.skeleton, [aria-busy="true"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
  }
})

test('time inputs show a visible focus indicator (WCAG 2.4.7 / 2.4.11)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await mock(page)
  await page.goto('/settings/availability')
  const time = page.getByLabel('Monday opens')
  await expect(time).toBeVisible()
  await page.keyboard.press('Tab')
  await time.focus()
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')   // keyboard focus, so :focus-visible matches
  await expect(time).toBeFocused()
  const style = await time.evaluate((el) => { const s = getComputedStyle(el); return { outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth) } })
  expect(style.outlineStyle).not.toBe('none')
  expect(style.outlineWidth).toBeGreaterThanOrEqual(2)
})
