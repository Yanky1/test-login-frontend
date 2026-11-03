import { expect, type APIRequestContext } from '@playwright/test'
import { createSeller, setStatus, PASSWORD, newEmail, lastMail } from './helpers'
import { makePng } from './png'

const BUSINESS = { vendorName: 'Acme Co', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false }
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })
export async function login(request: APIRequestContext, email: string, password = PASSWORD) {
  const r = await request.post('/api/v1/auth/login', { data: { email, password } }); expect(r.ok()).toBeTruthy()
  return (await r.json()).accessToken as string
}

/** An approved seller (wizard + admin approval through the API). */
export async function approvedSeller(request: APIRequestContext) {
  const s = await createSeller(request)
  const token = await login(request, s.email)
  expect((await request.put('/api/v1/seller/application/business', { data: BUSINESS, headers: bearer(token) })).ok()).toBeTruthy()
  expect((await request.put('/api/v1/seller/application/kosher', { data: { answers: { sells_food: 'no' } }, headers: bearer(token) })).ok()).toBeTruthy()
  expect((await request.post('/api/v1/seller/application/submit', { data: { acceptSellerAgreement: true }, headers: bearer(token) })).ok()).toBeTruthy()
  await setStatus(request, s.sellerId, 'Approved')
  return { ...s, token }
}

export async function providerList(request: APIRequestContext, token: string) {
  return (await (await request.get('/api/v1/seller/providers', { headers: bearer(token) })).json()).providers as { membershipId: string; email: string; isMe: boolean }[]
}
/** Marks a member as provider and gives them working hours every day 06:00-22:00. */
export async function makeProvider(request: APIRequestContext, ownerToken: string, membershipId: string, hours = true) {
  expect((await request.put(`/api/v1/seller/providers/${membershipId}`, { headers: bearer(ownerToken), data: { isProvider: true } })).ok()).toBeTruthy()
  if (hours) {
    const weekly = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, intervals: [{ start: '06:00', end: '22:00' }] }))
    expect((await request.put(`/api/v1/seller/providers/${membershipId}/availability`, { headers: bearer(ownerToken), data: { weekly, overrides: [] } })).ok()).toBeTruthy()
  }
}

export const DETAILS = {
  pricingModel: 'hourly', price: 60, minMinutes: 60, maxMinutes: 480, incrementMinutes: 30, defaultDurationMinutes: 120, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeHours: 1, maxAdvanceDays: 60, slotGranularityMinutes: 60,
  online: true, onlineInstructions: 'https://meet.example.test/room-7', atCustomer: true, serviceArea: { postalCodes: ['11201', '112*'] }, travelFee: 10, travelBufferMinutes: 30, atSeller: false,
  bookingMode: 'instant', approvalHours: 24, intake: [], addOns: [], cancelFreeHours: 24, cancelFeePercent: 50, maxReschedules: 2, noShowFeePercent: 100, assignmentRule: 'buyerchoice',
}

/** A complete, ACTIVE service through the API. */
export async function makeService(request: APIRequestContext, token: string, providers: string[], title = 'Home cleaning service', over: Record<string, unknown> = {}, brandId?: string) {
  const cats = (await (await request.get('/api/v1/categories', { headers: bearer(token) })).json()) as { id: string; slug: string }[]
  const cat = cats.find((c) => c.slug === 'home-services')!.id
  const created = await request.post('/api/v1/seller/products', { headers: bearer(token), data: { title, categoryId: cat, type: 'service', brandId } }); expect(created.status()).toBe(201)
  const id = (await created.json()).id as string
  const up = await request.post(`/api/v1/seller/products/${id}/images?alt=Cleaning`, { headers: bearer(token), multipart: { file: { name: 'p.png', mimeType: 'image/png', buffer: makePng() } } }); expect(up.status()).toBe(201)
  const v = (await (await request.get(`/api/v1/seller/products/${id}`, { headers: bearer(token) })).json()).version as number
  const d = await request.put(`/api/v1/seller/services/${id}/details`, { headers: bearer(token), data: { ...DETAILS, ...over, version: v } }); expect(d.ok(), await d.text()).toBeTruthy()
  expect((await request.put(`/api/v1/seller/services/${id}/providers`, { headers: bearer(token), data: { membershipIds: providers } })).ok()).toBeTruthy()
  const act = await request.post(`/api/v1/seller/products/${id}/status`, { headers: bearer(token), data: { status: 'active' } }); expect(act.ok(), await act.text()).toBeTruthy()
  return id
}

/** First free slot the simulator (= the marketplace) finds from tomorrow. */
export async function firstSlots(request: APIRequestContext, token: string, serviceId: string, days = 5, extra = '&location=customer&postalCode=11201') {
  const from = new Date(Date.now() + 3 * 3600_000); const to = new Date(Date.now() + days * 86400_000)
  const r = await request.get(`/api/v1/seller/dev/services/${serviceId}/slots?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${extra}`, { headers: bearer(token) })
  expect(r.ok(), await r.text()).toBeTruthy()
  return (await r.json()).slots as { startAt: string; endAt: string; providerIds: string[] }[]
}
export async function simBook(request: APIRequestContext, token: string, serviceId: string, start: string, mode = 'book', extra: Record<string, unknown> = {}) {
  const r = await request.post('/api/v1/seller/dev/bookings', { headers: bearer(token), data: { serviceId, start, location: 'customer', postalCode: '11201', mode, ...extra } })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()).booking as { bookingId: string; marketplaceBookingId: string; number: string; status: string }
}
export async function simEvent(request: APIRequestContext, token: string, mid: string, body: Record<string, unknown>) {
  return request.post(`/api/v1/seller/dev/bookings/${mid}/events`, { headers: bearer(token), data: body })
}

/** Invites a member (new user) and returns their signed-in token + login. */
export async function joinAs(request: APIRequestContext, ownerToken: string, role: string, brandIds?: string[]) {
  const email = newEmail()
  const inv = await request.post('/api/v1/team/invitations', { headers: bearer(ownerToken), data: { email, role, brandIds } }); expect(inv.status()).toBe(202)
  const text = await lastMail(request, email, 'team-invitation'); const tok = /\/invite\/([A-Za-z0-9_-]+)/.exec(text)![1]
  const j = await request.post(`/api/v1/invitations/${tok}/join`, { data: { password: PASSWORD, acceptTerms: true } }); expect(j.ok(), await j.text()).toBeTruthy()
  return { email, token: (await j.json()).accessToken as string }
}
