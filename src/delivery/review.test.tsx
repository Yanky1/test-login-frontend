import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'
import { Route, Routes } from 'react-router-dom'
import { api, ApiError, onSessionEnded } from '../api'
import { RequireAuth } from '../components/RequireAuth'
import { setCrossTabForTests, type CrossTab, type TabMessage } from '../lib/crossTab'
import { canLeave } from '../lib/unsaved'
import Home from '../pages/Home'
import SettingsPage from '../pages/Settings'
import { API, mount } from '../products/testkit'
import { server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'
import { newId, type DriverMe, type StopDto } from './api'
import DispatchBoard from './DispatchBoard'
import DriverApp, { stripJpegMetadata } from './driver'
import { classify, DriverQueue, MemoryBlobs, type Sender } from './queue'
import { cacheDriverUser, clearDriverStorage, driverStorageName, hasPendingDriverWork, readCachedDriverRoutes, cacheDriverRoutes } from './storage'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const login = (role: string, account = A, email = 'sam@x.com') => ({ email, sellerId: account, activeAccountId: account, accounts: [{ sellerId: account, vendorName: 'Acme', role, accountStatus: 'Approved', brandCount: 1 }] })
const mountAs = (role: string, ui: React.ReactElement, path: string) => mount(ui, path, path, login(role))
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }
const err = (status: number, code?: string) => new ApiError(status, { code, title: 'Server said no' })
const stop = (o: Partial<StopDto> = {}): StopDto => ({
  id: 's1', seq: 1, status: 'OutForDelivery', trackingStatus: 'out_for_delivery', code: 'LD-1', window: { start: '2026-11-04T12:00:00Z', end: '2026-11-04T14:00:00Z' }, eta: null, attempts: 0, version: 2, detailsVisible: true,
  to: { name: 'Jane', line1: '1 Main St', line2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201' },
  contact: { firstName: 'Jane', phone: '+1 555 000 1111', call: 'tel:+15550001111', sms: 'sms:+15550001111' }, navigateUrl: 'https://maps.google.com/?q=1', proofs: 0, ...o,
})
const me = (stops: StopDto[]): DriverMe => ({ role: 'Driver', consented: true, paused: false, routes: [{ id: 'r1', date: '2026-11-04', status: 'Active', startedAt: null, version: 1, stops }] })
const NOOP: Sender = { start: async () => undefined, upload: async () => ({ id: 'x' }), event: async () => ({ applied: true }) }
const JPEG_WITH_GPS = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0b, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53, 0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xff, 0xd9])

/** Fake "other tab": a CrossTab whose remote messages are injected by the test. */
function fakeBus() {
  const subs = new Set<(m: TabMessage) => void>()
  const bus: CrossTab = { post: () => undefined, subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } } }
  return { bus, emit: (m: TabMessage) => subs.forEach((f) => f(m)) }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

