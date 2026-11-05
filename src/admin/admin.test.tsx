import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { adminToken } from './api'
import { A, PERMS, mockSignIn, mount, signIn, waitForPath } from './testkit'

afterEach(() => { adminToken.set(null); vi.useRealTimers() })

describe('staff sign-in and two-factor', () => {
  it('asks for the authenticator code after the password and lands on the dashboard', async () => {
    let body: Record<string, unknown> | undefined
    mockSignIn('SuperAdmin')
    server.use(http.post(`${A}/auth/login`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>
      if (!b.totpCode) return HttpResponse.json({ error: 'Login failed', twoFactorRequired: true }, { status: 401 })
      body = b
      return HttpResponse.json({ accessToken: 'staff-tok', expiresIn: 3600, email: 'staff@example.com', role: 'SuperAdmin', permissions: PERMS.SuperAdmin })
    }))
    const user = userEvent.setup()
    mount('/admin')
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()   // not signed in: redirected
    await user.type(screen.getByLabelText('Email'), 'staff@example.com')
    await user.type(screen.getByLabelText('Password'), 'Some-Passw0rd!x')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Authenticator code'), '123 456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(body).toMatchObject({ email: 'staff@example.com', totpCode: '123456' })
    expect(adminToken.get()).toBe('staff-tok')
  })

  it('accepts a recovery code instead', async () => {
    let body: Record<string, unknown> | undefined
    mockSignIn('Support')
    server.use(http.post(`${A}/auth/login`, async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>
      if (!b.totpCode && !b.recoveryCode) return HttpResponse.json({ twoFactorRequired: true }, { status: 401 })
      body = b
      return HttpResponse.json({ accessToken: 't', expiresIn: 3600, email: 'a@b.c', role: 'Support', permissions: PERMS.Support })
    }))
    const user = userEvent.setup(); mount('/admin/login')
    await user.type(await screen.findByLabelText('Email'), 'a@b.c'); await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code' }))
    await user.type(screen.getByLabelText('Recovery code'), 'ABCDE-12345')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(body).toMatchObject({ recoveryCode: 'ABCDE-12345' })
  })

  it('shows one generic message for a wrong password or code (no hint which)', async () => {
    server.use(http.post(`${A}/auth/login`, () => HttpResponse.json({ error: 'Login failed' }, { status: 401 })))
    const user = userEvent.setup(); mount('/admin/login')
    await user.type(await screen.findByLabelText('Email'), 'a@b.c'); await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed. Check your email and password.')
    expect(adminToken.get()).toBeNull()
  })

  it('makes a staff account without a second factor set one up, shows recovery codes once, then signs in', async () => {
    let enabled: Record<string, unknown> | undefined
    mockSignIn('Moderator', { twoFactorSetup: true })
    server.use(
      http.post(`${A}/auth/2fa/setup`, () => HttpResponse.json({ sharedKey: 'JBSWY3DPEHPK3PXP', otpAuthUri: 'otpauth://totp/Solvelt%20Staff:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=Solvelt%20Staff&digits=6' })),
      http.post(`${A}/auth/2fa/enable`, async ({ request }) => { enabled = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ recoveryCodes: ['AAAAA-11111', 'BBBBB-22222'] }) }),
    )
    const user = userEvent.setup(); mount('/admin/login')
    await user.type(await screen.findByLabelText('Email'), 'a@b.c'); await user.type(screen.getByLabelText('Password'), 'Some-Passw0rd!x')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Set up two-factor authentication' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show my setup code' }))
    expect(await screen.findByRole('img', { name: 'QR code for your authenticator app' })).toBeInTheDocument()
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Code from the app'), '654321')
    await user.click(screen.getByRole('button', { name: 'Turn on two-factor' }))
    expect(enabled).toMatchObject({ email: 'a@b.c', code: '654321' })
    const list = await screen.findByRole('list', { name: 'Recovery codes' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText(/shown once/)).toBeInTheDocument()
  })

  it('ends the session politely when the server says it expired', async () => {
    await signIn('SuperAdmin')
    server.use(http.get(`${A}/applications`, () => HttpResponse.json({ error: 'x' }, { status: 401 })))
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: /Applications/ }))
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()
    expect(screen.getByText('Your staff session ended. Sign in again.')).toBeInTheDocument()
    expect(adminToken.get()).toBeNull()
  })

  it('signs out after the client-side inactivity limit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSignIn('ReadOnly')
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    mount('/admin/login')
    await user.type(await screen.findByLabelText('Email'), 'a@b.c'); await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await screen.findByRole('navigation', { name: 'Staff areas' })
    await act(async () => { await vi.advanceTimersByTimeAsync(14 * 60_000) })
    expect(await screen.findByText('You were signed out after a period of inactivity.')).toBeInTheDocument()
    expect(adminToken.get()).toBeNull()
  })
})

