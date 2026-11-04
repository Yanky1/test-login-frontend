import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { API, mount } from '../products/testkit'
import PaymentsPage from './Payments'
import type { Onboarding, Summary } from './api'

const onb = (o: Partial<Onboarding> = {}): Onboarding => ({
  state: 'active', hasAccount: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, currentlyDue: [], pastDue: [], disabledReason: null, deadline: null, nextSteps: [],
  payoutSettings: { interval: 'daily', delayDays: 2, bankLast4: '4242', bankName: 'TEST BANK' }, sandbox: true, ...o,
})
const summary = (o: Partial<Summary> = {}): Summary => ({
  balances: [{ currency: 'USD', pendingCents: 2299, availableCents: 5000, reservedCents: 230, inTransitCents: 1000, paidOutCents: 0, owedCents: 7529, negative: false, nextTransferAt: '2026-11-05T00:00:00Z' }],
  payoutsPaused: false, pausedReason: null, minTransferCents: 500, releaseDays: 7, openDisputes: 0, onboarding: onb(), ...o,
})
const mockSummary = (s: Summary) => server.use(http.get(`${API}/seller/payments/summary`, () => HttpResponse.json(s)))
const as = (role: string) => ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Acme', role, accountStatus: 'Approved', brandCount: 1 }] })
const page = <T,>(items: T[]) => ({ total: items.length, page: 1, pageSize: 25, items })