// ---- 1: what is retried, paused or dropped ---------------------------------------------------------------------------------------------
describe('queue failure handling', () => {
  const sender = (fail: (op: string, n: number) => unknown) => {
    const calls: { op: string; id?: string }[] = []
    const s: Sender = {
      start: async () => { calls.push({ op: 'start' }) },
      upload: async (_s, c) => { calls.push({ op: 'upload' }); const e = fail('upload', calls.length); if (e) throw e; return { id: 'srv-' + c } },
      event: async (_s, b) => { calls.push({ op: 'event', id: b.clientEventId }); const e = fail('event', calls.length); if (e) throw e; return { applied: true } },
    }
    return { s, calls }
  }

  it('classifies the answers: only validation-style refusals are final', () => {
    expect(classify(new TypeError('Failed to fetch'))).toBe('retry')
    for (const st of [500, 502, 503, 408, 429]) expect(classify(err(st))).toBe('retry')
    expect(classify(err(401))).toBe('pause')
    expect(classify(err(403, 'no_active_account'))).toBe('pause'); expect(classify(err(403, 'driver_forbidden'))).toBe('pause')
    expect(classify(err(409, 'version_conflict'))).toBe('backoff')
    for (const [st, c] of [[422, 'proof_required'], [409, 'invalid_state'], [409, 'stop_finished'], [404, undefined], [400, undefined]] as const) expect(classify(err(st, c))).toBe('final')
  })

  it('a 401 (or a lost account) pauses the flush and keeps the delivery AND its photo', async () => {
    let denied = true
    const { s, calls } = sender((op) => (op === 'event' && denied ? err(401) : null))
    const blobs = new MemoryBlobs(); const q = new DriverQueue(mem(), blobs, s)
    const p = await q.enqueueProof('s1', 'photo', new Blob(['p']))
    q.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' }, [p])
    const r = await q.flush()
    expect(r).toMatchObject({ paused: true, offline: false })
    expect(q.pending()).toBe(1); expect(q.failures()).toHaveLength(0); expect(blobs.size).toBe(1)      // nothing dropped, the photo is still on the device
    denied = false
    expect((await q.flush()).sent).toBe(1)
    expect(calls.filter((c) => c.op === 'upload')).toHaveLength(1)                                    // the photo was not uploaded again
    expect(q.pending()).toBe(0)
    const { s: s2 } = sender((op) => (op === 'event' ? err(403, 'driver_forbidden') : null))
    const q2 = new DriverQueue(mem(), new MemoryBlobs(), s2); q2.enqueueEvent('s1', { type: 'out_for_delivery' })
    expect(await q2.flush()).toMatchObject({ paused: true }); expect(q2.pending()).toBe(1); expect(q2.failures()).toHaveLength(0)
  })

  it('a version conflict is retried with the SAME client event id after a growing delay', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
    let conflicts = 2
    const { s, calls } = sender((op) => (op === 'event' && conflicts-- > 0 ? err(409, 'version_conflict') : null))
    const q = new DriverQueue(mem(), new MemoryBlobs(), s)
    const id = q.enqueueEvent('s1', { type: 'out_for_delivery' })
    expect(await q.flush()).toMatchObject({ offline: true }); expect(calls).toHaveLength(1)
    expect(await q.flush()).toMatchObject({ offline: true }); expect(calls).toHaveLength(1)           // still backing off: nothing is sent
    vi.advanceTimersByTime(2_100)
    expect(await q.flush()).toMatchObject({ offline: true }); expect(calls).toHaveLength(2)           // second conflict: longer delay
    vi.advanceTimersByTime(2_100); expect(await q.flush()).toMatchObject({ offline: true }); expect(calls).toHaveLength(2)
    vi.advanceTimersByTime(2_100)
    expect((await q.flush()).sent).toBe(1); expect(calls).toHaveLength(3)
    expect(new Set(calls.map((c) => c.id))).toEqual(new Set([id]))                                    // always the same id: the server applies it once
    expect(q.failures()).toHaveLength(0); expect(q.pending()).toBe(0)
  })

  it('keeps a photo until its event has settled, and removes it after a final refusal too', async () => {
    const { s } = sender((op) => (op === 'event' ? err(409, 'stop_finished') : null))
    const blobs = new MemoryBlobs(); const q = new DriverQueue(mem(), blobs, s)
    const p = await q.enqueueProof('s1', 'photo', new Blob(['p']))
    q.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' }, [p])
    expect(blobs.size).toBe(1)
    await q.flush()
    expect(q.failures()).toHaveLength(1); expect(q.failures()[0].code).toBe('stop_finished'); expect(blobs.size).toBe(0)
    // a successful delivery clears its photo as well, but only after the event was accepted
    const ok = sender(() => null); const b2 = new MemoryBlobs(); const q2 = new DriverQueue(mem(), b2, ok.s)
    const p2 = await q2.enqueueProof('s2', 'photo', new Blob(['p'])); q2.enqueueEvent('s2', { type: 'delivered', placement: 'left_at_door' }, [p2])
    await q2.flush(); expect(b2.size).toBe(0)
  })

  it('tells the driver when an older or already-finished update was skipped', async () => {
    const calls: unknown[] = []
    const s: Sender = { start: async () => undefined, upload: async () => ({ id: 'x' }), event: async () => { calls.push(1); return calls.length === 1 ? { applied: false, reason: 'ignored_stale' } : calls.length === 2 ? { applied: false, reason: 'ignored_state' } : { applied: false, replayed: true } } }
    const q = new DriverQueue(mem(), new MemoryBlobs(), s)
    q.enqueueEvent('s1', { type: 'out_for_delivery' }); q.enqueueEvent('s1', { type: 'failed', reason: 'refused' }); q.enqueueEvent('s1', { type: 'reattempt' })
    await q.flush()
    expect(q.notices().map((n) => n.message)).toEqual([expect.stringContaining('newer update'), expect.stringContaining('already finished')])   // a plain replay says nothing
    q.dismissNotices(); expect(q.notices()).toHaveLength(0)
  })
})

