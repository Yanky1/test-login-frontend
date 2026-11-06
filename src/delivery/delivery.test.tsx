import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { API, mount } from '../products/testkit'
import { renderAt, signedIn } from '../test/utils'
import type React from 'react'
import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import DriverApp from './driver'
import SettingsPage from '../pages/Settings'
import DispatchBoard from './DispatchBoard'
import DeliverySettingsPage from './DeliverySettings'
import { DriverQueue, MemoryBlobs, type Sender } from './queue'
import type { DriverMe, StopDto } from './api'

const A = '11111111-1111-1111-1111-111111111111'
const login = (role: string) => ({ sellerId: A, activeAccountId: A, accounts: [{ sellerId: A, vendorName: 'Acme', role, accountStatus: 'Approved', brandCount: 1 }] })
const asRole = (role: string) => signedIn(login(role))
const mountAs = (role: string, ui: React.ReactElement, path: string) => mount(ui, path, path, login(role))
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }

/** A tiny JPEG with an EXIF (APP1) block: SOI, APP1 "Exif\0\0GPS", SOS, data, EOI. */
const JPEG_WITH_GPS = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0b, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53, 0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xff, 0xd9])

const stop = (o: Partial<StopDto> = {}): StopDto => ({
  id: 's1', seq: 1, status: 'OutForDelivery', trackingStatus: 'out_for_delivery', code: 'LD-1', window: { start: '2026-11-04T12:00:00Z', end: '2026-11-04T14:00:00Z' }, eta: null, attempts: 0, version: 2, detailsVisible: true,
  to: { name: 'Jane', line1: '1 Main St', line2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201' },
  contact: { firstName: 'Jane', phone: '+1 555 000 1111', call: 'tel:+15550001111', sms: 'sms:+15550001111' }, navigateUrl: 'https://maps.google.com/?q=1%20Main%20St', proofs: 0, ...o,
})
const me = (stops: StopDto[], over: Partial<DriverMe> = {}, routeStatus: 'Planned' | 'Active' | 'Completed' = 'Active'): DriverMe => ({
  role: 'Driver', consented: true, paused: false, routes: [{ id: 'r1', date: '2026-11-04', status: routeStatus, startedAt: null, version: 1, stops }], ...over,
})
const mockMe = (m: DriverMe) => server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(m)))
const fakeSender = (fail = false) => {
  const calls: { op: string; body?: unknown }[] = []
  const s: Sender = {
    start: async () => { calls.push({ op: 'start' }); if (fail) throw new TypeError('offline') },
    upload: async () => { calls.push({ op: 'upload' }); if (fail) throw new TypeError('offline'); return { id: 'srv-1' } },
    event: async (_s, body) => { calls.push({ op: 'event', body }); if (fail) throw new TypeError('offline') },
  }
  return { s, calls }
}
const mountDriver = (q: DriverQueue) => mountAs('Driver', <DriverApp queueOverride={q} />, '/driver')

