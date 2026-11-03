import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import App from '../App'
import { adminToken } from './api'
import { A, mockSignIn, signIn } from './testkit'

afterEach(() => { adminToken.set(null); vi.useRealTimers() })

const seller = { id: 's-1', vendorName: 'Acme Co', status: 'Approved', statusNote: null, country: 'US', createdAt: '2026-10-01T00:00:00Z', submittedAt: '2026-10-02T00:00:00Z', ownerEmail: 'o@acme.test', ownerEmailVerified: true,
  members: [{ userId: 'u-o', email: 'o@acme.test', role: 'Owner', status: 'Active', lastActiveAt: null }], brands: [], counts: { listings: 0, activeListings: 0, orders: 0, bookings: 0 }, statusHistory: [],
  recentActivity: { lastOrderAt: null, lastBookingAt: null, lastListingUpdateAt: null, lastMemberActivityAt: null }, notes: [] }
const app = {
  id: 'a-1', status: 'PendingReview', statusNote: null, submittedAt: '2026-10-30T10:00:00Z', ageDays: 4, owner: { email: 'o@acme.test', emailVerified: true },
  business: { vendorName: 'Acme Co', contactName: 'Dana', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false },
  kosher: [], files: [{ id: 'f-1', fieldKey: 'kosher_certificate', originalName: 'cert.html', contentType: 'text/html', size: 2048, createdAt: '2026-10-30T10:00:00Z' }],
  legal: { termsVersion: '2026-01', termsAcceptedAt: '2026-10-29T10:00:00Z', sellerAgreementVersion: '2026-01', sellerAgreementAcceptedAt: '2026-10-30T10:00:00Z' },
  assignment: null, detail: { statusHistory: [], notes: [] },
}