// ---- 2: client ids are real GUIDs ---------------------------------------------------------------------------------------------------
describe('client ids', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  it('are RFC 4122 v4 UUIDs even without crypto.randomUUID (http origins, older Safari)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a } })
    const ids = Array.from({ length: 50 }, () => newId())
    for (const id of ids) expect(id).toMatch(V4)
    expect(new Set(ids).size).toBe(50)
    vi.stubGlobal('crypto', undefined)
    expect(newId()).toMatch(V4)
  })
})

// ---- 3: what is kept on the device -----------------------------------------------------------------------------------------------------
describe('device storage', () => {
  it('is keyed by user and account, so one account never replays into another', async () => {
    const kv = mem()
    const a = new DriverQueue(kv, new MemoryBlobs(), undefined, driverStorageName({ email: 'sam@x.com', activeAccountId: A }))
    const b = new DriverQueue(kv, new MemoryBlobs(), undefined, driverStorageName({ email: 'sam@x.com', activeAccountId: B }))
    const other = new DriverQueue(kv, new MemoryBlobs(), undefined, driverStorageName({ email: 'kim@x.com', activeAccountId: A }))
    a.enqueueEvent('s1', { type: 'out_for_delivery' })
    expect(a.pending()).toBe(1); expect(b.pending()).toBe(0); expect(other.pending()).toBe(0)
  })

  it('clearDriverStorage removes every solvelt.driver.* key and the photo database, and nothing else', () => {
    localStorage.setItem('solvelt.driver.queue.x', '[{"id":"1"}]'); localStorage.setItem('solvelt.driver.failures.x', '[]'); localStorage.setItem('theme', 'dark')
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del })
    expect(hasPendingDriverWork()).toBe(true)
    clearDriverStorage()
    expect(localStorage.getItem('solvelt.driver.queue.x')).toBeNull(); expect(localStorage.getItem('solvelt.driver.failures.x')).toBeNull(); expect(localStorage.getItem('theme')).toBe('dark')
    expect(del).toHaveBeenCalledWith('solvelt-driver'); expect(hasPendingDriverWork()).toBe(false)
  })

  const shell = <Routes><Route element={<RequireAuth />}><Route path="/driver" element={<SessionProbe />} /></Route><Route path="/login" element={<div>login page</div>} /></Routes>
  const seed = () => { localStorage.setItem('solvelt.driver.queue.sam|A', '[{"id":"1"}]'); localStorage.setItem('solvelt.driver.route.sam|A', '{}') }
  const wiped = () => expect(localStorage.getItem('solvelt.driver.queue.sam|A')).toBeNull()

  it('is wiped (queue, cached route and the photo database) when the session ends', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seed()
    signedIn(login('Driver'))
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json({ error: 'Session expired' }, { status: 401 })))
    renderAt(shell, '/driver')
    const call = await screen.findByRole('button', { name: 'call api' })
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.json({ error: 'gone' }, { status: 401 })))      // the refresh cookie is no longer valid: the session is really over
    await userEvent.click(call)
    await waitFor(() => wiped())
    expect(localStorage.getItem('solvelt.driver.route.sam|A')).toBeNull(); expect(del).toHaveBeenCalledWith('solvelt-driver')
  })

  it('is wiped on a manual log-out', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seed()
    signedIn(login('Driver'))
    renderAt(shell, '/driver')
    await screen.findByRole('button', { name: 'call api' })
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await waitFor(() => wiped()); expect(del).toHaveBeenCalled()
  })

  it('is wiped when another tab logs out', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seed()
    const bus = fakeBus(); setCrossTabForTests(bus.bus)
    signedIn(login('Driver'))
    renderAt(shell, '/driver')
    await screen.findByRole('button', { name: 'call api' })
    act(() => bus.emit({ type: 'logout', reason: 'manual' }))
    await waitFor(() => wiped()); expect(del).toHaveBeenCalled()
    setCrossTabForTests(null)
  })

  it('a manual log-out first tries to send what is waiting, then warns before discarding it', async () => {
    const calls: string[] = []
    let online = false
    const s: Sender = { start: async () => undefined, upload: async () => ({ id: 'x' }), event: async () => { calls.push('event'); if (!online) throw new TypeError('offline'); return { applied: true } } }
    const q = new DriverQueue(mem(), new MemoryBlobs(), s); q.enqueueEvent('s1', { type: 'out_for_delivery' })
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    mountAs('Driver', <DriverApp queueOverride={q} />, '/driver')
    await screen.findByRole('heading', { name: 'My deliveries' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(await canLeave()).toBe(false)                                  // still offline: asked, and the driver said stay
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('have not been sent'))
    online = true
    confirm.mockClear()
    expect(await canLeave()).toBe(true)                                   // back online: it was sent first, no question
    expect(confirm).not.toHaveBeenCalled(); expect(q.pending()).toBe(0)
  })
})

