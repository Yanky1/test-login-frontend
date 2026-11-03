import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import AvailabilityPage from './AvailabilityPage'
import BookingDetailPage from './BookingDetailPage'
import QuotePage, { Composer } from './QuotePage'
import { ServiceProviders } from './ServiceSections'
import type { QuoteDto } from './types'
import { API, NY, booking, mockSchedule, mount, noActions } from './testkit'

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
