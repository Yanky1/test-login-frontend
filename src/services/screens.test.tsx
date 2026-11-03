import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { useState } from 'react'
import { render } from '@testing-library/react'
import NewProductPage from '../products/NewProduct'
import ProductEditorPage from '../products/ProductEditor'
import { detail, mockCatalog } from '../products/testkit'
import AvailabilityPage from './AvailabilityPage'
import BookingDetailPage from './BookingDetailPage'
import BookingsPage from './BookingsPage'
import CalendarPage, { MonthGrid, rangeOf, stepAnchor } from './CalendarPage'
import { Composer } from './QuotePage'
import { parsePostalCodes, ServiceAreaEditor } from './ServiceAreaEditor'
import type { ServiceArea, QuoteDto } from './types'
import { API, ME, booking, calendar, mockSchedule, mount, noActions, providers, service } from './testkit'

describe('listing type picker', () => {
  it('creates a service when "Service" is chosen and a product otherwise', async () => {
    const posts: unknown[] = []
    mockCatalog()
    server.use(http.post(`${API}/seller/products`, async ({ request }) => { posts.push(await request.json()); return HttpResponse.json(detail({ id: 'new1' }), { status: 201 }) }))
    mount(<NewProductPage />, '/products/new')
    expect(await screen.findByRole('radio', { name: /Product/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /Service/ }))
    expect(screen.getByLabelText('Service title')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Service title'), 'Home cleaning')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ title: 'Home cleaning', type: 'service' })
  })
  it('does not send a type for an ordinary product', async () => {
    const posts: Record<string, unknown>[] = []
    mockCatalog()
    server.use(http.post(`${API}/seller/products`, async ({ request }) => { posts.push((await request.json()) as Record<string, unknown>); return HttpResponse.json(detail({ id: 'n2' }), { status: 201 }) }))
    mount(<NewProductPage />, '/products/new')
    await userEvent.type(await screen.findByLabelText('Product title'), 'Rye bread')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(posts).toHaveLength(1)); expect(posts[0]).not.toHaveProperty('type')
  })
})

describe('service area editor', () => {
  it('parses pasted postal codes, de-duplicates and reports invalid ones', () => {
    expect(parsePostalCodes('11201, 11202\n112*; 11201')).toEqual({ ok: ['11201', '11202', '112*'], bad: [] })
    expect(parsePostalCodes('11201, <b>')).toEqual({ ok: ['11201'], bad: ['<b>'] })
  })
  function Harness({ start }: { start?: ServiceArea }) {
    const [v, setV] = useState<ServiceArea>(start ?? { postalCodes: [], radius: null })
    return <><ServiceAreaEditor value={v} onChange={setV} /><output data-testid="json">{JSON.stringify(v)}</output></>
  }
  it('adds and removes codes with labelled controls and edits the radius', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('Postal codes'), '11201, 112*{enter}')
    expect(screen.getByRole('list', { name: /Postal codes in your service area/ })).toHaveTextContent('11201')
    await userEvent.type(screen.getByLabelText('Postal codes'), 'bad!!')
    await userEvent.click(screen.getByRole('button', { name: 'Add codes' }))
    expect(screen.getByText(/Not a valid postal code: bad!!/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove postal code 112*' }))
    await userEvent.type(screen.getByLabelText(/Radius/), '10'); await userEvent.type(screen.getByLabelText(/^Latitude/), '40.7'); await userEvent.type(screen.getByLabelText(/^Longitude/), '-73.9')
    const json = JSON.parse(screen.getByTestId('json').textContent!)
    expect(json.postalCodes).toEqual(['11201']); expect(json.radius).toMatchObject({ distance: 10, lat: 40.7, lng: -73.9, unit: 'km' })
  })
})

