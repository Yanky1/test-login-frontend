import { api } from '../api'
import { fetchBlob } from '../products/api'

export interface Balance {
  currency: string; pendingCents: number; availableCents: number; reservedCents: number; inTransitCents: number; paidOutCents: number; owedCents: number
  negative: boolean; nextTransferAt: string | null
}
export interface PayoutSettings { interval: string | null; delayDays: number | null; bankLast4: string | null; bankName: string | null }
export interface Onboarding {
  state: 'not_started' | 'in_progress' | 'action_required' | 'restricted' | 'active'; hasAccount: boolean; detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean
  currentlyDue: string[]; pastDue: string[]; disabledReason: string | null; deadline: string | null; nextSteps: string[]; payoutSettings: PayoutSettings | null; sandbox: boolean
}
export interface Summary {
  balances: Balance[]; payoutsPaused: boolean; pausedReason: string | null; minTransferCents: number; releaseDays: number; openDisputes: number; onboarding: Onboarding
}
export interface LedgerLine { account: string; kind: string; amountCents: number }
export interface LedgerRow {
  id: string; createdAt: string; type: string; memo: string; currency: string; amountCents: number
  orderId: string | null; orderNumber: string | null; bookingId: string | null; bookingNumber: string | null; lines: LedgerLine[]
}
export interface Page<T> { total: number; page: number; pageSize: number; items: T[] }
export interface TransferRow { id: string; createdAt: string; amountCents: number; currency: string; status: 'scheduled' | 'sent' | 'failed' | 'reversed'; batchDate: string }
export interface PayoutRow { id: string; createdAt: string; amountCents: number; currency: string; status: string; arrivalDate: string | null; failureCode: string | null }
export interface DisputeRow {
  id: string; createdAt: string; amountCents: number; feeCents: number; currency: string; status: string; reason: string | null; evidenceDueBy: string | null; closedAt: string | null
  orderId: string | null; orderNumber: string | null; bookingId: string | null; bookingNumber: string | null; canRespond: boolean
}
export interface StatementCurrency {
  currency: string; openingCents: number; salesCents: number; feesCents: number; refundsCents: number; disputesCents: number; adjustmentsCents: number
  transfersCents: number; closingCents: number; paidOutCents: number
}
export interface Statement { month: string; currencies: StatementCurrency[] }

const P = '/seller/payments'
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString(); return s ? `?${s}` : ''
}

export const paymentsApi = {
  summary: () => api<Summary>(`${P}/summary`),
  ledger: (o: { type?: string; from?: string; to?: string; orderId?: string; page?: number }) => api<Page<LedgerRow>>(`${P}/ledger${qs({ ...o, pageSize: 25 })}`),
  transfers: () => api<Page<TransferRow>>(`${P}/transfers`),
  payouts: () => api<Page<PayoutRow>>(`${P}/payouts`),
  disputes: () => api<Page<DisputeRow>>(`${P}/disputes`),
  statements: () => api<{ months: string[] }>(`${P}/statements`),
  statement: (m: string) => api<Statement>(`${P}/statements/${m}`),
  statementCsv: (m: string) => fetchBlob(`${P}/statements/${m}/csv`),
  startOnboarding: () => api<{ url: string; expiresAt: string; onboarding: Onboarding }>(`${P}/onboarding`, { body: {} }),
  sync: () => api<Onboarding>(`${P}/onboarding/sync`, { body: {} }),
  dashboardLink: () => api<{ url: string }>(`${P}/dashboard-link`, { body: {} }),
}

export const TYPE_LABEL: Record<string, string> = {
  sale: 'Sale', policy_fee: 'Cancellation / no-show fee', extra_charge: 'Extra charge', refund: 'Refund', dispute: 'Dispute', dispute_fee: 'Dispute fee', dispute_won: 'Dispute won',
  release: 'Released to available', reserve_release: 'Reserve released', adjustment: 'Adjustment by Solvelt', transfer: 'Transfer to Stripe', transfer_failed: 'Transfer failed (returned)',
  transfer_reversed: 'Transfer reversed', payout: 'Payout to your bank', payout_reversed: 'Payout returned',
}
