import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { Alert, Button, Skeleton } from '../components/ui'
import { saveBlob } from '../products/api'
import { SelectField, TextField } from '../products/ui'
import { TabList, tabPanelProps } from '../orders/tabs'
import { dt } from '../orders/format'
import { dayUtc, isStripeUrl, money } from './format'
import { TYPE_LABEL, paymentsApi, type DisputeRow, type LedgerRow, type Onboarding, type Page, type PayoutRow, type Statement, type Summary, type TransferRow } from './api'
import '../products/products.css'
import '../orders/orders.css'
import './payments.css'

const TABS = [['overview', 'Overview'], ['transactions', 'Transactions'], ['transfers', 'Transfers & payouts'], ['statements', 'Statements'], ['disputes', 'Disputes']] as const
const STATE_LABEL: Record<Onboarding['state'], { text: string; tone: string }> = {
  not_started: { text: 'Not set up', tone: 'warn' }, in_progress: { text: 'Setup in progress', tone: 'warn' }, action_required: { text: 'Action needed', tone: 'warn' },
  restricted: { text: 'Payouts restricted', tone: 'bad' }, active: { text: 'Active', tone: 'ok' },
}
/** A loading placeholder that screen readers announce (Skeleton alone is aria-hidden). */
const Loading = ({ what, lines = 3 }: { what: string; lines?: number }) => <div role="status" aria-label={`Loading ${what}`}><Skeleton lines={lines} /></div>
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message2 : fallback)

function Balances({ s }: { s: Summary }) {
  if (s.balances.length === 0) return <p className="sub">No money has moved yet. Your balances appear here after your first paid order.</p>
  return (
    <>
      {s.balances.map((b) => (
        <section key={b.currency} aria-label={`${b.currency} balances`}>
          {s.balances.length > 1 && <h3>{b.currency}</h3>}
          <ul className="stats">
            <li className="stat"><span className="v" data-testid="bal-pending">{money(b.pendingCents, b.currency)}</span><span className="l">Pending (not yet releasable)</span></li>
            <li className={`stat${b.availableCents < 0 ? ' bad' : ''}`}><span className="v" data-testid="bal-available">{money(b.availableCents, b.currency)}</span><span className="l">Available</span></li>
            <li className="stat"><span className="v" data-testid="bal-reserved">{money(b.reservedCents, b.currency)}</span><span className="l">Reserved</span></li>
            <li className="stat"><span className="v" data-testid="bal-transit">{money(b.inTransitCents, b.currency)}</span><span className="l">On its way to your bank</span></li>
            <li className="stat"><span className="v">{b.nextTransferAt ? dayUtc(b.nextTransferAt) : '—'}</span><span className="l">Next transfer</span></li>
          </ul>
          {b.negative && <Alert kind="info">Your balance is negative ({money(b.owedCents, b.currency)}) because refunds, disputes or shipping labels came to more than your earnings. It is recovered automatically from your next sales.</Alert>}
        </section>
      ))}
    </>
  )
}

