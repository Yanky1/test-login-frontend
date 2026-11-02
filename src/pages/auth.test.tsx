import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import LoginPage from './Login'
import { RedirectIfAuthed, RequireAuth } from '../components/RequireAuth'
import { API, loginBody, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'
import { tokenStore } from '../api'

const app = (
  <Routes>
    <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
    <Route element={<RequireAuth />}>
      <Route path="/" element={<div>home</div>} />
      <Route path="/settings/security" element={<div>security settings</div>} />
      <Route path="/work/page" element={<div>work page</div>} />
    </Route>
  </Routes>
)

afterEach(() => { vi.useRealTimers() })
const fake = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })

async function fillLogin(user: ReturnType<typeof userEvent.setup>, pw = 'Tr1cky-Horse-Battery!') {
  await user.type(await screen.findByLabelText('Email'), 'seller@example.com')
  await user.type(screen.getByLabelText('Password'), pw)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('route guards and redirect-back', () => {
  it('anonymous users are sent to /login with the original path in ?next', async () => {
    renderAt(app, '/settings/security?tab=x')
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/login?next=%2Fsettings%2Fsecurity%3Ftab%3Dx'))
  })

  it('after login the user lands on the original page', async () => {
    const user = userEvent.setup()
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(loginBody())))
    renderAt(app, '/login?next=%2Fwork%2Fpage')
    await fillLogin(user)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    expect(tokenStore.get()).toBe('tok-1')
  })

  it.each(['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])('ignores unsafe next=%s', async (bad) => {
    const user = userEvent.setup()
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(loginBody())))
    renderAt(app, `/login?next=${encodeURIComponent(bad)}`)
    await fillLogin(user)
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('signed-in users visiting /login are redirected away', async () => {
    signedIn()
    renderAt(app, '/login')
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('restores the session on reload from the refresh cookie (memory-only access token)', async () => {
    signedIn({ accessToken: 'restored' })
    renderAt(app, '/work/page')
    expect(await screen.findByText('work page')).toBeInTheDocument()
    expect(tokenStore.get()).toBe('restored')
  })
})

describe('login errors, lockout hints and captcha', () => {
  it('shows "Login failed" with the attempts hint from the separate field', async () => {
    const user = userEvent.setup()
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ error: 'Login failed', hint: { attemptsRemaining: 2, lastTry: false, captchaRequired: false, lockedUntil: null, message: '2 tries left' } }, { status: 401 })))
    renderAt(app, '/login')
    await fillLogin(user, 'x')
    expect(await screen.findByText(/Login failed — 2 tries left/)).toBeInTheDocument()
  })

  it('requires Turnstile after "Last try" and sends the token', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    server.use(http.post(`${API}/auth/login`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>; bodies.push(b)
      return b.captchaToken ? HttpResponse.json(loginBody()) : HttpResponse.json({ error: 'Login failed', hint: { attemptsRemaining: 1, lastTry: true, captchaRequired: true, lockedUntil: null, message: 'Last try' } }, { status: 401 })
    }))
    renderAt(app, '/login')
    await fillLogin(user)
    expect(await screen.findByText(/Last try/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Sign in' })
    expect(submit).toBeDisabled() // captcha required first
    await user.click(screen.getByRole('button', { name: /Verify you are human/ }))
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(bodies.at(-1)).toMatchObject({ captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' })
  })

  it('400 "Verification failed" asks for the verification', async () => {
    const user = userEvent.setup()
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ error: 'Verification failed' }, { status: 400 })))
    renderAt(app, '/login')
    await fillLogin(user)
    expect(await screen.findByText('Please complete the verification and try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Verify you are human/ })).toBeInTheDocument()
  })

  it('asks for a 2FA code when the server says it is required', async () => {
    const user = userEvent.setup()
    server.use(http.post(`${API}/auth/login`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>
      return b.totpCode ? HttpResponse.json(loginBody()) : HttpResponse.json({ error: 'Login failed', twoFactorRequired: true, hint: {} }, { status: 401 })
    }))
    renderAt(app, '/login')
    await fillLogin(user)
    const code = await screen.findByLabelText('Authentication code')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    await user.type(code, '123456')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('uses the right autocomplete attributes and offers a passkey / Google button', async () => {
    renderAt(app, '/login')
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username webauthn')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute('href', expect.stringContaining('/api/v1/auth/external/google/start'))
  })

  it('shows the inactivity notice after an automatic logout', async () => {
    renderAt(app, '/login?reason=idle&next=%2Fwork%2Fpage')
    expect(await screen.findByText(/signed out because you were inactive/)).toBeInTheDocument()
  })
})

describe('inactivity logout (fake timers)', () => {
  const cfg = { idleTimeoutMinutes: 2, warningSeconds: 30, refreshIntervalMinutes: 60 }

  it('shows a warning with a live countdown, then logs out, revokes the session and returns to login with next', async () => {
    signedIn()
    let logoutCalls = 0
    server.use(http.post(`${API}/auth/logout`, () => { logoutCalls++; return new HttpResponse(null, { status: 204 }) }))
    fake()
    renderAt(app, '/work/page', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(89_000) })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument() // 89 s idle < 90 s
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('You will be logged out in 00:29')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(screen.getByText('You will be logged out in 00:19')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/login?reason=idle&next=%2Fwork%2Fpage'))
    expect(logoutCalls).toBe(1)
    expect(tokenStore.get()).toBeNull()
  })

  it('"Stay signed in" dismisses the warning and refreshes the session', async () => {
    signedIn()
    let refreshes = 0
    server.use(http.post(`${API}/auth/refresh`, () => { refreshes++; return HttpResponse.json(loginBody()) }))
    fake()
    renderAt(app, '/work/page', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    const before = refreshes
    await act(async () => { await vi.advanceTimersByTimeAsync(95_000) })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' })) })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(refreshes).toBeGreaterThan(before))
    expect(screen.getByText('work page')).toBeInTheDocument()
  })

  it('"Log out" in the warning signs out immediately', async () => {
    signedIn()
    fake()
    renderAt(app, '/work/page', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(95_000) })
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('/login'))
  })
})

describe('background refresh only while active', () => {
  const cfg = { idleTimeoutMinutes: 30, warningSeconds: 60, refreshIntervalMinutes: 5 }

  it('refreshes after the interval when the user was active', async () => {
    signedIn()
    let refreshes = 0
    server.use(http.post(`${API}/auth/refresh`, () => { refreshes++; return HttpResponse.json(loginBody()) }))
    fake()
    renderAt(app, '/work/page', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    const start = refreshes // 1 from bootstrap
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000) })
    fireEvent.mouseMove(window) // user activity
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
    await waitFor(() => expect(refreshes).toBe(start + 1))
  })

  it('does NOT refresh when the user has been idle', async () => {
    signedIn()
    let refreshes = 0
    server.use(http.post(`${API}/auth/refresh`, () => { refreshes++; return HttpResponse.json(loginBody()) }))
    fake()
    renderAt(app, '/work/page', cfg)
    expect(await screen.findByText('work page')).toBeInTheDocument()
    const start = refreshes
    await act(async () => { await vi.advanceTimersByTimeAsync(12 * 60_000) }) // 2+ intervals, no activity
    expect(refreshes).toBe(start)
  })
})
