import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import { adminToken, type StaffRole } from './api'
import { A, signIn } from './testkit'

afterEach(() => { adminToken.set(null); vi.useRealTimers() })

const ROLES: StaffRole[] = ['SuperAdmin', 'Support', 'Moderator', 'ReadOnly']
const page = <T,>(items: T[]) => ({ total: items.length, page: 1, pageSize: 25, items })

const seller = { id: 's-1', vendorName: 'Acme Co', status: 'Approved', statusNote: null, country: 'US', createdAt: '2026-10-01T00:00:00Z', submittedAt: '2026-10-02T00:00:00Z', ownerEmail: 'o@acme.test', ownerEmailVerified: true,
  members: [], brands: [], counts: { listings: 0, activeListings: 0, orders: 0, bookings: 0 }, statusHistory: [],
  recentActivity: { lastOrderAt: null, lastBookingAt: null, lastListingUpdateAt: null, lastMemberActivityAt: null }, notes: [] }

const overview = (hold = false) => ({
  seller: { id: 's-1', vendorName: 'Acme Co', status: 'Approved' },
  balances: [{ currency: 'USD', pendingCents: 1200, availableCents: 345600, reservedCents: 500, inTransitCents: 700, paidOutCents: 90000, owedCents: 346300, negative: false }],
  stripe: { stripeAccountId: 'acct_123', onboarding: { state: 'restricted', payoutsEnabled: false, chargesEnabled: true, detailsSubmitted: true, pastDue: ['individual.id_number'], currentlyDue: [], disabledReason: 'requirements.past_due', deadline: null }, lastEventAt: null },
  activeHold: hold ? { id: 'h-1', reason: 'Chargeback risk', placedAt: '2026-11-01T10:00:00Z', placedBy: 'u-1' } : null,
  holds: hold ? [{ id: 'h-1', reason: 'Chargeback risk', placedAt: '2026-11-01T10:00:00Z', placedBy: 'u-1' }] : [], failedTransfers: 1, openDisputes: 2,
})
const journal = { id: 'j-1', createdAt: '2026-11-01T10:00:00Z', type: 'sale', memo: 'Order 1001', currency: 'USD', orderId: 'o-1', bookingId: null, sourceRef: null, reason: null, entries: [{ account: 'Pending', kind: 'sale', amountCents: 1999 }] }

function sellerMocks(opts: { hold?: boolean } = {}) {
  server.use(
    http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)),
    http.get(`${A}/payments/sellers/s-1`, () => HttpResponse.json(overview(opts.hold))),
    http.get(`${A}/payments/sellers/s-1/ledger`, () => HttpResponse.json(page([journal]))),
  )
}
const reasonBox = (dlg: HTMLElement) => within(dlg).getByLabelText(/^(Reason|Warning text)/)