function SessionProbe() { return <button onClick={() => void api('/driver/me').catch(() => undefined)}>call api</button> }

// ---- 4: offline reload ----------------------------------------------------------------------------------------------------------------------
describe('offline', () => {
  const routes = () => <Routes><Route element={<RequireAuth />}><Route path="/driver" element={<div>driver home</div>} /></Route><Route path="/login" element={<div>login page</div>} /></Routes>

  it('an offline reload of /driver stays in the app when a driver profile is cached, but a real "no session" still goes to login', async () => {
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.error()))      // the network is down
    cacheDriverUser({ email: 'sam@x.com', sellerId: A, vendorName: 'Acme', accountStatus: 'Approved', roles: ['Seller'], activeAccountId: A, accounts: [], role: 'Driver' })
    renderAt(routes(), '/driver')
    expect(await screen.findByText('driver home')).toBeInTheDocument()
  })

  it('without a cached driver the unreachable server is treated like before (login)', async () => {
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.error()))
    renderAt(routes(), '/driver')
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })

  it('a 401 followed by an unreachable server does not end the session or clear the queue', async () => {
    signedIn(login('Driver'))
    const ended = vi.fn(); const off = onSessionEnded(ended)
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json({}, { status: 401 })))
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/driver" element={<SessionProbe />} /></Route></Routes>, '/driver')
    await screen.findByText('call api')
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.error()))
    await expect(api('/driver/me')).rejects.toBeInstanceOf(TypeError)
    expect(ended).not.toHaveBeenCalled(); off()
  })

  it('shows the cached route (addresses, no names or phone numbers) when the network is down', async () => {
    cacheDriverRoutes('sam@x.com|' + A, me([stop()]))
    const cached = readCachedDriverRoutes<DriverMe>('sam@x.com|' + A)!
    expect(cached.routes[0].stops[0].contact).toBeNull(); expect(cached.routes[0].stops[0].to?.name).toBe(''); expect(JSON.stringify(cached)).not.toContain('555')
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.error()))
    mountAs('Driver', <DriverApp queueOverride={new DriverQueue(mem(), new MemoryBlobs(), NOOP, 'sam@x.com|' + A)} />, '/driver')
    expect(await screen.findByRole('button', { name: /1 Main St/ })).toBeInTheDocument()
    expect(screen.getByText(/You are offline/)).toBeInTheDocument()
  })
})

