import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { AuthImage } from '../products/AuthImage'
import { AreaField, PIcon, SelectField } from '../products/ui'
import { useCanWrite } from '../products/usePermissions'
import { ordersApi, messagesApi, type MessageTemplate, type OrderDetail, type PackingSlip } from './api'
import { CancelDialog, CancelRequestDialog, ConfirmDialog, HoldDialog, RefundDialog, ReturnReceiveDialog, ReturnRejectDialog, ShipDialog, TrackingDialog } from './Dialogs'
import { dt, eventLabel, money, reasonLabel, shipByText, statusLabel, statusTone } from './format'
import { useLiveReload } from './live'
import { PackingSlips } from './PackingSlips'
import { OrderShippingPanel, ReturnLabelDialog } from '../shipping/OrderShipping'
import { trackLabel, trackTone } from '../shipping/format'
import './orders.css'

type Dlg = { k: 'ship' } | { k: 'hold' } | { k: 'cancel' } | { k: 'refund'; returnId?: string } | { k: 'deliver' } | { k: 'tracking'; id: string }
  | { k: 'creq'; id: string; approve: boolean } | { k: 'rreject'; id: string } | { k: 'rreceive'; id: string } | { k: 'slip'; slip: PackingSlip } | { k: 'retlabel'; id: string }

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) }).catch(() => undefined) }}>
      <PIcon name={done ? 'check' : 'copy'} /> {done ? 'Copied' : 'Copy'}<span className="sr-only"> {label}</span>
    </button>
  )
}