describe('navigation', () => {
  it.each(ROLES)('%s sees the Payments and Shipping pages (every role can read them)', async (role) => {
    await signIn(role)
    const nav = screen.getByRole('navigation', { name: 'Staff areas' })
    expect(within(nav).getByRole('link', { name: 'Payments' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Shipping' })).toBeInTheDocument()
  })

  it('hides the nav items and shows a no-access page when the role has no payments or shipping permission', async () => {
    const user = await signIn('SuperAdmin', '/admin/payments', { permissions: ['DashboardView'] })
    expect(await screen.findByRole('heading', { name: 'You don’t have access to this page' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Staff areas' })
    expect(within(nav).queryByRole('link', { name: 'Payments' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Shipping' })).toBeNull()
    expect(user).toBeTruthy()
  })
})

describe('seller page tabs', () => {
  it('links the payments, shipping and delivery views as tabs and opens each', async () => {
    sellerMocks()
    server.use(
      http.get(`${A}/shipping/sellers/s-1/shipments`, () => HttpResponse.json(page([]))),
      http.get(`${A}/shipping/sellers/s-1/labels`, () => HttpResponse.json(page([]))),
      http.get(`${A}/sellers/s-1/local-delivery`, () => HttpResponse.json({ settings: [], routes: [], deliveries: [] })),
    )
    const user = await signIn('ReadOnly', '/admin/sellers/s-1')
    const tabs = await screen.findByRole('tablist', { name: 'Seller areas' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Payments', 'Shipping', 'Local delivery'])
    await user.click(within(tabs).getByRole('tab', { name: 'Payments' }))
    expect(await screen.findByRole('heading', { name: 'Balances' })).toBeInTheDocument()
    await user.click(within(tabs).getByRole('tab', { name: 'Shipping' }))
    expect(await screen.findByRole('heading', { name: 'Shipments' })).toBeInTheDocument()
    await user.click(within(tabs).getByRole('tab', { name: 'Local delivery' }))
    expect(await screen.findByText('This seller has no local-delivery settings.')).toBeInTheDocument()
  })

  it('hides a tab the role lacks the permission for', async () => {
    sellerMocks()
    await signIn('SuperAdmin', '/admin/sellers/s-1', { permissions: ['DashboardView', 'SellersView', 'PaymentsView'] })
    const tabs = await screen.findByRole('tablist', { name: 'Seller areas' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Payments'])
  })

  it('the tab is deep-linkable: /sellers/:id/payments opens it', async () => {
    sellerMocks()
    await signIn('Support', '/admin/sellers/s-1/payments')
    expect(await screen.findByRole('heading', { name: 'Balances' })).toBeInTheDocument()
  })
})

describe('seller payments', () => {
  it('shows balances (money formatted from integer minor units), the Stripe status and the ledger', async () => {
    sellerMocks()
    await signIn('ReadOnly', '/admin/sellers/s-1/payments')
    expect(await screen.findByText('$3,456.00')).toBeInTheDocument()
    expect(screen.getByText('$3,463.00')).toBeInTheDocument()
    expect(screen.getByText('acct_123')).toBeInTheDocument()
    expect(screen.getByText('individual.id_number')).toBeInTheDocument()
    expect(screen.getByText('Order 1001')).toBeInTheDocument()
    expect(screen.getByText('Pending sale: $19.99')).toBeInTheDocument()
  })

  it.each([
    ['SuperAdmin', ['Place payout hold', 'Adjust balance']], ['Support', ['Place payout hold']], ['Moderator', []], ['ReadOnly', []],
  ] as const)('%s sees exactly these payment actions', async (role, actions) => {
    sellerMocks()
    await signIn(role, '/admin/sellers/s-1/payments')
    await screen.findByRole('heading', { name: 'Payout hold' })
    for (const a of ['Place payout hold', 'Release hold', 'Adjust balance']) {
      if ((actions as readonly string[]).includes(a)) expect(screen.getByRole('button', { name: a })).toBeInTheDocument()
      else expect(screen.queryByRole('button', { name: a })).toBeNull()
    }
  })

  it('sends the ledger filters (type, dates, order, booking, reference) to the server', async () => {
    sellerMocks()
    const seen: URLSearchParams[] = []
    server.use(http.get(`${A}/payments/sellers/s-1/ledger`, ({ request }) => { seen.push(new URL(request.url).searchParams); return HttpResponse.json(page([journal])) }))
    const user = await signIn('ReadOnly', '/admin/sellers/s-1/payments')
    await screen.findByText('Order 1001')
    await user.selectOptions(screen.getByLabelText('Type'), 'refund')
    await user.type(screen.getByLabelText('From'), '2026-10-01')
    await user.type(screen.getByLabelText('Order id'), 'o-1')
    await user.type(screen.getByLabelText('Booking id'), 'b-1')
    await user.type(screen.getByLabelText('Order or booking number'), '1001')
    await waitFor(() => {
      const last = seen.at(-1)!
      expect(Object.fromEntries(last)).toMatchObject({ type: 'refund', from: '2026-10-01', orderId: 'o-1', bookingId: 'b-1', reference: '1001' })
    })
  })

  it('places a hold behind a confirm dialog that needs a reason, then reloads', async () => {
    sellerMocks()
    let body: unknown
    server.use(http.post(`${A}/payments/sellers/s-1/hold`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ holdId: 'h-1' }) }))
    const user = await signIn('Support', '/admin/sellers/s-1/payments')
    await user.click(await screen.findByRole('button', { name: 'Place payout hold' }))
    const dlg = screen.getByRole('dialog', { name: 'Hold this seller’s payouts' })
    await user.click(within(dlg).getByRole('button', { name: 'Place hold' }))
    expect(within(dlg).getByText('Write at least 5 characters.')).toBeInTheDocument()
    expect(body).toBeUndefined()
    await user.type(reasonBox(dlg), 'Chargeback risk')
    server.use(http.get(`${A}/payments/sellers/s-1`, () => HttpResponse.json(overview(true))))
    await user.click(within(dlg).getByRole('button', { name: 'Place hold' }))
    expect(await screen.findByText('Payouts are on hold.')).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Chargeback risk' })
    expect(await screen.findByRole('button', { name: 'Release hold' })).toBeInTheDocument()
  })

  it('releases a hold with a reason', async () => {
    sellerMocks({ hold: true })
    let body: unknown
    server.use(http.post(`${A}/payments/sellers/s-1/hold/release`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ released: 1 }) }))
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1/payments')
    expect(await screen.findByText(/On hold since/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Release hold' }))
    const dlg = screen.getByRole('dialog', { name: 'Release the payout hold' })
    await user.type(reasonBox(dlg), 'Checked with the seller')
    await user.click(within(dlg).getByRole('button', { name: 'Release hold' }))
    expect(await screen.findByText('The payout hold was released.')).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Checked with the seller' })
  })

  it('shows the server error in the dialog when the hold is refused', async () => {
    sellerMocks()
    server.use(http.post(`${A}/payments/sellers/s-1/hold`, () => HttpResponse.json({ title: 'The payouts of this seller are already on hold.', code: 'already_on_hold' }, { status: 409 })))
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1/payments')
    await user.click(await screen.findByRole('button', { name: 'Place payout hold' }))
    const dlg = screen.getByRole('dialog')
    await user.type(reasonBox(dlg), 'Second hold attempt')
    await user.click(within(dlg).getByRole('button', { name: 'Place hold' }))
    expect(await within(dlg).findByText('The payouts of this seller are already on hold.')).toBeInTheDocument()
  })

  it('an adjustment is sent as integer minor units after a confirm dialog, with the step-up prompt when the API asks for it', async () => {
    sellerMocks()
    const bodies: Record<string, unknown>[] = []
    let stepped = false
    server.use(
      http.post(`${A}/auth/step-up`, () => { stepped = true; return new HttpResponse(null, { status: 204 }) }),
      http.post(`${A}/payments/sellers/s-1/adjustments`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        if (!stepped) return HttpResponse.json({ code: 'step_up_required', title: 'Confirm it is you' }, { status: 403 })
        return HttpResponse.json({ recorded: true, journalId: 'j-9', owedCents: 350000 })
      }),
    )
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1/payments')
    await user.click(await screen.findByRole('button', { name: 'Adjust balance' }))
    const dlg = screen.getByRole('dialog', { name: 'Manual balance adjustment' })
    await user.type(within(dlg).getByLabelText('Amount in minor units (cents)'), '2500')
    expect(within(dlg).getByText(/credit \$25\.00/)).toBeInTheDocument()          // shown back as formatted money before the confirmation
    await user.type(reasonBox(dlg), 'Goodwill after a lost parcel')
    await user.click(within(dlg).getByRole('button', { name: 'Credit the seller' }))
    const step = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(step).getByLabelText('Authenticator code'), '123456')
    await user.click(within(step).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('The adjustment was recorded.')).toBeInTheDocument()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toMatchObject({ direction: 'credit', amountCents: 2500, currency: 'USD', reason: 'Goodwill after a lost parcel' })
    expect(bodies[0].requestId).toBe(bodies[1].requestId)                      // the retry is idempotent
  })

  it('rejects a non-integer adjustment amount before calling the API', async () => {
    sellerMocks()
    const call = vi.fn(() => HttpResponse.json({ recorded: true }))
    server.use(http.post(`${A}/payments/sellers/s-1/adjustments`, call))
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1/payments')
    await user.click(await screen.findByRole('button', { name: 'Adjust balance' }))
    const dlg = screen.getByRole('dialog')
    await user.type(within(dlg).getByLabelText('Amount in minor units (cents)'), '12.50')
    await user.type(reasonBox(dlg), 'Typed decimals by mistake')
    await user.click(within(dlg).getByRole('button', { name: 'Credit the seller' }))
    expect(await within(dlg).findByText('Enter the amount as a positive whole number of minor units.')).toBeInTheDocument()
    expect(call).not.toHaveBeenCalled()
  })

  it('shows an error state with a retry when the overview cannot be loaded', async () => {
    server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)), http.get(`${A}/payments/sellers/s-1`, () => HttpResponse.json({ title: 'Payments are unavailable' }, { status: 500 })),
      http.get(`${A}/payments/sellers/s-1/ledger`, () => HttpResponse.json(page([]))))
    await signIn('ReadOnly', '/admin/sellers/s-1/payments')
    expect(await screen.findByText('Payments are unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('payments page', () => {
  const transfer = { id: 't-1', sellerId: 'aaaaaaaa-1111', amountCents: 5000, currency: 'USD', status: 'Failed', attempts: 3, retries: 1, lastError: 'insufficient funds', stripeTransferId: null, createdAt: '2026-11-01T10:00:00Z', nextAttemptAt: null }
  const flag = { id: 'f-1', kind: 'ledger_mismatch', createdAt: '2026-11-01T10:00:00Z', resolvedAt: null, detail: 'Stripe differs by 100' }

  it.each([['SuperAdmin', true], ['Support', true], ['Moderator', false], ['ReadOnly', false]] as const)('%s: retry of a failed transfer is %s', async (role, can) => {
    server.use(http.get(`${A}/payments/transfers`, () => HttpResponse.json(page([transfer]))))
    await signIn(role, '/admin/payments')
    expect(await screen.findByText('insufficient funds')).toBeInTheDocument()
    expect(screen.getByText('$50.00')).toBeInTheDocument()
    expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(can)
  })

  it('retries a transfer after a reason, and shows the 409 text when the balance no longer covers it', async () => {
    server.use(http.get(`${A}/payments/transfers`, () => HttpResponse.json(page([transfer]))),
      http.post(`${A}/payments/transfers/t-1/retry`, () => HttpResponse.json({ title: 'The seller’s available balance no longer covers this transfer.', code: 'insufficient_available' }, { status: 409 }), { once: true }),
      http.post(`${A}/payments/transfers/t-1/retry`, () => HttpResponse.json({ queued: true })))
    const user = await signIn('Support', '/admin/payments')
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    const dlg = screen.getByRole('dialog', { name: 'Retry this transfer' })
    await user.type(reasonBox(dlg), 'Balance topped up')
    await user.click(within(dlg).getByRole('button', { name: 'Retry transfer' }))
    expect(await within(dlg).findByText(/no longer covers this transfer/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Retry transfer' }))
    expect(await screen.findByText('The transfer was queued again.')).toBeInTheDocument()
  })

  it('lists payouts, accounts past due and unallocated disputes from their tabs', async () => {
    server.use(
      http.get(`${A}/payments/payouts`, () => HttpResponse.json(page([{ id: 'p-1', sellerId: 'bbbbbbbb-2222', stripePayoutId: 'po_1', amountCents: 12345, currency: 'USD', status: 'in_transit', failureCode: null, arrivalDate: null, createdAt: '2026-11-01T10:00:00Z' }]))),
      http.get(`${A}/payments/accounts/requirements-past-due`, () => HttpResponse.json(page([{ sellerId: 'cccccccc-3333', stripeAccountId: 'acct_9', pastDue: ['external_account'], deadline: null, disabledReason: 'requirements.past_due', payoutsEnabled: false }]))),
      http.get(`${A}/payments/unallocated-disputes`, () => HttpResponse.json(page([{ id: 'u-1', disputeId: 'dp_1', marketplaceOrderId: 'MP-1', chargeRef: 'ch_1', currency: 'USD', stripeAmountCents: 9900, allocatedCents: 0, status: 'needs_response', reason: 'fraudulent', evidenceDueBy: null, flagId: 'f-1', note: null, createdAt: '2026-11-01T10:00:00Z', resolvedAt: null }]))),
    )
    const user = await signIn('ReadOnly', '/admin/payments/payouts')
    expect(await screen.findByText('$123.45')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Accounts past due' }))
    expect(await screen.findByText('external_account')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Unallocated disputes' }))
    expect(await screen.findByText('dp_1')).toBeInTheDocument()
    expect(screen.getByText('$99.00')).toBeInTheDocument()
  })

  it.each([['SuperAdmin', true], ['Support', true], ['Moderator', false], ['ReadOnly', false]] as const)('%s: reconciliation run and resolve are %s', async (role, can) => {
    server.use(http.get(`${A}/payments/reconciliation`, () => HttpResponse.json(page([flag]))))
    await signIn(role, '/admin/payments/reconciliation')
    expect(await screen.findByText(/Stripe differs by 100/)).toBeInTheDocument()
    expect(!!screen.queryByRole('button', { name: 'Run reconciliation' })).toBe(can)
    expect(!!screen.queryByRole('button', { name: 'Resolve' })).toBe(can)
  })

  it('runs reconciliation and resolves a flag, each behind a reason dialog', async () => {
    const posted: string[] = []
    server.use(http.get(`${A}/payments/reconciliation`, () => HttpResponse.json(page([flag]))),
      http.post(`${A}/payments/reconciliation/run`, () => { posted.push('run'); return HttpResponse.json({ flagged: 0 }) }),
      http.post(`${A}/payments/reconciliation/f-1/resolve`, async ({ request }) => { posted.push(JSON.stringify(await request.json())); return HttpResponse.json({ resolved: true }) }))
    const user = await signIn('SuperAdmin', '/admin/payments/reconciliation')
    await user.click(await screen.findByRole('button', { name: 'Run reconciliation' }))
    let dlg = screen.getByRole('dialog', { name: 'Run reconciliation now' })
    await user.type(reasonBox(dlg), 'Weekly check')
    await user.click(within(dlg).getByRole('button', { name: 'Run reconciliation' }))
    expect(await screen.findByText('Reconciliation ran.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    dlg = screen.getByRole('dialog', { name: 'Resolve this flag' })
    await user.type(reasonBox(dlg), 'Fixed in Stripe')
    await user.click(within(dlg).getByRole('button', { name: 'Resolve flag' }))
    expect(await screen.findByText('The flag was resolved.')).toBeInTheDocument()
    expect(posted).toEqual(['run', '{"reason":"Fixed in Stripe"}'])
  })

  it('shows an error state when a list fails', async () => {
    server.use(http.get(`${A}/payments/transfers`, () => HttpResponse.json({ title: 'Transfers are unavailable' }, { status: 500 })))
    await signIn('ReadOnly', '/admin/payments')
    expect(await screen.findByText('Transfers are unavailable')).toBeInTheDocument()
  })
})

describe('shipping', () => {
  const label = { id: 'l-1', sellerId: 'dddddddd-4444', orderId: 'o-1', kind: 'Outbound', status: 'RefundFailed', carrier: 'USPS', service: 'Priority', trackingNumber: '9400111', costCents: 842, currency: 'USD', createdAt: '2026-11-01T10:00:00Z', purchasedAt: null, refundStatus: 'failed', refundError: 'carrier timeout', refundAttempts: 2, refundRequestedAt: null, error: null }

  it.each([['SuperAdmin', true], ['Support', true], ['Moderator', false], ['ReadOnly', false]] as const)('%s: refund retry is %s', async (role, can) => {
    server.use(http.get(`${A}/shipping/refunds`, () => HttpResponse.json(page([label]))))
    await signIn(role, '/admin/shipping')
    expect(await screen.findByText('9400111')).toBeInTheDocument()
    expect(screen.getByText('$8.42')).toBeInTheDocument()
    expect(!!screen.queryByRole('button', { name: 'Retry refund' })).toBe(can)
  })

  it('filters refunds by state and retries one after a reason', async () => {
    const states: (string | null)[] = []
    let body: unknown
    server.use(http.get(`${A}/shipping/refunds`, ({ request }) => { states.push(new URL(request.url).searchParams.get('state')); return HttpResponse.json(page([label])) }),
      http.post(`${A}/shipping/labels/l-1/refund/retry`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ status: 'Voiding', refundStatus: 'pending' }) }))
    const user = await signIn('Support', '/admin/shipping')
    await screen.findByText('9400111')
    await user.selectOptions(screen.getByLabelText('Refund state'), 'failed')
    await waitFor(() => expect(states.at(-1)).toBe('failed'))
    await user.click(screen.getByRole('button', { name: 'Retry refund' }))
    const dlg = screen.getByRole('dialog', { name: 'Retry this label refund' })
    await user.type(reasonBox(dlg), 'Carrier confirmed it is fixed')
    await user.click(within(dlg).getByRole('button', { name: 'Retry refund' }))
    expect(await screen.findByText('The refund was requested again.')).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Carrier confirmed it is fixed' })
  })

  it('shows exceptions and webhook failures, and an error state with a retry', async () => {
    server.use(
      http.get(`${A}/shipping/exceptions`, () => HttpResponse.json(page([{ orderId: 'o-1', sellerId: 'dddddddd-4444', orderNumber: 'SO-1001', reason: 'delivery_failed', since: '2026-11-01T10:00:00Z' }]))),
      http.get(`${A}/shipping/webhooks/failures`, () => HttpResponse.json({ title: 'Webhook log is unavailable' }, { status: 500 })))
    const user = await signIn('ReadOnly', '/admin/shipping/exceptions')
    expect(await screen.findByText('SO-1001')).toBeInTheDocument()
    expect(screen.getByText('delivery_failed')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Webhook failures' }))
    expect(await screen.findByText('Webhook log is unavailable')).toBeInTheDocument()
  })

  it('the seller tab lists shipments and labels, filters labels by status and retries a refund for a role that may', async () => {
    const statuses: (string | null)[] = []
    server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)),
      http.get(`${A}/shipping/sellers/s-1/shipments`, () => HttpResponse.json(page([{ id: 'sh-1', orderId: 'o-1', orderNumber: 'SO-1001', carrier: 'USPS', service: 'Priority', trackingNumber: '9400111', method: 'Standard', status: 'in_transit', shippedAt: '2026-11-01T10:00:00Z', deliveredAt: null, labelId: 'l-1' }]))),
      http.get(`${A}/shipping/sellers/s-1/labels`, ({ request }) => { statuses.push(new URL(request.url).searchParams.get('status')); return HttpResponse.json(page([label])) }))
    const user = await signIn('Support', '/admin/sellers/s-1/shipping')
    expect(await screen.findByText('SO-1001')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Retry refund' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Label status'), 'RefundFailed')
    await waitFor(() => expect(statuses.at(-1)).toBe('RefundFailed'))
  })
})

describe('local delivery', () => {
  const overview = {
    settings: [{ brandId: null, enabled: true, timeZone: 'America/New_York', sameDayCutoff: '11:00', minLeadMinutes: 60, maxDaysAhead: 7, version: 3, exists: true,
      zones: [{ id: 'z-1', name: 'Brooklyn', country: 'US', radiusKm: 8, postcodes: ['112'], feeCents: 500, freeOverCents: 5000, minOrderCents: null, priority: 1, active: true }],
      windows: [{ id: 'w-1', start: '09:00', end: '12:00', capacity: 10, days: ['Mon', 'Tue'], active: true }] }],
    routes: [{ id: 'r-1', date: '2026-11-04', status: 'Completed', startedAt: null, completedAt: null }],
    deliveries: [{ id: 'd-1', orderId: 'o-1', number: 'SO-1001', code: 'ABC123', status: 'Delivered', date: '2026-11-04', windowStartUtc: null, windowEndUtc: null, routeId: 'r-1', attempts: 1, feeCents: 500, deliveredAt: '2026-11-04T15:00:00Z' }],
  }
  const mocks = () => server.use(http.get(`${A}/sellers/s-1`, () => HttpResponse.json(seller)), http.get(`${A}/sellers/s-1/local-delivery`, () => HttpResponse.json(overview)))

  it('shows the seller’s settings, zones, windows and deliveries without any personal data', async () => {
    mocks()
    await signIn('ReadOnly', '/admin/sellers/s-1/delivery')
    expect(await screen.findByText('America/New_York')).toBeInTheDocument()
    expect(screen.getByText('Brooklyn')).toBeInTheDocument()
    expect(screen.getByText('09:00')).toBeInTheDocument()
    expect(screen.getByText('SO-1001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Access proof' })).toBeNull()
  })

  it('proof of delivery is break-glass: nothing is requested until a reason is confirmed, the proof is shown after the reveal and gone after Hide', async () => {
    mocks()
    const proof = vi.fn(async ({ request }: { request: Request }) => HttpResponse.json({ expiresInMinutes: 60, proofs: [{ id: 'p-1', kind: 'photo', url: '/api/public/delivery-proof/p-1?exp=1&sig=x' }],
      attempts: [{ number: 1, outcome: 'delivered', reason: null, note: 'Left with the doorman', recipientName: 'J. Buyer', placement: 'door', at: '2026-11-04T15:00:00Z' }], _body: await request.json() }))
    server.use(http.post(`${A}/local-delivery/deliveries/d-1/proof-access`, proof))
    const user = await signIn('Support', '/admin/sellers/s-1/delivery')
    await user.click(await screen.findByRole('button', { name: 'Access proof' }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(proof).not.toHaveBeenCalled()
    const dlg = screen.getByRole('dialog', { name: 'Access the proof of delivery for SO-1001' })
    await user.click(within(dlg).getByRole('button', { name: 'Reveal proof' }))
    expect(within(dlg).getByText('Write at least 5 characters.')).toBeInTheDocument()
    expect(proof).not.toHaveBeenCalled()
    await user.type(reasonBox(dlg), 'Ticket 4521: buyer says not received')
    await user.click(within(dlg).getByRole('button', { name: 'Reveal proof' }))
    const img = await screen.findByRole('img', { name: 'photo proof for order SO-1001' })
    expect(img).toHaveAttribute('src', expect.stringContaining('/api/public/delivery-proof/p-1'))
    expect(screen.getByText('J. Buyer')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide proof' }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText('J. Buyer')).toBeNull()
  })

  it('leaving the tab discards a revealed proof', async () => {
    mocks()
    server.use(http.post(`${A}/local-delivery/deliveries/d-1/proof-access`, () => HttpResponse.json({ expiresInMinutes: 60, proofs: [{ id: 'p-1', kind: 'signature', url: '/api/public/delivery-proof/p-1?exp=1&sig=x' }], attempts: [] })),
      http.get(`${A}/payments/sellers/s-1`, () => HttpResponse.json(overview as never)), http.get(`${A}/payments/sellers/s-1/ledger`, () => HttpResponse.json(page([]))))
    const user = await signIn('SuperAdmin', '/admin/sellers/s-1/delivery')
    await user.click(await screen.findByRole('button', { name: 'Access proof' }))
    await user.type(reasonBox(screen.getByRole('dialog')), 'Ticket 99: dispute')
    await user.click(screen.getByRole('button', { name: 'Reveal proof' }))
    await screen.findByRole('img', { name: /signature proof/ })
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    await user.click(await screen.findByRole('tab', { name: 'Local delivery' }))
    await screen.findByText('SO-1001')
    expect(screen.queryByRole('img', { name: /signature proof/ })).toBeNull()
  })

  it('shows the server’s reason when the proof cannot be revealed', async () => {
    mocks()
    server.use(http.post(`${A}/local-delivery/deliveries/d-1/proof-access`, () => HttpResponse.json({ title: 'Too many reveals. Try again later.' }, { status: 429 })))
    const user = await signIn('Support', '/admin/sellers/s-1/delivery')
    await user.click(await screen.findByRole('button', { name: 'Access proof' }))
    const dlg = screen.getByRole('dialog')
    await user.type(reasonBox(dlg), 'Ticket 7: audit')
    await user.click(within(dlg).getByRole('button', { name: 'Reveal proof' }))
    expect(await within(dlg).findByText('Too many reveals. Try again later.')).toBeInTheDocument()
  })
})

describe('moderation additions', () => {
  const row = (id: string, kind: string, summary: string) => ({ id, kind, targetId: 't-' + id, sellerId: kind === 'review' ? '00000000-0000-0000-0000-000000000000' : 's-1', reason: summary, summary, reporterKind: 'buyer', status: 'Open', createdAt: '2026-11-01T10:00:00Z', resolution: null, vendor: kind === 'review' ? null : 'Acme Co' })
  const detail = (kind: string, extra: object = {}) => ({ ...row('m-1', kind, 'Reported text'), resolvedAt: null, resolutionNote: null, target: null, contentReports: [], ...extra })
  const decide = (action: string, cb: (b: unknown) => void, status = 200, resp: object = { resolved: true }) => http.post(`${A}/moderation/m-1/${action}`, async ({ request }) => { cb(await request.json()); return HttpResponse.json(resp, { status }) })

  it('the queue renders every report kind with its label', async () => {
    server.use(http.get(`${A}/moderation`, () => HttpResponse.json(page([row('a', 'listing', 'Fake mug'), row('b', 'question', 'Rude question'), row('c', 'message', 'Spam'), row('d', 'review', 'Fake review'), row('e', 'review_reply', 'Abusive reply'), row('f', 'booking_message', 'Odd message'), row('g', 'contact_warning', 'Phone number')]))))
    await signIn('Moderator', '/admin/moderation')
    const table = await screen.findByRole('table', { name: 'Moderation queue' })
    for (const t of ['Reported listing', 'Reported question', 'Reported message', 'Reported review', 'Reported review reply', 'Reported booking message', 'Contact details in a message']) expect(within(table).getByRole('link', { name: t })).toBeInTheDocument()
    expect(within(table).getByText('Abusive reply')).toBeInTheDocument()
  })

  it.each([['Moderator', true], ['SuperAdmin', true], ['Support', false], ['ReadOnly', false]] as const)('%s: decision buttons are %s', async (role, can) => {
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(detail('question'))))
    await signIn(role, '/admin/moderation/m-1')
    await screen.findByRole('heading', { name: 'Reported question' })
    for (const b of ['Hide content', 'Remove content', 'Warn seller', 'Escalate: suspend the seller', 'Dismiss']) expect(!!screen.queryByRole('button', { name: b })).toBe(can)
  })

  it('hide-content: confirm dialog with a reason and an optional message for the reporter', async () => {
    let body: unknown
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(detail('question'))), decide('hide-content', (b) => { body = b }))
    const user = await signIn('Moderator', '/admin/moderation/m-1')
    await user.click(await screen.findByRole('button', { name: 'Hide content' }))
    const dlg = screen.getByRole('dialog', { name: 'Hide the reported content' })
    await user.click(within(dlg).getByRole('button', { name: 'Hide content' }))
    expect(within(dlg).getByText('Write at least 5 characters.')).toBeInTheDocument()
    expect(body).toBeUndefined()
    await user.type(reasonBox(dlg), 'Breaks the rules on abuse')
    await user.type(within(dlg).getByLabelText(/Message for the person who reported it/), 'Thanks, we removed it.')
    await user.click(within(dlg).getByRole('button', { name: 'Hide content' }))
    expect(await screen.findByText('The content was hidden.')).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Breaks the rules on abuse', reasonShownToUser: 'Thanks, we removed it.' })
  })

  it.each([['remove-content', 'Remove content', 'The content was removed.'], ['warn-seller', 'Warn seller', 'The seller was warned by email.'], ['escalate-suspend', 'Escalate: suspend the seller', 'The seller was suspended.']] as const)('%s sends the reason and no reporter message when left empty', async (action, button, done) => {
    let body: unknown
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(detail('listing'))), http.get(`${A}/listings/t-m-1`, () => HttpResponse.json({ id: 't-m-1', type: 'Product', status: 'Active', title: 'Mug', description: null, sku: null, priceCents: 1000, stock: 1, brand: null, seller: null, images: 0, moderation: null })), decide(action, (b) => { body = b }))
    const user = await signIn('SuperAdmin', '/admin/moderation/m-1')
    await user.click(await screen.findByRole('button', { name: button }))
    await user.type(reasonBox(screen.getByRole('dialog')), 'Policy violation confirmed')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^(Remove content|Send warning|Suspend seller)$/ }))
    expect(await screen.findByText(done)).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Policy violation confirmed' })
  })

  it('shows "already resolved" when another moderator won, changes nothing and reloads the decision', async () => {
    let calls = 0
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(calls === 0 ? detail('message') : detail('message', { status: 'Actioned', resolution: 'hidden', resolutionNote: 'Decided by Sam' }))),
      decide('hide-content', () => { calls++ }, 409, { code: 'already_resolved', title: 'This report was already decided.' }))
    const user = await signIn('Moderator', '/admin/moderation/m-1')
    await user.click(await screen.findByRole('button', { name: 'Hide content' }))
    await user.type(reasonBox(screen.getByRole('dialog')), 'Abusive message text')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hide content' }))
    expect(await screen.findByText(/Another moderator already resolved this report/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText(/Decided by Sam/)).toBeInTheDocument()
    expect(screen.queryByText('The content was hidden.')).toBeNull()
  })

  it('a review report shows the review and the marketplace reports, and offers no seller actions (there is no seller on this portal)', async () => {
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(detail('review', { target: { reviewId: 'rev-77' }, contentReports: [{ reportId: 'rep-1', kind: 'review', targetId: 'rev-77', reason: 'abusive', note: 'Contains slurs', reporterRef: 'buyer-9', decision: null, decidedAt: null, createdAt: '2026-11-01T10:00:00Z' }] }))))
    await signIn('Moderator', '/admin/moderation/m-1')
    expect(await screen.findByRole('heading', { name: 'Reported review' })).toBeInTheDocument()
    expect(screen.getAllByText('rev-77').length).toBeGreaterThan(0)
    expect(screen.getByText('Contains slurs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide content' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Warn seller' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Escalate: suspend the seller' })).toBeNull()
  })

  it('a review reply report shows the reply and the review it answers; it can be removed but not hidden, and its seller can be warned', async () => {
    let body: unknown
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(detail('review_reply', { target: { replyId: 'rp-1', replyText: 'We are sorry you felt that way', repliedAt: '2026-11-02T10:00:00Z', editedAt: null, removed: false, removedReason: null,
      review: { reviewId: 'rev-77', rating: 2, text: 'Arrived late', buyerDisplayName: 'Sam B.', createdAt: '2026-11-01T10:00:00Z', state: 'published', productTitle: 'Linen napkin set' } } }))),
      decide('remove-content', (b) => { body = b }))
    const user = await signIn('Moderator', '/admin/moderation/m-1')
    expect(await screen.findByRole('heading', { name: 'Reported review reply' })).toBeInTheDocument()
    expect(screen.getByText('We are sorry you felt that way')).toBeInTheDocument()
    expect(screen.getByText('Arrived late')).toBeInTheDocument()
    expect(screen.getByText('Linen napkin set')).toBeInTheDocument()
    expect(screen.getByText('2 out of 5')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide content' })).toBeNull()                       // the API refuses it (unsupported_decision)
    expect(screen.getByRole('button', { name: 'Warn seller' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Escalate: suspend the seller' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove content' }))
    await user.type(reasonBox(screen.getByRole('dialog')), 'The reply is abusive')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove content' }))
    expect(await screen.findByText('The content was removed.')).toBeInTheDocument()
    expect(body).toEqual({ reason: 'The reply is abusive' })
  })

  it('a review reply is read-only for a role that cannot act', async () => {
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(detail('review_reply', { target: { replyId: 'rp-1', replyText: 'W*** are s***', repliedAt: '2026-11-02T10:00:00Z', removed: false } }))))
    await signIn('ReadOnly', '/admin/moderation/m-1')
    expect(await screen.findByText('W*** are s***')).toBeInTheDocument()
    expect(screen.getByText('The text is masked for your role.')).toBeInTheDocument()
    expect(screen.getByText('Your role can read reports but not act on them.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove content' })).toBeNull()
  })

  it('a decision that fails for another reason keeps the dialog open with the server text', async () => {
    server.use(http.get(`${A}/moderation/m-1`, () => HttpResponse.json(detail('message'))), decide('remove-content', () => undefined, 409, { code: 'no_seller', title: 'This report has no seller.' }))
    const user = await signIn('Moderator', '/admin/moderation/m-1')
    await user.click(await screen.findByRole('button', { name: 'Remove content' }))
    const dlg = screen.getByRole('dialog')
    await user.type(reasonBox(dlg), 'Remove this message')
    await user.click(within(dlg).getByRole('button', { name: 'Remove content' }))
    expect(await within(dlg).findByText('This report has no seller.')).toBeInTheDocument()
  })
})