// ---- 5: signature pad -----------------------------------------------------------------------------------------------------------------------
describe('signature pad', () => {
  it('is painted on a light sheet when it appears, and dark ink is used, so the exported PNG is readable in dark mode', async () => {
    const ctx = { fillRect: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), drawImage: vi.fn(), fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    mountAs('Driver', <DriverApp queueOverride={new DriverQueue(mem(), new MemoryBlobs(), NOOP, 'x')} />, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: /Stop 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delivered' }))
    await screen.findByRole('img', { name: /Signature/ })
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 600, 220)
    expect(ctx.fillStyle).toBe('#ffffff'); expect(ctx.strokeStyle).toBe('#14172b')
    await userEvent.click(screen.getByRole('button', { name: 'Clear signature' }))
    expect(ctx.fillRect).toHaveBeenCalledTimes(2)                                // clearing repaints the sheet instead of leaving it transparent
  })
})

// ---- 6: focus -----------------------------------------------------------------------------------------------------------------------------------
describe('focus', () => {
  it('moves into the stop when it opens and back to its button in the list when it closes', async () => {
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop(), stop({ id: 's2', seq: 2, status: 'InTransit' })]))))
    mountAs('Driver', <DriverApp queueOverride={new DriverQueue(mem(), new MemoryBlobs(), NOOP, 'x')} />, '/driver')
    const second = await screen.findByRole('button', { name: /Stop 2/ })
    await userEvent.click(second)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Stop 2' })))
    await userEvent.click(screen.getByRole('button', { name: '← All stops' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Stop 2/ })))
  })
})

// ---- 7: dispatch board ---------------------------------------------------------------------------------------------------------------------------
describe('dispatch board after a failed action', () => {
  it('reloads the board and says that someone else changed it (409)', async () => {
    let boards = 0
    const d = { id: 'd1', orderId: 'o1', number: 'SO-1', brandId: 'b1', status: 'Unassigned', trackingStatus: null, code: 'LD-1', windowId: 'w1', windowStart: '2026-11-04T12:00:00Z', windowEnd: '2026-11-04T14:00:00Z', city: 'Brooklyn', postalCode: '11201', routeId: null, seq: 0, driverMembershipId: null, driver: null, feeCents: 500, eta: null, late: false, exception: false, failReason: null, attempts: 0, hasCoordinates: true, version: 1, orderStatus: 'Accepted' }
    server.use(
      http.get(`${API}/seller/delivery/board`, () => { boards++; return HttpResponse.json({ date: '2026-11-04', timeZone: 'UTC', windows: [], deliveries: [d], routes: [] }) }),
      http.get(`${API}/seller/delivery/drivers`, () => HttpResponse.json([{ membershipId: 'm1', email: 'sam@x.com', firstName: 'Sam' }])),
      http.post(`${API}/seller/delivery/deliveries/d1/assign`, () => HttpResponse.json({ title: 'Conflict', code: 'version_conflict' }, { status: 409 })),
    )
    mountAs('Manager', <DispatchBoard />, '/delivery')
    await userEvent.selectOptions(await screen.findByLabelText('Driver for SO-1'), 'm1')
    const before = boards
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }))
    expect(await screen.findByText(/changed by someone else/)).toBeInTheDocument()
    await waitFor(() => expect(boards).toBeGreaterThan(before))
  })
})

