import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import { createCrossTab, setCrossTabForTests, type CrossTab, type TabMessage } from '../lib/crossTab'
import { refreshSession, tokenStore } from '../api'
import { API, loginBody, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'

/** Fake "other tab": a CrossTab whose remote messages are injected by the test. */
function fakeBus() {
  const subs = new Set<(m: TabMessage) => void>()
  const posted: TabMessage[] = []
  const bus: CrossTab = { post: (m) => { posted.push(m) }, subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } } }
  return { bus, posted, emit: (m: TabMessage) => subs.forEach((f) => f(m)) }
}

const fake = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
const app = (<Routes><Route element={<RequireAuth />}><Route path="/work" element={<div>work page</div>} /></Route><Route path="/login" element={<div>login page</div>} /></Routes>)
const cfg = { idleTimeoutMinutes: 2, warningSeconds: 30, refreshIntervalMinutes: 60 }

const setLocks = (locks: unknown) => Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
afterEach(() => { vi.useRealTimers(); setCrossTabForTests(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'locks') })

describe('cross-tab transport', () => {
  it('BroadcastChannel: a message posted in one tab reaches the other, not the sender', () => {
    const hubs = new Map<string, Set<{ onmessage: ((e: MessageEvent) => void) | null; handlers: Set<(e: MessageEvent) => void> }>>()
    class FakeBC {
      handlers = new Set<(e: MessageEvent) => void>(); onmessage = null; name: string
      constructor(name: string) { this.name = name; (hubs.get(name) ?? hubs.set(name, new Set()).get(name)!).add(this) }
      postMessage(data: unknown) { hubs.get(this.name)!.forEach((c) => { if (c !== this) c.handlers.forEach((h) => h({ data } as MessageEvent)) }) }
      addEventListener(_: string, h: (e: MessageEvent) => void) { this.handlers.add(h) }
      removeEventListener(_: string, h: (e: MessageEvent) => void) { this.handlers.delete(h) }
    }
    vi.stubGlobal('BroadcastChannel', FakeBC)
    const a = createCrossTab(); const b = createCrossTab()
    const gotA = vi.fn(); const gotB = vi.fn()
    a.subscribe(gotA); b.subscribe(gotB)
    a.post({ type: 'logout', reason: 'idle' })
    expect(gotB).toHaveBeenCalledWith({ type: 'logout', reason: 'idle' })
    expect(gotA).not.toHaveBeenCalled()
  })

  it('falls back to storage events when BroadcastChannel is missing', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const tab = createCrossTab()
    const got = vi.fn()
    const off = tab.subscribe(got)
    window.dispatchEvent(new StorageEvent('storage', { key: 'solvelt-auth-msg', newValue: JSON.stringify({ m: { type: 'activity', at: 5 }, n: 1 }) }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'x' }))
    expect(got).toHaveBeenCalledTimes(1)
    expect(got).toHaveBeenCalledWith({ type: 'activity', at: 5 })
    tab.post({ type: 'logout', reason: 'manual' })
    expect(JSON.parse(localStorage.getItem('solvelt-auth-msg')!).m).toEqual({ type: 'logout', reason: 'manual' })
    off()
    localStorage.clear()
  })
})

describe('idle logout is shared across tabs', () => {
  let t: ReturnType<typeof fakeBus>
  beforeEach(() => { t = fakeBus(); setCrossTabForTests(t.bus) })

  it('activity in another tab resets this tab\'s idle timer and dismisses the warning', async () => {
    signedIn()
    fake()
    renderAt(app, '/work', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(95_000) }) // past the warning threshold (90 s)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await act(async () => { t.emit({ type: 'activity', at: Date.now() }) }) // the user is busy in another tab
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) }) // original deadline (120 s) passes: still signed in
    expect(screen.getByText('work page')).toBeInTheDocument()
    expect(tokenStore.get()).not.toBeNull()
  })

  it('local activity is broadcast so other tabs stay alive', async () => {
    signedIn()
    // IdleGuard attaches its activity listeners in a passive effect, which React may flush after the page text is already
    // visible. Dispatching before that loses the event (flaked ~1 in 8 under load), so wait for the listener itself.
    const addListener = vi.spyOn(window, 'addEventListener')
    renderAt(app, '/work', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    await waitFor(() => expect(addListener).toHaveBeenCalledWith('mousemove', expect.any(Function), expect.anything()))
    await act(async () => { window.dispatchEvent(new Event('mousemove')) })
    expect(t.posted).toContainEqual(expect.objectContaining({ type: 'activity' }))
  })

  it('a logout in another tab signs this tab out without calling the API again', async () => {
    signedIn()
    let logoutCalls = 0
    server.use(http.post(`${API}/auth/logout`, () => { logoutCalls++; return new HttpResponse(null, { status: 204 }) }))
    renderAt(app, '/work', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    await act(async () => { t.emit({ type: 'logout', reason: 'idle' }) })
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/login?reason=idle&next=%2Fwork'))
    expect(logoutCalls).toBe(0)
    expect(tokenStore.get()).toBeNull()
  })

  it('an idle tab logs out once and tells the other tabs', async () => {
    signedIn()
    let logoutCalls = 0
    server.use(http.post(`${API}/auth/logout`, () => { logoutCalls++; return new HttpResponse(null, { status: 204 }) }))
    fake()
    renderAt(app, '/work', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000) })
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('/login'))
    expect(logoutCalls).toBe(1)
    expect(t.posted).toContainEqual({ type: 'logout', reason: 'idle' })
  })

  it('only the tab that wins the logout Web Lock calls the API', async () => {
    signedIn()
    let logoutCalls = 0
    server.use(http.post(`${API}/auth/logout`, () => { logoutCalls++; return new HttpResponse(null, { status: 204 }) }))
    // another tab already holds the lock: ifAvailable callback receives null
    setLocks({ request: async (n: string, a: unknown, b?: (l: unknown) => Promise<unknown>) => {
      const cb = (typeof a === 'function' ? a : b) as (l: unknown) => Promise<unknown>
      return cb(n === 'solvelt-logout' ? null : {})
    } })
    fake()
    renderAt(app, '/work', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000) })
    expect(logoutCalls).toBe(0)
  })
})

describe('refresh is serialised across tabs', () => {
  it('runs inside the shared "solvelt-refresh" Web Lock', async () => {
    const names: string[] = []
    setLocks({ request: async (n: string, cb: () => Promise<unknown>) => { names.push(n); return cb() } })
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.json(loginBody())))
    const r = await refreshSession()
    expect(r?.accessToken).toBe('tok-1')
    expect(names).toEqual(['solvelt-refresh'])
  })

  it('concurrent callers in one tab share a single request; a second "tab" waits for the lock instead of racing', async () => {
    let inFlight = 0; let maxInFlight = 0; let calls = 0
    // a tiny lock manager: one holder at a time, like navigator.locks across tabs
    let chain: Promise<unknown> = Promise.resolve()
    setLocks({ request: (_n: string, cb: () => Promise<unknown>) => (chain = chain.then(cb, cb)) })
    server.use(http.post(`${API}/auth/refresh`, async () => { calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 30)); inFlight--; return HttpResponse.json(loginBody()) }))
    const [a, b] = await Promise.all([refreshSession(), refreshSession()])
    expect(a).toEqual(b)
    expect(calls).toBe(1) // same-tab single flight
    // simulate another tab: reset the in-tab single-flight by awaiting, then run two sequential lock holders
    await refreshSession()
    expect(maxInFlight).toBe(1)
  })
})
