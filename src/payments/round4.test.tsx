import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { API, mount } from '../products/testkit'
import PaymentsPage from './Payments'
import { money } from './format'

const as = (role: string) => ({ activeAccountId: 'a1', role, accounts: [{ sellerId: 'a1', vendorName: 'Acme', role, accountStatus: 'Approved', brandCount: 1 }] })
const onb = { state: 'active', hasAccount: true, detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, currentlyDue: [], pastDue: [], disabledReason: null, deadline: null, nextSteps: [], payoutSettings: null, sandbox: true }
const summary = { balances: [], payoutsPaused: false, pausedReason: null, minTransferCents: 500, releaseDays: 7, openDisputes: 1, onboarding: onb }
const dispute = (id: string, status: string, canRespond: boolean) => ({ id, createdAt: '2026-11-02T00:00:00Z', amountCents: 2499, feeCents: 0, currency: 'USD', status, reason: 'fraudulent', evidenceDueBy: canRespond ? '2026-11-20T00:00:00Z' : null, closedAt: null, orderId: 'o1', orderNumber: 'SO-2026-000001', bookingId: null, bookingNumber: null, canRespond })
const showDisputes = (rows: ReturnType<typeof dispute>[], role = 'Owner') => {
  server.use(http.get(`${API}/seller/payments/summary`, () => HttpResponse.json(summary)),
    http.get(`${API}/seller/payments/disputes`, () => HttpResponse.json({ total: rows.length, page: 1, pageSize: 25, items: rows })))
  mount(<PaymentsPage />, '/payments', '/payments?tab=disputes', as(role))
}

describe('money with a currency the runtime does not know', () => {
  it('never assumes two decimals: it shows the raw minor units with the code', () => {
    expect(money(1500, 'ZZZ')).toBe('1500 ZZZ (minor units)')          // well formed, not a real currency
    expect(money(1500, '12')).toBe('1500 12 (minor units)')            // not even a code
    expect(money(1500, '')).toBe('1500  (minor units)')
  })
  it('keeps the real decimals of known currencies, whatever the case of the code', () => {
    expect(money(1500, 'USD')).toBe('$15.00')
    expect(money(1500, 'JPY')).toMatch(/1,500/)                        // no decimals
    expect(money(1500, 'KWD')).toMatch(/1\.500/)                       // three decimals
    expect(money(1500, 'usd')).toBe('$15.00')
  })
})

describe('disputes that cannot be answered', () => {
  it('an inquiry under review shows a dash and no respond button', async () => {
    showDisputes([dispute('d1', 'inquiry_review', false)])
    expect(await screen.findByText('inquiry review')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /inquiry review/ })).toHaveTextContent('—')
    expect(screen.queryByRole('button', { name: /respond in stripe/i })).toBeNull()
    expect(screen.queryByText(/before the evidence deadline/i)).toBeNull()
    expect(screen.getByText(/no dispute needs a response/i)).toBeInTheDocument()
  })

  it('the button appears for an owner as soon as one row can be answered', async () => {
    showDisputes([dispute('d1', 'inquiry_review', false), dispute('d2', 'needs_response', true)])
    expect(await screen.findByRole('button', { name: /respond in stripe/i })).toBeInTheDocument()
    expect(screen.getByText(/before the evidence deadline/i)).toBeInTheDocument()
  })

  it('an Admin never gets the button, even when a row can be answered', async () => {
    showDisputes([dispute('d2', 'needs_response', true)], 'Admin')
    expect(await screen.findByText('needs response')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /respond in stripe/i })).toBeNull()
  })

  it('closed disputes alone do not offer a response either', async () => {
    showDisputes([dispute('d3', 'won', false), dispute('d4', 'lost', false)])
    expect(await screen.findByText('won')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /respond in stripe/i })).toBeNull()
  })
})