// ---- 8: photos --------------------------------------------------------------------------------------------------------------------------------------
describe('photos', () => {
  it('stripJpegMetadata removes the EXIF block and keeps the image data; garbage is refused', () => {
    const out = stripJpegMetadata(JPEG_WITH_GPS)!
    expect(new TextDecoder('latin1').decode(out)).not.toContain('Exif'); expect(Array.from(out.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xda]); expect(Array.from(out.slice(-3))).toEqual([0xaa, 0xbb, 0xff].slice(0, 0).concat([0xbb, 0xff, 0xd9]).slice(0, 3))
    expect(stripJpegMetadata(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull()
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff]))).toBeNull()
  })

  it('a photo that cannot be processed is rejected: nothing is queued, so no raw copy (with GPS) reaches the device storage', async () => {
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    const blobs = new MemoryBlobs(); const q = new DriverQueue(mem(), blobs, NOOP, 'x')
    mountAs('Driver', <DriverApp queueOverride={q} />, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: /Stop 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delivered' }))
    fireEvent.change(screen.getByLabelText(/Photo/), { target: { files: [new File(['not an image'], 'p.heic', { type: 'image/heic' })] } })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    expect(await screen.findByText(/could not be prepared/)).toBeInTheDocument()
    expect(q.pending()).toBe(0); expect(blobs.size).toBe(0)
  })

  it('a JPEG is queued without its EXIF block when the canvas path is not available', async () => {
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    const offline: Sender = { start: async () => { throw new TypeError('offline') }, upload: async () => { throw new TypeError('offline') }, event: async () => { throw new TypeError('offline') } }
    const kv = mem(); const blobs = new MemoryBlobs(); const q = new DriverQueue(kv, blobs, offline, 'x')
    mountAs('Driver', <DriverApp queueOverride={q} />, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: /Stop 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delivered' }))
    fireEvent.change(screen.getByLabelText(/Photo/), { target: { files: [new File([JPEG_WITH_GPS], 'p.jpg', { type: 'image/jpeg' })] } })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }))
    await waitFor(() => expect(blobs.size).toBe(1))
    const key = Object.values(JSON.parse(kv.getItem('solvelt.driver.blobkeys.x') ?? '{}') as Record<string, string>)[0]
    const stored = await (await blobs.get(key))!.arrayBuffer()
    expect(new TextDecoder('latin1').decode(new Uint8Array(stored))).not.toContain('Exif')
  })
})

// ---- 9: small items ---------------------------------------------------------------------------------------------------------------------------------
describe('small items', () => {
  it('Home sends a Driver to the driver app', async () => {
    signedIn(login('Driver'))
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/" element={<Home />} /><Route path="/driver" element={<div>driver home</div>} /></Route></Routes>, '/')
    expect(await screen.findByText('driver home')).toBeInTheDocument()
  })

  it('Settings shows a Driver only the security settings and a way back to the driver app', async () => {
    server.use(http.get(`${API}/account/me`, () => HttpResponse.json({ email: 'sam@x.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus: null, vendorName: null })))
    mountAs('Driver', <SettingsPage />, '/settings/team')
    expect(await screen.findByRole('link', { name: 'Security' })).toBeInTheDocument()
    for (const n of ['Profile', 'Team', 'Brands', 'Notifications', 'Availability', 'Local delivery']) expect(screen.queryByRole('link', { name: n })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the driver app' })).toHaveAttribute('href', '/driver')
  })

  it('the Dismiss buttons are real touch targets', async () => {
    const q = new DriverQueue(mem(), new MemoryBlobs(), { start: async () => undefined, upload: async () => ({ id: 'x' }), event: async () => { throw err(422, 'proof_required') } }, 'x')
    q.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' }); await q.flush()
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    mountAs('Driver', <DriverApp queueOverride={q} />, '/driver')
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    expect(dismiss).toHaveClass('dr-small')                                   // .dr-small is min-height: var(--target) (44px)
  })
})