function OnboardingCard({ s, owner, reload }: { s: Summary; owner: boolean; reload: () => void }) {
  const o = s.onboarding; const label = STATE_LABEL[o.state]
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const go = async (fn: () => Promise<{ url: string }>) => {
    setBusy(true); setErr('')
    try {
      const { url } = await fn()
      if (!isStripeUrl(url)) { setErr('The payment provider returned an address we do not trust, so we did not open it.'); setBusy(false); return }
      window.location.assign(url)
    } catch (e) { setErr(errText(e, 'Could not open Stripe. Try again.')); setBusy(false) }
  }
  const sync = async () => { setBusy(true); setErr(''); try { await paymentsApi.sync(); reload() } catch (e) { setErr(errText(e, 'Could not refresh the status.')) } finally { setBusy(false) } }
  return (
    <section className="pay-card" aria-labelledby="onb-h">
      <h2 id="onb-h">Payout setup <span className={`chip ${label.tone}`}>{label.text}</span></h2>
      {o.sandbox && <p className="sub">Test mode: no real money moves.</p>}
      {o.nextSteps.length > 0 && <><p>To receive your earnings:</p><ul className="steps">{o.nextSteps.map((t) => <li key={t}>{t}</li>)}</ul></>}
      {o.pastDue.length > 0 && <Alert>Some information is overdue{o.deadline ? ` (deadline ${dayUtc(o.deadline)})` : ''}. Payouts may be paused until you provide it.</Alert>}
      {o.state === 'active' && <p>Stripe pays out your transferred earnings{o.payoutSettings?.interval ? ` ${o.payoutSettings.interval}` : ''}{o.payoutSettings?.delayDays != null ? ` with a ${o.payoutSettings.delayDays}-day delay` : ''}{o.payoutSettings?.bankLast4 ? ` to the bank account ending in ${o.payoutSettings.bankLast4}` : ''}.</p>}
      {s.payoutsPaused && o.state === 'active' && <Alert kind="info">Your transfers are paused{s.pausedReason === 'under_review' ? ' while we review your account' : ''}. Contact support if you have questions.</Alert>}
      <Alert>{err}</Alert>
      {owner ? (
        <div className="btnrow">
          {o.state !== 'active' && <Button variant="primary" loading={busy} onClick={() => void go(async () => (await paymentsApi.startOnboarding()))}>{o.hasAccount ? 'Continue payout setup' : 'Set up payouts'}</Button>}
          {o.hasAccount && <Button loading={busy} onClick={() => void sync()}>Refresh status</Button>}
          {o.detailsSubmitted && <Button loading={busy} onClick={() => void go(() => paymentsApi.dashboardLink())}>Open Stripe dashboard</Button>}
        </div>
      ) : <p className="sub">Only the account Owner can set up or change payouts.</p>}
      <p className="sub">Stripe handles identity checks, your bank details and tax forms (such as 1099-K). We never see or store your full bank number.</p>
    </section>
  )
}

function Overview({ s, owner, reload }: { s: Summary; owner: boolean; reload: () => void }) {
  return (
    <>
      <Balances s={s} />
      <p className="sub">Earnings from an order become available {s.releaseDays} days after delivery, then move to your Stripe account (minimum {money(s.minTransferCents)} per transfer).</p>
      {s.openDisputes > 0 && <Alert kind="info">{s.openDisputes} open dispute{s.openDisputes > 1 ? 's' : ''}. See the Disputes tab.</Alert>}
      <OnboardingCard s={s} owner={owner} reload={reload} />
    </>
  )
}

function Transactions() {
  const [type, setType] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [ref, setRef] = useState(''); const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<LedgerRow> | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<string | null>(null)
  const [search, setSearch] = useState('')   // the order/booking filter is applied by the API over ALL rows, not over the loaded page
  useEffect(() => { const t = setTimeout(() => { setSearch(ref.trim()); setPage(1) }, 300); return () => clearTimeout(t) }, [ref])
  useEffect(() => {
    let alive = true
    setErr(''); setData(null)
    paymentsApi.ledger({ type, from, to, reference: search, page }).then((d) => alive && setData(d)).catch((e) => alive && setErr(errText(e, 'Could not load transactions.')))
    return () => { alive = false }
  }, [type, from, to, search, page])
  const rows = data?.items ?? []
  return (
    <>
      <div className="filters">
        <SelectField label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}>
          <option value="">All types</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </SelectField>
        <TextField label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} />
        <TextField label="Until" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} />
        <TextField label="Order or booking number" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
      <Alert>{err}</Alert>
      {!data && !err && <Loading what="transactions" lines={4} />}
      {data && rows.length === 0 && <p className="sub">No transactions match.</p>}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table className="ptable">
            <caption className="sr-only">Transactions</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Order / booking</th><th scope="col" className="num">Amount</th><th scope="col">Details</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{dt(r.createdAt)}</td><td>{TYPE_LABEL[r.type] ?? r.type}</td>
                    <td>{r.orderId ? <Link to={`/orders/${r.orderId}`}>{r.orderNumber}</Link> : r.bookingId ? <Link to={`/bookings/${r.bookingId}`}>{r.bookingNumber}</Link> : '—'}</td>
                    <td className="num">{money(r.amountCents, r.currency)}</td>
                    <td><button type="button" className="linklike" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Show'}<span className="sr-only"> lines of {TYPE_LABEL[r.type] ?? r.type}</span></button></td>
                  </tr>
                  {open === r.id && <tr><td colSpan={5}><ul className="lines">{r.lines.map((l, i) => <li key={i}>{l.kind} ({l.account}): {money(l.amountCents, r.currency)}</li>)}</ul></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.pageSize && (
        <div className="btnrow">
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span aria-live="polite">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
          <Button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>
  )
}

