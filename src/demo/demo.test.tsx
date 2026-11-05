import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import SellerLayout from '../products/SellerLayout'
import SettingsPage from '../pages/Settings'
import { WizardLayout } from '../pages/wizard/shared'
import PendingStep from '../pages/wizard/PendingStep'
import ProductsListPage from '../products/ProductsList'
import OrdersListPage from '../orders/OrdersList'
import { item as orderItem } from '../orders/testkit'
import { API, loginBody, server } from '../test/server'
import { renderAt, signedIn } from '../test/utils'
import { countsSummary, isPendingStatus } from './api'
import { DemoPill } from './DemoPill'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const acct = (role: string, status = 'Approved') => ({ sellerId: A, vendorName: 'Acme Co', role, accountStatus: status, brandCount: 1 })
const ZERO = { products: 0, services: 0, orders: 0, bookings: 0, quotes: 0, conversations: 0, notifications: 0 }
const FILLED = { products: 8, services: 3, orders: 12, bookings: 5, quotes: 2, conversations: 4, notifications: 6 }
const EXISTS = { exists: true, batchId: 'b1', createdAt: '2026-11-01T00:00:00Z', counts: FILLED }
const NONE = { exists: false, batchId: null, createdAt: null, counts: ZERO }
const emptyList = { items: [], total: 0, page: 1, pageSize: 1, counts: { all: 0, draft: 0, active: 0, inactive: 0, archived: 0, outOfStock: 0, attention: 0 } }

interface Opts { demo?: boolean; role?: string; status?: string; products?: number; orders?: number; demoStatus?: typeof NONE | typeof EXISTS }
const publicConfig = (demo: boolean) => http.get(`${API}/public-config`, () => HttpResponse.json({
  marketplaceUrl: 'https://market.example', termsVersion: '1', sellerAgreementVersion: '1', smsWordingVersion: '1', smsWording: 'x', turnstileSiteKey: 'stub', ...(demo ? { demoEnabled: true } : {}),
}))
const application = (status: string) => ({
  sellerId: A, status, statusNote: null, draftStep: 5, editable: false,
  business: { vendorName: 'Acme Co', contactName: 'Dana', contactPhone: '+1 555 123 4567', addressLine1: '1 Main St', addressLine2: null, city: 'Brooklyn', region: 'NY', postalCode: '11201', country: 'US', smsOptIn: false },
  kosher: { answers: {}, certificate: null }, legal: { termsVersion: '1', termsAcceptedAt: 'x', sellerAgreementVersion: null, sellerAgreementAcceptedAt: null }, marketplaceUrl: 'https://market.example',
})

/** Signed in, with the shell endpoints, the demo flag and the emptiness probes mocked. Returns the calls the demo endpoints saw. */
function setup(o: Opts = {}) {
  const { demo = true, role = 'Owner', status = 'Approved', products = 0, orders = 0, demoStatus = NONE } = o
  const calls: string[] = []
  let appStatus = status
  signedIn(loginBody({ sellerId: A, vendorName: 'Acme Co', activeAccountId: A, accountStatus: status, accounts: [acct(role, status)] }))
  server.use(
    publicConfig(demo),
    http.get(`${API}/brands`, () => HttpResponse.json([{ id: 'b1', name: 'Acme Co', isDefault: true }])),
    http.get(`${API}/seller/products`, () => HttpResponse.json({ ...emptyList, total: products })),
    http.get(`${API}/seller/orders/counts`, () => HttpResponse.json({ needsAction: 0, pending: 0, shipped: 0, delivered: 0, cancelled: 0, returns: 0, late: 0, all: orders })),
    http.get(`${API}/seller/demo-data`, () => { calls.push('GET demo-data'); return HttpResponse.json(demoStatus) }),
    http.post(`${API}/seller/demo-data`, () => { calls.push('POST demo-data'); return HttpResponse.json({ batchId: 'b1', counts: FILLED }, { status: 201 }) }),
    http.delete(`${API}/seller/demo-data`, () => { calls.push('DELETE demo-data'); return HttpResponse.json({ removed: FILLED }) }),
    http.post(`${API}/seller/demo/approve`, () => { calls.push('POST approve'); appStatus = 'Approved'; return HttpResponse.json({ status: 'Approved' }) }),
    http.get(`${API}/session`, () => { calls.push('GET session'); return HttpResponse.json({ activeAccountId: A, vendorName: 'Acme Co', accountStatus: appStatus, role, accounts: [acct(role, appStatus)] }) }),
    http.get(`${API}/account/me`, () => HttpResponse.json({ email: 'seller@example.com', emailConfirmed: true, hasPassword: true, twoFactorEnabled: false, passkeyCount: 0, logins: [], sellerStatus: status, vendorName: 'Acme Co' })),
    http.get(`${API}/seller/application`, () => HttpResponse.json(application(appStatus))),
    http.get(`${API}/seller/field-config`, () => HttpResponse.json([])),
  )
  return calls
}

