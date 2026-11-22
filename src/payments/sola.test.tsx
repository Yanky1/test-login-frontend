import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { API, mount } from '../products/testkit'
import { mockOrder, order } from '../orders/testkit'
import OrderDetailPage from '../orders/OrderDetail'
import PaymentsPage from './Payments'
import { adminToken } from '../admin/api'
import { A, signIn } from '../admin/testkit'

/** C19: phone orders paid through Sola. Rows carry `provider`; Sola disputes are answered by Solvelt; staff record fundings from Sola to Stripe. */
const as = (role: string) => ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Acme', role, accountStatus: 'Approved', brandCount: 1 }] })
const onb = { state: 'active', hasAccount: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, currentlyDue: [], pastDue: [], disabledReason: null, deadline: null, nextSteps: [], payoutSettings: null, sandbox: true }
const summary = { balances: [], payoutsPaused: false, pausedReason: null, minTransferCents: 500, releaseDays: 7, openDisputes: 1, onboarding: onb }
const page = <T,>(items: T[]) => ({ total: items.length, page: 1, pageSize: 25, items })
const row = (id: string, type: string, provider: 'stripe' | 'sola' | null) => ({ id, createdAt: '2026-11-20T10:00:00Z', type, memo: type, currency: 'USD', amountCents: 2299, orderId: 'o1', orderNumber: `SO-${id}`, bookingId: null, bookingNumber: null, lines: [], provider })
const dispute = (id: string, provider: 'stripe' | 'sola', canRespond: boolean) => ({ id, createdAt: '2026-11-02T00:00:00Z', amountCents: 2499, feeCents: 1500, currency: 'USD', status: 'needs_response', reason: 'fraudulent', evidenceDueBy: '2026-11-30T00:00:00Z', closedAt: null, orderId: 'o1', orderNumber: `SO-${id}`, bookingId: null, bookingNumber: null, canRespond, provider })

const seller = (tab: string, mocks: Parameters<typeof server.use>) => {
  server.use(http.get(`${API}/seller/payments/summary`, () => HttpResponse.json(summary)), ...mocks)
  mount(<PaymentsPage />, '/payments', `/payments?tab=${tab}`, as('Owner'))
}

afterEach(() => { adminToken.set(null) })

describe('provider labels for the seller', () => {
  it('a Sola sale says "Phone order (Sola)" in the transactions; Stripe and release rows carry no label', async () => {
    seller('transactions', [http.get(`${API}/seller/payments/ledger`, () => HttpResponse.json(page([row('1', 'sale', 'sola'), row('2', 'sale', 'stripe'), row('3', 'release', null)])))])
    const sola = (await screen.findByRole('link', { name: 'SO-1' })).closest('tr')!
    expect(within(sola).getByText('Phone order (Sola)')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'SO-2' }).closest('tr')!).queryByText('Phone order (Sola)')).toBeNull()
    expect(within(screen.getByRole('link', { name: 'SO-3' }).closest('tr')!).queryByText('Phone order (Sola)')).toBeNull()
    expect(screen.getAllByTestId('provider-chip')).toHaveLength(1)
  })

  it('rows from a server without C19 (no provider field) show no label', async () => {
    const old = { ...row('9', 'sale', null) } as Record<string, unknown>; delete old.provider
    seller('transactions', [http.get(`${API}/seller/payments/ledger`, () => HttpResponse.json(page([old])))])
    expect(await screen.findByRole('link', { name: 'SO-9' })).toBeInTheDocument()
    expect(screen.queryByText('Phone order (Sola)')).toBeNull()
  })

  it('the order money panel says when a phone order was paid through Sola', async () => {
    mockOrder(order({ money: { itemsCents: 1999, discountCents: 0, shippingCents: 500, taxCents: 0, totalCents: 2499, feeCents: 200, netCents: 2299, refundedCents: 0, refundableCents: 2499, paymentProvider: 'sola' } }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    const panel = await screen.findByRole('region', { name: 'Payment summary' })
    expect(within(panel).getByTestId('paid-with')).toHaveTextContent('Phone order (Sola)')
  })

  it('a Stripe order shows no provider line', async () => {
    mockOrder(order({ money: { itemsCents: 1999, discountCents: 0, shippingCents: 500, taxCents: 0, totalCents: 2499, feeCents: 200, netCents: 2299, refundedCents: 0, refundableCents: 2499, paymentProvider: 'stripe' } }))
    mount(<OrderDetailPage />, '/orders/:id', '/orders/o1')
    const panel = await screen.findByRole('region', { name: 'Payment summary' })
    expect(within(panel).queryByTestId('paid-with')).toBeNull()
  })
})