const TRANSFER_TONE = { scheduled: 'warn', sent: 'ok', failed: 'bad', reversed: 'bad' } as const
function Transfers() {
  const [t, setT] = useState<Page<TransferRow> | null>(null); const [p, setP] = useState<Page<PayoutRow> | null>(null); const [err, setErr] = useState('')
  useEffect(() => { Promise.all([paymentsApi.transfers(), paymentsApi.payouts()]).then(([a, b]) => { setT(a); setP(b) }).catch((e) => setErr(errText(e, 'Could not load transfers.'))) }, [])
  if (err) return <Alert>{err}</Alert>
  if (!t || !p) return <Loading what="transfers and payouts" lines={4} />
  return (
    <>
      <h2>Transfers to your Stripe account</h2>
      {t.items.length === 0 ? <p className="sub">No transfers yet.</p> : (
        <div className="tablewrap"><table className="ptable"><caption className="sr-only">Transfers</caption>
          <thead><tr><th scope="col">Date</th><th scope="col" className="num">Amount</th><th scope="col">Status</th></tr></thead>
          <tbody>{t.items.map((r) => <tr key={r.id}><td>{dt(r.createdAt)}</td><td className="num">{money(r.amountCents, r.currency)}</td><td><span className={`chip ${TRANSFER_TONE[r.status]}`}>{r.status}</span></td></tr>)}</tbody></table></div>
      )}
      <h2>Payouts to your bank</h2>
      {p.items.length === 0 ? <p className="sub">Stripe pays out your transfers on its schedule. They will be listed here.</p> : (
        <div className="tablewrap"><table className="ptable"><caption className="sr-only">Payouts</caption>
          <thead><tr><th scope="col">Date</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Arrival</th></tr></thead>
          <tbody>{p.items.map((r) => <tr key={r.id}><td>{dt(r.createdAt)}</td><td className="num">{money(r.amountCents, r.currency)}</td>
            <td><span className={`chip ${r.status === 'paid' ? 'ok' : r.status === 'failed' || r.status === 'canceled' ? 'bad' : 'warn'}`}>{r.status.replace('_', ' ')}</span>{r.failureCode && <span className="sub"> ({r.failureCode})</span>}</td><td>{dayUtc(r.arrivalDate) || '—'}</td></tr>)}</tbody></table></div>
      )}
    </>
  )
}

function Statements() {
  const [months, setMonths] = useState<string[] | null>(null); const [m, setM] = useState(''); const [st, setSt] = useState<Statement | null>(null); const [err, setErr] = useState('')
  useEffect(() => { paymentsApi.statements().then((r) => { setMonths(r.months); setM(r.months[0] ?? '') }).catch((e) => setErr(errText(e, 'Could not load statements.'))) }, [])
  useEffect(() => {
    if (!m) return
    let alive = true
    setSt(null); setErr('')   // a month change drops the old table and its error at once
    paymentsApi.statement(m).then((r) => alive && setSt(r)).catch((e) => alive && setErr(errText(e, 'Could not load the statement.')))
    return () => { alive = false }
  }, [m])
  const csv = async () => { try { saveBlob(await paymentsApi.statementCsv(m), `statement-${m}.csv`) } catch { setErr('Could not download the CSV.') } }
  if (months && months.length === 0) return <p className="sub">Statements appear after your first transaction.</p>
  return (
    <>
      <Alert>{err}</Alert>
      <div className="filters">
        <SelectField label="Month" value={m} onChange={(e) => setM(e.target.value)}>{(months ?? []).map((x) => <option key={x} value={x}>{x}</option>)}</SelectField>
        <Button disabled={!m} onClick={() => void csv()}>Download CSV</Button>
      </div>
      {m && !st && !err && <Loading what="the statement" />}
      {st?.currencies.map((c) => (
        <div className="tablewrap" key={c.currency}>
          <table className="ptable"><caption>{st.month} statement ({c.currency})</caption>
            <tbody>
              {([['Opening balance', c.openingCents], ['Sales', c.salesCents], ['Marketplace fees', c.feesCents], ['Refunds', c.refundsCents], ['Disputes', c.disputesCents], ['Adjustments', c.adjustmentsCents], ['Shipping labels', c.shippingLabelsCents], ['Transfers to Stripe', c.transfersCents], ['Closing balance', c.closingCents]] as const)
                .map(([l, v]) => <tr key={l}><th scope="row">{l}</th><td className="num">{money(v, c.currency)}</td></tr>)}
            </tbody></table>
        </div>
      ))}
    </>
  )
}

