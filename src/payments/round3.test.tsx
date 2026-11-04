import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { API, mount } from '../products/testkit'
import PaymentsPage from './Payments'
import { RequirePayments } from './RequirePayments'
import { dayUtc, isStripeUrl, money } from './format'

const as = (role: string | null) => role === null ? { activeAccountId: null, role: null, accounts: [] } : ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Acme', role, accountStatus: 'Approved', brandCount: 1 }] })
const onb = { state: 'active', hasAccount: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, currentlyDue: [], pastDue: [], disabledReason: null, deadline: null, nextSteps: [], payoutSettings: null, sandbox: true }
const summary = { balances: [], payoutsPaused: false, pausedReason: null, minTransferCents: 500, releaseDays: 7, openDisputes: 0, onboarding: onb }
const page = <T,>(items: T[]) => ({ total: items.length, page: 1, pageSize: 25, items })
const guarded = () => <RequirePayments><PaymentsPage /></RequirePayments>

describe('Payments access', () => {
  it.each(['Manager', 'Viewer', null])('%s is sent away from /payments instead of seeing the page shell and an API error', async (role) => {
    let hits = 0
    server.use(http.get(`${API}/seller/payments/summary`, () => { hits++; return HttpResponse.json(summary) }))
    mount(guarded(), '/payments', '/payments', as(role))
    expect(await screen.findByText('elsewhere')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Payments' })).toBeNull()
    expect(hits).toBe(0)
  })

  it.each(['Owner', 'Admin'])('%s sees the page', async (role) => {
    server.use(http.get(`${API}/seller/payments/summary`, () => HttpResponse.json(summary)))
    mount(guarded(), '/payments', '/payments', as(role))
    expect(await screen.findByRole('heading', { name: 'Payments' })).toBeInTheDocument()
  })

  it('an unknown role gets no Owner buttons', async () => {
    server.use(http.get(`${API}/seller/payments/summary`, () => HttpResponse.json({ ...summary, onboarding: { ...onb, state: 'not_started', hasAccount: false, detailsSubmitted: false, payoutsEnabled: false, nextSteps: ['Set up payouts'] } })))
    mount(<PaymentsPage />, '/payments', '/payments', as(null))
    expect(await screen.findByText(/only the account owner/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /set up payouts/i })).toBeNull()
  })
})