const shell = (
  <Routes>
    <Route element={<RequireAuth />}>
      <Route element={<SellerLayout />}>
        <Route path="/products" element={<div>products page</div>} />
        <Route path="/orders" element={<div>orders page</div>} />
        <Route path="/calendar" element={<div>calendar page</div>} />
      </Route>
      <Route path="/settings/:tab?" element={<SettingsPage />} />
      <Route path="/signup" element={<WizardLayout />}><Route path="pending" element={<PendingStep />} /></Route>
    </Route>
  </Routes>
)

describe('TEST MODE badge', () => {
  it('shows in the topbar when the server is in demo mode, for any role', async () => {
    setup({ role: 'Viewer' })
    renderAt(shell, '/products')
    expect(await screen.findByText('TEST MODE', { selector: 'header .chip' })).toBeInTheDocument()
  })
  it('is absent when demoEnabled is false or missing', async () => {
    setup({ demo: false })
    renderAt(shell, '/products')
    await screen.findByText('products page')
    expect(screen.queryByText('TEST MODE')).not.toBeInTheDocument()
  })
})

describe('Fill with demo data card (dashboard)', () => {
  it('shows for an Owner of an empty account; fills with progress, then confirms and reloads the page', async () => {
    const user = userEvent.setup()
    const calls = setup()
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    server.use(http.post(`${API}/seller/demo-data`, async () => { calls.push('POST demo-data'); await gate; return HttpResponse.json({ batchId: 'b1', counts: FILLED }, { status: 201 }) }))
    renderAt(shell, '/products')
    const card = (await screen.findByRole('heading', { name: /Fill with demo data/ })).closest('section')!
    await user.click(within(card).getByRole('button', { name: 'Fill with demo data' }))
    expect(await within(card).findByRole('status')).toHaveTextContent('Creating demo data')
    expect(within(card).getByRole('button', { name: 'Fill with demo data' })).toBeDisabled()
    release()
    expect(await screen.findByRole('heading', { name: 'Demo data added' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('8 products, 3 services, 12 orders, 5 bookings, 2 quote requests, 4 conversations')
    expect(calls.filter((c) => c === 'POST demo-data')).toHaveLength(1)
  })
  it('also shows on Orders', async () => {
    setup()
    renderAt(shell, '/orders')
    expect(await screen.findByRole('button', { name: 'Fill with demo data' })).toBeInTheDocument()
  })
  it('is hidden when the account has products', async () => {
    setup({ products: 2 })
    renderAt(shell, '/products')
    await screen.findByText('products page')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Fill with demo data' })).not.toBeInTheDocument())
  })
  it('is hidden when the account has orders', async () => {
    setup({ orders: 1 })
    renderAt(shell, '/products')
    await screen.findByText('products page')
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('button', { name: 'Fill with demo data' })).not.toBeInTheDocument()
  })
  it('is hidden when demo data already exists', async () => {
    setup({ demoStatus: EXISTS })
    renderAt(shell, '/products')
    await screen.findByText('products page')
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('button', { name: 'Fill with demo data' })).not.toBeInTheDocument()
  })
  it('is hidden when the flag is off', async () => {
    const calls = setup({ demo: false })
    renderAt(shell, '/products')
    await screen.findByText('products page')
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('button', { name: 'Fill with demo data' })).not.toBeInTheDocument()
    expect(calls).not.toContain('GET demo-data')   // nothing is even asked of the demo endpoints (they answer 404 then)
  })
  it.each(['Admin', 'Manager', 'Viewer'])('is hidden for a %s (Owner only)', async (role) => {
    setup({ role })
    renderAt(shell, '/products')
    await screen.findByText('products page')
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('button', { name: 'Fill with demo data' })).not.toBeInTheDocument()
  })
  it('shows the server problem (rate limit) and lets the Owner try again', async () => {
    const user = userEvent.setup()
    setup()
    server.use(http.post(`${API}/seller/demo-data`, () => HttpResponse.json({ code: 'rate_limited' }, { status: 429 })))
    renderAt(shell, '/products')
    await user.click(await screen.findByRole('button', { name: 'Fill with demo data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries')
    expect(screen.getByRole('button', { name: 'Fill with demo data' })).toBeEnabled()
  })
  it('explains demo_data_exists (409)', async () => {
    const user = userEvent.setup()
    setup()
    server.use(http.post(`${API}/seller/demo-data`, () => HttpResponse.json({ code: 'demo_data_exists' }, { status: 409 })))
    renderAt(shell, '/products')
    await user.click(await screen.findByRole('button', { name: 'Fill with demo data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already has demo data')
  })
})

describe('pending-approval screen', () => {
  it('shows the fill card with a note that the data appears after approval, plus the approve button (Owner)', async () => {
    const user = userEvent.setup()
    const calls = setup({ status: 'PendingReview' })
    renderAt(shell, '/signup/pending')
    const card = (await screen.findByRole('heading', { name: /Fill with demo data/ })).closest('section')!
    expect(within(card).getByText(/appear in your lists after approval/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve this account (test mode)' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Fill with demo data' }))
    expect(await screen.findByRole('heading', { name: 'Demo data added' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('once this account is approved')
    expect(calls).toContain('POST demo-data')
    expect(calls).not.toContain('POST approve')     // filling never approves
  })
  it('without the flag there is neither card nor approve button', async () => {
    setup({ status: 'PendingReview', demo: false })
    renderAt(shell, '/signup/pending')
    await screen.findByRole('heading', { name: 'Your application is pending' })
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('button', { name: /Approve this account/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fill with demo data' })).not.toBeInTheDocument()
  })
  it.each(['Admin', 'Viewer'])('a %s sees no demo tools', async (role) => {
    setup({ status: 'PendingReview', role })
    renderAt(shell, '/signup/pending')
    await screen.findByRole('heading', { name: 'Your application is pending' })
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('button', { name: /Approve this account/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fill with demo data' })).not.toBeInTheDocument()
  })
  it('approve asks first: Cancel does nothing', async () => {
    const user = userEvent.setup()
    const calls = setup({ status: 'PendingReview' })
    renderAt(shell, '/signup/pending')
    await user.click(await screen.findByRole('button', { name: 'Approve this account (test mode)' }))
    const dlg = await screen.findByRole('dialog', { name: 'Approve this account?' })
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).not.toContain('POST approve')
  })
  it('confirming approves, refreshes the session and opens the full portal', async () => {
    const user = userEvent.setup()
    const calls = setup({ status: 'PendingReview' })
    renderAt(<>{shell}</>, '/signup/pending')
    await user.click(await screen.findByRole('button', { name: 'Approve this account (test mode)' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, approve it' }))
    expect(await screen.findByText('products page')).toBeInTheDocument()
    expect(screen.getByTestId('loc')).toHaveTextContent('/products')
    expect(calls).toContain('POST approve')
    expect(calls).toContain('GET session')
  })
  it('a not_pending answer is shown in the dialog and nothing opens', async () => {
    const user = userEvent.setup()
    setup({ status: 'PendingReview' })
    server.use(http.post(`${API}/seller/demo/approve`, () => HttpResponse.json({ code: 'not_pending' }, { status: 409 })))
    renderAt(shell, '/signup/pending')
    await user.click(await screen.findByRole('button', { name: 'Approve this account (test mode)' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, approve it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not waiting for approval')
    expect(screen.queryByText('products page')).not.toBeInTheDocument()
  })
})

describe('Settings -> Test tools', () => {
  it('is a tab for the Owner when demo mode is on', async () => {
    setup()
    renderAt(shell, '/settings/profile')
    expect(await screen.findByRole('link', { name: 'Test tools' })).toHaveAttribute('href', '/settings/test-tools')
  })
  it.each(['Admin', 'Manager', 'Viewer'])('is not offered to a %s, and the URL shows nothing of it', async (role) => {
    setup({ role })
    renderAt(shell, '/settings/test-tools')
    await screen.findByRole('heading', { name: 'Profile' })
    expect(screen.queryByRole('link', { name: 'Test tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Test tools' })).not.toBeInTheDocument()
  })
  it('is not offered when the flag is off', async () => {
    setup({ demo: false })
    renderAt(shell, '/settings/test-tools')
    await screen.findByRole('heading', { name: 'Profile' })
    expect(screen.queryByRole('link', { name: 'Test tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Test tools' })).not.toBeInTheDocument()
  })
  it('with no demo data: Fill is enabled, Remove is disabled; filling shows the counts', async () => {
    const user = userEvent.setup()
    const calls = setup()
    renderAt(shell, '/settings/test-tools')
    const fill = await screen.findByRole('button', { name: 'Fill with demo data' })
    expect(screen.getByRole('button', { name: 'Remove demo data' })).toBeDisabled()
    server.use(http.get(`${API}/seller/demo-data`, () => HttpResponse.json(EXISTS)))
    await user.click(fill)
    expect(await screen.findByRole('list', { name: 'Demo records in this account' })).toHaveTextContent('12 Orders')
    expect(screen.getByRole('button', { name: 'Fill with demo data' })).toBeDisabled()
    expect(calls).toContain('POST demo-data')
  })
  it('Remove asks first; Cancel keeps everything; confirm deletes', async () => {
    const user = userEvent.setup()
    const calls = setup({ demoStatus: EXISTS })
    renderAt(shell, '/settings/test-tools')
    await user.click(await screen.findByRole('button', { name: 'Remove demo data' }))
    let dlg = await screen.findByRole('dialog', { name: 'Remove demo data?' })
    expect(dlg).toHaveTextContent('Records you created yourself are not touched')
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).not.toContain('DELETE demo-data')
    await user.click(screen.getByRole('button', { name: 'Remove demo data' }))
    dlg = await screen.findByRole('dialog', { name: 'Remove demo data?' })
    server.use(http.get(`${API}/seller/demo-data`, () => HttpResponse.json(NONE)))
    await user.click(within(dlg).getByRole('button', { name: 'Yes, remove demo data' }))
    await waitFor(() => expect(calls).toContain('DELETE demo-data'))
    expect(await screen.findByText('This account has no demo data.')).toBeInTheDocument()
    expect(screen.getByText(/Removed 8 products/)).toBeInTheDocument()
  })
  it('offers "Approve this account" only while the account is pending', async () => {
    setup({ status: 'PendingReview' })
    renderAt(shell, '/settings/test-tools')
    expect(await screen.findByRole('button', { name: 'Approve this account (test mode)' })).toBeInTheDocument()
  })
  it('does not offer approve for an approved account', async () => {
    setup()
    renderAt(shell, '/settings/test-tools')
    await screen.findByRole('button', { name: 'Fill with demo data' })
    expect(screen.queryByRole('button', { name: /Approve this account/ })).not.toBeInTheDocument()
  })
  it('approving from Settings confirms, calls the server and opens the portal', async () => {
    const user = userEvent.setup()
    const calls = setup({ status: 'PendingReview' })
    renderAt(shell, '/settings/test-tools')
    await user.click(await screen.findByRole('button', { name: 'Approve this account (test mode)' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Approve this account?' })).getByRole('button', { name: 'Yes, approve it' }))
    expect(await screen.findByText('products page')).toBeInTheDocument()
    expect(calls).toContain('POST approve')
  })
})

describe('Demo pill', () => {
  it('has the visible text "Demo"', () => {
    renderAt(<DemoPill />, '/')
    expect(screen.getByText('Demo')).toBeInTheDocument()
  })
  it('marks products with demo: true in the products list, and only those', async () => {
    setup()
    const base = { sku: null, status: 'Active', brandId: 'b1', brandName: 'Acme Co', categoryId: 'c', price: 10, currentPrice: 10, onSale: false, quantity: 5, hasVariants: false, variantCount: 0, qualityScore: 82, canPublish: true, needsAttention: false, lowStock: false, version: 1, updatedAt: '2026-11-01T00:00:00Z', thumbnailUrl: null }
    server.use(http.get(`${API}/seller/products`, () => HttpResponse.json({ items: [{ ...base, id: 'p1', title: 'Demo mug', demo: true }, { ...base, id: 'p2', title: 'Real bowl' }], total: 2, page: 1, pageSize: 20, counts: { all: 2, draft: 0, active: 2, inactive: 0, archived: 0, outOfStock: 0, attention: 0 } })))
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/products" element={<ProductsListPage />} /></Route></Routes>, '/products')
    const demoRow = (await screen.findAllByRole('link', { name: 'Demo mug' }))[0].closest('tr')!
    expect(within(demoRow).getByText('Demo')).toBeInTheDocument()
    const realRow = screen.getAllByRole('link', { name: 'Real bowl' })[0].closest('tr')!
    expect(within(realRow).queryByText('Demo')).not.toBeInTheDocument()
  })
  it('marks orders with demo: true in the orders list', async () => {
    setup()
    const counts = { needsAction: 0, pending: 0, shipped: 0, delivered: 0, cancelled: 0, returns: 0, late: 0, all: 2 }
    server.use(
      http.get(`${API}/seller/orders/counts`, () => HttpResponse.json(counts)),
      http.get(`${API}/seller/orders/dashboard`, () => HttpResponse.json({ todayOrders: 0, toShip: 0, late: 0, returnsOpen: 0, sales30Cents: 0, orders30: 0, daily: [], lateShipmentRate: 0, cancellationRate: 0, messages: { unread: 0, needsReply: 0, overdue: 0, avgResponseHours: null, repliedInTimePct: null } })),
      http.get(`${API}/seller/orders`, () => HttpResponse.json({ items: [orderItem({ id: 'o1', number: 'SO-DEMO-1', demo: true }), orderItem({ id: 'o2', number: 'SO-REAL-2' })], total: 2, page: 1, pageSize: 20 })),
    )
    renderAt(<Routes><Route element={<RequireAuth />}><Route path="/orders" element={<OrdersListPage />} /></Route></Routes>, '/orders')
    const demoRow = (await screen.findAllByRole('link', { name: 'SO-DEMO-1' }))[0].closest('tr')!
    expect(within(demoRow).getByText('Demo')).toBeInTheDocument()
    const realRow = screen.getAllByRole('link', { name: 'SO-REAL-2' })[0].closest('tr')!
    expect(within(realRow).queryByText('Demo')).not.toBeInTheDocument()
  })
})

describe('helpers', () => {
  it('summarises counts in plain words and skips zeros', () => {
    expect(countsSummary({ ...ZERO, products: 1, orders: 2 })).toBe('1 product, 2 orders')
    expect(countsSummary(ZERO)).toBe('')
  })
  it('only pending accounts can be approved', () => {
    expect(isPendingStatus('PendingReview')).toBe(true)
    expect(isPendingStatus('NeedsInfo')).toBe(true)
    expect(isPendingStatus('Approved')).toBe(false)
    expect(isPendingStatus(null)).toBe(false)
  })
})