export default function OrderDetailPage() {
  const { id = '' } = useParams()
  const canWrite = useCanWrite()
  const [o, setO] = useState<OrderDetail | null>(null)
  const [error, setError] = useState(''); const [stale, setStale] = useState(false); const [notFound, setNotFound] = useState(false)
  const [dlg, setDlg] = useState<Dlg | null>(null)
  const [flash, setFlash] = useState('')
  const load = useCallback(async () => {
    try { setO(await ordersApi.get(id)); setError(''); setStale(false) } catch (e) { if (e instanceof ApiError && e.status === 404) setNotFound(true); else setError(e instanceof ApiError ? e.message2 : 'Could not load this order.') }
  }, [id])
  useEffect(() => { setO(null); setNotFound(false); void load() }, [load])
  // Never reload under an open dialog (it would change the order version beneath the user's input): remember it and reload when the dialog closes.
  const pending = useRef(false)
  useLiveReload(['order.changed'], () => { if (dlg) pending.current = true; else void load() })
  const closeDlg = () => { setDlg(null); if (pending.current) { pending.current = false; void load() } }
  const fail = (m: string, conflict?: boolean) => { setError(m); setStale(!!conflict) }
  const done = (next: OrderDetail, msg?: string) => { pending.current = false; setO(next); setDlg(null); if (msg) setFlash(msg) }

  if (notFound) return <main className="pwrap" aria-labelledby="page-title"><h1 id="page-title" tabIndex={-1}>Order not found</h1><p>This order doesn’t exist, or you don’t have access to it.</p><Link className="btn" to="/orders">Back to orders</Link></main>
  if (!o) return <main className="pwrap" aria-labelledby="page-title"><h1 id="page-title" tabIndex={-1}>Order</h1><Alert>{error}</Alert><div aria-busy="true" aria-label="Loading order"><Skeleton lines={6} /></div></main>
  const a = o.actions
  const sb = shipByText({ status: o.status, shipByAt: o.shipByAt })
  const openCancel = o.cancellations.find((c) => c.status === 'Requested')
  const retReq = o.returns.find((r) => r.status === 'Requested'); const retReceived = o.returns.find((r) => r.status === 'Received')
  const accept = async () => { done(await ordersApi.act(o.id, 'accept', { version: o.version }), 'Order accepted.') }
  const next = (() => {
    if (!canWrite) return null
    if (openCancel && a.decideCancellation) return <Button variant="primary" onClick={() => setDlg({ k: 'creq', id: openCancel.id, approve: true })}>Review cancellation request</Button>
    if (retReq && a.decideReturn) return <a className="btn primary" href="#ret-h">Review the return request</a>
    if (a.accept) return <ActionButton primary run={accept} onError={fail}>Accept order</ActionButton>
    if (a.ship) return <Button variant="primary" onClick={() => setDlg({ k: 'ship' })}>Ship order</Button>
    if (a.resume) return <ActionButton primary run={async () => done(await ordersApi.act(o.id, 'resume', { version: o.version }), 'Hold removed.')} onError={fail}>Remove hold</ActionButton>
    if (a.markDelivered) return <Button variant="primary" onClick={() => setDlg({ k: 'deliver' })}>Mark as delivered</Button>
    if (retReceived && a.refund) return <Button variant="primary" onClick={() => setDlg({ k: 'refund', returnId: retReceived.id })}>Refund the return</Button>
    return null
  })()
  const lineOf = (lineId: string) => o.lines.find((l) => l.id === lineId)

  return (
    <main className="pwrap order-page" aria-labelledby="page-title">
      <p className="crumb"><Link to="/orders">← All orders</Link></p>
      <header className="order-head">
        <div>
          <h1 id="page-title" tabIndex={-1}>Order {o.number}</h1>
          <p className="sub">Placed {dt(o.placedAt)} · {o.brandName} · Solvelt order {o.marketplaceOrderId}</p>
          <div className="chips-row">
            <span className={`chip ${statusTone(o.status)}`}>{statusLabel(o.status, o.money)}</span>
            {o.late && <span className="chip bad">Late</span>}
            {o.oversold && <span className="chip warn">Oversold – needs attention</span>}
            {o.cancelRequested && <span className="chip warn">Cancellation requested</span>}
            {o.returnOpen && <span className="chip warn">Return in progress</span>}
            {o.needsAttention && <span className="chip bad">Delivery problem – needs attention</span>}
            {sb.tone !== 'none' && <span className={`chip ${sb.tone === 'bad' ? 'bad' : sb.tone === 'warn' ? 'warn' : 'ok'}`}>{sb.text}</span>}
          </div>
        </div>
        <div className="actions">{next}<Button onClick={() => void ordersApi.packingSlip(o.id).then((slip) => setDlg({ k: 'slip', slip })).catch(() => setError('Could not prepare the packing slip.'))}>Packing slip</Button></div>
      </header>
      <div aria-live="polite" className="flash">{flash && <Alert kind="success">{flash}</Alert>}</div>
      <Alert>{error}</Alert>
      {stale && <p><Button onClick={() => void load()}>Reload order</Button></p>}
      {o.stockMismatch && <Alert kind="info">Some units couldn’t be taken off your stock automatically when this order shipped. Please check the stock count of its items.</Alert>}
      {o.redacted && <Alert kind="info">The buyer’s details were removed after the retention period.</Alert>}

      <div className="order-grid">
        <div className="order-main">
          <section className="pcard" aria-labelledby="items-h">
            <h2 id="items-h">Items</h2>
            <ul className="order-lines">
              {o.lines.map((l) => (
                <li key={l.id}>
                  {l.hasImage ? <AuthImage src={ordersApi.thumbnail(o.id, l.id)} alt="" className="pthumb" /> : <span className="pthumb img-ph" aria-hidden="true" />}
                  <div className="grow">
                    <strong>{l.title}</strong>{l.options && <div className="sub">{l.options}</div>}<div className="sub">SKU {l.sku ?? '—'}</div>
                    <div className="sub">{[l.shippedQty > 0 && `${l.shippedQty} shipped`, l.unshippedQty > 0 && `${l.unshippedQty} to ship`, l.cancelledQty > 0 && `${l.cancelledQty} cancelled`, l.refundedQty > 0 && `${l.refundedQty} refunded`, l.returnedQty > 0 && `${l.returnedQty} returned`].filter(Boolean).join(' · ')}</div>
                    {l.stockShort && <span className="chip warn">Not enough stock</span>}
                  </div>
                  <div className="num"><div>{l.quantity} × {money(l.unitPriceCents, o.currency)}</div>{l.discountCents > 0 && <div className="sub">Discount −{money(l.discountCents, o.currency)}</div>}<strong>{money(l.lineTotalCents, o.currency)}</strong></div>
                </li>
              ))}
            </ul>
          </section>

          {(o.shipments.length > 0) && (
            <section className="pcard" aria-labelledby="ship-h">
              <h2 id="ship-h">Shipments</h2>
              <ul className="plain">
                {o.shipments.map((s) => (
                  <li key={s.id} className="shipment">
                    <div className="grow">
                      <strong>{s.carrier}{s.service ? ` · ${s.service}` : ''}</strong>
                      <div>{s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">{s.trackingNumber}<span className="sr-only"> (opens the carrier’s site)</span></a> : s.trackingNumber}</div>
                      <div className="sub">Shipped {dt(s.shippedAt)}{s.deliveredAt ? ` · Delivered ${dt(s.deliveredAt)}` : ''}{s.labelCostCents != null ? ` · Label ${money(s.labelCostCents, s.labelCurrency ?? o.currency)}` : ''}</div>
                      {s.trackingStatus && s.trackingStatus !== 'unknown' && <div><span className={`chip ${trackTone(s.trackingStatus)}`}>{trackLabel(s.trackingStatus)}</span>{s.eta && !s.deliveredAt ? <span className="sub"> Estimated delivery {dt(s.eta)}</span> : null}</div>}
                      <div className="sub">{s.lines.map((x) => `${x.quantity} × ${lineOf(x.lineId)?.title ?? 'item'}`).join(', ')}</div>
                    </div>
                    {a.editTracking && !s.deliveredAt && <Button onClick={() => setDlg({ k: 'tracking', id: s.id })}>Edit tracking<span className="sr-only"> {s.trackingNumber}</span></Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(o.shipments.length > 0 || (o.returnShipments?.length ?? 0) > 0) && <OrderShippingPanel order={o} canWrite={canWrite} onChanged={load} />}

          {o.cancellations.length > 0 && (
            <section className="pcard" aria-labelledby="cr-h"><h2 id="cr-h">Cancellation requests</h2>
              <ul className="plain">{o.cancellations.map((c) => (
                <li key={c.id}>
                  <p><strong>{c.requestedBy === 'Buyer' ? 'The buyer asked to cancel' : 'Cancelled by you'}</strong> · {reasonLabel(c.reason)} <span className="chip">{c.status}</span></p>
                  {c.note && <p className="sub">“{c.note}”</p>}{c.decisionNote && <p className="sub">Your answer: {c.decisionNote}</p>}
                  {c.status === 'Requested' && a.decideCancellation && <div className="actions"><Button variant="primary" onClick={() => setDlg({ k: 'creq', id: c.id, approve: true })}>Approve<span className="sr-only"> cancellation</span></Button><Button onClick={() => setDlg({ k: 'creq', id: c.id, approve: false })}>Decline<span className="sr-only"> cancellation</span></Button></div>}
                </li>))}</ul>
            </section>
          )}

          {o.returns.length > 0 && (
            <section className="pcard" aria-labelledby="ret-h"><h2 id="ret-h">Returns</h2>
              <ul className="plain">{o.returns.map((r) => (
                <li key={r.id}>
                  <p><strong>{r.lines.map((x) => `${x.quantity} × ${lineOf(x.lineId)?.title ?? 'item'}`).join(', ')}</strong> <span className="chip">{r.status}</span></p>
                  <p className="sub">{reasonLabel(r.reason)}{r.buyerComment ? ` – “${r.buyerComment}”` : ''}</p>
                  {r.decisionReason && <p className="sub">Decision: {r.decisionReason}</p>}
                  {o.returnShipments?.filter((x) => x.returnId === r.id).map((x) => (
                    <p key={x.id} className="sub">Return label sent · {x.carrier} {x.trackingNumber} · <span className={`chip ${trackTone(x.trackingStatus)}`}>{trackLabel(x.trackingStatus)}</span></p>
                  ))}
                  {r.status === 'Approved' && o.returnShipments?.some((x) => x.returnId === r.id && x.deliveredAt) && <Alert kind="success">Return arrived – inspect the items and mark the return as received.</Alert>}
                  {canWrite && <div className="actions">
                    {r.status === 'Requested' && a.decideReturn && <><ActionButton primary run={async () => done(await ordersApi.act(o.id, `returns/${r.id}/approve`, { version: o.version }), 'Return approved.')} onError={fail}>Approve return</ActionButton><Button onClick={() => setDlg({ k: 'rreject', id: r.id })}>Reject return</Button></>}
                    {r.status === 'Approved' && !o.returnShipments?.some((x) => x.returnId === r.id) && <Button onClick={() => setDlg({ k: 'retlabel', id: r.id })}>Send a prepaid return label</Button>}
                    {r.status === 'Approved' && a.receiveReturn && <Button variant="primary" onClick={() => setDlg({ k: 'rreceive', id: r.id })}>Mark as received</Button>}
                    {r.status === 'Received' && a.refund && <Button variant="primary" onClick={() => setDlg({ k: 'refund', returnId: r.id })}>Refund this return</Button>}
                  </div>}
                </li>))}</ul>
            </section>
          )}

          {o.refunds.length > 0 && (
            <section className="pcard" aria-labelledby="ref-h"><h2 id="ref-h">Refunds</h2>
              <ul className="plain">{o.refunds.map((r) => <li key={r.id}><strong>{money(r.amountCents, o.currency)}</strong> · {reasonLabel(r.reason)} · {dt(r.createdAt)}{r.shippingCents > 0 && <span className="sub"> (includes {money(r.shippingCents, o.currency)} shipping)</span>}</li>)}</ul>
            </section>
          )}

          <Messages order={o} canWrite={canWrite && a.note} />

          <section className="pcard" aria-labelledby="tl-h">
            <h2 id="tl-h">Timeline</h2>
            <ol className="timeline">{[...o.timeline].reverse().map((e) => <li key={e.id}><span className="t-dot" aria-hidden="true" /><div><strong>{eventLabel(e.type)}</strong>{e.text && <span className="sub"> – {e.text}</span>}<div className="sub">{dt(e.at)} · {e.actor === 'Seller' ? 'You' : e.actor === 'Buyer' ? 'Buyer' : 'Solvelt'}</div></div></li>)}</ol>
          </section>
        </div>

        <aside className="order-side" aria-label="Order summary">
          <section className="pcard" aria-labelledby="pay-h">
            <h2 id="pay-h">Payment summary</h2>
            <dl className="sum">
              <div><dt>Items</dt><dd>{money(o.money.itemsCents, o.currency)}</dd></div>
              {o.money.discountCents > 0 && <div><dt>Discounts</dt><dd>−{money(o.money.discountCents, o.currency)}</dd></div>}
              <div><dt>Shipping charged</dt><dd>{money(o.money.shippingCents, o.currency)}</dd></div>
              <div><dt>Tax</dt><dd>{money(o.money.taxCents, o.currency)}</dd></div>
              <div className="total"><dt>Buyer paid</dt><dd>{money(o.money.totalCents, o.currency)}</dd></div>
              <div><dt>Solvelt fee</dt><dd>−{money(o.money.feeCents, o.currency)}</dd></div>
              <div className="total"><dt>Your earnings</dt><dd>{money(o.money.netCents, o.currency)}</dd></div>
              {o.money.refundedCents > 0 && <div><dt>Refunded</dt><dd>−{money(o.money.refundedCents, o.currency)}</dd></div>}
            </dl>
            <p className="sub">Solvelt handles the payment and your payout. Tax is paid by Solvelt.</p>
          </section>

          <section className="pcard" aria-labelledby="addr-h">
            <h2 id="addr-h">Ship to</h2>
            {o.redacted ? <p>Removed after the retention period.</p> : (
              <>
                <address>{o.shippingAddress.name}<br />{o.shippingAddress.line1}<br />{o.shippingAddress.line2 && <>{o.shippingAddress.line2}<br /></>}{o.shippingAddress.city}{o.shippingAddress.region ? `, ${o.shippingAddress.region}` : ''} {o.shippingAddress.postalCode}<br />{o.shippingAddress.country}</address>
                <CopyButton label="the shipping address" text={[o.shippingAddress.name, o.shippingAddress.line1, o.shippingAddress.line2, `${o.shippingAddress.city}${o.shippingAddress.region ? ', ' + o.shippingAddress.region : ''} ${o.shippingAddress.postalCode}`, o.shippingAddress.country].filter(Boolean).join('\n')} />
                <p className="sub">{o.shippingMethod} ({o.shippingSpeed}) · deliver by {dt(o.deliverByAt)}</p>
                {o.buyer.phone && <p className="sub">Phone for the carrier: {o.buyer.phone}</p>}
                {o.giftMessage && <p className="gift-note"><strong>Gift message:</strong> {o.giftMessage}</p>}
              </>
            )}
            <p className="sub">Buyer: {o.buyer.name}. Their real email is never shared; use messages to reach them.</p>
          </section>

          {canWrite && (
            <section className="pcard" aria-labelledby="act-h">
              <h2 id="act-h">More actions</h2>
              <div className="stack">
                {a.accept && <ActionButton run={accept} onError={fail}>Accept order</ActionButton>}
                {a.ship && <Button onClick={() => setDlg({ k: 'ship' })}>Ship items…</Button>}
                {a.hold && <Button onClick={() => setDlg({ k: 'hold' })}>Put on hold…</Button>}
                {a.resume && <ActionButton run={async () => done(await ordersApi.act(o.id, 'resume', { version: o.version }), 'Hold removed.')} onError={fail}>Remove hold</ActionButton>}
                {a.markDelivered && <Button onClick={() => setDlg({ k: 'deliver' })}>Mark as delivered…</Button>}
                {a.cancel && <Button variant="destructive" onClick={() => setDlg({ k: 'cancel' })}>{a.cancelRemainder ? 'Cancel unshipped items…' : 'Cancel order…'}</Button>}
                {a.refund && <Button onClick={() => setDlg({ k: 'refund' })}>Issue a refund…</Button>}
                {!a.refund && o.status !== 'Cancelled' && o.money.refundableCents > 0 && a.refundLimitCents == null && !o.lines.some((l) => l.shippedQty > 0) && <p className="sub">Refunds open once something has shipped. Before that, cancel the order.</p>}
                {!a.refund && a.refundLimitCents === 0 && <p className="sub">Only an Owner or Admin can refund.</p>}
              </div>
            </section>
          )}
          <Notes order={o} canWrite={canWrite && a.note} onChange={(n) => setO(n)} />
        </aside>
      </div>

      {dlg?.k === 'ship' && <ShipDialog reload={load} order={o} onClose={closeDlg} onDone={(n) => done(n, 'Shipment saved.')} />}
      {dlg?.k === 'hold' && <HoldDialog reload={load} order={o} onClose={closeDlg} onDone={(n) => done(n, 'Order on hold.')} />}
      {dlg?.k === 'cancel' && <CancelDialog reload={load} order={o} onClose={closeDlg} onDone={(n) => done(n, 'Cancelled.')} />}
      {dlg?.k === 'refund' && <RefundDialog reload={load} order={o} returnId={dlg.returnId} onClose={closeDlg} onDone={(n) => done(n, 'Refund issued.')} />}
      {dlg?.k === 'tracking' && <TrackingDialog reload={load} order={o} shipmentId={dlg.id} onClose={closeDlg} onDone={(n) => done(n, 'Tracking updated.')} />}
      {dlg?.k === 'creq' && <CancelRequestDialog reload={load} order={o} request={o.cancellations.find((c) => c.id === dlg.id)!} approve={dlg.approve} onClose={closeDlg} onDone={(n) => done(n, dlg.approve ? 'Order cancelled.' : 'Request declined.')} />}
      {dlg?.k === 'rreject' && <ReturnRejectDialog reload={load} order={o} ret={o.returns.find((r) => r.id === dlg.id)!} onClose={closeDlg} onDone={(n) => done(n, 'Return rejected.')} />}
      {dlg?.k === 'rreceive' && <ReturnReceiveDialog reload={load} order={o} ret={o.returns.find((r) => r.id === dlg.id)!} onClose={closeDlg} onDone={(n) => done(n, 'Return marked as received.')} />}
      {dlg?.k === 'retlabel' && <ReturnLabelDialog order={o} returnId={dlg.id} onClose={closeDlg} onDone={() => { void load() }} />}
      {dlg?.k === 'deliver' && <ConfirmDialog title="Mark as delivered?" confirm="Yes, it was delivered" onClose={closeDlg} body={<p>Only do this if the carrier hasn’t confirmed the delivery yet and you know the parcel arrived.</p>} onConfirm={async () => done(await ordersApi.act(o.id, 'deliver', { version: o.version }), 'Marked as delivered.')} />}
      {dlg?.k === 'slip' && <PackingSlips slips={[dlg.slip]} onClose={closeDlg} />}
    </main>
  )
}

function ActionButton({ run, onError, primary, children }: { run: () => Promise<void>; onError: (m: string, conflict?: boolean) => void; primary?: boolean; children: string }) {
  const [busy, setBusy] = useState(false)
  return <Button variant={primary ? 'primary' : 'secondary'} loading={busy} onClick={async () => { setBusy(true); try { await run() } catch (e) { onError(e instanceof ApiError ? (e.code === 'version_conflict' ? 'This order was changed somewhere else. Reload to see the latest.' : e.message2) : 'Something went wrong.', e instanceof ApiError && e.code === 'version_conflict') } finally { setBusy(false) } }}>{children}</Button>
}

function Notes({ order, canWrite, onChange }: { order: OrderDetail; canWrite: boolean; onChange: (o: OrderDetail) => void }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  return (
    <section className="pcard" aria-labelledby="notes-h">
      <h2 id="notes-h">Internal notes</h2>
      <p className="sub">Only your team sees these.</p>
      <ul className="plain">{order.notes.map((n) => <li key={n.id}><p>{n.text}</p><p className="sub">{n.author} · {dt(n.createdAt)}</p></li>)}</ul>
      {canWrite && (
        <form onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); setErr(''); try { onChange(await ordersApi.act(order.id, 'notes', { text: text.trim() })); setText('') } catch (x) { setErr(x instanceof ApiError ? x.message2 : 'Could not save the note.') } finally { setBusy(false) } }}>
          <AreaField label="Add a note" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} error={err} />
          <Button type="submit" loading={busy} disabled={!text.trim()}>Add note</Button>
        </form>
      )}
    </section>
  )
}

/** Buyer conversation of this order: a link to the full thread plus a quick reply box (templates included). */
function Messages({ order, canWrite }: { order: OrderDetail; canWrite: boolean }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('')
  const [warn, setWarn] = useState(false); const [conv, setConv] = useState(order.conversationId)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  useEffect(() => { if (canWrite) messagesApi.templates().then(setTemplates).catch(() => undefined) }, [canWrite])
  const send = async (ack: boolean) => {
    setBusy(true); setErr(''); setOk('')
    try { const r = await ordersApi.sendMessage(order.id, text.trim(), ack); setConv(r.conversationId); setText(''); setWarn(false); setOk('Message sent.') }
    catch (e) { if (e instanceof ApiError && e.code === 'contact_details_warning') setWarn(true); else setErr(e instanceof ApiError ? e.message2 : 'Could not send.') } finally { setBusy(false) }
  }
  return (
    <section className="pcard" aria-labelledby="msg-h">
      <h2 id="msg-h">Messages with the buyer</h2>
      {conv ? <p><Link to={`/messages/${conv}`}>Open the conversation</Link></p> : <p className="sub">No messages yet.</p>}
      {canWrite && !order.redacted && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(false) }}>
          {templates.length > 0 && <SelectField label="Saved reply" value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setText(t.body) }}><option value="">Insert a saved reply…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</SelectField>}
          <AreaField label="Message to the buyer" rows={3} maxLength={4000} value={text} onChange={(e) => { setText(e.target.value); setWarn(false) }} error={err} hint="Keep the conversation on Solvelt: don't share emails, phone numbers or payment links." />
          {warn && <Alert kind="info">This looks like it shares contact details or a payment link. Sharing them outside Solvelt is against marketplace rules. <Button type="button" onClick={() => void send(true)}>Send anyway</Button></Alert>}
          <div aria-live="polite">{ok && <p className="ok-text">{ok}</p>}</div>
          <Button variant="primary" type="submit" loading={busy} disabled={!text.trim()}>Send message</Button>
        </form>
      )}
    </section>
  )
}
