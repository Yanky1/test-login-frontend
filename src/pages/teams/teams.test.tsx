import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import SettingsPage from '../Settings'
import InvitePage from './Invite'
import ChooseAccount from './ChooseAccount'
import { RequireAuth } from '../../components/RequireAuth'
import { API, loginBody, server } from '../../test/server'
import { renderAt, signedIn } from '../../test/utils'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const acct = (id: string, name: string, role: string, status = 'Approved', brandCount = 1) => ({ sellerId: id, vendorName: name, role, accountStatus: status, brandCount })
const brand = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, slug: name.toLowerCase(), description: null, contactEmail: null, website: null, status: 'Active', isDefault: false, hasLogo: false, logoUrl: null, ...over })
const member = (over: Record<string, unknown>) => ({ id: 'm1', userId: 'u1', email: 'owner@example.com', role: 'Owner', status: 'Active', allBrands: true, brands: [], createdAt: '2026-01-01T00:00:00Z', lastActiveAt: null, isMe: false, ...over })

/** Signed in with the given role in account A (single account), plus the endpoints the shell asks for. */
function asRole(role: string, extra: Record<string, unknown> = {}) {
  signedIn({ sellerId: A, vendorName: 'Acme Co', activeAccountId: A, accounts: [acct(A, 'Acme Co', role)], ...extra })
  server.use(
    http.get(`${API}/brands`, () => HttpResponse.json([brand('b1', 'Acme Co'), brand('b2', 'Second')])),
    http.get(`${API}/account/me`, () => HttpResponse.json({ email: 'seller@example.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus: 'Approved', vendorName: 'Acme Co' })),
    http.get(`${API}/team/members`, () => HttpResponse.json([member({ id: 'm0', email: 'seller@example.com', isMe: true, role }), member({ id: 'm1', email: 'owner@example.com', role: 'Owner' }), member({ id: 'm2', email: 'mgr@example.com', role: 'Manager', allBrands: false, brands: [{ id: 'b2', name: 'Second' }] })])),
    http.get(`${API}/team/invitations`, () => HttpResponse.json([])),
  )
}

const shell = (
  <Routes>
    <Route path="/login" element={<div>login page</div>} />
    <Route path="/invite/:token" element={<InvitePage />} />
    <Route element={<RequireAuth />}>
      <Route path="/" element={<div>home page</div>} />
      <Route path="/accounts" element={<ChooseAccount />} />
      <Route path="/settings/:tab?" element={<SettingsPage />} />
    </Route>
  </Routes>
)

describe('account picker after sign-in', () => {
  it('several accounts and none active: shows "Choose an account" with roles and status, then switches', async () => {
    const user = userEvent.setup()
    signedIn({ sellerId: '', vendorName: '', activeAccountId: null, accounts: [acct(A, 'Acme Co', 'Owner', 'Live', 2), acct(B, 'Other Shop', 'Viewer', 'PendingReview')] })
    let switched: unknown = null
    server.use(
      http.get(`${API}/account/invitations`, () => HttpResponse.json([])),
      http.get(`${API}/brands`, () => HttpResponse.json([brand('b1', 'Other Shop')])),
      http.post(`${API}/session/account`, async ({ request }) => {
        switched = await request.json()
        return HttpResponse.json({ accessToken: 'tok-2', body: { activeAccountId: B, vendorName: 'Other Shop', accountStatus: null, role: 'Viewer', accounts: [acct(A, 'Acme Co', 'Owner', 'Live', 2), acct(B, 'Other Shop', 'Viewer', 'PendingReview')] } })
      }),
    )
    renderAt(shell, '/')
    expect(await screen.findByRole('heading', { name: 'Choose an account' })).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Your accounts' })
    expect(within(list).getByText('Acme Co')).toBeInTheDocument()
    expect(within(list).getByText('Owner')).toBeInTheDocument()
    expect(within(list).getByText('Live')).toBeInTheDocument()
    expect(within(list).getByText('Awaiting approval')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to Other Shop' }))
    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(switched).toEqual({ sellerId: B })
  })

  it('exactly one account: goes straight in without asking', async () => {
    signedIn({ sellerId: '', vendorName: '', activeAccountId: null, accounts: [acct(A, 'Acme Co', 'Owner')] })
    server.use(
      http.get(`${API}/account/invitations`, () => HttpResponse.json([])),
      http.get(`${API}/brands`, () => HttpResponse.json([])),
      http.post(`${API}/session/account`, () => HttpResponse.json({ accessToken: 'tok-2', body: { activeAccountId: A, vendorName: 'Acme Co', accountStatus: null, role: 'Owner', accounts: [acct(A, 'Acme Co', 'Owner')] } })),
    )
    renderAt(shell, '/')
    expect(await screen.findByText('home page')).toBeInTheDocument()
  })

  it('already active account: no picker; old servers without accounts keep working', async () => {
    asRole('Owner')
    renderAt(shell, '/')
    expect(await screen.findByText('home page')).toBeInTheDocument()
  })

  it('zero accounts: empty state, pending invites with Accept/Decline, and create-an-account', async () => {
    const user = userEvent.setup()
    signedIn({ sellerId: '', vendorName: '', activeAccountId: null, accounts: [] })
    const calls: string[] = []
    let invites = [{ id: 'i1', accountName: 'Bakery Ltd', role: 'Manager', expiresAt: '2026-12-01T00:00:00Z' }]
    server.use(
      http.get(`${API}/account/invitations`, () => HttpResponse.json(invites)),
      http.get(`${API}/session`, () => HttpResponse.json({ activeAccountId: null, vendorName: '', accountStatus: null, role: null, accounts: [acct(B, 'Bakery Ltd', 'Manager')] })),
      http.post(`${API}/account/invitations/:id/:action`, ({ params }) => { calls.push(`${params.action}:${params.id}`); invites = []; return HttpResponse.json({ sellerId: B }) }),
    )
    renderAt(shell, '/')
    expect(await screen.findByRole('heading', { name: "You're not part of any seller account" })).toBeInTheDocument()
    expect(await screen.findByText('Bakery Ltd')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline invitation to Bakery Ltd' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create a new seller account' }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('You must accept the Terms to create an account.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Accept invitation to Bakery Ltd' }))
    await waitFor(() => expect(calls).toEqual(['accept:i1']))
  })
})

describe('account and brand switchers in the header', () => {
  it('lists accounts with roles, switches and offers to create a new account', async () => {
    const user = userEvent.setup()
    asRole('Owner', { accounts: [acct(A, 'Acme Co', 'Owner'), acct(B, 'Other Shop', 'Viewer')] })
    let body: unknown
    server.use(http.post(`${API}/session/account`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ accessToken: 'tok-3', body: { activeAccountId: B, vendorName: 'Other Shop', accountStatus: null, role: 'Viewer', accounts: [acct(A, 'Acme Co', 'Owner'), acct(B, 'Other Shop', 'Viewer')] } })
    }))
    renderAt(shell, '/')
    const trigger = await screen.findByRole('button', { name: /Acme Co/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Create a new seller account' })).toHaveAttribute('href', '/accounts?new=1')
    await user.click(screen.getByRole('button', { name: /Other Shop/ }))
    await waitFor(() => expect(body).toEqual({ sellerId: B }))
    expect(await screen.findByRole('button', { name: /Other Shop/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
  })

  it('shows a brand filter only when there are several brands', async () => {
    asRole('Admin')
    renderAt(shell, '/')
    const sel = await screen.findByRole('combobox', { name: 'Brand' })
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['All brands', 'Acme Co', 'Second'])
  })

  it('a removed membership (403 no_active_account) drops the user to the account they still have', async () => {
    asRole('Owner', { accounts: [acct(A, 'Acme Co', 'Owner'), acct(B, 'Other Shop', 'Viewer')] })
    server.use(
      http.get(`${API}/account/me`, () => HttpResponse.json({ code: 'no_active_account' }, { status: 403 })),
      http.get(`${API}/session`, () => HttpResponse.json({ activeAccountId: null, vendorName: '', accountStatus: null, role: null, accounts: [acct(B, 'Other Shop', 'Viewer')] })),
      http.get(`${API}/account/invitations`, () => HttpResponse.json([])),
      http.post(`${API}/session/account`, () => HttpResponse.json({ accessToken: 't', body: { activeAccountId: B, vendorName: 'Other Shop', accountStatus: null, role: 'Viewer', accounts: [acct(B, 'Other Shop', 'Viewer')] } })),
    )
    renderAt(shell, '/settings/profile')
    expect(await screen.findByText('home page')).toBeInTheDocument() // single remaining account is opened automatically
    expect(await screen.findByRole('button', { name: /Other Shop/ })).toBeInTheDocument()
  })
})

describe('Team page', () => {
  it('Owner sees invite, change/remove for others, transfer ownership and pending invites', async () => {
    asRole('Owner')
    renderAt(shell, '/settings/team')
    expect(await screen.findByRole('heading', { name: 'Team members' })).toBeInTheDocument()
    expect(await screen.findByText('mgr@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite a team member' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change role or access for mgr@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove owner@example.com' })).toBeInTheDocument() // Owners can manage other Owners
    expect(screen.getByRole('button', { name: 'Leave account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove seller@example.com' })).not.toBeInTheDocument() // never yourself
    expect(screen.getByRole('heading', { name: 'Transfer ownership' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pending invitations' })).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /mgr@example.com/ })).getByText('Second')).toBeInTheDocument() // brand access of the Manager
  })

  it('Admin can invite but cannot touch Owners or transfer ownership', async () => {
    asRole('Admin')
    renderAt(shell, '/settings/team')
    expect(await screen.findByText('mgr@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite a team member' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove mgr@example.com' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove owner@example.com' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change role or access for owner@example.com' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Transfer ownership' })).not.toBeInTheDocument()
  })

  it('Manager and Viewer have no Team tab (and the URL falls back to Profile)', async () => {
    for (const role of ['Manager', 'Viewer']) {
      asRole(role)
      const { unmount } = renderAt(shell, '/settings/team')
      await screen.findByRole('heading', { name: 'Account settings' })
      expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Team members' })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Brands' })).toBeInTheDocument()
      unmount()
    }
  })

  it('invite modal validates the email and the brand scope, lists role descriptions, then sends the request', async () => {
    const user = userEvent.setup()
    asRole('Admin')
    let sent: Record<string, unknown> | null = null
    server.use(http.post(`${API}/team/invitations`, async ({ request }) => { sent = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 'i9' }, { status: 202 }) }))
    renderAt(shell, '/settings/team')
    await user.click(await screen.findByRole('button', { name: 'Invite a team member' }))
    const dlg = screen.getByRole('dialog', { name: 'Invite a team member' })
    // roles an Admin may hand out: no Owner
    expect(within(dlg).getAllByRole('option').map((o) => o.textContent)).toEqual(['Admin', 'Manager', 'Viewer'])
    await user.click(within(dlg).getByRole('button', { name: 'Send invitation' }))
    expect(await within(dlg).findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(sent).toBeNull()
    await user.type(within(dlg).getByLabelText('Email address'), 'new.person@example.com')
    await user.selectOptions(within(dlg).getByLabelText('Role'), 'Manager')
    expect(within(dlg).getByText(/Works on the brands they are given/)).toBeInTheDocument()
    await user.click(within(dlg).getByLabelText('Only selected brands'))
    await user.click(within(dlg).getByRole('button', { name: 'Send invitation' }))
    expect(await within(dlg).findByText('Choose at least one brand, or give access to all brands.')).toBeInTheDocument()
    await user.click(within(dlg).getByLabelText('Second'))
    await user.click(within(dlg).getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(sent).toEqual({ email: 'new.person@example.com', role: 'Manager', allBrands: false, brandIds: ['b2'] }))
    expect(await screen.findByText('Invitation sent to new.person@example.com.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape closes the dialog; removing a member asks for confirmation first', async () => {
    const user = userEvent.setup()
    asRole('Owner')
    let removed = false
    server.use(http.delete(`${API}/team/members/m2`, () => { removed = true; return new HttpResponse(null, { status: 204 }) }))
    renderAt(shell, '/settings/team')
    await user.click(await screen.findByRole('button', { name: 'Remove mgr@example.com' }))
    expect(screen.getByRole('dialog', { name: 'Remove mgr@example.com?' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(removed).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Remove mgr@example.com' }))
    await user.click(screen.getByRole('button', { name: 'Remove member' }))
    await waitFor(() => expect(removed).toBe(true))
  })

  it('resends and revokes pending invitations; shows the server message when the account would lose its last Owner', async () => {
    const user = userEvent.setup()
    asRole('Owner')
    const calls: string[] = []
    server.use(
      http.get(`${API}/team/invitations`, () => HttpResponse.json([{ id: 'i1', email: 'wait@example.com', role: 'Viewer', allBrands: true, brands: [], status: 'Pending', expiresAt: '2026-12-01T00:00:00Z', lastSentAt: '2026-11-01T00:00:00Z', sendCount: 1 }])),
      http.post(`${API}/team/invitations/i1/resend`, () => { calls.push('resend'); return HttpResponse.json({}, { status: 202 }) }),
      http.delete(`${API}/team/invitations/i1`, () => { calls.push('revoke'); return new HttpResponse(null, { status: 204 }) }),
      http.post(`${API}/team/leave`, () => HttpResponse.json({ title: 'An account must always have at least one Owner. Transfer ownership first.', code: 'last_owner' }, { status: 409 })),
    )
    renderAt(shell, '/settings/team')
    await user.click(await screen.findByRole('button', { name: 'Resend invitation to wait@example.com' }))
    await user.click(await screen.findByRole('button', { name: 'Revoke invitation to wait@example.com' }))
    await waitFor(() => expect(calls).toEqual(['resend', 'revoke']))
    await user.click(screen.getByRole('button', { name: 'Leave account' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave account' }))
    expect(await screen.findByText('An account must always have at least one Owner. Transfer ownership first.')).toBeInTheDocument()
  })
})

describe('Brands page', () => {
  it('Viewer and Manager can look but not change', async () => {
    asRole('Manager')
    renderAt(shell, '/settings/brands')
    expect(await screen.findByRole('heading', { name: 'Brands' })).toBeInTheDocument()
    server.use(http.get(`${API}/brands`, () => HttpResponse.json([brand('b1', 'Acme Co'), brand('b2', 'Second')])))
    expect(await screen.findByText('Second')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a brand' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Second' })).not.toBeInTheDocument()
  })

  it('Admin creates a brand with a validated logo and archives; the last active brand cannot be archived', async () => {
    const user = userEvent.setup({ applyAccept: false }) // let the app (not the file picker) reject the wrong type
    asRole('Admin')
    let created: Record<string, unknown> | null = null; let uploaded = false
    server.use(
      http.get(`${API}/brands`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('includeArchived') ? [brand('b1', 'Acme Co'), brand('b2', 'Second', { status: 'Archived' })] : [brand('b1', 'Acme Co')])),
      http.post(`${API}/brands`, async ({ request }) => { created = (await request.json()) as Record<string, unknown>; return HttpResponse.json(brand('b3', 'Sweet Things'), { status: 201 }) }),
      http.post(`${API}/brands/b3/logo`, () => { uploaded = true; return HttpResponse.json(brand('b3', 'Sweet Things', { hasLogo: true })) }),
    )
    renderAt(shell, '/settings/brands')
    expect(await screen.findByText("You can't archive your last active brand.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive Acme Co' })).not.toBeInTheDocument() // the last active brand
    expect(screen.getByRole('button', { name: 'Restore Second' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a brand' }))
    const dlg = screen.getByRole('dialog', { name: 'Add a brand' })
    await user.click(within(dlg).getByRole('button', { name: 'Add brand' }))
    expect(await within(dlg).findByText('Enter a name for the brand.')).toBeInTheDocument()
    await user.type(within(dlg).getByLabelText('Brand name'), 'Sweet Things')
    await user.upload(within(dlg).getByLabelText(/Logo/), new File(['x'], 'logo.gif', { type: 'image/gif' }))
    expect(await within(dlg).findByText('Use a JPEG, PNG or WebP image.')).toBeInTheDocument()
    await user.upload(within(dlg).getByLabelText(/Logo/), new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    expect(await within(dlg).findByText('The logo must be 1 MB or smaller.')).toBeInTheDocument()
    await user.upload(within(dlg).getByLabelText(/Logo/), new File(['x'], 'logo.png', { type: 'image/png' }))
    await user.click(within(dlg).getByRole('button', { name: 'Add brand' }))
    await waitFor(() => expect(created).toMatchObject({ name: 'Sweet Things' }))
    await waitFor(() => expect(uploaded).toBe(true))
    expect(await screen.findByText('Sweet Things added.')).toBeInTheDocument()
  })
})

describe('invitation pages', () => {
  const preview = (over: Record<string, unknown> = {}) => ({ state: 'pending', email: 'invitee@example.com', accountName: 'Acme Co', role: 'Manager', allBrands: false, brands: ['Second'], expiresAt: '2026-12-01T00:00:00Z', ...over })

  it.each([
    ['expired', 'This invitation has expired'],
    ['revoked', 'This invitation was withdrawn'],
    ['accepted', 'This invitation was already used'],
    ['declined', 'This invitation was declined'],
  ])('shows the %s state', async (state, title) => {
    server.use(http.get(`${API}/invitations/tok`, () => HttpResponse.json(preview({ state }))))
    renderAt(shell, '/invite/tok')
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
  })

  it('an unknown link is a plain "isn\'t valid" page', async () => {
    server.use(http.get(`${API}/invitations/nope`, () => HttpResponse.json({ code: 'invite_not_found' }, { status: 404 })))
    renderAt(shell, '/invite/nope')
    expect(await screen.findByRole('heading', { name: "This invitation link isn't valid" })).toBeInTheDocument()
  })

  it('signed out, new user: email is locked, password rules and terms are enforced, then joins and lands in the app', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.get(`${API}/invitations/tok`, () => HttpResponse.json(preview())),
      http.post(`${API}/invitations/tok/join`, async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json(loginBody({ sellerId: A, activeAccountId: A, accounts: [acct(A, 'Acme Co', 'Manager')] })) }),
      http.get(`${API}/brands`, () => HttpResponse.json([brand('b2', 'Second')])),
    )
    renderAt(shell, '/invite/tok')
    expect(await screen.findByRole('heading', { name: "You're invited" })).toBeInTheDocument()
    const email = screen.getByLabelText('Email')
    expect(email).toHaveValue('invitee@example.com'); expect(email).toHaveAttribute('readonly')
    expect(screen.getByText(/Brand access: Second/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create login and join' }))
    expect(await screen.findByText('Password does not meet the requirements')).toBeInTheDocument()
    expect(screen.getByText('You must accept the Terms to continue')).toBeInTheDocument()
    expect(body).toBeNull()
    await user.type(screen.getByLabelText('Choose a password'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByLabelText(/I agree to the Terms/))
    await user.click(screen.getByRole('button', { name: 'Create login and join' }))
    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(body).toEqual({ password: 'Tr1cky-Horse-Battery!', acceptTerms: true })
  })

  it('signed out: existing login is sent to sign in and back; decline is possible', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${API}/invitations/tok`, () => HttpResponse.json(preview())),
      http.post(`${API}/invitations/tok/join`, () => HttpResponse.json({ code: 'sign_in_required' }, { status: 409 })),
    )
    renderAt(shell, '/invite/tok')
    expect(await screen.findByRole('link', { name: 'I already have a Solvelt login' })).toHaveAttribute('href', '/login?next=%2Finvite%2Ftok')
    await user.type(screen.getByLabelText('Choose a password'), 'Tr1cky-Horse-Battery!')
    await user.click(screen.getByLabelText(/I agree to the Terms/))
    await user.click(screen.getByRole('button', { name: 'Create login and join' }))
    expect(await screen.findByRole('link', { name: 'Sign in to accept the invitation' })).toBeInTheDocument()
  })

  it('signed out: decline', async () => {
    const user = userEvent.setup()
    let declined = false
    server.use(
      http.get(`${API}/invitations/tok`, () => HttpResponse.json(preview())),
      http.post(`${API}/invitations/tok/decline`, () => { declined = true; return new HttpResponse(null, { status: 204 }) }),
    )
    renderAt(shell, '/invite/tok')
    await user.click(await screen.findByRole('button', { name: 'Decline invitation' }))
    expect(await screen.findByRole('heading', { name: 'Invitation declined' })).toBeInTheDocument()
    expect(declined).toBe(true)
  })

  it('signed in with the right email: accepts and switches to the new account', async () => {
    const user = userEvent.setup()
    asRole('Owner', { email: 'invitee@example.com', accounts: [acct(A, 'Acme Co', 'Owner')] })
    let switched: unknown
    server.use(
      http.get(`${API}/invitations/tok`, () => HttpResponse.json(preview())),
      http.post(`${API}/invitations/tok/accept`, () => HttpResponse.json({ sellerId: B, role: 'Manager' })),
      http.get(`${API}/session`, () => HttpResponse.json({ activeAccountId: A, vendorName: 'Acme Co', accountStatus: null, role: 'Owner', accounts: [acct(A, 'Acme Co', 'Owner'), acct(B, 'Acme Co', 'Manager')] })),
      http.post(`${API}/session/account`, async ({ request }) => { switched = await request.json(); return HttpResponse.json({ accessToken: 't', body: { activeAccountId: B, vendorName: 'Acme Co', accountStatus: null, role: 'Manager', accounts: [acct(B, 'Acme Co', 'Manager')] } }) }),
    )
    renderAt(shell, '/invite/tok')
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(switched).toEqual({ sellerId: B })
  })

  it('signed in with another email: explains the mismatch and offers to sign out', async () => {
    const user = userEvent.setup()
    asRole('Owner')
    server.use(
      http.get(`${API}/invitations/tok`, () => HttpResponse.json(preview())),
      http.post(`${API}/invitations/tok/accept`, () => HttpResponse.json({ code: 'email_mismatch', title: 'different email' }, { status: 403 })),
    )
    renderAt(shell, '/invite/tok')
    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    expect(await screen.findByRole('heading', { name: 'Wrong email address' })).toBeInTheDocument()
    expect(screen.getByText(/invitation was sent to invitee@example.com, but you are signed in as seller@example.com/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out and continue' }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })
})