describe('Sola disputes', () => {
  it('never offer "Respond in Stripe", even if the row claims it can be answered, and say Solvelt handles them', async () => {
    seller('disputes', [http.get(`${API}/seller/payments/disputes`, () => HttpResponse.json(page([dispute('1', 'sola', true)])))])
    const r = (await screen.findByRole('link', { name: 'SO-1' })).closest('tr')!
    expect(within(r).getByText('Phone order (Sola)')).toBeInTheDocument()
    expect(within(r).getByText('Handled by Solvelt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /respond in stripe/i })).toBeNull()
    expect(screen.getByText(/answered by Solvelt/)).toBeInTheDocument()
  })

  it('a Stripe dispute next to a Sola one still gets the button', async () => {
    seller('disputes', [http.get(`${API}/seller/payments/disputes`, () => HttpResponse.json(page([dispute('1', 'sola', false), dispute('2', 'stripe', true)])))])
    expect(await screen.findByRole('button', { name: /respond in stripe/i })).toBeInTheDocument()
  })
})

const treasury = (hold = false, unfunded = 229900) => ({
  holdTransfersWhenUnfunded: hold,
  currencies: [{ currency: 'USD', releasedCents: 229900, fundedCents: 229900 - unfunded, unfundedCents: unfunded, overfundedCents: 0, heldAtSolaCents: 249900, transfersHeld: hold && unfunded > 0 }],
  fundings: page(unfunded < 229900 ? [{ id: 'f1', createdAt: '2026-11-21T10:00:00Z', currency: 'USD', reference: 'SOLA-1', note: 'Weekly move', requestId: 'r1', amountCents: 229900 - unfunded }] : []),
})

describe('staff Sola treasury', () => {
  it('shows the unfunded figure and lets a Super admin record a funding in minor units with a request id kept across the step-up', async () => {
    let funded = false; let stepped = false
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.get(`${A}/payments/sola/treasury`, () => HttpResponse.json(treasury(false, funded ? 0 : 229900))),
      http.post(`${A}/auth/step-up`, () => { stepped = true; return new HttpResponse(null, { status: 204 }) }),
      http.post(`${A}/payments/sola/funding`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        if (!stepped) return HttpResponse.json({ code: 'step_up_required', title: 'Confirm it is you' }, { status: 403 })
        funded = true
        return HttpResponse.json({ recorded: true, journalId: 'j1', currency: 'USD', fundedCents: 229900, unfundedCents: 0 })
      }),
    )
    const user = await signIn('SuperAdmin', '/admin/payments/sola')
    const tile = (await screen.findByText('Unfunded: move this to Stripe')).closest('.adm-tile') as HTMLElement
    expect(within(tile).getByText('$2,299.00')).toBeInTheDocument()
    expect(screen.getByText('Transfers never wait for funding')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Record a funding' }))
    const dlg = screen.getByRole('dialog', { name: 'Record money moved from Sola to Stripe' })
    await user.type(within(dlg).getByLabelText('Amount in minor units (cents)'), '229900')
    await user.type(within(dlg).getByLabelText('Bank or Sola batch reference'), 'SOLA-1')
    await user.type(within(dlg).getByLabelText(/^Note/), 'Weekly move')
    await user.click(within(dlg).getByRole('button', { name: 'Record the funding' }))
    const step = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
    await user.type(within(step).getByLabelText('Authenticator code'), '123456')
    await user.click(within(step).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('The funding was recorded.')).toBeInTheDocument()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toMatchObject({ direction: 'sola_to_stripe', amountCents: 229900, currency: 'USD', reference: 'SOLA-1', note: 'Weekly move' })
    expect(bodies[0].requestId).toBeTruthy()
    expect(bodies[0].requestId).toBe(bodies[1].requestId)
    expect(await screen.findByRole('cell', { name: 'Weekly move' })).toBeInTheDocument()
  })

  it('only roles with PaymentsAdjust get the button; a read-only role still sees the figures and the hold state', async () => {
    server.use(http.get(`${A}/payments/sola/treasury`, () => HttpResponse.json(treasury(true))))
    await signIn('ReadOnly', '/admin/payments/sola')
    expect(await screen.findByText('Transfers held')).toBeInTheDocument()
    expect(screen.getByText('Transfers wait while a currency is unfunded')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record a funding' })).toBeNull()
  })

  it('rejects a non-integer amount before calling the API', async () => {
    let called = 0
    server.use(http.get(`${A}/payments/sola/treasury`, () => HttpResponse.json(treasury())), http.post(`${A}/payments/sola/funding`, () => { called++; return HttpResponse.json({ recorded: true }) }))
    const user = await signIn('SuperAdmin', '/admin/payments/sola')
    await user.click(await screen.findByRole('button', { name: 'Record a funding' }))
    const dlg = screen.getByRole('dialog', { name: 'Record money moved from Sola to Stripe' })
    await user.type(within(dlg).getByLabelText('Amount in minor units (cents)'), '12.50')
    await user.type(within(dlg).getByLabelText('Bank or Sola batch reference'), 'SOLA-2')
    await user.type(within(dlg).getByLabelText(/^Note/), 'Weekly move')
    await user.click(within(dlg).getByRole('button', { name: 'Record the funding' }))
    expect(await within(dlg).findByText(/positive whole number/)).toBeInTheDocument()
    expect(called).toBe(0)
  })
})