describe('role-based shell', () => {
  it.each([
    ['SuperAdmin', ['Dashboard', 'Applications', 'Sellers', 'Payments', 'Shipping', 'Users', 'Moderation', 'Support lookups', 'Integrations', 'Audit log', 'Platform settings', 'Staff']],
    ['Support', ['Dashboard', 'Applications', 'Sellers', 'Payments', 'Shipping', 'Users', 'Moderation', 'Support lookups', 'Integrations', 'Audit log', 'Platform settings']],
    ['ReadOnly', ['Dashboard', 'Applications', 'Sellers', 'Payments', 'Shipping', 'Users', 'Moderation', 'Support lookups', 'Integrations', 'Audit log', 'Platform settings']],
  ] as const)('%s sees exactly its areas in the navigation', async (role, items) => {
    await signIn(role)
    const nav = screen.getByRole('navigation', { name: 'Staff areas' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual([...items])
    expect(screen.getByText(role === 'SuperAdmin' ? 'Super admin' : role === 'ReadOnly' ? 'Read-only' : role)).toBeInTheDocument()
  })

  it('Support cannot open the Staff page by URL: a clear message, no request for staff data', async () => {
    const staff = vi.fn(() => HttpResponse.json({ members: [], invitations: [] }))
    await signIn('Support', '/admin/staff')
    server.use(http.get(`${A}/staff`, staff))
    expect(await screen.findByRole('heading', { name: 'You don’t have access to this page' })).toBeInTheDocument()
    expect(staff).not.toHaveBeenCalled()
  })

  it('after an explicit sign-out the next sign-in starts at the dashboard; a direct visit returns to the page asked for', async () => {
    const user = await signIn('SuperAdmin', '/admin/staff')                 // direct visit: signed in, then taken to /admin/staff
    expect(screen.getByTestId('loc')).toHaveTextContent('/admin/staff')
    server.use(http.get(`${A}/staff`, () => HttpResponse.json({ members: [], invitations: [] })))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Staff sign-in' })
    await user.type(screen.getByLabelText('Email'), 'staff@example.com'); await user.type(screen.getByLabelText('Password'), 'Some-Passw0rd!x')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/admin$/)
  })

  it('has one skip link, one h1, and signs out through the server', async () => {
    const out = vi.fn(() => new HttpResponse(null, { status: 204 }))
    const user = await signIn('SuperAdmin')
    server.use(http.post(`${A}/auth/logout`, out))
    expect(screen.queryAllByRole('link', { name: 'Skip to content' })).toHaveLength(0)   // AdminApp is mounted without App: the shell must not add its own (the app-wide one lives in App.tsx)
    expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()
    expect(out).toHaveBeenCalled()
  })
})

describe('dashboard', () => {
  it('shows the tiles, the age of the oldest application and the chart with a table alternative', async () => {
    await signIn('ReadOnly')
    expect(await screen.findByText('Applications waiting for review')).toBeInTheDocument()
    expect(screen.getByText('Oldest 5 day(s), average 2.5 day(s)')).toBeInTheDocument()
    expect(screen.getByText('Orders today').previousSibling).toHaveTextContent('7')
    expect(screen.getByRole('img', { name: /Orders, bookings and new sellers per day for the last 14 days/ })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByText('Show the numbers as a table'))
    expect(screen.getByRole('table', { name: 'Daily numbers' })).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(14)
  })
})

describe('sensitive actions', () => {
  const seller = { id: 's-1', vendorName: 'Acme Co', status: 'Approved', statusNote: null, country: 'US', createdAt: '2026-10-01T00:00:00Z', submittedAt: '2026-10-02T00:00:00Z', ownerEmail: 'o@acme.test', ownerEmailVerified: true,
    members: [{ userId: 'u-o', email: 'o@acme.test', role: 'Owner', status: 'Active', lastActiveAt: null }, { userId: 'u-m', email: 'm@acme.test', role: 'Admin', status: 'Active', lastActiveAt: null }],
    brands: [{ id: 'b', name: 'Acme', status: 'Active' }], counts: { listings: 3, activeListings: 2, orders: 5, bookings: 1 }, statusHistory: [], recentActivity: { lastOrderAt: null, lastBookingAt: null, lastListingUpdateAt: null, lastMemberActivityAt: null }, notes: [] }

  it('requires a reason of at least 5 characters before anything is sent', async () => {
    const close = vi.fn(() => HttpResponse.json({ sellerId: 's-1', status: 'Closed' }))
    server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)), http.post(`${A}/sellers/s-1/close`, close))
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1')
    await user.click(await screen.findByRole('button', { name: 'Close account' }))
    const dlg = screen.getByRole('dialog', { name: 'Close this account' })
    await user.type(within(dlg).getByLabelText('Reason (kept in the audit log)'), 'no')
    await user.click(within(dlg).getByRole('button', { name: 'Close account' }))
    expect(within(dlg).getByText('Write at least 5 characters.')).toBeInTheDocument()
    expect(close).not.toHaveBeenCalled()
  })

  it('asks for the authenticator code when the server wants a step-up, then repeats the action', async () => {
    const calls: string[] = []; let stepped = false; let closeBody: Record<string, unknown> | undefined
    server.use(
      http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)),
      http.post(`${A}/sellers/s-1/close`, async ({ request }) => {
        calls.push(stepped ? 'close-ok' : 'close-denied')
        if (!stepped) return HttpResponse.json({ code: 'step_up_required', title: 'Confirm it’s you again' }, { status: 403 })
        closeBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ sellerId: 's-1', status: 'Closed' })
      }),
      http.post(`${A}/auth/step-up`, async ({ request }) => { expect(await request.json()).toEqual({ code: '246810' }); stepped = true; calls.push('step-up'); return HttpResponse.json({ stepUpUntil: 'x' }) }),
    )
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1')
    await user.click(await screen.findByRole('button', { name: 'Close account' }))
    await user.type(within(screen.getByRole('dialog', { name: 'Close this account' })).getByLabelText('Reason (kept in the audit log)'), 'Owner asked by phone')
    await user.click(within(screen.getByRole('dialog', { name: 'Close this account' })).getByRole('button', { name: 'Close account' }))
    const step = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(step).getByLabelText('Authenticator code'), '246810')
    await user.click(within(step).getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Account closed.')
    expect(calls).toEqual(['close-denied', 'step-up', 'close-ok'])
    expect(closeBody).toEqual({ reason: 'Owner asked by phone' })
  })

  it('a wrong authenticator code at step-up shows an error and keeps the staff session (only a real expiry ends it)', async () => {
    server.use(
      http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)),
      http.post(`${A}/sellers/s-1/close`, () => HttpResponse.json({ code: 'step_up_required' }, { status: 403 })),
      http.post(`${A}/auth/step-up`, () => HttpResponse.json({ code: 'step_up_failed', title: 'That code isn’t right.' }, { status: 401 })),
    )
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1')
    await user.click(await screen.findByRole('button', { name: 'Close account' }))
    await user.type(within(screen.getByRole('dialog', { name: 'Close this account' })).getByLabelText('Reason (kept in the audit log)'), 'Owner asked by phone')
    await user.click(within(screen.getByRole('dialog', { name: 'Close this account' })).getByRole('button', { name: 'Close account' }))
    const step = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(step).getByLabelText('Authenticator code'), '000000')
    await user.click(within(step).getByRole('button', { name: 'Confirm' }))
    expect(await within(step).findByText('That code isn’t right.')).toBeInTheDocument()
    expect(adminToken.get()).toBe('staff-tok')                                                           // still signed in
    expect(screen.queryByRole('heading', { name: 'Staff sign-in' })).toBeNull()
  })

  it('shows only the actions a role may use (Moderator can suspend but not close or transfer)', async () => {
    server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)))
    await signIn('Moderator', '/admin/sellers/s-1')
    await screen.findByRole('heading', { name: 'Acme Co' })
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Close account' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resend owner verification' })).toBeNull()
  })

  it('transfers ownership to a chosen member with both a reason and the member id', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)), http.post(`${A}/sellers/s-1/transfer-ownership`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({}) }))
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1')
    await user.click(await screen.findByRole('button', { name: 'Transfer ownership' }))
    const dlg = screen.getByRole('dialog', { name: 'Emergency ownership transfer' })
    await user.selectOptions(within(dlg).getByLabelText('New Owner'), 'u-m')
    await user.type(within(dlg).getByLabelText('Reason (kept in the audit log)'), 'Owner unreachable, ticket 77')
    await user.click(within(dlg).getByRole('button', { name: 'Transfer ownership' }))
    await screen.findByText('Ownership transferred.')
    expect(body).toEqual({ newOwnerUserId: 'u-m', reason: 'Owner unreachable, ticket 77' })
  })
})