function Disputes({ owner }: { owner: boolean }) {
  const [d, setD] = useState<Page<DisputeRow> | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { paymentsApi.disputes().then(setD).catch((e) => setErr(errText(e, 'Could not load disputes.'))) }, [])
  const open = async () => {
    setBusy(true)
    try {
      const { url } = await paymentsApi.dashboardLink()
      if (!isStripeUrl(url)) { setErr('The payment provider returned an address we do not trust, so we did not open it.'); setBusy(false); return }
      window.location.assign(url)
    } catch (e) { setErr(errText(e, 'Could not open Stripe.')); setBusy(false) }
  }
  if (err) return <Alert>{err}</Alert>
  if (!d) return <Loading what="disputes" />
  if (d.items.length === 0) return <p className="sub">No disputes. If a buyer disputes a payment, it shows up here with the date your evidence is due.</p>
  return (
    <>
      <p>Respond to disputes in your Stripe Express dashboard before the evidence deadline.</p>
      {owner && <div className="btnrow"><Button loading={busy} onClick={() => void open()}>Respond in Stripe</Button></div>}
      <div className="tablewrap"><table className="ptable"><caption className="sr-only">Disputes</caption>
        <thead><tr><th scope="col">Opened</th><th scope="col">Order / booking</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Evidence due</th></tr></thead>
        <tbody>{d.items.map((r) => (
          <tr key={r.id}><td>{dt(r.createdAt)}</td>
            <td>{r.orderId ? <Link to={`/orders/${r.orderId}`}>{r.orderNumber}</Link> : r.bookingNumber ?? '—'}</td>
            <td className="num">{money(r.amountCents, r.currency)}</td>
            <td><span className={`chip ${r.status === 'won' ? 'ok' : r.status === 'lost' ? 'bad' : 'warn'}`}>{r.status.replace('_', ' ')}</span></td>
            <td>{r.canRespond ? dayUtc(r.evidenceDueBy) || 'Check Stripe' : '—'}</td></tr>))}
        </tbody></table></div>
    </>
  )
}

export default function PaymentsPage() {
  const { user } = useAuth()
  const owner = user?.role === 'Owner'   // an unknown role gets no Owner buttons (the server decides anyway)
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') ?? 'overview'
  const [s, setS] = useState<Summary | null>(null); const [err, setErr] = useState('')
  const load = useCallback(() => { paymentsApi.summary().then(setS).catch((e) => setErr(errText(e, 'Could not load your payments.'))) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { document.title = 'Payments · Solvelt' }, [])
  // returning from Stripe's hosted setup: pull the fresh status once (the webhook may be a moment behind)
  useEffect(() => { if (sp.get('onboarding') && owner) paymentsApi.sync().then(load).catch(() => undefined) }, [sp, owner, load])
  return (
    <main className="pwrap" aria-labelledby="page-title">
      <h1 id="page-title" tabIndex={-1}>Payments</h1>
      <Alert>{err}</Alert>
      <TabList label="Payments sections" idPrefix="paytab" value={tab} onChange={(id) => setSp(id === 'overview' ? {} : { tab: id })} tabs={TABS.map(([id, label]) => ({ id, label }))} />
      <div {...tabPanelProps('paytab', tab)}>
        {tab === 'overview' && (s ? <Overview s={s} owner={owner} reload={load} /> : !err && <Loading what="your balances" lines={4} />)}
        {tab === 'transactions' && <Transactions />}
        {tab === 'transfers' && <Transfers />}
        {tab === 'statements' && <Statements />}
        {tab === 'disputes' && <Disputes owner={owner} />}
      </div>
    </main>
  )
}