describe('service editor sections', () => {
  it('copes with the nulls the server sends for a brand-new service (empty area, no questions)', async () => {
    const fresh = service({ atCustomer: true, serviceArea: { postalCodes: null, radius: null } as unknown as ServiceArea, intake: null as never, addOns: null as never })
    mockCatalog(detail({ id: 's1', type: 'Service', service: fresh, attributeConfig: [] })); mockSchedule()
    mount(<ProductEditorPage />, '/products/:id', '/products/s1')
    expect(await screen.findByLabelText('Postal codes')).toBeInTheDocument()
    const sec = within(screen.getByRole('region', { name: 'Booking' })); expect(sec.getByRole('button', { name: 'Add a question' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Add an add-on' })).toBeInTheDocument()
  })
  const svcDetail = (o = {}) => detail({ id: 's1', type: 'Service', service: service(), attributeConfig: [], issues: [{ key: 'providers', section: 'providers', severity: 'required', message: 'Choose at least one team member.' }], ...o })
  it('shows the service sections instead of price, stock, variations and shipping', async () => {
    mockCatalog(svcDetail()); mockSchedule()
    mount(<ProductEditorPage />, '/products/:id', '/products/s1')
    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeInTheDocument()
    for (const h of ['Timing', 'Where it happens', 'Booking', 'Policies', 'Team']) expect(screen.getByRole('heading', { name: h })).toBeInTheDocument()
    for (const h of ['Price & stock', 'Variations', 'Shipping']) expect(screen.queryByRole('heading', { name: h })).toBeNull()
    expect(screen.queryByRole('button', { name: /Preview as buyer/ })).toBeNull()
    expect(screen.getByLabelText('Hourly rate (USD)')).toHaveValue('60')
    expect(await screen.findByRole('switch', { name: /owner@example.com/ })).toBeChecked()
  })
  it('reveals the service area editor only for at-customer services and saves the details with the listing version', async () => {
    const puts: Record<string, unknown>[] = []
    mockCatalog(svcDetail({ version: 4 })); mockSchedule()
    server.use(http.put(`${API}/seller/services/:id/details`, async ({ request }) => { puts.push((await request.json()) as Record<string, unknown>); return HttpResponse.json(svcDetail({ version: 5, service: service({ atCustomer: true }) })) }))
    mount(<ProductEditorPage />, '/products/:id', '/products/s1')
    await screen.findByRole('heading', { name: 'Where it happens' })
    expect(screen.queryByText('Service area')).toBeNull()
    await userEvent.click(screen.getByRole('switch', { name: "At the customer's location" }))
    expect(screen.getByText('Service area')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Postal codes'), '11201{enter}')
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 4000 })
    const last = puts.at(-1)!
    expect(last).toMatchObject({ version: 4, atCustomer: true, pricingModel: 'hourly', price: 60 }); expect((last.serviceArea as ServiceArea).postalCodes).toEqual(['11201'])
  })
  it('sends the editor token and shows the conflict dialog on a 409, without re-fetching the listing to retry (optimistic concurrency stays effective)', async () => {
    let gets = 0; let puts = 0
    mockCatalog(svcDetail({ version: 4 })); mockSchedule()
    server.use(
      http.get(`${API}/seller/products/s1`, () => { gets++; return HttpResponse.json(svcDetail({ version: 9 })) }),
      http.put(`${API}/seller/services/:id/details`, () => { puts++; return HttpResponse.json({ code: 'version_conflict' }, { status: 409 }) }),
    )
    mount(<ProductEditorPage />, '/products/:id', '/products/s1')
    await screen.findByRole('heading', { name: 'Where it happens' })
    const getsAfterLoad = gets
    await userEvent.click(screen.getByRole('switch', { name: 'Online' }))
    expect(await screen.findByText(/changed somewhere else/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(puts).toBe(1); expect(gets).toBe(getsAfterLoad)
    expect(screen.getByRole('button', { name: 'Keep my version' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Load the latest' })).toBeInTheDocument()
  })
  it('hides hourly-only fields for fixed prices and the rate for quote services', async () => {
    mockCatalog(svcDetail({ service: service({ pricingModel: 'quote', price: null }) })); mockSchedule()
    mount(<ProductEditorPage />, '/products/:id', '/products/s1')
    await screen.findByRole('heading', { name: 'Pricing' })
    expect(screen.queryByLabelText(/rate|Price per job/i)).toBeNull(); expect(screen.getByText(/you reply with a price/i)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('How do you charge?'), 'hourly')
    expect(screen.getByLabelText('Hourly rate (USD)')).toBeInTheDocument(); expect(screen.getByLabelText('Bill in steps of')).toBeInTheDocument()
  })
  it('adds intake questions and add-ons', async () => {
    mockCatalog(svcDetail()); mockSchedule()
    mount(<ProductEditorPage />, '/products/:id', '/products/s1')
    const booking = within(await screen.findByRole('region', { name: 'Booking' }))
    await userEvent.click(booking.getByRole('button', { name: 'Add a question' }))
    await userEvent.type(screen.getByLabelText('Question 1'), 'Any pets?')
    await userEvent.selectOptions(screen.getByLabelText('Answer type for question 1'), 'choice')
    expect(screen.getByLabelText('Options for question 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add an add-on' }))
    expect(screen.getByLabelText('Add-on 1 name')).toBeInTheDocument()
  })
})

describe('availability settings', () => {
  it('blocks saving overlapping intervals and shows the problem next to the day', async () => {
    const calls = mockSchedule()
    mount(<AvailabilityPage />, '/availability')
    const mon = await screen.findByRole('group', { name: 'Monday' })
    await userEvent.click(within(mon).getByRole('button', { name: /Add hours/ }))
    await userEvent.click(within(mon).getByRole('button', { name: /Add hours/ }))
    const closes = within(mon).getAllByLabelText('Monday closes'); const opens = within(mon).getAllByLabelText('Monday opens')
    fireEvent.change(closes[0], { target: { value: '13:00' } }); fireEvent.change(opens[1], { target: { value: '12:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save working hours' }))
    expect(await within(mon).findByRole('alert')).toHaveTextContent(/overlaps/)
    expect(screen.getByText(/Fix the highlighted hours/)).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })
  it('saves a weekly schedule with a date override', async () => {
    const calls = mockSchedule()
    mount(<AvailabilityPage />, '/availability')
    const mon = await screen.findByRole('group', { name: 'Monday' })
    await userEvent.click(within(mon).getByRole('button', { name: /Add hours/ }))
    await userEvent.click(within(mon).getByRole('button', { name: 'Copy Monday to Tue–Fri' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add a date' }))
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2030-12-24' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save working hours' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const body = calls.find((c) => c.method === 'PUT')!.body as { weekly: { day: number; intervals: unknown[] }[]; overrides: { date: string; intervals: unknown[] }[] }
    expect(body.weekly.map((d) => d.day).sort()).toEqual([1, 2, 3, 4, 5]); expect(body.weekly[0].intervals).toEqual([{ start: '09:00', end: '17:00' }])
    expect(body.overrides).toEqual([{ date: '2030-12-24', intervals: [] }])
    expect(await screen.findByText('Working hours saved.')).toBeInTheDocument()
  })
  it('lets only Owners and Admins turn provider mode on or off', async () => {
    mockSchedule({ providers: providers({ providers: [{ ...providers().providers[0], role: 'Manager' }] }) })
    mount(<AvailabilityPage />, '/availability', '/availability', { activeAccountId: 'a1', accounts: [{ sellerId: 'a1', vendorName: 'A', role: 'Manager', accountStatus: 'Approved', brandCount: 1 }] })
    await screen.findByRole('heading', { name: 'Weekly hours' })
    expect(screen.queryByRole('switch', { name: /Takes bookings/ })).toBeNull()
  })
  it('shows the one-time ICS link after creating it', async () => {
    mockSchedule()
    server.use(http.post(`${API}/seller/providers/:id/ics`, () => HttpResponse.json({ token: 'ics_abc', path: '/api/calendar/feeds/ics_abc.ics' })))
    mount(<AvailabilityPage />, '/availability')
    await userEvent.click(await screen.findByRole('button', { name: 'Create a private link' }))
    expect(await screen.findByTestId('ics-url')).toHaveTextContent('/api/calendar/feeds/ics_abc.ics')
    expect(screen.getByText(/shown only once/)).toBeInTheDocument()
  })
})

describe('calendar', () => {
  const at = (view: string) => `/calendar?view=${view}&date=2030-01-09`
  it('lists bookings in the agenda with status words, the provider zone and a booking popup', async () => {
    mockSchedule()
    mount(<CalendarPage />, '/calendar', at('agenda'))
    const item = await screen.findByRole('button', { name: /Home cleaning/ })
    expect(item).toHaveTextContent('Confirmed'); expect(item).toHaveTextContent('10:00 AM–12:00 PM')
    expect(screen.getByText(/Times are shown in America\/New_York/)).toBeInTheDocument()
    await userEvent.click(item)
    const dlg = await screen.findByRole('dialog', { name: 'Home cleaning' })
    expect(within(dlg).getByRole('button', { name: 'Open booking' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('renders the week grid with positioned bookings and a text label for each', async () => {
    mockSchedule()
    mount(<CalendarPage />, '/calendar', at('week'))
    const btn = await screen.findByRole('button', { name: /Confirmed\s*10:00 AM Home cleaning\s*until 12:00 PM, for Jane Buyer/ })
    expect(btn).toHaveTextContent('Confirmed')
    expect(screen.getByRole('region', { name: 'Schedule grid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to the list view' })).toBeInTheDocument()
  })
  it('requests exactly the visible range in the provider zone and refetches when the view changes', async () => {
    const calls = mockSchedule()
    mount(<CalendarPage />, '/calendar', at('week'))
    await screen.findByRole('region', { name: 'Schedule grid' })
    const first = calls.find((c) => c.url.startsWith('/seller/calendar'))!.url
    expect(first).toContain('from=2030-01-07T05%3A00%3A00.000Z'); expect(first).toContain('to=2030-01-14T05%3A00%3A00.000Z')   // Mon 00:00 EST .. next Mon 00:00 EST
    await userEvent.click(screen.getByRole('button', { name: 'Month' }))
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/seller/calendar')).length).toBeGreaterThan(1))
  })
  it('month grid is a keyboard-operable grid with roving tabindex', async () => {
    mockSchedule()
    mount(<CalendarPage />, '/calendar', at('month'))
    const cell = await screen.findByRole('button', { name: /^9 1 booking, Wednesday, January 9, 2030/ })
    cell.focus(); expect(cell).toHaveFocus(); expect(cell).toHaveAttribute('tabindex', '0')
    await userEvent.keyboard('{ArrowRight}')
    const next = screen.getByRole('button', { name: /Thursday, January 10, 2030/ }); expect(next).toHaveFocus(); expect(next).toHaveAttribute('tabindex', '0'); expect(cell).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{ArrowDown}'); expect(screen.getByRole('button', { name: /Thursday, January 17, 2030/ })).toHaveFocus()
    await userEvent.keyboard('{Home}'); expect(screen.getByRole('button', { name: /Monday, January 14, 2030/ })).toHaveFocus()
    await userEvent.keyboard('{End}'); expect(screen.getByRole('button', { name: /Sunday, January 20, 2030/ })).toHaveFocus()
    expect(screen.getByRole('grid', { name: /Month of January 2030/ })).toBeInTheDocument()
  })
  it('MonthGrid opens a day with Enter and announces the booking counts', async () => {
    const picked: string[] = []
    const days = rangeOf('month', '2030-01-09').days
    render(<MonthGrid anchor="2030-01-09" today="2030-01-09" days={days} byDay={new Map([['2030-01-09', [calendar().bookings[0]]]])} onPick={(d) => picked.push(d)} onMonth={() => undefined} />)
    const cell = screen.getByRole('button', { name: /^9 1 booking, Wednesday, January 9, 2030, today/ }); cell.focus()
    await userEvent.keyboard('{Enter}'); expect(picked).toEqual(['2030-01-09'])
  })
  it('steps by the right unit', () => {
    expect(stepAnchor('day', '2030-01-09', 1)).toBe('2030-01-10'); expect(stepAnchor('week', '2030-01-09', -1)).toBe('2030-01-02'); expect(stepAnchor('month', '2030-01-31', 1)).toBe('2030-02-01'); expect(stepAnchor('agenda', '2030-01-09', 1)).toBe('2030-01-23')
    expect(rangeOf('week', '2030-01-09').first).toBe('2030-01-07'); expect(rangeOf('month', '2030-01-09').days).toHaveLength(42)
  })
  it('reschedules through an accessible dialog (no drag and drop needed) in the provider zone', async () => {
    const calls = mockSchedule()
    mount(<CalendarPage />, '/calendar', at('agenda'))
    await userEvent.click(await screen.findByRole('button', { name: /Home cleaning/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Reschedule booking' })
    expect(within(dlg).getByText(/Time zone: America\/New_York/)).toBeInTheDocument()
    fireEvent.change(within(dlg).getByLabelText('Date'), { target: { value: '2030-01-10' } }); fireEvent.change(within(dlg).getByLabelText('Start time'), { target: { value: '14:00' } })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Move booking' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/reschedule'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/reschedule'))!.body as { start: string }).start).toBe('2030-01-10T19:00:00.000Z')   // 14:00 EST
  })
  it('creates a manual block from the toolbar and shows blocks and time off', async () => {
    const calls = mockSchedule({ calendar: calendar({ blocks: [{ id: 'b9', providerId: ME, kind: 'timeoff', startAt: '2030-01-10T05:00:00Z', endAt: '2030-01-11T05:00:00Z', allDay: true, note: 'Holiday' }] }) })
    mount(<CalendarPage />, '/calendar', at('agenda'))
    expect(await screen.findByRole('button', { name: /Time off/ })).toHaveTextContent('Holiday')
    await userEvent.click(screen.getByRole('button', { name: /Block time/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Block time' })
    await userEvent.type(within(dlg).getByLabelText(/^Note/), 'Dentist')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Block this time' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/blocks'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/blocks'))!.body as Record<string, unknown>).note).toBe('Dentist')
  })
  it('shows an empty-state text instead of an empty grid in the list view', async () => {
    mockSchedule({ calendar: calendar({ bookings: [] }) })
    mount(<CalendarPage />, '/calendar', at('agenda'))
    expect(await screen.findByText(/Nothing scheduled/)).toBeInTheDocument()
  })
})

describe('booking detail', () => {
  it('offers only the actions the server allows and approves a request', async () => {
    const calls = mockSchedule({ booking: booking() })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    expect(await screen.findByRole('heading', { name: /Home cleaning/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: /Decline/ })).toBeInTheDocument(); expect(screen.getByRole('button', { name: /Cancel booking/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start job' })).toBeNull(); expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/approve'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/approve'))!.body as { version: number }).version).toBe(1)
    expect(await screen.findByText('Booking confirmed.')).toBeInTheDocument()
  })
  it('shows the provider time zone, price, policy, timeline and the customer to those who may see them', async () => {
    mockSchedule({ booking: booking({ status: 'Confirmed', actions: { ...noActions } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await screen.findByRole('heading', { name: /Home cleaning/ })
    expect(screen.getByText(/America\/New_York \(the provider's\)/)).toBeInTheDocument(); expect(screen.getByText('$130.00')).toBeInTheDocument()
    expect(screen.getByText(/Free cancellation until 24 h before, then 50%/)).toBeInTheDocument()
    expect(screen.getByText('1 Main St, Brooklyn 11201')).toBeInTheDocument(); expect(screen.getByRole('link', { name: '+1 555 010 0000' })).toBeInTheDocument()
    expect(screen.getByText('Any pets?')).toBeInTheDocument(); expect(screen.getByText(/requested/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Actions' })?.querySelectorAll('button')).toHaveLength(0)
  })
  it('hides address and phone when the server says they are not visible, and explains why', async () => {
    mockSchedule({ booking: booking({ customer: { name: 'Jane Buyer', phone: null, address: null, postalCode: '11201', visible: false, redacted: false }, actions: { ...noActions } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await screen.findByRole('heading', { name: /Home cleaning/ })
    expect(screen.queryByText(/1 Main St/)).toBeNull(); expect(screen.queryByText(/555 010/)).toBeNull()
    expect(screen.getByText(/assigned provider and to Owners and Admins/)).toBeInTheDocument()
  })
  it('asks for a reason before cancelling, then confirms and posts it', async () => {
    const calls = mockSchedule({ booking: booking({ status: 'Confirmed' }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: /Cancel booking/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Cancel this booking' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel booking' }))
    expect(await within(dlg).findByText('Write a short reason.')).toBeInTheDocument(); expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(false)
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Provider sick')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel booking' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/cancel'))!.body as { reason: string }).reason).toBe('Provider sick')
  })
  it('completes an hourly job with the actual time and warns about extra time', async () => {
    const calls = mockSchedule({ booking: booking({ status: 'InProgress', actions: { ...noActions, complete: true } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    await userEvent.click(await screen.findByRole('button', { name: 'Complete…' }))
    const dlg = await screen.findByRole('dialog', { name: 'Complete this booking' })
    const input = within(dlg).getByLabelText(/Time actually worked/)
    await userEvent.clear(input); await userEvent.type(input, '190')
    expect(within(dlg).getByRole('status')).toHaveTextContent(/90 minutes more than booked/)
    await userEvent.clear(input); await userEvent.type(input, '0'); await userEvent.click(within(dlg).getByRole('button', { name: 'Mark as completed' }))
    expect(await within(dlg).findByText(/Enter the minutes worked/)).toBeInTheDocument()
    await userEvent.clear(input); await userEvent.type(input, '190'); await userEvent.click(within(dlg).getByRole('button', { name: 'Mark as completed' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/complete'))).toBe(true))
    expect((calls.find((c) => c.url.endsWith('/complete'))!.body as { actualMinutes: number }).actualMinutes).toBe(190)
  })
  it('shows an answerable reschedule request and a proposal waiting for the buyer', async () => {
    mockSchedule({ booking: booking({ status: 'Confirmed', rescheduleRequestedStartAt: '2030-01-10T15:00:00Z', actions: { ...noActions, decideReschedule: true } }) })
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/bk1')
    expect(await screen.findByText(/asked to move this booking to/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept new time' })).toBeInTheDocument()
  })
  it('says so when the booking is not visible to the caller', async () => {
    mockSchedule(); server.use(http.get(`${API}/seller/bookings/:id`, () => HttpResponse.json({ title: 'x' }, { status: 404 })))
    mount(<BookingDetailPage />, '/bookings/:id', '/bookings/zzz')
    expect(await screen.findByRole('heading', { name: 'Booking not found' })).toBeInTheDocument()
  })
})

describe('bookings list', () => {
  it('switches tabs, shows the attention badge and links to details and quote requests', async () => {
    const urls: string[] = []
    mockSchedule()
    server.use(
      http.get(`${API}/seller/bookings/counts`, () => HttpResponse.json({ requests: 2, today: 1, upcoming: 3, quoteRequests: 1, needsAction: 3 })),
      http.get(`${API}/seller/bookings`, ({ request }) => { urls.push(new URL(request.url).search); return HttpResponse.json({ items: [{ id: 'bk1', number: 'BK-1', status: 'Requested', serviceId: 's1', serviceTitle: 'Home cleaning', brandId: 'b1', providerId: ME, location: 'customer', startAt: '2030-01-09T15:00:00Z', endAt: '2030-01-09T17:00:00Z', totalCents: 13000, approvalDeadline: '2030-01-08T15:00:00Z', rescheduleRequested: false, isMine: true, buyerName: 'Jane' }], total: 1, page: 1, pageSize: 20 }) }),
      http.get(`${API}/seller/quote-requests`, () => HttpResponse.json({ items: [{ id: 'q1', status: 'Requested', serviceId: 's1', serviceTitle: 'Fence repair', brandId: 'b1', location: 'customer', buyerName: 'Sam', details: 'x', postalCode: '11201', preferredTimes: [], address: null, phone: null, quote: null, bookingId: null, declineReason: null, createdAt: '2030-01-01T10:00:00Z', version: 1 }], total: 1, page: 1, pageSize: 20 })),
    )
    mount(<BookingsPage />, '/bookings')
    const tab = await screen.findByRole('tab', { name: /Requests/ })
    expect(tab).toHaveAttribute('aria-selected', 'true'); expect(within(tab).getByLabelText('2 need attention')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Open\s*BK-1/ })).toHaveAttribute('href', '/bookings/bk1')
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Quote requests/ }))
    expect(await screen.findByRole('link', { name: /Send a quote/ })).toHaveAttribute('href', '/bookings/quotes/q1')
    expect(urls[0]).toContain('tab=requests')
  })
})

describe('quote composer', () => {
  const quote = (o: Partial<QuoteDto> = {}): QuoteDto => ({ id: 'q1', status: 'Requested', serviceId: 's1', serviceTitle: 'Fence repair', brandId: 'b1', location: 'customer', buyerName: 'Sam', details: 'Broken fence', postalCode: '11201', preferredTimes: [], address: null, phone: null, quote: null, bookingId: null, declineReason: null, createdAt: '2030-01-01T10:00:00Z', version: 3, ...o })
  it('validates the quote and sends price, duration, provider, slots in the provider zone and the version', async () => {
    const sent: Record<string, unknown>[] = []
    mockSchedule()
    server.use(http.post(`${API}/seller/quote-requests/:id/quote`, async ({ request }) => { sent.push((await request.json()) as Record<string, unknown>); return HttpResponse.json(quote({ status: 'Quoted' })) }))
    let done = 0
    mount(<Composer quote={quote()} onDone={() => done++} />, '/q')
    await screen.findByRole('option', { name: 'owner@example.com' })
    await userEvent.click(screen.getByRole('button', { name: 'Send quote' }))
    expect(await screen.findByText('Enter a price between 0 and 1,000,000.')).toBeInTheDocument(); expect(screen.getByText('Propose at least one start time.')).toBeInTheDocument(); expect(sent).toHaveLength(0)
    await userEvent.type(screen.getByLabelText('Price (USD)'), '250')
    fireEvent.change(screen.getByLabelText('Proposed date 1'), { target: { value: '2030-02-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add another time' }))
    fireEvent.change(screen.getByLabelText('Proposed date 2'), { target: { value: '2030-02-06' } }); fireEvent.change(screen.getByLabelText('Proposed time 2'), { target: { value: '14:00' } })
    await userEvent.type(screen.getByLabelText(/Note to the buyer/), 'Includes parts.')
    await userEvent.click(screen.getByRole('button', { name: 'Send quote' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ price: 250, durationMinutes: 120, providerId: ME, note: 'Includes parts.', version: 3, slots: ['2030-02-05T14:00:00.000Z', '2030-02-06T19:00:00.000Z'] })
    await waitFor(() => expect(done).toBe(1))
  })
  it('rejects duplicate proposed times', async () => {
    mockSchedule()
    mount(<Composer quote={quote()} onDone={() => undefined} />, '/q')
    await screen.findByRole('option', { name: 'owner@example.com' })
    await userEvent.type(screen.getByLabelText('Price (USD)'), '10')
    fireEvent.change(screen.getByLabelText('Proposed date 1'), { target: { value: '2030-02-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add another time' }))
    fireEvent.change(screen.getByLabelText('Proposed date 2'), { target: { value: '2030-02-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'Send quote' }))
    expect(await screen.findByText('Each proposed time must be different.')).toBeInTheDocument()
  })
})