describe('applications', () => {
  const detail = {
    id: 'a-1', status: 'PendingReview', statusNote: null, submittedAt: '2026-10-30T10:00:00Z', ageDays: 4, owner: { email: 'o@acme.test', emailVerified: true },
    business: { vendorName: 'Acme Co', contactName: 'Dana Seller', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false },
    kosher: [{ key: 'is_kosher', label: 'Is your food kosher?', type: 'yesno', answer: 'yes' }, { key: 'kosher_agency', label: 'Kosher certifying agency', type: 'select', answer: 'OU' }],
    files: [{ id: 'f-1', fieldKey: 'kosher_certificate', originalName: 'cert.png', contentType: 'image/png', size: 2048, createdAt: '2026-10-30T10:00:00Z' }],
    legal: { termsVersion: '2026-01', termsAcceptedAt: '2026-10-29T10:00:00Z', sellerAgreementVersion: '2026-01', sellerAgreementAcceptedAt: '2026-10-30T10:00:00Z' },
    assignment: null, detail: { statusHistory: [{ type: 'seller.status_changed', at: '2026-10-30T10:00:00Z', detail: 'Draft->PendingReview;actor=;note=;seller=a-1', reason: null, actorRole: null }], notes: [] },
  }

  it('lists the queue with filters sent to the server and the age of each application', async () => {
    const urls: string[] = []
    server.use(http.get(`${A}/applications`, ({ request }) => { urls.push(new URL(request.url).search); return HttpResponse.json({ total: 1, page: 1, pageSize: 25, items: [{ id: 'a-1', vendorName: 'Acme Co', status: 'PendingReview', country: 'US', submittedAt: '2026-10-30T10:00:00Z', ownerEmail: 'o@acme.test', assignedTo: null, ageDays: 4 }] }) }))
    const user = await signIn('Moderator', '/admin/applications')
    expect(await screen.findByRole('link', { name: 'Acme Co' })).toHaveAttribute('href', '/admin/applications/a-1')
    expect(screen.getByText('4 d')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Assigned'), 'me')
    await user.type(screen.getByLabelText('Country'), 'us')
    await waitFor(() => expect(urls.at(-1)).toContain('assigned=me'))
    expect(urls.at(-1)).toContain('country=us')
  })

  it('shows everything the wizard collected, the certificate (fetched with the staff token) and approves with a reason', async () => {
    let auth: string | null = null; let approve: Record<string, unknown> | undefined
    server.use(
      http.get(`${A}/applications/a-1`, () => HttpResponse.json(detail)),
      http.get(`${A}/applications/a-1/files/f-1`, ({ request }) => { auth = request.headers.get('Authorization'); return new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }) }),
      http.post(`${A}/applications/a-1/approve`, async ({ request }) => { approve = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ sellerId: 'a-1', status: 'Approved' }) }),
    )
    const user = await signIn('Moderator', '/admin/applications/a-1')
    await screen.findByRole('heading', { name: 'Acme Co' })
    expect(screen.getByText('1 Main St, Brooklyn, NY, 11201, US')).toBeInTheDocument()
    expect(screen.getByText('Kosher certifying agency').nextSibling).toHaveTextContent('OU')
    expect(screen.getByText('Terms version').nextSibling).toHaveTextContent('2026-01')
    expect(await screen.findByRole('img', { name: 'Uploaded certificate cert.png' })).toBeInTheDocument()
    expect(auth).toBe('Bearer staff-tok')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    const dlg = screen.getByRole('dialog', { name: 'Approve this application' })
    await user.type(within(dlg).getByLabelText('Reason (internal, kept in the audit log)'), 'Certificate verified with the agency')
    await user.click(within(dlg).getByRole('button', { name: 'Approve' }))
    await screen.findByText('Application approved.')
    expect(approve).toEqual({ reason: 'Certificate verified with the agency' })
  })

  it('needs-info sends the message written for the seller; Support and Read-only get no decision buttons', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.get(`${A}/applications/a-1`, () => HttpResponse.json(detail)), http.post(`${A}/applications/a-1/needs-info`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({}) }))
    const user = await signIn('Moderator', '/admin/applications/a-1')
    await user.click(await screen.findByRole('button', { name: 'Needs info' }))
    const dlg = screen.getByRole('dialog', { name: 'Ask the seller for more information' })
    await user.type(within(dlg).getByLabelText('What is missing?'), 'Please upload a clearer certificate.')
    await user.click(within(dlg).getByRole('button', { name: 'Send request' }))
    await screen.findByText('The seller was asked for more information.')
    expect(body).toEqual({ message: 'Please upload a clearer certificate.' })
  })

  it('a Support member sees the application but no decision buttons', async () => {
    server.use(http.get(`${A}/applications/a-1`, () => HttpResponse.json(detail)), http.get(`${A}/applications/a-1/files/f-1`, () => new HttpResponse(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })))
    await signIn('Support', '/admin/applications/a-1')
    await screen.findByRole('heading', { name: 'Acme Co' })
    for (const n of ['Approve', 'Needs info', 'Reject', 'Assign to me']) expect(screen.queryByRole('button', { name: n })).toBeNull()
  })
})

