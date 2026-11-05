import { useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, Field } from '../../components/ui'
import { adminApi, fmtDate, fmtMoney, qs, type Page } from '../api'
import { Badge, Can, ErrorNote, KV, Loading, PageHeader, Pager, Panel, ReasonAction, StatTile, Table, Tabs, useLoad } from '../components'

/* ------------------------------------------------------------------------------------------------ one seller */
interface Balance { currency: string; pendingCents: number; availableCents: number; reservedCents: number; inTransitCents: number; paidOutCents: number; owedCents: number; negative: boolean }
interface Hold { id: string; reason: string; placedAt: string; placedBy: string | null; releasedAt?: string | null; releasedBy?: string | null; releaseReason?: string | null }
interface Overview {
  seller: { id: string; vendorName: string | null; status: string }
  balances: Balance[]
  stripe: { stripeAccountId: string; onboarding: { state: string; payoutsEnabled: boolean; chargesEnabled: boolean; detailsSubmitted: boolean; pastDue: string[]; currentlyDue: string[]; disabledReason: string | null; deadline: string | null }; lastEventAt: string | null } | null
  activeHold: Hold | null; holds: Hold[]; failedTransfers: number; openDisputes: number
}
interface Journal { id: string; createdAt: string; type: string; memo: string | null; currency: string; orderId: string | null; bookingId: string | null; sourceRef: string | null; reason: string | null; entries: { account: string; kind: string; amountCents: number }[] }

const JOURNAL_TYPES = ['sale', 'refund', 'transfer', 'transfer_failed', 'transfer_reversed', 'payout', 'payout_reversed', 'reserve_release', 'release', 'dispute', 'dispute_fee', 'dispute_won', 'adjustment']
const word = (s: string) => s.replaceAll('_', ' ')

function AdjustAction({ sellerId, currencies, onDone }: { sellerId: string; currencies: string[]; onDone: () => void }) {
  const [direction, setDirection] = useState('credit'); const [amount, setAmount] = useState(''); const [currency, setCurrency] = useState(currencies[0] ?? 'USD')
  const [requestId] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())))
  const id = useId()
  const cents = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : null
  return (
    <ReasonAction label="Adjust balance" variant="destructive" onDone={onDone} dialog={{
      title: 'Manual balance adjustment', confirm: direction === 'credit' ? 'Credit the seller' : 'Debit the seller', danger: true,
      lead: <>Moves money on the seller’s available balance and e-mails the owners. It cannot be undone, only offset by another adjustment. You will be asked for your authenticator code.
        {cents !== null && cents > 0 && <p><strong>You are about to {direction} {fmtMoney(cents, currency.toUpperCase())}</strong> ({cents} minor units).</p>}</>,
      extra: (
        <>
          <div className="field"><label htmlFor={`${id}-dir`}>Direction</label>
            <select id={`${id}-dir`} value={direction} onChange={(e) => setDirection(e.target.value)}><option value="credit">Credit (add to the seller)</option><option value="debit">Debit (take from the seller)</option></select></div>
          <Field label="Amount in minor units (cents)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} hint="A whole number, e.g. 2500 for 25.00." required />
          <Field label="Currency (ISO code)" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} required />
        </>
      ),
      onSubmit: async (reason) => {
        if (cents === null || cents <= 0) throw new Error('Enter the amount as a positive whole number of minor units.')
        if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Use a 3-letter currency code such as USD.')
        const r = await adminApi<{ recorded: boolean }>(`/payments/sellers/${sellerId}/adjustments`, { body: { direction, amountCents: cents, currency, reason, requestId } })
        if (!r.recorded) throw new Error('This adjustment was already recorded.')
      },
    }} />
  )
}

