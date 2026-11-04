import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { API } from '../products/testkit'
import type { Availability, BookingActions, BookingDetail, CalendarData, ProviderList, ServiceDetails } from './types'
import { DEFAULT_SERVICE } from './useServiceDetails'

export { API, mount } from '../products/testkit'
export const ME = 'm-owner'
export const NY = 'America/New_York'

export const providers = (over: Partial<ProviderList> = {}): ProviderList => ({
  accountTimeZone: NY,
  providers: [{ membershipId: ME, email: 'owner@example.com', role: 'Owner', isProvider: true, timeZone: null, effectiveTimeZone: NY, reminderDayBefore: true, reminderHourBefore: true, icsActive: false, isMe: true }],
  ...over,
})
export const service = (o: Partial<ServiceDetails> = {}): ServiceDetails => ({ ...DEFAULT_SERVICE, pricingModel: 'hourly', price: 60, incrementMinutes: 30, defaultDurationMinutes: 120, online: true, onlineInstructions: 'https://meet.test/x', ...o })

export const noActions: BookingActions = { approve: false, decline: false, propose: false, reschedule: false, cancel: false, start: false, complete: false, noShow: false, reassign: false, decideReschedule: false }
export const booking = (o: Partial<BookingDetail> = {}): BookingDetail => ({
  id: 'bk1', number: 'BK-2026-000001', status: 'Requested', version: 1, serviceId: 's1', serviceTitle: 'Home cleaning', brandId: 'b1', providerId: ME, providerEmail: 'owner@example.com', providerTimeZone: NY, isMine: true,
  location: 'customer', startAt: '2030-01-09T15:00:00Z', endAt: '2030-01-09T17:00:00Z', durationMinutes: 120, approvalDeadline: '2030-01-08T15:00:00Z', proposedStartAt: null, rescheduleRequestedStartAt: null, rescheduleCount: 0,
  pricing: { model: 'hourly', rateCents: 6000, priceCents: 12000, addOnsCents: 0, travelFeeCents: 1000, totalCents: 13000, cancellationFeeCents: 0, additionalChargeCents: 0, actualMinutes: null },
  policy: { cancelFreeHours: 24, cancelFeePercent: 50, maxReschedules: 2, noShowFeePercent: 100, incrementMinutes: 30, approvalHours: 24 }, addOns: [], intake: [{ id: 'pets', question: 'Any pets?', answer: 'yes' }],
  customer: { name: 'Jane Buyer', phone: '+1 555 010 0000', address: { line1: '1 Main St', city: 'Brooklyn', postalCode: '11201' }, postalCode: '11201', visible: true, redacted: false },
  onlineInstructions: null, sellerAddress: null, requirements: 'Clear the area.', timeline: [{ at: '2030-01-01T10:00:00Z', type: 'booking.requested', actor: 'buyer', text: null }],
  actions: { ...noActions, approve: true, decline: true, propose: true, cancel: true, reassign: true }, createdAt: '2030-01-01T10:00:00Z', ...o,
})

export const emptyAvailability: Availability = { timeZone: NY, weekly: [], overrides: [] }
export const calendar = (o: Partial<CalendarData> = {}): CalendarData => ({
  from: '2030-01-07T05:00:00Z', to: '2030-01-14T05:00:00Z', accountTimeZone: NY, combined: true, providers: [{ membershipId: ME, email: 'owner@example.com', timeZone: NY, isMe: true }], blocks: [], workingHours: [],
  bookings: [{ id: 'bk1', number: 'BK-1', status: 'Confirmed', title: 'Home cleaning', serviceId: 's1', brandId: 'b1', providerId: ME, startAt: '2030-01-09T15:00:00Z', endAt: '2030-01-09T17:00:00Z', location: 'customer', buyerName: 'Jane Buyer', canAct: true }], ...o,
})

/** Common handlers of the scheduling screens; returns the recorded writes. */
/** The query strings the slot-picker endpoint received (for assertions). */
export const slotQueries: string[] = []
export function mockSchedule(o: { providers?: ProviderList; calendar?: CalendarData; booking?: BookingDetail; availability?: Availability } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const rec = async (request: Request) => { let body: unknown = null; try { body = await request.clone().json() } catch { /* no body */ } calls.push({ method: request.method, url: new URL(request.url).pathname.replace('/api/v1', ''), body }) }
  server.use(
    http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme', isDefault: true }])),
    http.get(`${API}/seller/providers`, () => HttpResponse.json(o.providers ?? providers())),
    http.get(`${API}/seller/products`, () => HttpResponse.json({ items: [{ id: 's1', title: 'Home cleaning', status: 'Active' }], total: 1, page: 1, pageSize: 100, counts: {} })),
    http.get(`${API}/seller/calendar`, ({ request }) => { calls.push({ method: 'GET', url: new URL(request.url).pathname.replace('/api/v1', '') + new URL(request.url).search, body: null }); return HttpResponse.json(o.calendar ?? calendar()) }),
    http.get(`${API}/seller/bookings/:id`, () => HttpResponse.json(o.booking ?? booking())),
    http.get(`${API}/seller/bookings/:id/messages`, () => HttpResponse.json({ messages: [] })),
    http.post(`${API}/seller/bookings/:id/:action`, async ({ request, params }) => { await rec(request); const d = o.booking ?? booking(); return HttpResponse.json({ ...d, version: d.version + 1, status: params.action === 'approve' ? 'Confirmed' : d.status }) }),
    http.get(`${API}/seller/providers/:id/availability`, () => HttpResponse.json(o.availability ?? emptyAvailability)),
    http.put(`${API}/seller/providers/:id/availability`, async ({ request }) => { await rec(request); return HttpResponse.json({ ok: true }) }),
    http.get(`${API}/seller/providers/:id/blocks`, () => HttpResponse.json({ blocks: [] })),
    http.post(`${API}/seller/providers/:id/blocks`, async ({ request }) => { await rec(request); return HttpResponse.json({ block: { id: 'blk', providerId: ME, kind: 'busy', startAt: '2030-01-09T15:00:00Z', endAt: '2030-01-09T16:00:00Z', allDay: false, note: null }, affectedBookings: 0 }, { status: 201 }) }),
    http.get(`${API}/seller/services/:id/slots`, ({ request }) => { const u = new URL(request.url); slotQueries.push(u.search); return HttpResponse.json({ durationMinutes: 120, slots: u.searchParams.get('from')?.startsWith('2030-01-10') ? [{ startAt: '2030-01-10T14:00:00Z', endAt: '2030-01-10T16:00:00Z', providerIds: [ME] }, { startAt: '2030-01-10T18:30:00Z', endAt: '2030-01-10T20:30:00Z', providerIds: [ME] }] : [] }) }),
    http.get(`${API}/seller/services/:id/providers`, () => HttpResponse.json({ providers: [{ membershipId: ME, email: 'owner@example.com', role: 'Owner', timeZone: NY, eligible: true }] })),
  )
  return calls
}