describe('support lookups: masked by default, reveal with a reason', () => {
  const masked = { revealed: false, id: 'o-1', number: 'SO-2026-000001', sellerId: 's-1', status: 'New', currency: 'USD', totalCents: 2499, feeCents: 250, refundedCents: 0, lines: 1,
    buyer: { name: 'J*** B***', email: 'r***@r***.example', phone: '*************11' }, shipTo: { name: 'J*** B***', city: 'Brooklyn', postalCode: '11***', country: 'US' } }
  const raw = { ...masked, revealed: true, buyer: { name: 'Jane Buyer', email: 'relay-abc@relay.example', phone: '+1 555 000 1111' }, shipTo: { name: 'Jane Buyer', line1: '1 Main St', city: 'Brooklyn', postalCode: '11201', country: 'US' } }

  it('shows masked data, then the real data only after a reason, with a visible notice', async () => {
    let body: Record<string, unknown> | undefined
    server.use(
      http.get(`${A}/lookups/orders`, () => HttpResponse.json({ items: [{ id: 'o-1', number: 'SO-2026-000001', sellerId: 's-1', status: 'New', placedAt: '2026-11-01T10:00:00Z', totalCents: 2499, buyerName: 'J*** B***', buyerEmail: 'r***@r***.example' }] })),
      http.get(`${A}/lookups/orders/o-1`, () => HttpResponse.json(masked)),
      http.post(`${A}/lookups/orders/o-1/reveal`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(raw) }),
    )
    const user = await signIn('Support', '/admin/lookups/orders')
    await user.type(await screen.findByRole('textbox', { name: 'Find orders' }), 'SO-2026-000001')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(await screen.findByRole('link', { name: 'SO-2026-000001' }))
    const dd = await screen.findByText('Buyer name')
    expect(dd.nextSibling).toHaveTextContent('J*** B***')
    expect(screen.queryByText('Jane Buyer')).toBeNull(); expect(screen.queryByText(/1 Main St/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reveal personal data' }))
    const dlg = screen.getByRole('dialog', { name: 'Reveal personal data' })
    await user.click(within(dlg).getByRole('button', { name: 'Reveal' }))
    expect(within(dlg).getByText('Write at least 5 characters.')).toBeInTheDocument()          // no reason, no reveal
    expect(body).toBeUndefined()
    await user.type(within(dlg).getByLabelText('Reason, with the ticket reference'), 'Ticket 8812: missing parcel')
    await user.click(within(dlg).getByRole('button', { name: 'Reveal' }))
    expect(await screen.findByText('Personal data is shown. This view was recorded in the audit log.')).toBeInTheDocument()
    expect(screen.getByText('Buyer name').nextSibling).toHaveTextContent('Jane Buyer')
    expect(screen.getByText(/1 Main St/)).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Ticket 8812: missing parcel' })
    expect(screen.queryByRole('button', { name: 'Reveal personal data' })).toBeNull()
  })

  it.each(['ReadOnly', 'Moderator'] as const)('%s has no reveal button', async (role) => {
    server.use(http.get(`${A}/lookups/orders/o-1`, () => HttpResponse.json(masked)))
    await signIn(role, '/admin/lookups/orders/o-1')
    await screen.findByText('Buyer name')
    expect(screen.queryByRole('button', { name: 'Reveal personal data' })).toBeNull()
  })
})

describe('moderation', () => {
  const report = { id: 'r-1', kind: 'message', targetId: 'm-1', sellerId: 's-1', reason: 'Harassment', summary: 'You idiot', reporterKind: 'buyer', status: 'Open', createdAt: '2026-11-02T10:00:00Z', resolvedAt: null, resolution: null, resolutionNote: null, vendor: 'Acme Co',
    target: { conversationId: 'c-1', subject: 'Order question', messages: [{ id: 'm-1', direction: 'Buyer', text: 'You idiot, mail me at j***@e***.com', createdAt: '2026-11-02T09:59:00Z', reported: true }] } }
  it('lets a Moderator warn, dismiss or escalate with a reason; Read-only only reads (text already masked by the server)', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.get(`${A}/moderation/r-1`, () => HttpResponse.json(report)), http.post(`${A}/moderation/r-1/warn-seller`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({}) }))
    const user = await signIn('Moderator', '/admin/moderation/r-1')
    await screen.findByRole('heading', { name: 'Reported message' })
    expect(screen.getByRole('list', { name: 'Conversation' })).toHaveTextContent('You idiot')
    await user.click(screen.getByRole('button', { name: 'Warn seller' }))
    const dlg = screen.getByRole('dialog', { name: 'Warn the seller' })
    await user.type(within(dlg).getByLabelText('Warning text (sent to the seller)'), 'Do not move buyers off the platform')
    await user.click(within(dlg).getByRole('button', { name: 'Send warning' }))
    await screen.findByText('The seller was warned by email.')
    expect(body).toEqual({ reason: 'Do not move buyers off the platform' })
    expect(screen.getByRole('button', { name: 'Escalate: suspend the seller' })).toBeInTheDocument()
  })
  it('Read-only sees the report but no action buttons and a note about masked text', async () => {
    server.use(http.get(`${A}/moderation/r-1`, () => HttpResponse.json(report)))
    await signIn('ReadOnly', '/admin/moderation/r-1')
    await screen.findByRole('heading', { name: 'Reported message' })
    for (const n of ['Dismiss', 'Warn seller', 'Escalate: suspend the seller']) expect(screen.queryByRole('button', { name: n })).toBeNull()
    expect(screen.getByText('Your role can read reports but not act on them.')).toBeInTheDocument()
    expect(screen.getByText('Email addresses and phone numbers in message text are hidden for your role.')).toBeInTheDocument()
  })
  it('hides a reported listing with a reason that is shown to the seller', async () => {
    let body: Record<string, unknown> | undefined
    const listingReport = { ...report, id: 'r-2', kind: 'listing', targetId: 'p-1', target: { productId: 'p-1' } }
    server.use(
      http.get(`${A}/moderation/r-2`, () => HttpResponse.json(listingReport)),
      http.get(`${A}/listings/p-1`, () => HttpResponse.json({ id: 'p-1', type: 'Product', status: 'Active', title: 'Fake brand mug', description: 'plain', sku: null, priceCents: 1500, stock: 3, brand: 'Acme', seller: { id: 's-1', vendorName: 'Acme Co', status: 'Approved' }, images: 2, moderation: null })),
      http.post(`${A}/listings/p-1/hide`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({}) }),
    )
    const user = await signIn('Moderator', '/admin/moderation/r-2')
    await user.click(await screen.findByRole('button', { name: 'Hide listing' }))
    const dlg = screen.getByRole('dialog', { name: 'Hide this listing' })
    await user.type(within(dlg).getByLabelText('Reason (shown to the seller)'), 'Counterfeit brand name in the title')
    await user.click(within(dlg).getByRole('button', { name: 'Hide listing' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Counterfeit brand name in the title' }))
  })
})