describe('Payments page', () => {
  it('shows balance cards and the active payout setup with the bank last 4 only', async () => {
    mockSummary(summary())
    mount(<PaymentsPage />, '/payments', '/payments', as('Owner'))
    expect(await screen.findByTestId('bal-pending')).toHaveTextContent('$22.99')
    expect(screen.getByTestId('bal-available')).toHaveTextContent('$50.00')
    expect(screen.getByTestId('bal-reserved')).toHaveTextContent('$2.30')
    expect(screen.getByTestId('bal-transit')).toHaveTextContent('$10.00')
    expect(screen.getByText(/ending in 4242/)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /set up payouts/i })).toBeNull()
  })

  it('walks an owner through onboarding: next steps, then redirects to the Stripe link', async () => {
    mockSummary(summary({ balances: [], onboarding: onb({ state: 'action_required', payoutsEnabled: false, nextSteps: ['Add the bank account where you want to be paid.'], payoutSettings: null }) }))
    const assign = vi.fn(); Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
    let called = 0
    server.use(http.post(`${API}/seller/payments/onboarding`, () => { called++; return HttpResponse.json({ url: 'https://connect.stripe.com/setup/acct_1', expiresAt: '', onboarding: onb() }) }))
    mount(<PaymentsPage />, '/payments', '/payments', as('Owner'))
    expect(await screen.findByText('Add the bank account where you want to be paid.')).toBeInTheDocument()
    expect(screen.getByText('Action needed')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /continue payout setup/i }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.com/setup/acct_1'))
    expect(called).toBe(1)
  })

  it('an Admin sees the page but is told only the Owner can change payouts (no setup buttons)', async () => {
    mockSummary(summary({ balances: [], onboarding: onb({ state: 'not_started', hasAccount: false, detailsSubmitted: false, payoutsEnabled: false, nextSteps: ['Set up payouts to start receiving your earnings.'], payoutSettings: null }) }))
    mount(<PaymentsPage />, '/payments', '/payments', as('Admin'))
    expect(await screen.findByText(/only the account owner/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /set up payouts/i })).toBeNull()
    expect(screen.getByText(/No money has moved yet/)).toBeInTheDocument()
  })

  it('explains a negative balance and a paused payout without revealing a staff reason', async () => {
    mockSummary(summary({ payoutsPaused: true, pausedReason: 'under_review', balances: [{ currency: 'USD', pendingCents: 0, availableCents: -2299, reservedCents: 0, inTransitCents: 0, paidOutCents: 0, owedCents: -2299, negative: true, nextTransferAt: null }] }))
    mount(<PaymentsPage />, '/payments', '/payments', as('Owner'))
    expect(await screen.findByText(/balance is negative/i)).toBeInTheDocument()
    expect(screen.getByText(/transfers are paused while we review/i)).toBeInTheDocument()
  })

  it('lists transactions with a link to the order and filters by type', async () => {
    mockSummary(summary())
    const urls: URL[] = []
    server.use(http.get(`${API}/seller/payments/ledger`, ({ request }) => {
      urls.push(new URL(request.url))
      return HttpResponse.json(page([{ id: 'j1', createdAt: '2026-11-01T10:00:00Z', type: 'sale', memo: 'Sale', currency: 'USD', amountCents: 2299, orderId: 'o1', orderNumber: 'SO-2026-000001', bookingId: null, bookingNumber: null, lines: [{ account: 'pending', kind: 'items', amountCents: 1999 }] }]))
    }))
    mount(<PaymentsPage />, '/payments', '/payments?tab=transactions', as('Owner'))
    const link = await screen.findByRole('link', { name: 'SO-2026-000001' })
    expect(link).toHaveAttribute('href', '/orders/o1')
    await userEvent.click(screen.getByRole('button', { name: /lines of sale/i }))
    expect(await screen.findByText(/items \(pending\): \$19\.99/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'refund')
    await waitFor(() => expect(urls.at(-1)!.searchParams.get('type')).toBe('refund'))
  })

  it('shows transfer and payout history with status', async () => {
    mockSummary(summary())
    server.use(
      http.get(`${API}/seller/payments/transfers`, () => HttpResponse.json(page([{ id: 't1', createdAt: '2026-11-02T00:00:00Z', amountCents: 2299, currency: 'USD', status: 'failed', batchDate: '2026-11-02' }]))),
      http.get(`${API}/seller/payments/payouts`, () => HttpResponse.json(page([{ id: 'p1', createdAt: '2026-11-03T00:00:00Z', amountCents: 2299, currency: 'USD', status: 'in_transit', arrivalDate: '2026-11-05T00:00:00Z', failureCode: null }]))),
    )
    mount(<PaymentsPage />, '/payments', '/payments?tab=transfers', as('Owner'))
    const tr = await screen.findByRole('table', { name: 'Transfers' })
    expect(within(tr).getByText('failed')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Payouts' })).getByText('in transit')).toBeInTheDocument()
  })

  it('shows the monthly statement and downloads the CSV', async () => {
    mockSummary(summary())
    let csvHits = 0
    server.use(
      http.get(`${API}/seller/payments/statements`, () => HttpResponse.json({ months: ['2026-11'] })),
      http.get(`${API}/seller/payments/statements/2026-11`, () => HttpResponse.json({ month: '2026-11', currencies: [{ currency: 'USD', openingCents: 0, salesCents: 2499, feesCents: -200, refundsCents: 0, disputesCents: 0, adjustmentsCents: 0, transfersCents: 0, closingCents: 2299, paidOutCents: 0 }] })),
      http.get(`${API}/seller/payments/statements/2026-11/csv`, () => { csvHits++; return new HttpResponse('date,type\r\n', { headers: { 'Content-Type': 'text/csv' } }) }),
    )
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn()
    mount(<PaymentsPage />, '/payments', '/payments?tab=statements', as('Owner'))
    expect(await screen.findByRole('table', { name: /2026-11 statement/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Closing balance \$22\.99/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect(csvHits).toBe(1))
  })

  it('lists disputes with the evidence due date and a Stripe response button for owners', async () => {
    mockSummary(summary({ openDisputes: 1 }))
    server.use(http.get(`${API}/seller/payments/disputes`, () => HttpResponse.json(page([{ id: 'd1', createdAt: '2026-11-02T00:00:00Z', amountCents: 2499, feeCents: 1500, currency: 'USD', status: 'needs_response', reason: 'fraudulent', evidenceDueBy: '2026-11-20T00:00:00Z', closedAt: null, orderId: 'o1', orderNumber: 'SO-2026-000001', bookingId: null, bookingNumber: null, canRespond: true }]))))
    mount(<PaymentsPage />, '/payments', '/payments?tab=disputes', as('Owner'))
    expect(await screen.findByText('needs response')).toBeInTheDocument()
    expect(screen.getByText(/Nov 20, 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /respond in stripe/i })).toBeInTheDocument()
  })
})
