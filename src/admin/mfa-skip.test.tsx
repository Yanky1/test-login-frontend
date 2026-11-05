import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { adminToken } from './api'
import { A, PERMS, mockSignIn, mount } from './testkit'

afterEach(() => { adminToken.set(null); vi.useRealTimers() })

const API = '*/api/v1'
const config = (demo: boolean, skip: boolean) => http.get(`${API}/public-config`, () => HttpResponse.json({
  marketplaceUrl: 'https://market.example', termsVersion: '1', sellerAgreementVersion: '1', smsWordingVersion: '1', smsWording: 'x', turnstileSiteKey: 'stub',
  ...(demo ? { demoEnabled: true } : {}), ...(skip ? { staffMfaSkipEnabled: true } : {}),
}))
const SKIP = 'Skip two-factor (test mode)'
const BANNER = 'Two-factor skipped (test mode)'
const skippedMe = (extra: object = {}) => http.get(`${A}/auth/me`, () => HttpResponse.json({ userId: 'u-1', email: 'staff@example.com', role: 'SuperAdmin', permissions: PERMS.SuperAdmin, sessionExpiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idleMinutes: 15, stepUpUntil: null, mfaSkipped: true, ...extra }))
const demoLogin = (seen?: (b: unknown) => void) => http.post(`${A}/auth/demo-mfa`, async ({ request }) => {
  seen?.(await request.json())
  return HttpResponse.json({ tokenType: 'Bearer', accessToken: 'staff-skip-tok', expiresIn: 3600, email: 'staff@example.com', role: 'SuperAdmin', permissions: PERMS.SuperAdmin, mfaSkipped: true })
})

/** Types email + password on the sign-in form and continues: lands on the code step (twoFactorRequired) or the setup step. */
async function toStep(kind: 'code' | 'enrol') {
  mockSignIn('SuperAdmin', { twoFactorSetup: kind === 'enrol' })
  const user = userEvent.setup()
  mount('/admin/login')
  await user.type(await screen.findByLabelText('Email'), 'staff@example.com')
  await user.type(screen.getByLabelText('Password'), 'Some-Passw0rd!x')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole(kind === 'code' ? 'button' : 'button', { name: kind === 'code' ? 'Verify and sign in' : 'Show my setup code' })
  return user
}

describe('staff two-factor skip: button visibility (needs demoEnabled AND staffMfaSkipEnabled)', () => {
  it.each([[false, false], [true, false], [false, true]] as const)('is hidden on the code and setup screens when demo=%s and skip=%s', async (demo, skip) => {
    server.use(config(demo, skip))
    await toStep('code')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: SKIP })).toBeNull()
  })

  it.each([[false, false], [true, false], [false, true]] as const)('is hidden on the setup screen when demo=%s and skip=%s', async (demo, skip) => {
    server.use(config(demo, skip))
    await toStep('enrol')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: SKIP })).toBeNull()
  })

  it('is shown, clearly labelled, on the code screen and on the setup screen when both are on', async () => {
    server.use(config(true, true))
    await toStep('code')
    expect(await screen.findByRole('button', { name: SKIP })).toBeInTheDocument()
    expect(screen.getByText(/Test site only/)).toBeInTheDocument()
  })

  it('is shown on the setup screen when both are on', async () => {
    server.use(config(true, true))
    await toStep('enrol')
    expect(await screen.findByRole('button', { name: SKIP })).toBeInTheDocument()
  })
})