describe('integrations', () => {
  const ev = { id: 'e-1', eventType: 'order.accepted', sellerId: 's-1', aggregateId: 'agg-1', status: 'Dead', attempts: 8, createdAt: '2026-11-01T10:00:00Z', nextAttemptAt: '2026-11-01T11:00:00Z', lastError: 'HTTP 500', payload: '{"orderId":"o-1","buyer":{"displayName":"[redacted]"}}' }
  const list = { total: 1, page: 1, pageSize: 25, counts: { pending: 2, retrying: 1, dead: 1, discarded: 0 }, items: [{ ...ev, payload: null }] }

  it('retries a dead letter with a reason; the payload preview is the redacted one', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.get(`${A}/integrations/outbox`, () => HttpResponse.json(list)), http.get(`${A}/integrations/outbox/e-1`, () => HttpResponse.json(ev)),
      http.post(`${A}/integrations/outbox/e-1/retry`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 'e-1', status: 'Pending' }) }))
    const user = await signIn('Support', '/admin/integrations')
    await user.click(await screen.findByRole('button', { name: /Details for order.accepted agg-1/ }))
    expect(await screen.findByText(/\[redacted\]/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()      // Support may retry, not discard
    await user.click(screen.getByRole('button', { name: 'Retry delivery' }))
    const dlg = screen.getByRole('dialog', { name: 'Retry this event' })
    await user.type(within(dlg).getByLabelText('Reason (kept in the audit log)'), 'Marketplace endpoint is back')
    await user.click(within(dlg).getByRole('button', { name: 'Retry' }))
    await screen.findByText('The event is queued again.')
    expect(body).toEqual({ reason: 'Marketplace endpoint is back' })
  })

  it('a Super admin can discard (asks for the authenticator code first)', async () => {
    let stepped = false; const order: string[] = []
    server.use(http.get(`${A}/integrations/outbox`, () => HttpResponse.json(list)), http.get(`${A}/integrations/outbox/e-1`, () => HttpResponse.json(ev)),
      http.post(`${A}/integrations/outbox/e-1/discard`, () => { order.push(stepped ? 'discard-ok' : 'discard-denied'); return stepped ? HttpResponse.json({ status: 'Discarded' }) : HttpResponse.json({ code: 'step_up_required' }, { status: 403 }) }),
      http.post(`${A}/auth/step-up`, () => { stepped = true; order.push('step-up'); return HttpResponse.json({}) }))
    const user = await signIn('SuperAdmin', '/admin/integrations')
    await user.click(await screen.findByRole('button', { name: /Details for order.accepted/ }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await user.type(within(screen.getByRole('dialog', { name: 'Discard this event' })).getByLabelText('Reason (kept in the audit log)'), 'Order was cancelled manually')
    await user.click(within(screen.getByRole('dialog', { name: 'Discard this event' })).getByRole('button', { name: 'Discard' }))
    await user.type(await screen.findByLabelText('Authenticator code'), '111222')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('The event was discarded.')
    expect(order).toEqual(['discard-denied', 'step-up', 'discard-ok'])
  })

  it('shows counts by cause for rejected marketplace requests', async () => {
    server.use(http.get(`${A}/integrations/inbound`, () => HttpResponse.json({ last24h: { bad_signature: 3, stale: 1 }, last7d: { bad_signature: 5, replayed: 2 }, recent: [{ at: '2026-11-03T09:00:00Z', code: 'bad_signature', ipAddress: '10.0.0.1' }] })))
    await signIn('ReadOnly', '/admin/integrations/inbound')
    expect((await screen.findAllByText('bad signature', { selector: 'dt' })).length).toBe(2)   // last 24 h and last 7 days
    expect(screen.getAllByText('replayed').length).toBeGreaterThan(0)
  })
})

