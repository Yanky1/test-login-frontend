import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import AvailabilityPage from './AvailabilityPage'
import BookingDetailPage from './BookingDetailPage'
import CalendarPage from './CalendarPage'
import QuotePage, { Composer } from './QuotePage'
import { ServiceProviders } from './ServiceSections'
import type { QuoteDto } from './types'
import { API, NY, booking, mockSchedule, mount, noActions, slotQueries } from './testkit'

const quote = (o: Partial<QuoteDto> = {}): QuoteDto => ({ id: 'q1', status: 'Requested', serviceId: 's1', serviceTitle: 'Fence repair', brandId: 'b1', location: 'customer', buyerName: 'Sam', details: 'Broken fence', postalCode: '11201', preferredTimes: [], address: null, phone: null, quote: null, bookingId: null, declineReason: null, version: 3, createdAt: '2030-01-01T10:00:00Z', ...o } as QuoteDto)
const conflict = () => HttpResponse.json({ code: 'version_conflict', title: 'Changed.' }, { status: 409 })

describe('review fixes: quotes', () => {
  it('writes proposed times in the ACCOUNT zone when the provider uses the account default (never the browser zone)', async () => {
    const sent: Record<string, unknown>[] = []
    mockSchedule()
    server.use(
      http.get(`${API}/seller/services/:id/providers`, () => HttpResponse.json({ providers: [{ membershipId: 'm-owner', email: 'owner@example.com', role: 'Owner', timeZone: null, eligible: true }] })),
      http.post(`${API}/seller/quote-requests/:id/quote`, async ({ request }) => { sent.push((await request.json()) as Record<string, unknown>); return HttpResponse.json(quote({ status: 'Quoted' })) }),
    )
    mount(<Composer quote={quote()} onDone={() => undefined} />, '/q')
    await screen.findByRole('option', { name: 'owner@example.com' })
    expect(await screen.findByText(new RegExp(`Times are in ${NY}`))).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Price (USD)'), '100')
    fireEvent.change(screen.getByLabelText('Proposed date 1'), { target: { value: '2030-02-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'Send quote' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].slots).toEqual(['2030-02-05T14:00:00.000Z'])   // 09:00 in New York, whatever zone the browser is in
  })
  it('reloads and says so when sending a quote hits a version conflict', async () => {
    let gets = 0
    mockSchedule()
    server.use(
      http.get(`${API}/seller/quote-requests/:id`, () => { gets++; return HttpResponse.json(quote({ version: gets > 1 ? 4 : 3 })) }),
      http.post(`${API}/seller/quote-requests/:id/quote`, conflict),
    )
    mount(<QuotePage />, '/bookings/quotes/:id', '/bookings/quotes/q1')
    await screen.findByRole('option', { name: 'owner@example.com' })
    await userEvent.type(screen.getByLabelText('Price (USD)'), '100')
    fireEvent.change(screen.getByLabelText('Proposed date 1'), { target: { value: '2030-02-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'Send quote' }))
    expect(await screen.findByText(/This request changed while you were writing/)).toBeInTheDocument()
    await waitFor(() => expect(gets).toBe(2))
  })
  it('hides the composer and Decline from Viewers', async () => {
    mockSchedule()
    server.use(http.get(`${API}/seller/quote-requests/:id`, () => HttpResponse.json(quote())))
    mount(<QuotePage />, '/bookings/quotes/:id', '/bookings/quotes/q1', { activeAccountId: 'a1', accounts: [{ sellerId: 'a1', vendorName: 'A', role: 'Viewer', accountStatus: 'Approved', brandCount: 1 }] })
    expect(await screen.findByRole('heading', { name: /Quote for Fence repair/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send quote' })).toBeNull(); expect(screen.queryByRole('button', { name: /Decline request/ })).toBeNull()
    expect(screen.getByText(/view-only access/)).toBeInTheDocument()
  })
})

describe('review fixes: bookings', () => {
  it('reloads the latest booking and explains when an action hits a version conflict', async () => {
    let gets = 0
    mockSchedule()
    server.use(
      http.get(`${API}/seller/bookings/:id`, () => { gets++; return HttpResponse.json(booking({ version: gets })) }),
      http.post(`${API}/seller/bookings/:id/approve`, conflict),
    )
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText(/This booking changed while you were looking at it/)).toBeInTheDocument()
    expect(gets).toBe(2)
  })
  it('asks for confirmation (no note field) before a no-show and sends the version', async () => {
    const calls = mockSchedule({ booking: booking({ status: 'Confirmed', actions: { ...noActions, noShow: true } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: /No-show/ }))
    const dlg = within(await screen.findByRole('dialog')); expect(dlg.queryByRole('textbox')).toBeNull()
    await userEvent.click(dlg.getByRole('button', { name: 'Mark no-show' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/no-show'))).toBe(true))
  })
})

describe('review fixes: availability', () => {
  const blockList = { blocks: [{ id: 'blk1', providerId: 'm-owner', kind: 'timeoff', startAt: '2099-01-09T15:00:00Z', endAt: '2099-01-09T16:00:00Z', allDay: false, note: 'Dentist' }] }
  it('confirms before removing time off', async () => {
    const deleted: string[] = []
    mockSchedule()
    server.use(http.get(`${API}/seller/providers/:id/blocks`, () => HttpResponse.json(blockList)), http.delete(`${API}/seller/providers/:id/blocks/:bid`, ({ params }) => { deleted.push(String(params.bid)); return HttpResponse.json({ ok: true }) }))
    mount(<AvailabilityPage />, '/availability')
    await userEvent.click(await screen.findByRole('button', { name: /Remove\s*time off Dentist/ }, { timeout: 5000 }))
    expect(deleted).toEqual([])
    const dlg = within(await screen.findByRole('dialog', { name: /Remove this time off/ }))
    await userEvent.click(dlg.getByRole('button', { name: 'Keep as it is' }))
    expect(deleted).toEqual([])
    await userEvent.click(await screen.findByRole('button', { name: /Remove\s*time off Dentist/ }, { timeout: 5000 }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleted).toEqual(['blk1']))
  })
  it('confirms before generating a new calendar feed link (the old one stops working)', async () => {
    let created = 0
    mockSchedule({ providers: { accountTimeZone: NY, providers: [{ membershipId: 'm-owner', email: 'owner@example.com', role: 'Owner', isProvider: true, timeZone: null, effectiveTimeZone: NY, reminderDayBefore: true, reminderHourBefore: true, icsActive: true, isMe: true }] } })
    server.use(http.post(`${API}/seller/providers/:id/ics`, () => { created++; return HttpResponse.json({ token: 'tok123' }) }))
    mount(<AvailabilityPage />, '/availability')
    await userEvent.click(await screen.findByRole('button', { name: /Generate a new link/ }))
    expect(created).toBe(0)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Generate a new link' }))
    await waitFor(() => expect(created).toBe(1))
    expect(await screen.findByTestId('ics-url')).toHaveTextContent('tok123')
  })
})

describe('review fixes: links', () => {
  it('links to Settings → Availability when nobody is a provider yet', async () => {
    mockSchedule()
    server.use(http.get(`${API}/seller/services/:id/providers`, () => HttpResponse.json({ providers: [] })))
    mount(<ServiceProviders serviceId="s1" readOnly={false} onChanged={() => undefined} />, '/x')
    expect(await screen.findByRole('link', { name: 'Availability' })).toHaveAttribute('href', '/settings/availability')
  })
})

describe('account settings (Owners and Admins)', () => {
  it('saves the account time zone and creates the team-wide calendar feed', async () => {
    const puts: unknown[] = []; let created = 0
    mockSchedule()
    server.use(
      http.put(`${API}/seller/booking-settings`, async ({ request }) => { puts.push(await request.json()); return HttpResponse.json({ timeZone: 'Europe/London' }) }),
      http.get(`${API}/seller/calendar/ics`, () => HttpResponse.json({ active: false, createdAt: null })),
      http.post(`${API}/seller/calendar/ics`, () => { created++; return HttpResponse.json({ token: 'acct-tok', path: '/x' }) }),
    )
    mount(<AvailabilityPage />, '/availability')
    const tz = await screen.findByLabelText('Time zone', { selector: '#av-acc-tz' }, { timeout: 5000 })
    await userEvent.clear(tz); await userEvent.type(tz, 'Europe/London')
    await userEvent.click(screen.getByRole('button', { name: 'Save account time zone' }))
    expect(await screen.findByText('Account time zone saved.')).toBeInTheDocument(); expect(puts).toEqual([{ timeZone: 'Europe/London' }])
    const feedSection = (await screen.findByRole('heading', { name: 'Team calendar feed' }, { timeout: 5000 })).closest('section')!
    await userEvent.click(within(feedSection).getByRole('button', { name: 'Create a private link' }))
    await waitFor(() => expect(created).toBe(1))
  })
  it('hides the account settings from a Manager', async () => {
    mockSchedule()
    mount(<AvailabilityPage />, '/availability', '/availability', { activeAccountId: 'a1', accounts: [{ sellerId: 'a1', vendorName: 'A', role: 'Manager', accountStatus: 'Approved', brandCount: 1 }] })
    await screen.findByRole('heading', { name: 'Provider settings' }, { timeout: 5000 })
    expect(screen.queryByRole('heading', { name: 'Account time zone' })).toBeNull()
  })
})

describe('server-side slot picker and provider-zone times', () => {
  it('offers the engine\'s free times for the chosen day in the provider zone and sends the picked one', async () => {
    slotQueries.length = 0
    const calls = mockSchedule({ booking: booking({ status: 'Confirmed', actions: { ...noActions, reschedule: true } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule…' }))
    const dlg = within(await screen.findByRole('dialog', { name: 'Reschedule booking' }))
    fireEvent.change(dlg.getByLabelText('Date'), { target: { value: '2030-01-10' } })
    const group = await dlg.findByRole('group', { name: 'Free start times on this day' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['09:00', '13:30'])   // 14:00Z and 18:30Z in New York
    // the server works the move out from the booking itself (duration with add-ons, location, its own slot free): the page sends only the booking
    expect(slotQueries.at(-1)).toContain('bookingId=bk1'); expect(slotQueries.at(-1)).not.toMatch(/minutes=|location=|postalCode=|providerId=/)
    await userEvent.click(within(group).getByRole('button', { name: '13:30' }))
    expect(within(group).getByRole('button', { name: '13:30' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(dlg.getByRole('button', { name: 'Move booking' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/reschedule'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/reschedule'))!.body as { start: string }).start).toBe('2030-01-10T18:30:00.000Z')
  })
  it('says so when a day has no free times and still lets the seller type one', async () => {
    mockSchedule({ booking: booking({ status: 'Confirmed', actions: { ...noActions, reschedule: true } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule…' }))
    const dlg = within(await screen.findByRole('dialog', { name: 'Reschedule booking' }))
    fireEvent.change(dlg.getByLabelText('Date'), { target: { value: '2030-03-01' } })
    expect(await dlg.findByText(/No free times on this day/)).toBeInTheDocument()
    expect(dlg.getByLabelText('Start time')).toBeInTheDocument()
  })
  it('shows message times in the provider zone, not the browser zone', async () => {
    mockSchedule({ booking: booking() })
    server.use(http.get(`${API}/seller/bookings/:id/messages`, () => HttpResponse.json({ messages: [{ id: 'm1', direction: 'buyer', text: 'Hello', createdAt: '2030-01-01T10:05:00Z', mine: false }] })))
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    expect(await screen.findByText(/Buyer · .*5:05 AM/)).toBeInTheDocument()   // 10:05Z is 05:05 in New York
  })
})

describe('focus after an action', () => {
  it('moves focus to the next action (or the heading) when the button that was used disappears', async () => {
    mockSchedule({ booking: booking() })
    server.use(http.post(`${API}/seller/bookings/:id/approve`, () => HttpResponse.json(booking({ status: 'Confirmed', version: 2, actions: { ...noActions, cancel: true } }))))
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    const approve = await screen.findByRole('button', { name: 'Approve' })
    approve.focus(); await userEvent.click(approve)
    expect(await screen.findByText('Booking confirmed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    await waitFor(() => expect(document.activeElement && document.activeElement !== document.body).toBe(true))
    expect(document.activeElement?.id === 'page-title' || document.activeElement?.closest('[aria-label="Actions"]') !== null).toBe(true)
  })
})

describe('slot picker details', () => {
  it('shows a hint instead of "Looking for free times" when the date is empty or invalid', async () => {
    mockSchedule({ booking: booking({ status: 'Confirmed', actions: { ...noActions, reschedule: true } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule…' }))
    const dlg = within(await screen.findByRole('dialog', { name: 'Reschedule booking' }))
    fireEvent.change(dlg.getByLabelText('Date'), { target: { value: '' } })
    expect(await dlg.findByText('Choose a date to see the free times.')).toBeInTheDocument()
    expect(dlg.queryByText(/Looking for free times/)).toBeNull()
  })
  it('tells the two 01:30 slots of the day the clocks go back apart and sends the exact instant that was picked', async () => {
    const calls = mockSchedule({ booking: booking({ status: 'Confirmed', actions: { ...noActions, reschedule: true } }) })
    server.use(http.get(`${API}/seller/services/:id/slots`, () => HttpResponse.json({ durationMinutes: 120, slots: [
      { startAt: '2026-11-01T05:30:00Z', endAt: '2026-11-01T07:30:00Z', providerIds: ['m-owner'] },   // 01:30 EDT
      { startAt: '2026-11-01T06:30:00Z', endAt: '2026-11-01T08:30:00Z', providerIds: ['m-owner'] },   // 01:30 EST, an hour later
      { startAt: '2026-11-01T15:00:00Z', endAt: '2026-11-01T17:00:00Z', providerIds: ['m-owner'] },   // 10:00 EST
    ] })))
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule…' }))
    const dlg = within(await screen.findByRole('dialog', { name: 'Reschedule booking' }))
    fireEvent.change(dlg.getByLabelText('Date'), { target: { value: '2026-11-01' } })
    const group = await dlg.findByRole('group', { name: 'Free start times on this day' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['01:30 EDT', '01:30 EST', '10:00'])
    await userEvent.click(within(group).getByRole('button', { name: '01:30 EDT' }))   // the FIRST 01:30; a bare "01:30" would be read as the second
    expect(within(group).getByRole('button', { name: '01:30 EDT' })).toHaveAttribute('aria-pressed', 'true'); expect(within(group).getByRole('button', { name: '01:30 EST' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(dlg.getByRole('button', { name: 'Move booking' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/reschedule'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/reschedule'))!.body as { start: string }).start).toBe('2026-11-01T05:30:00.000Z')
  })
  it('typing a time after picking a slot drops the picked instant', async () => {
    const calls = mockSchedule({ booking: booking({ status: 'Confirmed', actions: { ...noActions, reschedule: true } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule…' }))
    const dlg = within(await screen.findByRole('dialog', { name: 'Reschedule booking' }))
    fireEvent.change(dlg.getByLabelText('Date'), { target: { value: '2030-01-10' } })
    await userEvent.click(await dlg.findByRole('button', { name: '09:00' }))
    fireEvent.change(dlg.getByLabelText('Start time'), { target: { value: '11:15' } })
    expect(dlg.getByRole('button', { name: '09:00' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(dlg.getByRole('button', { name: 'Move booking' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/reschedule'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/reschedule'))!.body as { start: string }).start).toBe('2030-01-10T16:15:00.000Z')   // 11:15 EST
  })
  it('offers free times for a customer-location booking from the calendar too (the server works from the booking, no postal code needed here)', async () => {
    slotQueries.length = 0
    mockSchedule()
    mount(<CalendarPage />, '/calendar', '/calendar?view=agenda&date=2030-01-09')
    await userEvent.click(await screen.findByRole('button', { name: /Home cleaning/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule…' }))
    const dlg = within(await screen.findByRole('dialog', { name: 'Reschedule booking' }))
    fireEvent.change(dlg.getByLabelText('Date'), { target: { value: '2030-01-10' } })
    expect(await dlg.findByRole('group', { name: 'Free start times on this day' })).toBeInTheDocument()
    expect(slotQueries.at(-1)).toContain('bookingId=bk1')
  })
})