describe('staff two-factor skip: sign-in', () => {
  it('sends the email and password, opens the admin and shows the permanent banner', async () => {
    let body: unknown
    server.use(config(true, true))
    const user = await toStep('code')
    server.use(demoLogin((b) => { body = b }), skippedMe())      // after toStep: mockSignIn registered its own /auth/me
    await user.click(await screen.findByRole('button', { name: SKIP }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(body).toEqual({ email: 'staff@example.com', password: 'Some-Passw0rd!x' })
    expect(adminToken.get()).toBe('staff-skip-tok')
    expect(screen.getByRole('status')).toHaveTextContent(BANNER)
    // permanent: still there on another page
    await user.click(within(screen.getByRole('navigation', { name: 'Staff areas' })).getByRole('link', { name: 'Sellers' }))
    expect(await screen.findByRole('heading', { name: 'Seller accounts' })).toBeInTheDocument()
    expect(screen.getByText(BANNER)).toBeInTheDocument()
  })

  it('works from the setup screen too', async () => {
    server.use(config(true, true))
    const user = await toStep('enrol')
    server.use(demoLogin(), skippedMe())
    await user.click(await screen.findByRole('button', { name: SKIP }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText(BANNER)).toBeInTheDocument()
  })

  it('shows no banner for a normal two-factor session, even with both flags on', async () => {
    server.use(config(true, true))
    const user = await toStep('code')
    await user.type(await screen.findByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  it('keeps the sign-in screen and says so when the server refuses (wrong password, or the switch was turned off)', async () => {
    server.use(config(true, true), http.post(`${A}/auth/demo-mfa`, () => HttpResponse.json({ error: 'Login failed' }, { status: 401 })))
    const user = await toStep('code')
    await user.click(await screen.findByRole('button', { name: SKIP }))
    expect(await screen.findByText('Could not skip two-factor. Check your email and password.')).toBeInTheDocument()
    expect(adminToken.get()).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull()
  })

  it('says to wait when the skip is rate limited', async () => {
    server.use(config(true, true), http.post(`${A}/auth/demo-mfa`, () => HttpResponse.json({ code: 'rate_limited' }, { status: 429 })))
    const user = await toStep('code')
    await user.click(await screen.findByRole('button', { name: SKIP }))
    expect(await screen.findByText('Too many attempts. Wait a minute and try again.')).toBeInTheDocument()
  })
})

describe('staff two-factor skip: step-up prompt', () => {
  const seller = { id: 's-1', vendorName: 'Acme Co', status: 'Approved', statusNote: null, country: 'US', createdAt: '2026-10-01T00:00:00Z', submittedAt: '2026-10-02T00:00:00Z', ownerEmail: 'o@acme.test', ownerEmailVerified: true,
    members: [], brands: [], counts: { listings: 0, activeListings: 0, orders: 0, bookings: 0 }, statusHistory: [], recentActivity: { lastOrderAt: null, lastBookingAt: null, lastListingUpdateAt: null, lastMemberActivityAt: null }, notes: [] }

  async function openStepUp() {
    let closed = 0
    server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)),
      http.post(`${A}/sellers/s-1/close`, () => (closed++ === 0 ? HttpResponse.json({ code: 'step_up_required' }, { status: 403 }) : HttpResponse.json({ status: 'Closed' }))))
    mockSignIn('SuperAdmin')
    const user = userEvent.setup()
    mount('/admin/login')
    await user.type(await screen.findByLabelText('Email'), 'staff@example.com')
    await user.type(screen.getByLabelText('Password'), 'Some-Passw0rd!x')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await screen.findByRole('navigation', { name: 'Staff areas' })
    await user.click(within(screen.getByRole('navigation', { name: 'Staff areas' })).getByRole('link', { name: 'Sellers' }))
    await user.click(await screen.findByRole('link', { name: 'Acme Co' }).catch(() => screen.findByRole('button', { name: 'Close account' })))
    return { user, calls: () => closed }
  }

  it('is hidden in the step-up dialog unless both flags are on', async () => {
    server.use(config(true, false), http.get(`${A}/sellers`, () => HttpResponse.json({ total: 1, page: 1, pageSize: 25, items: [{ id: 's-1', vendorName: 'Acme Co', status: 'Approved', country: 'US', createdAt: '2026-10-01T00:00:00Z', ownerEmail: 'o@acme.test' }] })))
    const { user } = await openStepUp()
    await user.click(await screen.findByRole('button', { name: 'Close account' }))
    await user.type(screen.getByLabelText(/^Reason/), 'Closing this test account')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close account' }))
    expect(await screen.findByRole('dialog', { name: 'Confirm it’s you' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SKIP })).toBeNull()
  })

  it('marks the session and repeats the write without a code, then shows the banner', async () => {
    let stepUps = 0
    server.use(config(true, true), http.get(`${A}/sellers`, () => HttpResponse.json({ total: 1, page: 1, pageSize: 25, items: [{ id: 's-1', vendorName: 'Acme Co', status: 'Approved', country: 'US', createdAt: '2026-10-01T00:00:00Z', ownerEmail: 'o@acme.test' }] })),
      http.post(`${A}/auth/demo-step-up`, () => { stepUps++; server.use(skippedMe()); return HttpResponse.json({ mfaSkipped: true }) }))
    const { user, calls } = await openStepUp()
    await user.click(await screen.findByRole('button', { name: 'Close account' }))
    await user.type(screen.getByLabelText(/^Reason/), 'Closing this test account')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close account' }))
    const step = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.click(within(step).getByRole('button', { name: SKIP }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stepUps).toBe(1)
    expect(calls()).toBe(2)                                   // refused once, then repeated and accepted
    expect(await screen.findByText(BANNER)).toBeInTheDocument()
  })
})
