import { readFileSync } from 'node:fs'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Route, Routes } from 'react-router-dom'
import { api, ApiError, onSessionEnded } from '../api'
import { useAuth } from '../auth'
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
import DriverApp, { shrinkImage, stripJpegMetadata } from './driver'
import { classify, DriverQueue, httpSender, MemoryBlobs, type Sender } from './queue'
import { cacheDriverUser, clearDriverStorage, clearDriverStorageFor, endDriverSession, expireDriverStorage, KEPT_MAX_AGE_DAYS, readExpiredNotice, driverStorageName, hasPendingDriverWork, readCachedDriverRoutes, cacheDriverRoutes } from './storage'

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

  it('a conflict that never clears is moved to the failures after a few tries, so it cannot block the stops behind it', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
    const sent: string[] = []
    const s: Sender = { start: async () => undefined, upload: async () => ({ id: 'x' }), event: async (stop) => { sent.push(stop); if (stop === 's1') throw err(409, 'version_conflict'); return { applied: true } } }
    const blobs = new MemoryBlobs(); const q = new DriverQueue(mem(), blobs, s)
    const p = await q.enqueueProof('s1', 'photo', new Blob(['p']))
    q.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' }, [p]); q.enqueueEvent('s2', { type: 'out_for_delivery' })
    let tries = 0
    while (q.failures().length === 0 && tries < 50) { await q.flush(); tries++; if (q.failures().length === 0) { expect(sent).not.toContain('s2'); vi.advanceTimersByTime(6 * 60_000) } }   // blocked while it is retried
    expect(tries).toBeLessThanOrEqual(10)                                                             // ...but only for a handful of tries
    expect(q.failures()).toHaveLength(1); expect(q.failures()[0].code).toBe('version_conflict')
    expect(sent).toContain('s2'); expect(q.pending()).toBe(0); expect(blobs.size).toBe(0)             // the stop behind it went out, and its photo was settled
  })

  it('tells the driver about a skipped update even when the answer is a replay', async () => {
    const s: Sender = { start: async () => undefined, upload: async () => ({ id: 'x' }), event: async () => ({ applied: false, replayed: true, result: 'ignored_stale' }) }
    const q = new DriverQueue(mem(), new MemoryBlobs(), s); q.enqueueEvent('s1', { type: 'out_for_delivery' }); await q.flush()
    expect(q.notices().map((n) => n.message)).toEqual([expect.stringContaining('newer update')])
  })

  it('a real flush through httpSender whose event gets a 401 (and whose refresh gets a 401) pauses and keeps the delivery', async () => {
    server.use(
      http.post(`${API}/driver/stops/s1/events`, () => HttpResponse.json({ error: 'Session expired' }, { status: 401 })),
      http.post(`${API}/auth/refresh`, () => HttpResponse.json({ error: 'gone' }, { status: 401 })),
    )
    const q = new DriverQueue(mem(), new MemoryBlobs(), httpSender)
    q.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' })
    expect(await q.flush()).toMatchObject({ paused: true, sent: 0 })
    expect(q.pending()).toBe(1); expect(q.failures()).toHaveLength(0)
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
  const seed = () => { localStorage.setItem('solvelt.driver.queue.sam@x.com|A', '[{"id":"1"}]'); localStorage.setItem('solvelt.driver.route.sam@x.com|A', '{}') }
  const wiped = () => expect(localStorage.getItem('solvelt.driver.queue.sam@x.com|A')).toBeNull()

  const kept = () => {
    expect(localStorage.getItem('solvelt.driver.queue.sam@x.com|A')).toBe('[{"id":"1"}]')                // the unsent delivery is still there...
    expect(localStorage.getItem('solvelt.driver.route.sam@x.com|A')).toBeNull()                         // ...but the cached addresses and the cached profile are gone
    expect(localStorage.getItem('solvelt.driver.cachedUser')).toBeNull()
  }

  it('keeps unsent deliveries (and the photo database) when the session ends, through the real api() with a refresh that answers 401', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seed()
    signedIn(login('Driver'))
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json({ error: 'Session expired' }, { status: 401 })))
    renderAt(shell, '/driver')
    const call = await screen.findByRole('button', { name: 'call api' })
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.json({ error: 'gone' }, { status: 401 })))      // the refresh cookie is no longer valid: the session is really over
    await userEvent.click(call)
    expect(await screen.findByText('login page')).toBeInTheDocument()
    kept(); expect(del).not.toHaveBeenCalled()
  })

  it('wipes everything when the session ends and nothing is waiting', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del })
    localStorage.setItem('solvelt.driver.queue.sam@x.com|A', '[]'); localStorage.setItem('solvelt.driver.route.sam@x.com|A', '{}')
    signedIn(login('Driver'))
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json({ error: 'Session expired' }, { status: 401 })))
    renderAt(shell, '/driver')
    const call = await screen.findByRole('button', { name: 'call api' })
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.json({ error: 'gone' }, { status: 401 })))
    await userEvent.click(call)
    await waitFor(() => expect(localStorage.getItem('solvelt.driver.queue.sam@x.com|A')).toBeNull())
    expect(localStorage.getItem('solvelt.driver.route.sam@x.com|A')).toBeNull(); expect(del).toHaveBeenCalledWith('solvelt-driver')
  })

  it('keeps unsent deliveries when the app logs the driver out for inactivity (no confirmation was asked)', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seed()
    signedIn(login('Driver'))
    renderAt(shell, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: 'idle log out' }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
    kept(); expect(del).not.toHaveBeenCalled()
  })

  it('keeps unsent deliveries when another tab logs out for inactivity', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seed()
    const bus = fakeBus(); setCrossTabForTests(bus.bus)
    signedIn(login('Driver'))
    renderAt(shell, '/driver')
    await screen.findByRole('button', { name: 'call api' })
    act(() => bus.emit({ type: 'logout', reason: 'idle' }))
    await screen.findByText('login page')
    kept(); expect(del).not.toHaveBeenCalled()
    setCrossTabForTests(null)
  })

  it('endDriverSession keeps the queue when something is waiting and wipes when nothing is', () => {
    localStorage.setItem('solvelt.driver.queue.x', '[{"id":"1"}]'); localStorage.setItem('solvelt.driver.route.x', '{}'); localStorage.setItem('solvelt.driver.cachedUser', '{}')
    expect(endDriverSession()).toBe('kept'); expect(localStorage.getItem('solvelt.driver.queue.x')).not.toBeNull(); expect(localStorage.getItem('solvelt.driver.route.x')).toBeNull()
    localStorage.setItem('solvelt.driver.queue.x', '[]')
    expect(endDriverSession()).toBe('wiped'); expect(localStorage.getItem('solvelt.driver.queue.x')).toBeNull()
  })

  it('is wiped on a manual log-out (after the driver confirmed discarding what was unsent)', async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seed()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    signedIn(login('Driver'))
    renderAt(shell, '/driver')
    await screen.findByRole('button', { name: 'call api' })
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    await waitFor(() => wiped()); expect(del).toHaveBeenCalled(); expect(confirm).toHaveBeenCalled()
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

  const SAM = 'solvelt.driver.queue.sam@x.com|A'
  const seedSam = () => { localStorage.setItem(SAM, '[{"id":"1"}]'); localStorage.setItem('solvelt.driver.blobkeys.sam@x.com|A', '{"c1":"blob-sam"}'); localStorage.setItem('solvelt.driver.touched.sam@x.com|A', String(Date.now())) }
  const samKept = () => { expect(localStorage.getItem(SAM)).toBe('[{"id":"1"}]'); expect(localStorage.getItem('solvelt.driver.blobkeys.sam@x.com|A')).not.toBeNull() }

  it("another user's manual log-out on the same device does not delete a former driver's kept queue and photos", async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seedSam()
    localStorage.setItem('solvelt.driver.queue.kim@x.com|A', '[]')
    signedIn(login('Owner', A, 'kim@x.com'))
    renderAt(shell, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: 'manual log out' }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
    samKept(); expect(localStorage.getItem('solvelt.driver.queue.kim@x.com|A')).toBeNull()      // Kim's own data went
    expect(del).not.toHaveBeenCalled()                                                          // the photo database stays: Sam still has things to send
  })

  it("a manual log-out in another tab removes only this user's data too", async () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del }); seedSam()
    localStorage.setItem('solvelt.driver.queue.kim@x.com|A', '[]')
    const bus = fakeBus(); setCrossTabForTests(bus.bus)
    signedIn(login('Owner', A, 'kim@x.com'))
    renderAt(shell, '/driver')
    await screen.findByRole('button', { name: 'call api' })
    act(() => bus.emit({ type: 'logout', reason: 'manual' }))
    await screen.findByText('login page')
    samKept(); expect(localStorage.getItem('solvelt.driver.queue.kim@x.com|A')).toBeNull(); expect(del).not.toHaveBeenCalled()
    setCrossTabForTests(null)
  })

  it("clearDriverStorageFor deletes only that user's keys and photos, and the database only when nobody has anything left", async () => {
    const deleted: string[] = []
    const fake = { deleteDatabase: vi.fn(), open: () => { const r: { onsuccess?: () => void; onupgradeneeded?: () => void; result?: unknown } = {}; r.result = { createObjectStore: () => undefined, close: () => undefined, transaction: () => ({ objectStore: () => ({ delete: (k: string) => { deleted.push(k); const q: { onsuccess?: () => void } = {}; setTimeout(() => q.onsuccess?.(), 0); return q } }) }) }; setTimeout(() => r.onsuccess?.(), 0); return r } }
    vi.stubGlobal('indexedDB', fake)
    seedSam()
    localStorage.setItem('solvelt.driver.queue.kim@x.com|A', '[{"id":"9"}]'); localStorage.setItem('solvelt.driver.blobkeys.kim@x.com|A', '{"c2":"blob-kim"}'); localStorage.setItem('solvelt.driver.route.kim@x.com|B', '{}')
    clearDriverStorageFor('kim@x.com')
    await waitFor(() => expect(deleted).toEqual(['blob-kim']))                                    // only Kim's photo
    samKept(); expect(localStorage.getItem('solvelt.driver.route.kim@x.com|B')).toBeNull(); expect(fake.deleteDatabase).not.toHaveBeenCalled()
    clearDriverStorageFor('sam@x.com')                                                            // nobody has anything left: now the database goes
    expect(localStorage.getItem(SAM)).toBeNull(); expect(fake.deleteDatabase).toHaveBeenCalledWith('solvelt-driver')
  })

  it('kept queues and photos expire after a week without activity, with a notice on the next visit', () => {
    const del = vi.fn(); vi.stubGlobal('indexedDB', { deleteDatabase: del })
    const now = Date.now(); const day = 86_400_000
    localStorage.setItem(SAM, '[{"id":"1"},{"id":"2"}]'); localStorage.setItem('solvelt.driver.touched.sam@x.com|A', String(now - (KEPT_MAX_AGE_DAYS + 1) * day))
    localStorage.setItem('solvelt.driver.queue.kim@x.com|A', '[{"id":"3"}]'); localStorage.setItem('solvelt.driver.touched.kim@x.com|A', String(now - 6 * day))
    expect(expireDriverStorage(now)).toEqual(['sam@x.com|A'])
    expect(localStorage.getItem(SAM)).toBeNull(); expect(localStorage.getItem('solvelt.driver.queue.kim@x.com|A')).not.toBeNull()      // 6 days old: kept
    expect(readExpiredNotice('sam@x.com')).toEqual({ count: 2, days: KEPT_MAX_AGE_DAYS }); expect(readExpiredNotice('kim@x.com')).toBeNull()
  })

  const offlineSender: Sender = { start: async () => { throw new TypeError('offline') }, upload: async () => { throw new TypeError('offline') }, event: async () => { throw new TypeError('offline') } }
  const SAM_B = 'solvelt.driver.queue.sam@x.com|' + B

  it('a queue that keeps retrying offline does not expire: every flush restarts its clock', async () => {
    const q = new DriverQueue(localStorage, new MemoryBlobs(), offlineSender, 'sam@x.com|A')
    q.enqueueEvent('s1', { type: 'out_for_delivery' })
    localStorage.setItem('solvelt.driver.touched.sam@x.com|A', String(Date.now() - (KEPT_MAX_AGE_DAYS + 1) * 86_400_000))      // untouched for 8 days...
    expect(await q.flush()).toMatchObject({ offline: true })                                                                   // ...but a flush just tried (offline)
    expect(expireDriverStorage()).toEqual([]); expect(q.pending()).toBe(1)
  })

  it('a manual log-out from a page outside the driver app asks before discarding unsent updates of ANY account, and cancel keeps them', async () => {
    localStorage.setItem(SAM, '[{"id":"1"},{"id":"2"}]'); localStorage.setItem(SAM_B, '[{"id":"3"}]')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    signedIn(login('Driver'))
    renderAt(shell, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: 'manual log out' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][0]).toContain('3 delivery updates')                                  // both accounts counted
    expect(screen.getByRole('button', { name: 'call api' })).toBeInTheDocument()                    // cancelled: still signed in
    expect(localStorage.getItem(SAM)).not.toBeNull(); expect(localStorage.getItem(SAM_B)).not.toBeNull()
    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'manual log out' }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(localStorage.getItem(SAM)).toBeNull(); expect(localStorage.getItem(SAM_B)).toBeNull()
  })

  it('a manual log-out asks nothing when this user has nothing unsent (another user\'s kept queue is not theirs to confirm)', async () => {
    localStorage.setItem(SAM, '[{"id":"1"}]')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    signedIn(login('Owner', A, 'kim@x.com'))
    renderAt(shell, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: 'manual log out' }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled(); expect(localStorage.getItem(SAM)).not.toBeNull()
  })

  it('inside the driver app a log-out asks once: the app asked about its own queue, the log-out does not ask again', async () => {
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    const q = new DriverQueue(localStorage, new MemoryBlobs(), offlineSender, 'sam@x.com|' + A); q.enqueueEvent('s1', { type: 'out_for_delivery' })      // the name the app itself uses: email | account id
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    function LogoutBtn() { const { logout } = useAuth(); return <button onClick={() => void logout()}>manual log out</button> }
    mountAs('Driver', <><DriverApp queueOverride={q} /><LogoutBtn /></>, '/driver')
    await screen.findByRole('heading', { name: 'My deliveries' })
    await userEvent.click(screen.getByRole('button', { name: 'manual log out' }))
    await waitFor(() => expect(localStorage.getItem('solvelt.driver.queue.sam@x.com|' + A)).toBeNull())
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('a "leave anyway" given earlier (an account switch) does not excuse a later log-out from asking about that queue', async () => {
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    const q = new DriverQueue(localStorage, new MemoryBlobs(), offlineSender, 'sam@x.com|' + A); q.enqueueEvent('s1', { type: 'out_for_delivery' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    function Host() {
      const { logout } = useAuth(); const [show, setShow] = React.useState(true)
      return <>{show && <DriverApp queueOverride={q} />}<button onClick={() => setShow(false)}>hide driver app</button><button onClick={() => void logout()}>manual log out</button></>
    }
    mountAs('Driver', <Host />, '/driver')
    await screen.findByRole('heading', { name: 'My deliveries' })
    await waitFor(() => expect(localStorage.getItem('solvelt.driver.route.sam@x.com|' + A)).not.toBeNull())      // the app knows the signed-in user now (its queue name is email | account)
    await act(async () => { await canLeave() })                                   // what switching account does: the driver app asks, the driver says "leave anyway"
    expect(confirm).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'hide driver app' }))   // the driver app is gone (the other account has no driver view), its handler with it
    await userEvent.click(screen.getByRole('button', { name: 'manual log out' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))                 // the log-out asks for itself
    expect(confirm.mock.calls[1][0]).toContain('delivery update')
    await waitFor(() => expect(localStorage.getItem('solvelt.driver.queue.sam@x.com|' + A)).toBeNull())
  })

  it('every change to the queue restarts its clock', () => {
    const q = new DriverQueue(mem(), new MemoryBlobs(), NOOP, 'sam@x.com|A')
    expect(localStorage.getItem('solvelt.driver.touched.sam@x.com|A')).toBeNull()
    q.enqueueEvent('s1', { type: 'out_for_delivery' })
    expect(Number(localStorage.getItem('solvelt.driver.touched.sam@x.com|A'))).toBeGreaterThan(Date.now() - 5_000)
  })

  it('the app removes expired queues when it starts', async () => {
    localStorage.setItem(SAM, '[{"id":"1"}]'); localStorage.setItem('solvelt.driver.touched.sam@x.com|A', String(Date.now() - 10 * 86_400_000))
    signedIn(login('Owner', A, 'kim@x.com'))
    renderAt(shell, '/driver')
    await screen.findByRole('button', { name: 'call api' })
    expect(localStorage.getItem(SAM)).toBeNull(); expect(readExpiredNotice('sam@x.com')).toEqual({ count: 1, days: KEPT_MAX_AGE_DAYS })
  })

  it('a queue without a clock gets one now instead of being deleted', () => {
    localStorage.setItem(SAM, '[{"id":"1"}]')
    expect(expireDriverStorage(Date.now())).toEqual([])
    expect(localStorage.getItem('solvelt.driver.touched.sam@x.com|A')).not.toBeNull(); expect(localStorage.getItem(SAM)).not.toBeNull()
  })

  it('tells the driver that unsent updates expired, once, and the notice can be dismissed', async () => {
    localStorage.setItem('solvelt.driver.expired.sam@x.com', JSON.stringify({ count: 2, days: 7 }))
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    mountAs('Driver', <DriverApp queueOverride={new DriverQueue(mem(), new MemoryBlobs(), NOOP, 'x')} />, '/driver')
    expect(await screen.findByText(/2 unsent updates were removed from this phone because they were more than 7 days old/)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])
    expect(screen.queryByText(/removed from this phone/)).not.toBeInTheDocument(); expect(readExpiredNotice('sam@x.com')).toBeNull()
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

function SessionProbe() {
  const { logout } = useAuth()
  return <><button onClick={() => void api('/driver/me').catch(() => undefined)}>call api</button><button onClick={() => void logout('idle')}>idle log out</button><button onClick={() => void logout()}>manual log out</button></>
}

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

describe('focus while the form is being filled in', () => {
  it('stays on the field the driver is using when the route reloads in the background', async () => {
    let loads = 0
    server.use(http.get(`${API}/driver/me`, () => { loads++; return HttpResponse.json(me([stop()])) }))
    const q = new DriverQueue(mem(), new MemoryBlobs(), NOOP, 'x')
    mountAs('Driver', <DriverApp queueOverride={q} />, '/driver')
    await userEvent.click(await screen.findByRole('button', { name: /Stop 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Failed attempt' }))
    const reason = await screen.findByLabelText(/Reason/); reason.focus()
    expect(document.activeElement).toBe(reason)
    const before = loads
    q.enqueueEvent('s9', { type: 'out_for_delivery' })                                                 // something to send, so the sync reloads the route
    act(() => { window.dispatchEvent(new Event('online')) })                                          // a sync + reload replaces `me`
    await waitFor(() => expect(loads).toBeGreaterThan(before))
    await new Promise((r) => setTimeout(r, 50))
    expect(document.activeElement).toBe(reason)
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

describe('dispatch board other refusals', () => {
  it('shows the server message for a 409 that is not a version conflict', async () => {
    const d = { id: 'd1', orderId: 'o1', number: 'SO-1', brandId: 'b1', status: 'Unassigned', trackingStatus: null, code: 'LD-1', windowId: 'w1', windowStart: '2026-11-04T12:00:00Z', windowEnd: '2026-11-04T14:00:00Z', city: 'Brooklyn', postalCode: '11201', attempts: 0, driverMembershipId: null, routeId: null, stopSeq: 0, version: 1 }
    server.use(
      http.get(`${API}/seller/delivery/board`, () => HttpResponse.json({ date: '2026-11-04', timeZone: 'UTC', windows: [], deliveries: [d], routes: [] })),
      http.get(`${API}/seller/delivery/drivers`, () => HttpResponse.json([{ membershipId: 'm1', email: 'sam@x.com', firstName: 'Sam' }])),
      http.post(`${API}/seller/delivery/deliveries/d1/assign`, () => HttpResponse.json({ title: 'This delivery is already on a route.', code: 'invalid_state' }, { status: 409 })),
    )
    mountAs('Manager', <DispatchBoard />, '/delivery')
    await userEvent.selectOptions(await screen.findByLabelText('Driver for SO-1'), 'm1')
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }))
    expect(await screen.findByText('This delivery is already on a route.')).toBeInTheDocument()
    expect(screen.queryByText(/changed by someone else/)).not.toBeInTheDocument()
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

  it('a canvas that cannot draw never produces a blank JPEG: the byte-level strip is used, and anything else is rejected', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10 }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
    const out = await shrinkImage(new Blob([JPEG_WITH_GPS], { type: 'image/jpeg' }))
    expect(new TextDecoder('latin1').decode(new Uint8Array(await out.arrayBuffer()))).not.toContain('Exif')
    await expect(shrinkImage(new Blob(['not a jpeg'], { type: 'image/heic' }))).rejects.toThrow('photo_unprocessable')
    expect(toBlob).not.toHaveBeenCalled()                                                              // no blank canvas was exported
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
    server.use(http.get(`${API}/account/me`, () => HttpResponse.json({ email: 'sam@x.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus: null, vendorName: null })),
      http.get(`${API}/account/passkeys`, () => HttpResponse.json([])),
      http.get(`${API}/account/sessions`, () => HttpResponse.json([])))
    mountAs('Driver', <SettingsPage />, '/settings/team')
    expect(await screen.findByRole('link', { name: 'Security' })).toBeInTheDocument()
    for (const n of ['Profile', 'Team', 'Brands', 'Shipping', 'Notifications', 'Availability', 'Local delivery']) expect(screen.queryByRole('link', { name: n })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the driver app' })).toHaveAttribute('href', '/driver')
  })

  it('the Dismiss buttons are real touch targets', async () => {
    const q = new DriverQueue(mem(), new MemoryBlobs(), { start: async () => undefined, upload: async () => ({ id: 'x' }), event: async () => { throw err(422, 'proof_required') } }, 'x')
    q.enqueueEvent('s1', { type: 'delivered', placement: 'left_at_door' }); await q.flush()
    server.use(http.get(`${API}/driver/me`, () => HttpResponse.json(me([stop()]))))
    mountAs('Driver', <DriverApp queueOverride={q} />, '/driver')
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    expect(dismiss).toHaveClass('dr-small')
    expect(readFileSync('src/delivery/driver.css', 'utf8')).toMatch(/\.dr-small\s*\{[^}]*min-height:\s*var\(--target\)/)                  // the class is what makes it a touch target
    expect(dismiss).not.toHaveClass('back')
  })
})