describe('audit log', () => {
  it('sends the filters to the server and exports the CSV after a step-up', async () => {
    const urls: string[] = []; let stepped = false; const created: Blob[] = []
    const orig = URL.createObjectURL; URL.createObjectURL = (b: Blob | MediaSource) => { created.push(b as Blob); return 'blob:csv' }
    server.use(
      http.get(`${A}/audit`, ({ request }) => { urls.push(new URL(request.url).search); return HttpResponse.json({ total: 1, page: 1, pageSize: 25, items: [{ id: 1, type: 'admin.user.signed_out_everywhere', at: '2026-11-03T10:00:00Z', actorId: 'aaaaaaaa-1', actorRole: 'Support', subject: null, targetType: 'user', targetId: 'bbbbbbbb-2', reason: 'Ticket A-1', ipAddress: '10.0.0.2', detail: null }] }) }),
      http.get(`${A}/audit/export`, () => stepped ? new HttpResponse('"id","at"\r\n"1","x"\r\n', { headers: { 'Content-Type': 'text/csv' } }) : HttpResponse.json({ code: 'step_up_required' }, { status: 403 })),
      http.post(`${A}/auth/step-up`, () => { stepped = true; return HttpResponse.json({}) }),
    )
    try {
      const user = await signIn('SuperAdmin', '/admin/audit')
      expect(await screen.findByRole('rowheader', { name: 'admin.user.signed_out_everywhere' })).toBeInTheDocument()
      await user.type(screen.getByLabelText('Actor (user id or email part)'), 'support@')
      await user.type(screen.getByLabelText('Action'), 'user.')
      await user.click(screen.getByLabelText('Staff actions only'))
      await user.click(screen.getByRole('button', { name: 'Apply filters' }))
      await waitFor(() => expect(urls.at(-1)).toContain('staffOnly=true'))
      expect(urls.at(-1)).toContain('actor=support%40'); expect(urls.at(-1)).toContain('action=user.')
      await user.click(screen.getByRole('button', { name: 'Export CSV' }))
      await user.type(await screen.findByLabelText('Authenticator code'), '135790')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      await waitFor(() => expect(created.length).toBe(1))
      expect(created[0].type).toBe('text/csv')
    } finally { URL.createObjectURL = orig }
  })
  it('only Super admins get the export button', async () => {
    server.use(http.get(`${A}/audit`, () => HttpResponse.json({ total: 0, page: 1, pageSize: 25, items: [] })))
    await signIn('Support', '/admin/audit')
    await screen.findByText('No events match these filters.')
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
  })
})