describe('review fixes', () => {
  it('Escape closes only the step-up dialog; the reason dialog keeps what was typed', async () => {
    server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)),
      http.post(`${A}/sellers/s-1/close`, () => HttpResponse.json({ code: 'step_up_required' }, { status: 403 })))
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1')
    await user.click(await screen.findByRole('button', { name: 'Close account' }))
    const dlg = screen.getByRole('dialog', { name: 'Close this account' })
    await user.type(within(dlg).getByLabelText('Reason (kept in the audit log)'), 'Owner asked by phone')
    await user.click(within(dlg).getByRole('button', { name: 'Close account' }))
    await screen.findByLabelText('Authenticator code')
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Authenticator code')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Close this account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Reason (kept in the audit log)')).toHaveValue('Owner asked by phone')
  })

  it('a failed note save shows the server message and keeps the text; a short note says why', async () => {
    server.use(http.get(`${A}/applications/a-1`, () => HttpResponse.json({ ...app, files: [] })),
      http.post(`${A}/applications/a-1/notes`, () => HttpResponse.json({ title: 'Notes are locked for this application.' }, { status: 409 })))
    const user = await signIn('Moderator', '/admin/applications/a-1')
    await user.type(await screen.findByLabelText('Add a note'), 'hi')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByText('Write at least 3 characters.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Add a note'), ' there')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByText('Notes are locked for this application.')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a note')).toHaveValue('hi there')
  })

  const fields = [{ key: 'sells_food', label: 'Do you sell food?', type: 'yesno', options: null, parentKey: null, parentValue: null, required: true, sortOrder: 1 }]
  const settings = { marketplace: { feeBasisPoints: 1000, feePercent: 10, overridden: false }, legal: { termsVersion: '1', sellerAgreementVersion: '1', sellersOnOlderTerms: 0, sellersOnOlderAgreement: 0, reacceptance: '' }, featureFlags: {} }

  it('the question editor is read-only without SettingsEdit and has no Save when loading failed', async () => {
    server.use(http.get(`${A}/settings`, () => HttpResponse.json(settings)), http.get(`${A}/settings/seller-fields`, () => HttpResponse.json({ fields })))
    await signIn('Support', '/admin/settings')
    expect(await screen.findByText('Do you sell food?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Key (field 1)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save questions' })).toBeNull()
  })
  it('a failed load shows the error and no editor to save over the live questions', async () => {
    server.use(http.get(`${A}/settings`, () => HttpResponse.json(settings)), http.get(`${A}/settings/seller-fields`, () => HttpResponse.json({ title: 'Boom' }, { status: 500 })))
    await signIn('SuperAdmin', '/admin/settings')
    await screen.findByRole('button', { name: /retry|try again/i })
    expect(screen.queryByRole('button', { name: 'Save questions' })).toBeNull()
    expect(screen.queryByLabelText('Key (field 1)')).toBeNull()
  })

  it('the inactivity timer follows the server idle limit (5 minutes here), not a constant', async () => {
    mockSignIn('ReadOnly', { me: { idleMinutes: 5 } })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    render(<MemoryRouter initialEntries={['/admin/login']}><App /></MemoryRouter>)
    await user.type(await screen.findByLabelText('Email'), 'a@b.c'); await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await screen.findByRole('navigation', { name: 'Staff areas' })
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000) })
    expect(screen.queryByText('You were signed out after a period of inactivity.')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000) })
    expect(await screen.findByText('You were signed out after a period of inactivity.')).toBeInTheDocument()
  })

  it('warns before the absolute session limit', async () => {
    await signIn('ReadOnly', '/admin', { sessionExpiresAt: new Date(Date.now() + 30_000).toISOString() })
    expect(await screen.findByText(/Your staff session ends in about a minute/)).toBeInTheDocument()
  })

  it('a 403 that is not a step-up request re-reads the role (the nav shrinks)', async () => {
    let role: 'SuperAdmin' | 'ReadOnly' = 'SuperAdmin'
    const me = () => HttpResponse.json({ userId: 'u', email: 'staff@example.com', role, permissions: role === 'SuperAdmin' ? ['DashboardView', 'SettingsView', 'StaffView', 'AuditView', 'LookupsView'] : ['DashboardView'], sessionExpiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(), idleMinutes: 15, stepUpUntil: null })
    await signIn('SuperAdmin', '/admin/lookups/orders')
    server.use(http.get(`${A}/auth/me`, me), http.get(`${A}/lookups/orders`, () => HttpResponse.json({ title: 'Forbidden' }, { status: 403 })))
    const user = userEvent.setup()
    expect(within(screen.getByRole('navigation', { name: 'Staff areas' })).getByRole('link', { name: 'Audit log' })).toBeInTheDocument()
    role = 'ReadOnly'
    await user.type(await screen.findByRole('textbox', { name: 'Find orders' }), 'SO-1')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await vi.waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Staff areas' })).queryByRole('link', { name: 'Audit log' })).toBeNull())
  })

  it('lookup search shows the real reason, including a rate limit', async () => {
    server.use(http.get(`${A}/lookups/orders`, () => HttpResponse.json({ title: 'Too many requests' }, { status: 429 })))
    const user = await signIn('SuperAdmin', '/admin/lookups/orders')
    await user.type(await screen.findByRole('textbox', { name: 'Find orders' }), 'SO-1')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Too many searches. Wait a moment and try again.')).toBeInTheDocument()
  })

  it('a certificate of an unexpected type is download-only: no inline view, no new-tab link', async () => {
    server.use(http.get(`${A}/applications/a-1`, () => HttpResponse.json(app)),
      http.get(`${A}/applications/a-1/files/f-1`, () => new HttpResponse('<script>alert(1)</script>', { headers: { 'Content-Type': 'text/html' } })))
    await signIn('Moderator', '/admin/applications/a-1')
    const dl = await screen.findByRole('link', { name: 'Download the file' })
    expect(dl).toHaveAttribute('download', 'cert.html')
    expect(screen.queryByRole('link', { name: 'Open in a new tab' })).toBeNull()
    expect(document.querySelector('object')).toBeNull()
  })

  it('tabs: arrow keys move and select, only the current tab is in the tab order, and the panel is labelled by it', async () => {
    const user = await signIn('SuperAdmin', '/admin/lookups/orders')
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Bookings' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Bookings' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Bookings' }).id)
    expect(screen.getByRole('tab', { name: 'Bookings' })).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id)
  })

  it('the whole app has exactly one skip link on an admin page', async () => {
    mockSignIn('SuperAdmin')
    adminToken.set('staff-tok')
    render(<MemoryRouter initialEntries={['/admin/login']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Staff sign-in' })
    expect(screen.getAllByRole('link', { name: 'Skip to content' })).toHaveLength(1)
  })
})