describe('Payments formatting', () => {
  it('shows date-only values in UTC whatever the viewer time zone is', async () => {
    process.env.TZ = 'America/New_York'
    expect(dayUtc('2026-11-05T00:00:00Z')).toBe('Nov 5, 2026')                         // a local formatter would say Nov 4 here
    server.use(http.get(`${API}/seller/payments/summary`, () => HttpResponse.json({ ...summary, balances: [{ currency: 'USD', pendingCents: 0, availableCents: 5000, reservedCents: 0, inTransitCents: 0, paidOutCents: 0, owedCents: 5000, negative: false, nextTransferAt: '2026-11-05T00:00:00Z' }] })))
    mount(<PaymentsPage />, '/payments', '/payments', as('Owner'))
    expect(await screen.findByText('Nov 5, 2026')).toBeInTheDocument()
  })

  it('uses the currency real minor units: JPY has none, USD and EUR have two', () => {
    expect(money(1500, 'JPY')).toMatch(/1,500/); expect(money(1500, 'JPY')).not.toMatch(/15\.00|1,500\.00/)
    expect(money(1500, 'USD')).toBe('$15.00'); expect(money(1234, 'EUR')).toMatch(/12\.34/)
    expect(money(-2299, 'USD')).toMatch(/22\.99/)
  })

  it('only Stripe hosts may receive the browser (and https only)', () => {
    expect(isStripeUrl('https://connect.stripe.com/setup/e/acct_1/abc')).toBe(true)
    expect(isStripeUrl('https://dashboard.stripe.com/express/x')).toBe(true)
    expect(isStripeUrl('https://connect.fake-stripe.test/setup/acct_1')).toBe(true)      // development builds only (vitest is one)
    for (const bad of ['https://evil.example/connect.stripe.com', 'https://connect.stripe.com.evil.example/x', 'http://connect.stripe.com/x', 'javascript:alert(1)', 'https://user:pw@connect.stripe.com/x', 'not a url', 'https://notstripe.com'])
      expect(isStripeUrl(bad)).toBe(false)
  })

  it('refuses to follow an address that is not Stripe', async () => {
    server.use(
      http.get(`${API}/seller/payments/summary`, () => HttpResponse.json({ ...summary, onboarding: { ...onb, state: 'not_started', hasAccount: false, detailsSubmitted: false, payoutsEnabled: false, nextSteps: ['Set up payouts'] } })),
      http.post(`${API}/seller/payments/onboarding`, () => HttpResponse.json({ url: 'https://evil.example/phish', expiresAt: '', onboarding: onb })),
    )
    const assign = vi.fn(); Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
    mount(<PaymentsPage />, '/payments', '/payments', as('Owner'))
    await userEvent.click(await screen.findByRole('button', { name: /set up payouts/i }))
    expect(await screen.findByText(/address we do not trust/i)).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('Payments tables', () => {
  it('has shipping label types in the filter and as a statement line that adds up to the closing balance', async () => {
    server.use(
      http.get(`${API}/seller/payments/summary`, () => HttpResponse.json(summary)),
      http.get(`${API}/seller/payments/ledger`, () => HttpResponse.json(page([]))),
    )
    mount(<PaymentsPage />, '/payments', '/payments?tab=transactions', as('Owner'))
    const sel = await screen.findByLabelText('Type')
    expect(Array.from((sel as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(expect.arrayContaining(['Shipping label', 'Shipping label refunded']))
    server.use(
      http.get(`${API}/seller/payments/statements`, () => HttpResponse.json({ months: ['2026-11'] })),
      http.get(`${API}/seller/payments/statements/2026-11`, () => HttpResponse.json({ month: '2026-11', currencies: [{ currency: 'USD', openingCents: 0, salesCents: 2499, feesCents: -200, refundsCents: 0, disputesCents: 0, adjustmentsCents: 0, shippingLabelsCents: -800, transfersCents: 0, closingCents: 1499, paidOutCents: 0 }] })),
    )
    mount(<PaymentsPage />, '/payments', '/payments?tab=statements', as('Owner'))
    expect(await screen.findByRole('row', { name: /Shipping labels -\$8\.00/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Closing balance \$14\.99/ })).toBeInTheDocument()
  })

  it('filters by order or booking number through the API over all rows, not over the loaded page', async () => {
    server.use(http.get(`${API}/seller/payments/summary`, () => HttpResponse.json(summary)))
    const urls: URL[] = []
    server.use(http.get(`${API}/seller/payments/ledger`, ({ request }) => { urls.push(new URL(request.url)); return HttpResponse.json(page([])) }))
    mount(<PaymentsPage />, '/payments', '/payments?tab=transactions', as('Owner'))
    await userEvent.type(await screen.findByLabelText('Order or booking number'), 'SO-2026-000007')
    await waitFor(() => expect(urls.at(-1)!.searchParams.get('reference')).toBe('SO-2026-000007'))
  })

  it('drops the old statement and its error when the month changes and shows a loading state', async () => {
    server.use(
      http.get(`${API}/seller/payments/summary`, () => HttpResponse.json(summary)),
      http.get(`${API}/seller/payments/statements`, () => HttpResponse.json({ months: ['2026-11', '2026-10'] })),
      http.get(`${API}/seller/payments/statements/2026-11`, () => HttpResponse.json({ message: 'x' }, { status: 500 })),
    )
    let release!: () => void
    server.use(http.get(`${API}/seller/payments/statements/2026-10`, async () => { await new Promise<void>((r) => { release = r }); return HttpResponse.json({ month: '2026-10', currencies: [{ currency: 'USD', openingCents: 0, salesCents: 1000, feesCents: -100, refundsCents: 0, disputesCents: 0, adjustmentsCents: 0, shippingLabelsCents: 0, transfersCents: 0, closingCents: 900, paidOutCents: 0 }] }) }))
    mount(<PaymentsPage />, '/payments', '/payments?tab=statements', as('Owner'))
    expect(await screen.findByText(/could not load the statement|something went wrong/i)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Month'), '2026-10')
    expect(screen.queryByText(/could not load the statement|something went wrong/i)).toBeNull()      // the old error is gone at once
    expect(screen.getByRole('status', { name: /loading the statement/i })).toBeInTheDocument()
    release()
    expect(await screen.findByRole('table', { name: /2026-10 statement/ })).toBeInTheDocument()
  })
})