describe('platform settings', () => {
  const settings = { marketplace: { feeBasisPoints: 1000, feePercent: 10, overridden: false }, legal: { termsVersion: '2026-01', sellerAgreementVersion: '2026-01', sellersOnOlderTerms: 0, sellersOnOlderAgreement: 0, reacceptance: 'New versions apply to every new acceptance.' }, featureFlags: { Environment: 'Testing' } }
  const fields = [
    { key: 'sells_food', label: 'Do you sell food?', type: 'yesno', options: null, parentKey: null, parentValue: null, required: true, sortOrder: 1 },
    { key: 'is_kosher', label: 'Is your food kosher?', type: 'yesno', options: null, parentKey: 'sells_food', parentValue: 'yes', required: true, sortOrder: 2 },
    { key: 'kosher_certificate', label: 'Certificate', type: 'file', options: null, parentKey: 'is_kosher', parentValue: 'yes', required: true, sortOrder: 3 },
  ]
  it('changes the fee only with a valid number, a reason and a step-up', async () => {
    let body: Record<string, unknown> | undefined; let stepped = false
    server.use(http.get(`${A}/settings`, () => HttpResponse.json(settings)), http.get(`${A}/settings/seller-fields`, () => HttpResponse.json({ fields })),
      http.put(`${A}/settings/fee`, async ({ request }) => {
        if (!stepped) return HttpResponse.json({ code: 'step_up_required' }, { status: 403 })
        body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ feeBasisPoints: 1500 })
      }),
      http.post(`${A}/auth/step-up`, () => { stepped = true; return HttpResponse.json({ stepUpUntil: 'x' }) }))
    const user = await signIn('SuperAdmin', '/admin/settings')
    const input = await screen.findByLabelText('Fee in basis points (100 = 1%)')
    expect(screen.getByRole('button', { name: 'Save fee' })).toBeDisabled()
    await user.clear(input); await user.type(input, '9000')
    expect(screen.getByText('Use a whole number from 0 to 5000.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save fee' })).toBeDisabled()
    await user.clear(input); await user.type(input, '1500')
    await user.click(screen.getByRole('button', { name: 'Save fee' }))
    const dlg = screen.getByRole('dialog', { name: 'Change the marketplace fee' })
    await user.type(within(dlg).getByLabelText('Reason (kept in the audit log)'), 'Board decision 2026-11')
    await user.click(within(dlg).getByRole('button', { name: 'Save fee' }))
    await user.type(await screen.findByLabelText('Authenticator code'), '123456')
    await user.click(screen.getByRole('button', { name: /Confirm|Verify/ }))
    await screen.findByText('Fee saved.')
    expect(body).toEqual({ feeBasisPoints: 1500, reason: 'Board decision 2026-11' })
  })

  it('offers only earlier yes/no or choice questions as the parent of a branch and previews the branching', async () => {
    let preview: Record<string, unknown> | undefined
    server.use(http.get(`${A}/settings`, () => HttpResponse.json(settings)), http.get(`${A}/settings/seller-fields`, () => HttpResponse.json({ fields })),
      http.post(`${A}/settings/seller-fields/preview`, async ({ request }) => { preview = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ fields: fields.map((f) => ({ ...f, visible: f.key !== 'kosher_certificate' })) }) }))
    const user = await signIn('SuperAdmin', '/admin/settings')
    await screen.findByLabelText('Key (field 1)')
    const parentOfFirst = screen.getAllByLabelText('Only ask when this question…')[0]
    expect(within(parentOfFirst).getAllByRole('option').map((o) => o.textContent)).toEqual(['Always ask'])                  // nothing earlier
    const parentOfThird = screen.getAllByLabelText('Only ask when this question…')[2]
    expect(within(parentOfThird).getAllByRole('option').map((o) => o.textContent)).toEqual(['Always ask', 'sells_food', 'is_kosher'])
    expect(screen.getByLabelText('Key (field 3)')).toBeDisabled()                                                          // the certificate field is protected
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(2)                                              // ...and cannot be removed
    await user.selectOptions(screen.getByLabelText('Do you sell food?'), 'yes')
    await user.click(screen.getByRole('button', { name: 'Show preview' }))
    const list = await screen.findByRole('list', { name: 'Preview of the questions' })
    expect(within(list).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['✓ Asked: Do you sell food?', '✓ Asked: Is your food kosher? (depends on sells_food)', '— Hidden: Certificate (depends on is_kosher)'])
    expect(preview).toMatchObject({ answers: { sells_food: 'yes' } })
  })

  it('Support can read the settings but not change them', async () => {
    server.use(http.get(`${A}/settings`, () => HttpResponse.json(settings)), http.get(`${A}/settings/seller-fields`, () => HttpResponse.json({ fields })))
    await signIn('Support', '/admin/settings')
    await screen.findByText(/Currently/)
    expect(screen.queryByLabelText('Fee in basis points (100 = 1%)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save questions' })).toBeNull()
  })
})