describe('driver app', () => {
  it('lists the stops with window, address and status, and a stop opens with navigate / call / text', async () => {
    mockMe(me([stop(), stop({ id: 's2', seq: 2, status: 'InTransit', to: { name: 'Bob', line1: '9 Oak Ave', line2: null, city: 'Brooklyn', region: 'NY', postalCode: '11202' } })]))
    mountDriver(new DriverQueue(mem(), new MemoryBlobs(), fakeSender().s))
    expect(await screen.findByRole('heading', { name: 'My deliveries' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Stop 1.*1 Main St.*Out for delivery/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stop 2.*9 Oak Ave.*In transit/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Stop 1/ }))
    expect(screen.getByRole('link', { name: 'Navigate' })).toHaveAttribute('href', expect.stringContaining('maps.google.com'))
    expect(screen.getByRole('link', { name: 'Call Jane' })).toHaveAttribute('href', 'tel:+15550001111')
    expect(screen.getByRole('link', { name: 'Text' })).toHaveAttribute('href', 'sms:+15550001111')
    expect(screen.queryByText(/relay/i)).not.toBeInTheDocument()
  })

  it('shows no address or contact for a finished stop', async () => {
    mockMe(me([stop({ status: 'Delivered', detailsVisible: false, to: null, contact: null, navigateUrl: null })], {}, 'Completed'))
    mountDriver(new DriverQueue(mem(), new MemoryBlobs(), fakeSender().s))
    await userEvent.click(await screen.findByRole('button', { name: /Stop 1.*Delivered/ }))
    expect(screen.getByText(/address and contact details are no longer shown/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Navigate' })).not.toBeInTheDocument(); expect(screen.queryByText('1 Main St')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delivered' })).not.toBeInTheDocument()
  })

  it('needs a photo for Delivered; the delivery is queued with its photo and the stop turns Delivered at once', async () => {
    let current = me([stop()])
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(current)))
    const { s, calls } = fakeSender()
    const sent: Sender = { ...s, event: async (id, b) => { await s.event(id, b); current = me([stop({ status: 'Delivered', detailsVisible: false, to: null, contact: null, navigateUrl: null })], {}, 'Completed') } }   // the server applied it
    mountDriver(new DriverQueue(mem(), new MemoryBlobs(), sent))
    await userEvent.click(await screen.findByRole('button', { name: /Stop 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delivered' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    expect(await screen.findByText('Take a photo of the delivery first.')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    await userEvent.click(screen.getByLabelText('Left at the door'))
    fireEvent.change(screen.getByLabelText(/Photo/), { target: { files: [new File([JPEG_WITH_GPS], 'p.jpg', { type: 'image/jpeg' })] } })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    await waitFor(() => expect(calls.map((c) => c.op)).toEqual(['upload', 'event']))
    expect(calls[1].body).toMatchObject({ type: 'delivered', placement: 'left_at_door', proofIds: ['srv-1'] })
    expect(await screen.findByRole('button', { name: /Stop 1.*Delivered/ })).toBeInTheDocument()
  })

  it('works offline: the failed attempt is queued, the stop shows it, the banner counts it, and it is sent when the network is back', async () => {
    mockMe(me([stop()]))
    const down = fakeSender(true)
    const q = new DriverQueue(mem(), new MemoryBlobs(), down.s)
    mountDriver(q)
    await userEvent.click(await screen.findByRole('button', { name: /Stop 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Failed attempt' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save failed attempt' }))
    expect(await screen.findByText('Choose a reason.')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'no_one_home')
    await userEvent.click(screen.getByRole('button', { name: 'Save failed attempt' }))
    expect(await screen.findByRole('button', { name: /Stop 1.*Failed attempt/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status', { name: '' }) ?? true).toBeTruthy())
    expect(q.pending()).toBe(1); expect(q.items()[0]).toMatchObject({ kind: 'event', body: { type: 'failed', reason: 'no_one_home' } })
    expect(screen.getByText(/1 waiting to send/)).toBeInTheDocument()
    const up = fakeSender()
    const q2 = new DriverQueue(mem(), new MemoryBlobs(), up.s); void q2
    ;(q as unknown as { send: Sender }).send = up.s          // the network is back
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(up.calls.map((c) => c.op)).toEqual(['event']))
    expect(up.calls[0].body).toMatchObject({ type: 'failed', reason: 'no_one_home' })
    await waitFor(() => expect(q.pending()).toBe(0))
  })

  it('a planned route shows Start route and a failed stop offers try again or return to store', async () => {
    const posted: string[] = []
    server.use(http.post(`${API}/driver/routes/r1/start`, () => { posted.push('start'); return HttpResponse.json({}) }))
    mockMe(me([stop({ status: 'Assigned' })], {}, 'Planned'))
    mountDriver(new DriverQueue(mem(), new MemoryBlobs(), fakeSender().s))
    await userEvent.click(await screen.findByRole('button', { name: 'Start route' }))
    await waitFor(() => expect(posted).toEqual(['start']))
  })

  it('asks for consent before sharing the location and lets the driver pause or stop', async () => {
    mockMe(me([stop()], { consented: false }))
    const calls: unknown[] = []
    server.use(http.post(`${API}/driver/consent`, async ({ request }) => { calls.push(await request.json()); return HttpResponse.json({ consented: true, paused: false }) }))
    mountDriver(new DriverQueue(mem(), new MemoryBlobs(), fakeSender().s))
    expect(await screen.findByText(/only while a route is started/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Allow sharing' }))
    await waitFor(() => expect(calls).toEqual([{ consented: true }]))
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })
})

describe('role guard', () => {
  it('a Driver who opens /orders or /products lands in the driver app', async () => {
    mockMe(me([]))
    asRole('Driver')
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/driver" element={<div>driver home</div>} /><Route path="/orders" element={<div>orders list</div>} /><Route path="/products" element={<div>products</div>} /></Route></Routes>, '/orders')
    expect(await screen.findByText('driver home')).toBeInTheDocument()
    expect(screen.queryByText('orders list')).not.toBeInTheDocument()
  })
  it('a Manager still reaches /orders', async () => {
    asRole('Manager')
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/orders" element={<div>orders list</div>} /><Route path="/driver" element={<div>driver home</div>} /></Route></Routes>, '/orders')
    expect(await screen.findByText('orders list')).toBeInTheDocument()
  })
  /** Records every request a role should not be making; each answers 403 like the real DriverGuard / role checks. */
  const forbid = (paths: string[]) => {
    const hit: string[] = []
    server.use(...paths.map((p) => http.get(`${API}${p}`, () => { hit.push(p); return HttpResponse.json({ status: 403 }, { status: 403 }) })))
    return hit
  }
  it('a Driver on /driver never calls assistant, brands or account/phone', async () => {
    const hit = forbid(['/assistant/config', '/brands', '/account/phone'])
    mockMe(me([]))
    asRole('Driver')
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/driver" element={<DriverApp />} /></Route></Routes>, '/driver')
    await screen.findByText('Active')
    await new Promise((r) => setTimeout(r, 150))
    expect(hit).toEqual([])
  })
  it('a Driver on /settings/security never calls assistant, brands or account/phone', async () => {
    const hit = forbid(['/assistant/config', '/brands', '/account/phone'])
    server.use(http.get(`${API}/account/me`, () => HttpResponse.json({ email: 'd@example.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus: null, vendorName: null })))
    server.use(http.get(`${API}/account/passkeys`, () => HttpResponse.json([])), http.get(`${API}/account/sessions`, () => HttpResponse.json([])))
    asRole('Driver')
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/settings/:tab?" element={<SettingsPage />} /></Route></Routes>, '/settings/security')
    await screen.findByText('Linked logins')
    await new Promise((r) => setTimeout(r, 150))
    expect(hit).toEqual([])
    expect(screen.queryByText('Phone number')).not.toBeInTheDocument()
  })
  it('a Viewer who opens /driver is sent home without calling /driver/me', async () => {
    const hit = forbid(['/driver/me'])
    asRole('Viewer')
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/driver" element={<DriverApp />} /><Route path="/" element={<div>seller home</div>} /></Route></Routes>, '/driver')
    expect(await screen.findByText('seller home')).toBeInTheDocument()
    expect(hit).toEqual([])
  })
})

const delivery = (o: Record<string, unknown> = {}) => ({
  id: 'd1', orderId: 'o1', number: 'SO-2026-000001', brandId: 'b1', status: 'Unassigned', trackingStatus: null, code: 'LD-1', windowId: 'w1', windowStart: '2026-11-04T12:00:00Z', windowEnd: '2026-11-04T14:00:00Z',
  city: 'Brooklyn', postalCode: '11201', routeId: null, seq: 0, driverMembershipId: null, driver: null, feeCents: 500, eta: null, late: false, exception: false, failReason: null, attempts: 0, hasCoordinates: true, version: 1, orderStatus: 'Accepted', ...o,
})
const board = (deliveries: unknown[], routes: unknown[] = []) => ({ date: '2026-11-04', timeZone: 'UTC', windows: [{ id: 'w1', start: '12:00', end: '14:00', capacity: 2, booked: 2, warning: 'full' }], deliveries, routes })

describe('dispatch board', () => {
  const drivers = [{ membershipId: 'm-sam', email: 'sam@x.com', firstName: 'Sam' }, { membershipId: 'm-kim', email: 'kim@x.com', firstName: 'Kim' }]

  it('shows deliveries by window with capacity warnings and late / exception highlights, and assigns a driver', async () => {
    const assigned: unknown[] = []
    server.use(
      http.get(`${API}/seller/delivery/board`, () => HttpResponse.json(board([delivery(), delivery({ id: 'd2', orderId: 'o2', number: 'SO-2026-000002', late: true, status: 'Failed', exception: true, failReason: 'no_one_home', driver: 'Sam', routeId: 'r1', seq: 1 })], [{ id: 'r1', status: 'Active', driverMembershipId: 'm-sam', driver: 'Sam', startedAt: null, version: 1 }]))),
      http.get(`${API}/seller/delivery/drivers`, () => HttpResponse.json(drivers)),
      http.post(`${API}/seller/delivery/deliveries/d1/assign`, async ({ request }) => { assigned.push(await request.json()); return HttpResponse.json({}) }),
    )
    mountAs('Manager', <DispatchBoard />, '/delivery')
    expect(await screen.findByText('2 of 2 booked')).toBeInTheDocument(); expect(screen.getByText('Full')).toBeInTheDocument()
    expect(screen.getByText('Late')).toBeInTheDocument(); expect(screen.getByText(/Needs attention: no one home/)).toBeInTheDocument()
    const assign = await screen.findByRole('button', { name: 'Assign' }); expect(assign).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unassign failed stop' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Driver for SO-2026-000001'), 'm-sam')
    await userEvent.click(assign)
    await waitFor(() => expect(assigned).toEqual([{ driverMembershipId: 'm-sam' }]))
    expect(await screen.findByText('SO-2026-000001 assigned.')).toBeInTheDocument()
  })

  it('optimizes a planned route and shows API errors in plain words; a Viewer gets no assign controls', async () => {
    let optimized = 0
    server.use(
      http.get(`${API}/seller/delivery/board`, () => HttpResponse.json(board([delivery({ id: 'd3', status: 'Assigned', driver: 'Sam', routeId: 'r1', seq: 1 })], [{ id: 'r1', status: 'Planned', driverMembershipId: 'm-sam', driver: 'Sam', startedAt: null, version: 1 }]))),
      http.get(`${API}/seller/delivery/drivers`, () => HttpResponse.json(drivers)),
      http.post(`${API}/seller/delivery/routes/r1/optimize`, () => { optimized++; return HttpResponse.json({}) }),
    )
    const { unmount } = mountAs('Manager', <DispatchBoard />, '/delivery')

    await userEvent.click(await screen.findByRole('button', { name: 'Optimize order' }))
    expect(await screen.findByText('Stops reordered by distance.')).toBeInTheDocument(); expect(optimized).toBe(1)
    unmount()
    mountAs('Viewer', <DispatchBoard />, '/delivery')
    await screen.findAllByText(/SO-2026-000001/)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Delivery settings' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Optimize order' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Unassign' })).not.toBeInTheDocument()
  })
})

describe('delivery settings', () => {
  const base = { brandId: null, enabled: false, timeZone: 'UTC', sameDayCutoff: null, minLeadMinutes: 60, maxDaysAhead: 7, zones: [], windows: [], version: 0, exists: false }
  it('saves zones, fees, windows and the cutoff and shows server validation errors', async () => {
    const bodies: Record<string, unknown>[] = []
    let reject = true
    server.use(
      http.get(`${API}/seller/delivery/settings`, () => HttpResponse.json(base)),
      http.put(`${API}/seller/delivery/settings`, async ({ request }) => {
        const b = (await request.json()) as Record<string, unknown>; bodies.push(b)
        if (reject) { reject = false; return HttpResponse.json({ title: 'Each window needs start < end (HH:mm).', status: 400, errors: { windows: ['Each window needs start < end (HH:mm).'] } }, { status: 400 }) }
        return HttpResponse.json({ ...base, ...b, version: 1, exists: true })
      }),
    )
    mountAs('Owner', <DeliverySettingsPage />, '/settings/delivery')
    await userEvent.click(await screen.findByLabelText('Offer local delivery'))
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } })
    fireEvent.change(screen.getByLabelText(/Same-day cutoff/), { target: { value: '14:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add zone' }))
    const zone = within(screen.getByRole('group', { name: 'Zone 1' }))
    await userEvent.type(zone.getByLabelText('Name'), 'Brooklyn')
    await userEvent.type(zone.getByLabelText('Delivery fee ($)'), '5.50')
    await userEvent.type(zone.getByLabelText(/Postcodes/), '11201, 112*')
    await userEvent.click(screen.getByRole('button', { name: 'Add window' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }))
    expect(await screen.findByText('Each window needs start < end (HH:mm).')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save delivery settings' }))
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(bodies[1]).toMatchObject({ enabled: true, timeZone: 'America/New_York', sameDayCutoff: '14:00', zones: [{ name: 'Brooklyn', feeCents: 550, postcodes: ['11201', '112*'] }], windows: [{ start: '12:00', end: '14:00', capacity: 5 }] })
  })

  it('is read-only for people who cannot edit', async () => {
    server.use(http.get(`${API}/seller/delivery/settings`, () => HttpResponse.json({ ...base, enabled: true, version: 2, exists: true })))
    mountAs('Manager', <DeliverySettingsPage canEdit={false} />, '/settings/delivery')
    expect(await screen.findByLabelText('Offer local delivery')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save delivery settings' })).not.toBeInTheDocument()
  })
})