export function SellerPayments({ id }: { id: string }) {
  const { data: d, error, loading, reload } = useLoad(() => adminApi<Overview>(`/payments/sellers/${id}`), [id])
  const [type, setType] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [orderId, setOrderId] = useState(''); const [bookingId, setBookingId] = useState(''); const [reference, setReference] = useState(''); const [page, setPage] = useState(1)
  const [msg, setMsg] = useState<string | null>(null)
  const ledger = useLoad(() => adminApi<Page<Journal>>(`/payments/sellers/${id}/ledger` + qs({ type, from, to, orderId: orderId.trim(), bookingId: bookingId.trim(), reference: reference.trim(), page })), [id, type, from, to, orderId, bookingId, reference, page])
  if (loading && !d) return <Loading />
  if (error || !d) return <ErrorNote error={error ?? 'Not found'} retry={reload} />
  const done = (m: string) => () => { setMsg(m); reload(); ledger.reload() }
  const hold = (path: string) => (reason: string) => adminApi(`/payments/sellers/${id}/${path}`, { body: { reason } })
  const st = d.stripe?.onboarding
  return (
    <>
      <Alert kind="success">{msg ?? ''}</Alert>
      <Panel title="Balances">
        {d.balances.length === 0 ? <p className="adm-muted">No balance yet.</p> : d.balances.map((b) => (
          <div key={b.currency} className="adm-balance">
            <h3>{b.currency}</h3>
            <div className="adm-tiles">
              <StatTile label="Owed to the seller" value={fmtMoney(b.owedCents, b.currency)} tone={b.negative ? 'err' : undefined} hint={b.negative ? 'Negative: recovered from future sales' : undefined} />
              <StatTile label="Available" value={fmtMoney(b.availableCents, b.currency)} />
              <StatTile label="Pending" value={fmtMoney(b.pendingCents, b.currency)} />
              <StatTile label="Reserved" value={fmtMoney(b.reservedCents, b.currency)} />
              <StatTile label="In transit" value={fmtMoney(b.inTransitCents, b.currency)} />
              <StatTile label="Paid out" value={fmtMoney(b.paidOutCents, b.currency)} />
            </div>
          </div>
        ))}
        <p className="adm-muted">Failed transfers: {d.failedTransfers} · open disputes: {d.openDisputes}</p>
      </Panel>
      <div className="adm-cols">
        <Panel title="Stripe account" actions={st ? <Badge value={st.state} tone={st.state === 'active' ? 'ok' : st.state === 'restricted' ? 'err' : 'warn'} /> : undefined}>
          {!d.stripe || !st ? <p className="adm-muted">This seller has not started payout setup.</p> : (
            <KV items={[['Stripe account', <code key="a">{d.stripe.stripeAccountId}</code>], ['Details submitted', st.detailsSubmitted ? 'Yes' : 'No'], ['Charges enabled', st.chargesEnabled ? 'Yes' : 'No'], ['Payouts enabled', st.payoutsEnabled ? 'Yes' : 'No'],
              ['Past due', st.pastDue.length ? st.pastDue.join(', ') : 'Nothing'], ['Currently due', st.currentlyDue.length ? st.currentlyDue.join(', ') : 'Nothing'], ['Disabled reason', st.disabledReason], ['Deadline', fmtDate(st.deadline)], ['Last Stripe event', fmtDate(d.stripe.lastEventAt)]]} />
          )}
        </Panel>
        <Panel title="Payout hold" actions={<Badge value={d.activeHold ? 'On hold' : 'Not on hold'} tone={d.activeHold ? 'err' : 'ok'} />}>
          {d.activeHold ? <p>On hold since {fmtDate(d.activeHold.placedAt)}: {d.activeHold.reason}</p> : <p className="adm-muted">Payouts run normally.</p>}
          <div className="adm-actionrow">
            <Can permission="PaymentsHold">
              {d.activeHold
                ? <ReasonAction label="Release hold" variant="primary" onDone={done('The payout hold was released.')} dialog={{ title: 'Release the payout hold', lead: 'Transfers to the seller resume at the next run.', confirm: 'Release hold', onSubmit: hold('hold/release') }} />
                : <ReasonAction label="Place payout hold" variant="destructive" onDone={done('Payouts are on hold.')} dialog={{ title: 'Hold this seller’s payouts', lead: 'No transfer is made to the seller while the hold lasts. Sales and balances keep accruing.', confirm: 'Place hold', danger: true, onSubmit: hold('hold') }} />}
            </Can>
            <Can permission="PaymentsAdjust"><AdjustAction sellerId={id} currencies={d.balances.map((b) => b.currency)} onDone={done('The adjustment was recorded.')} /></Can>
          </div>
          {d.holds.length > 0 && (
            <Table caption="Hold history" head={['Placed', 'Reason', 'Released', 'Release reason']}>
              {d.holds.map((h) => <tr key={h.id}><td>{fmtDate(h.placedAt)}</td><td>{h.reason}</td><td>{fmtDate(h.releasedAt)}</td><td>{h.releaseReason ?? '—'}</td></tr>)}
            </Table>
          )}
        </Panel>
      </div>
      <Panel title="Ledger">
        <form className="adm-filters" role="search" aria-label="Filter the ledger" onSubmit={(e) => e.preventDefault()}>
          <div className="field"><label htmlFor="l-type">Type</label>
            <select id="l-type" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}><option value="">All types</option>{JOURNAL_TYPES.map((t) => <option key={t} value={t}>{word(t)}</option>)}</select></div>
          <Field label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
          <Field label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
          <Field label="Order id" value={orderId} onChange={(e) => { setOrderId(e.target.value); setPage(1) }} />
          <Field label="Booking id" value={bookingId} onChange={(e) => { setBookingId(e.target.value); setPage(1) }} />
          <Field label="Order or booking number" value={reference} onChange={(e) => { setReference(e.target.value); setPage(1) }} />
        </form>
        <ErrorNote error={ledger.error} retry={ledger.reload} />
        {ledger.loading && !ledger.data ? <Loading /> : ledger.data && (
          <>
            <Table caption="Ledger entries" head={['When', 'Type', 'Memo', 'Movements', 'Reason']} empty="No ledger entries match.">
              {ledger.data.items.map((j) => (
                <tr key={j.id}><td>{fmtDate(j.createdAt)}</td><th scope="row">{word(j.type)}</th><td>{j.memo ?? '—'}</td>
                  <td>{j.entries.map((e, i) => <div key={i}>{e.account} {e.kind}: {fmtMoney(e.amountCents, j.currency)}</div>)}</td><td>{j.reason ?? '—'}</td></tr>
              ))}
            </Table>
            <Pager page={ledger.data.page} pageSize={ledger.data.pageSize} total={ledger.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  )
}

/* ------------------------------------------------------------------------------------------------ platform-wide lists */
interface Transfer { id: string; sellerId: string; amountCents: number; currency: string; status: string; attempts: number; retries: number; lastError: string | null; stripeTransferId: string | null; createdAt: string; nextAttemptAt: string | null }
interface Payout { id: string; sellerId: string; stripePayoutId: string; amountCents: number; currency: string; status: string; failureCode: string | null; arrivalDate: string | null; createdAt: string }
interface PastDue { sellerId: string; stripeAccountId: string; pastDue: string[]; deadline: string | null; disabledReason: string | null; payoutsEnabled: boolean }
interface Flag { id: string; kind?: string; type?: string; createdAt: string; resolvedAt: string | null; [k: string]: unknown }
interface Unallocated { id: string; disputeId: string; marketplaceOrderId: string | null; chargeRef: string | null; currency: string; stripeAmountCents: number; allocatedCents: number; status: string; reason: string | null; evidenceDueBy: string | null; note: string | null; createdAt: string; resolvedAt: string | null }

const SellerLink = ({ id }: { id: string }) => <Link to={`/admin/sellers/${id}/payments`}>{id.slice(0, 8)}…</Link>
const TABS = [['transfers', 'Transfers'], ['payouts', 'Payouts'], ['past-due', 'Accounts past due'], ['reconciliation', 'Reconciliation'], ['disputes', 'Unallocated disputes']] as const

function Transfers() {
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Transfer>>('/payments/transfers' + qs({ status, page })), [status, page])
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Panel title="Transfers to sellers">
      <Alert kind="success">{msg ?? ''}</Alert>
      <form className="adm-filters" aria-label="Filter transfers" onSubmit={(e) => e.preventDefault()}>
        <div className="field"><label htmlFor="t-status">Status</label>
          <select id="t-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="">Any status</option><option value="pending">Pending</option><option value="created">Created</option><option value="failed">Failed</option><option value="reversed">Reversed</option></select></div>
      </form>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Transfers" head={['Seller', 'Amount', 'Status', 'Attempts', 'Last error', 'Created', 'Action']} empty="No transfers.">
            {data.items.map((t) => (
              <tr key={t.id}><th scope="row"><SellerLink id={t.sellerId} /></th><td>{fmtMoney(t.amountCents, t.currency)}</td><td><Badge value={t.status} tone={t.status === 'Failed' ? 'err' : t.status === 'Pending' ? 'warn' : t.status === 'Created' ? 'ok' : 'muted'} /></td>
                <td>{t.attempts} ({t.retries} retries)</td><td className="adm-clip">{t.lastError ?? '—'}</td><td>{fmtDate(t.createdAt)}</td>
                <td><Can permission="PaymentsRetry">{t.status === 'Failed' && <ReasonAction label="Retry" onDone={() => { setMsg('The transfer was queued again.'); reload() }} dialog={{ title: 'Retry this transfer', lead: `Retry the ${fmtMoney(t.amountCents, t.currency)} transfer. It runs at the next transfer job.`, confirm: 'Retry transfer', onSubmit: (reason) => adminApi(`/payments/transfers/${t.id}/retry`, { body: { reason } }) }} />}</Can></td></tr>
            ))}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

function Payouts() {
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Payout>>('/payments/payouts' + qs({ status, page })), [status, page])
  return (
    <Panel title="Stripe payouts">
      <form className="adm-filters" aria-label="Filter payouts" onSubmit={(e) => e.preventDefault()}>
        <div className="field"><label htmlFor="p-status">Status</label>
          <select id="p-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="">Any status</option><option value="pending">Pending</option><option value="in_transit">In transit</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="canceled">Canceled</option></select></div>
      </form>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Payouts" head={['Seller', 'Amount', 'Status', 'Failure', 'Arrival', 'Created']} empty="No payouts.">
            {data.items.map((p) => <tr key={p.id}><th scope="row"><SellerLink id={p.sellerId} /></th><td>{fmtMoney(p.amountCents, p.currency)}</td><td><Badge value={word(p.status)} tone={p.status === 'failed' ? 'err' : p.status === 'paid' ? 'ok' : 'warn'} /></td><td>{p.failureCode ?? '—'}</td><td>{fmtDate(p.arrivalDate)}</td><td>{fmtDate(p.createdAt)}</td></tr>)}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

function PastDueList() {
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<PastDue>>('/payments/accounts/requirements-past-due' + qs({ page })), [page])
  return (
    <Panel title="Accounts with requirements past due">
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Accounts past due" head={['Seller', 'Stripe account', 'Past due', 'Deadline', 'Disabled reason', 'Payouts']} empty="No account is past due.">
            {data.items.map((a) => <tr key={a.sellerId}><th scope="row"><SellerLink id={a.sellerId} /></th><td><code>{a.stripeAccountId}</code></td><td>{a.pastDue.join(', ')}</td><td>{fmtDate(a.deadline)}</td><td>{a.disabledReason ?? '—'}</td><td>{a.payoutsEnabled ? 'Enabled' : 'Disabled'}</td></tr>)}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

function Reconciliation() {
  const [open, setOpen] = useState(true); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Flag>>('/payments/reconciliation' + qs({ open: open ? '' : 'false', page })), [open, page])
  const [msg, setMsg] = useState<string | null>(null)
  const detail = (f: Flag) => Object.entries(f).filter(([k, v]) => !['id', 'createdAt', 'resolvedAt', 'resolvedBy'].includes(k) && v !== null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · ')
  return (
    <Panel title="Reconciliation flags" actions={<Can permission="PaymentsRetry">
      <ReasonAction label="Run reconciliation" variant="primary" onDone={() => { setMsg('Reconciliation ran.'); reload() }}
        dialog={{ title: 'Run reconciliation now', lead: 'Compares the ledger with Stripe and flags differences. It does not change any balance.', confirm: 'Run reconciliation', onSubmit: () => adminApi('/payments/reconciliation/run', { method: 'POST', body: {} }) }} />
    </Can>}>
      <Alert kind="success">{msg ?? ''}</Alert>
      <form className="adm-filters" aria-label="Filter flags" onSubmit={(e) => e.preventDefault()}>
        <div className="field"><label htmlFor="r-open">Show</label>
          <select id="r-open" value={open ? 'open' : 'all'} onChange={(e) => { setOpen(e.target.value === 'open'); setPage(1) }}><option value="open">Open flags</option><option value="all">All flags</option></select></div>
      </form>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Reconciliation flags" head={['Raised', 'Details', 'Status', 'Action']} empty="No open flags.">
            {data.items.map((f) => (
              <tr key={f.id}><td>{fmtDate(f.createdAt)}</td><td className="adm-clip">{detail(f)}</td><td><Badge value={f.resolvedAt ? 'Closed' : 'Open'} /></td>
                <td><Can permission="PaymentsRetry">{!f.resolvedAt && <ReasonAction label="Resolve" onDone={() => { setMsg('The flag was resolved.'); reload() }} dialog={{ title: 'Resolve this flag', lead: 'Only after the difference was checked and fixed.', confirm: 'Resolve flag', onSubmit: (reason) => adminApi(`/payments/reconciliation/${f.id}/resolve`, { body: { reason } }) }} />}</Can></td></tr>
            ))}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

function Disputes() {
  const [open, setOpen] = useState(true); const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad(() => adminApi<Page<Unallocated>>('/payments/unallocated-disputes' + qs({ open: open ? '' : 'false', page })), [open, page])
  return (
    <Panel title="Unallocated disputes">
      <p className="adm-muted">Stripe disputes on a charge that covers several sellers’ orders and has not been fully allocated: no seller was debited yet. Resolve them through the reconciliation flag.</p>
      <form className="adm-filters" aria-label="Filter disputes" onSubmit={(e) => e.preventDefault()}>
        <div className="field"><label htmlFor="d-open">Show</label>
          <select id="d-open" value={open ? 'open' : 'all'} onChange={(e) => { setOpen(e.target.value === 'open'); setPage(1) }}><option value="open">Open</option><option value="all">All</option></select></div>
      </form>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <Table caption="Unallocated disputes" head={['Dispute', 'Order', 'Amount', 'Allocated', 'Status', 'Evidence due', 'Note']} empty="No unallocated disputes.">
            {data.items.map((u) => <tr key={u.id}><th scope="row"><code>{u.disputeId}</code></th><td>{u.marketplaceOrderId ?? '—'}</td><td>{fmtMoney(u.stripeAmountCents, u.currency)}</td><td>{fmtMoney(u.allocatedCents, u.currency)}</td><td><Badge value={u.resolvedAt ? 'Closed' : word(u.status)} tone={u.resolvedAt ? 'muted' : 'warn'} /></td><td>{fmtDate(u.evidenceDueBy)}</td><td className="adm-clip">{u.note ?? '—'}</td></tr>)}
          </Table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  )
}

export default function Payments() {
  const { tab = 'transfers' } = useParams()
  const nav = useNavigate()
  const current = TABS.some(([t]) => t === tab) ? tab : 'transfers'
  return (
    <>
      <PageHeader title="Payments" lead="Platform-wide payment work. Open a seller’s Payments tab for balances, holds and adjustments." />
      <Tabs label="Payment lists" tabs={TABS} current={current} onSelect={(t) => nav(`/admin/payments/${t}`)}>
        {current === 'transfers' && <Transfers />}
        {current === 'payouts' && <Payouts />}
        {current === 'past-due' && <PastDueList />}
        {current === 'reconciliation' && <Reconciliation />}
        {current === 'disputes' && <Disputes />}
      </Tabs>
    </>
  )
}