describe('staff management', () => {
  const members = [
    { userId: 'u-1', email: 'staff@example.com', role: 'SuperAdmin', active: true, twoFactorEnabled: true, createdAt: '2026-10-01T00:00:00Z', lastLoginAt: null },
    { userId: 'u-2', email: 'sam@example.com', role: 'Support', active: true, twoFactorEnabled: false, createdAt: '2026-10-02T00:00:00Z', lastLoginAt: null },
  ]
  it('invites a staff member with a role and reason; cannot change one’s own access', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.get(`${A}/staff`, () => HttpResponse.json({ members, invitations: [] })), http.post(`${A}/staff/invitations`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({}) }))
    const user = await signIn('SuperAdmin', '/admin/staff')
    expect(await screen.findByText('You can’t change your own access')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change role of sam@example.com/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Change role/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Invite staff member' }))
    const dlg = screen.getByRole('dialog', { name: 'Invite a staff member' })
    await user.type(within(dlg).getByLabelText('Email'), 'new@example.com')
    await user.selectOptions(within(dlg).getByLabelText('Role'), 'Moderator')
    await user.type(within(dlg).getByLabelText('Reason (kept in the audit log)'), 'New trust and safety hire')
    await user.click(within(dlg).getByRole('button', { name: 'Send invitation' }))
    await screen.findByText('Invitation sent.')
    expect(body).toEqual({ email: 'new@example.com', role: 'Moderator', reason: 'New trust and safety hire' })
  })
  it('shows the server’s message when the last Super admin would be removed', async () => {
    server.use(http.get(`${A}/staff`, () => HttpResponse.json({ members, invitations: [] })),
      http.post(`${A}/staff/u-2/deactivate`, () => HttpResponse.json({ code: 'last_super_admin', title: 'There must always be at least one Super admin.' }, { status: 409 })))
    const user = await signIn('SuperAdmin', '/admin/staff')
    await user.click(await screen.findByRole('button', { name: 'Deactivate' }))
    const dlg = screen.getByRole('dialog', { name: 'Deactivate sam@example.com' })
    await user.type(within(dlg).getByLabelText('Reason (kept in the audit log)'), 'Left the company')
    await user.click(within(dlg).getByRole('button', { name: 'Deactivate' }))
    expect(await within(dlg).findByText('There must always be at least one Super admin.')).toBeInTheDocument()
  })
})

describe('invitation page', () => {
  it('sets the password with the token from the link and continues to sign-in', async () => {
    let body: Record<string, unknown> | undefined
    server.use(http.post(`${A}/auth/accept-invite`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return new HttpResponse(null, { status: 204 }) }))
    const user = userEvent.setup()
    mount('/admin/accept-invite?email=new%40example.com&token=tok-123')
    await user.type(await screen.findByLabelText('Password'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
    await waitForPath('/admin/login?email=new%40example.com&invited=1')
    expect(body).toEqual({ email: 'new@example.com', token: 'tok-123', password: 'Tr1cky-Horse-Battery!' })
    expect(await screen.findByText(/Your staff account is ready/)).toBeInTheDocument()
  })
  it('explains an incomplete or invalid link', async () => {
    mount('/admin/accept-invite')
    expect(await screen.findByText(/invitation link is incomplete/)).toBeInTheDocument()
  })
})
