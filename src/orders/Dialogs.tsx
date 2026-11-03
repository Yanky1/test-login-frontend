import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { AreaField, Dialog, PIcon, SelectField, TextField, Toggle } from '../products/ui'
import { ordersApi, type OrderDetail, type ReturnDto, type CancelRequestDto } from './api'
import { fromCents, localDate, money, normalizeTracking, reasonLabel, toCents, trackingValid } from './format'

interface Common { order: OrderDetail; onClose: () => void; onDone: (o: OrderDetail) => void; reload?: () => Promise<void> }

/** Runs one server action: busy flag, plain-language error (never throws), result handed to onDone. A version conflict offers a "Reload order" button that keeps the dialog (and what was typed) open. */
function useRun(onDone: (o: OrderDetail) => void, reload?: () => Promise<void>) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [stale, setStale] = useState(false)
  const run = async (fn: () => Promise<OrderDetail>) => {
    setBusy(true); setError(''); setStale(false)
    try { onDone(await fn()) } catch (e) {
      const conflict = e instanceof ApiError && e.code === 'version_conflict'
      setStale(conflict)
      setError(e instanceof ApiError ? (conflict ? 'This order was changed somewhere else. Reload it to see the latest, then try again.' : Object.values(e.fieldErrors())[0] ?? e.message2) : 'Something went wrong. Try again.')
    } finally { setBusy(false) }
  }
  const errorNode = (
    <>
      <Alert>{error}</Alert>
      {stale && reload && <Button type="button" onClick={async () => { await reload(); setStale(false); setError('') }}>Reload order</Button>}
    </>
  )
  return { busy, error, errorNode, run }
}

function Actions({ children }: { children: ReactNode }) { return <div className="actions dlg-actions">{children}</div> }

// ---- confirm ---------------------------------------------------------------------------------------------------------------
export function ConfirmDialog({ title, body, confirm, destructive, onClose, onConfirm }: { title: string; body: ReactNode; confirm: string; destructive?: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  return (
    <Dialog title={title} onClose={onClose}>
      <div>{body}</div>
      <Alert>{error}</Alert>
      <Actions>
        <Button variant={destructive ? 'destructive' : 'primary'} loading={busy} onClick={async () => { setBusy(true); setError(''); try { await onConfirm() } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Something went wrong.') } finally { setBusy(false) } }}>{confirm}</Button>
        <Button variant="ghost" onClick={onClose}>Keep as it is</Button>
      </Actions>
    </Dialog>
  )
}

// ---- hold ------------------------------------------------------------------------------------------------------------------
export function HoldDialog({ order, onClose, onDone, reload }: Common) {
  const [note, setNote] = useState(''); const { busy, errorNode, run } = useRun(onDone, reload)
  return (
    <Dialog title="Put this order on hold" onClose={onClose}>
      <p>While an order is on hold you can't ship it. Remove the hold to carry on.</p>
      <AreaField label="Why? (only your team sees this)" optional rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      {errorNode}
      <Actions><Button variant="primary" loading={busy} onClick={() => void run(() => ordersApi.act(order.id, 'hold', { note: note.trim() || undefined, version: order.version }))}>Put on hold</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></Actions>
    </Dialog>
  )
}

// ---- ship ------------------------------------------------------------------------------------------------------------------
export function ShipDialog({ order, onClose, onDone, reload }: Common) {
  const open = order.lines.filter((l) => l.unshippedQty > 0)
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.id, String(l.unshippedQty)])))
  const [carrier, setCarrier] = useState(order.reasons.carriers[0] ?? 'UPS')
  const [tracking, setTracking] = useState(''); const [service, setService] = useState('')
  const today = localDate()
  const [date, setDate] = useState(today)
  const [touched, setTouched] = useState(false)
  const { busy, errorNode, run } = useRun(onDone, reload)
  const chosen = open.map((l) => ({ l, n: Number(qty[l.id] ?? 0) })).filter((x) => x.n > 0)
  const qtyErr = (l: (typeof open)[number]) => { const n = Number(qty[l.id]); return !Number.isInteger(n) || n < 0 || n > l.unshippedQty ? `Between 0 and ${l.unshippedQty}` : '' }
  const trackErr = !tracking.trim() ? 'Enter the tracking number.' : !trackingValid(carrier, tracking) ? `That doesn't look like a ${carrier} tracking number.` : ''
  const dateErr = !date ? 'Choose the ship date.' : date > today ? "The ship date can't be in the future." : date < order.placedAt.slice(0, 10) ? "The ship date can't be before the order was placed." : ''
  const lineErr = open.some((l) => qtyErr(l)) ? 'Fix the quantities.' : chosen.length === 0 ? 'Choose at least one item to ship.' : ''
  const partial = chosen.length < open.length || chosen.some((x) => x.n < x.l.unshippedQty)
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTouched(true)
    if (trackErr || dateErr || lineErr) return
    void run(() => ordersApi.act(order.id, 'ship', {
      version: order.version, carrier, service: service.trim() || undefined, trackingNumber: normalizeTracking(tracking),
      shippedAt: date === today ? undefined : new Date(`${date}T12:00:00Z`).toISOString(), lines: chosen.map((x) => ({ lineId: x.l.id, quantity: x.n })),
    }))
  }
  return (
    <Dialog title={`Ship order ${order.number}`} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <fieldset className="ship-items"><legend>What is in this parcel?</legend>
          {open.map((l) => (
            <div key={l.id} className="ship-row">
              <div className="grow"><strong>{l.title}</strong>{l.options && <span className="sub"> · {l.options}</span>}<div className="sub">{l.sku ?? 'No SKU'} · {l.unshippedQty} left to ship</div></div>
              <TextField label={`Quantity of ${l.title}`} type="number" inputMode="numeric" min={0} max={l.unshippedQty} value={qty[l.id] ?? ''} error={qtyErr(l)} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            </div>
          ))}
          {touched && lineErr && <p className="field-error" role="alert">{lineErr}</p>}
        </fieldset>
        {partial && !lineErr && <Alert kind="info">This is a partial shipment. The order stays open until everything has shipped.</Alert>}
        <div className="pgrid2">
          <SelectField label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>{order.reasons.carriers.map((c) => <option key={c}>{c}</option>)}</SelectField>
          <TextField label="Tracking number" value={tracking} autoComplete="off" onChange={(e) => setTracking(e.target.value)} error={tracking || touched ? trackErr : ''} hint="Letters and numbers only. We check the format for your carrier." />
          <TextField label="Service" optional placeholder="e.g. Ground" maxLength={60} value={service} onChange={(e) => setService(e.target.value)} />
          <TextField label="Ship date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} error={touched ? dateErr : ''} />
        </div>
        <p className="sub"><PIcon name="box" /> Buying shipping labels in Solvelt is coming later. For now, buy the label with your carrier and enter the tracking number here.</p>
        {errorNode}
        <Actions><Button variant="primary" type="submit" loading={busy}>{partial ? 'Ship these items' : 'Mark as shipped'}</Button><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button></Actions>
      </form>
    </Dialog>
  )
}

export function TrackingDialog({ order, shipmentId, onClose, onDone, reload }: Common & { shipmentId: string }) {
  const s = order.shipments.find((x) => x.id === shipmentId)!
  const [carrier, setCarrier] = useState(s.carrier); const [tracking, setTracking] = useState(s.trackingNumber); const [touched, setTouched] = useState(false)
  const { busy, errorNode, run } = useRun(onDone, reload)
  const err = !trackingValid(carrier, tracking) ? `That doesn't look like a ${carrier} tracking number.` : ''
  return (
    <Dialog title="Edit tracking" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!err) void run(() => ordersApi.editTracking(order.id, shipmentId, { version: order.version, carrier, trackingNumber: normalizeTracking(tracking) })) }} noValidate>
        <SelectField label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>{order.reasons.carriers.map((c) => <option key={c}>{c}</option>)}</SelectField>
        <TextField label="Tracking number" value={tracking} autoComplete="off" onChange={(e) => setTracking(e.target.value)} error={touched ? err : ''} />
        {errorNode}
        <Actions><Button variant="primary" type="submit" loading={busy}>Save tracking</Button><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button></Actions>
      </form>
    </Dialog>
  )
}

// ---- cancel ----------------------------------------------------------------------------------------------------------------
export function CancelDialog({ order, onClose, onDone, reload }: Common) {
  const remainder = order.actions.cancelRemainder
  const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [restock, setRestock] = useState(true); const [touched, setTouched] = useState(false)
  const { busy, errorNode, run } = useRun(onDone, reload)
  const left = order.lines.reduce((n, l) => n + l.unshippedQty, 0)
  return (
    <Dialog title={remainder ? `Cancel the items that haven't shipped` : `Cancel order ${order.number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setTouched(true); if (reason) void run(() => ordersApi.act(order.id, 'cancel', { version: order.version, reason, note: note.trim() || undefined, restock })) }} noValidate>
        <Alert kind="info">{remainder
          ? `${left} item${left === 1 ? '' : 's'} that haven't shipped will be cancelled and the buyer is refunded for them. What already shipped is not affected.`
          : 'The buyer is told the order was cancelled and gets a full refund from Solvelt. This can’t be undone.'}</Alert>
        <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={touched && !reason ? 'Choose a reason.' : ''}>
          <option value="">Choose a reason</option>{order.reasons.cancel.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
        </SelectField>
        <AreaField label="Note for the buyer" optional rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        <Toggle label="Put the items back in stock" checked={restock} onChange={setRestock} hint="Turn this off if the items are damaged or lost: they are then removed from your stock count." />
        {errorNode}
        <Actions><Button variant="destructive" type="submit" loading={busy}>{remainder ? 'Cancel these items' : 'Cancel order'}</Button><Button variant="ghost" type="button" onClick={onClose}>Keep order</Button></Actions>
      </form>
    </Dialog>
  )
}

export function CancelRequestDialog({ order, request, approve, onClose, onDone, reload }: Common & { request: CancelRequestDto; approve: boolean }) {
  const [note, setNote] = useState(''); const [restock, setRestock] = useState(true); const [touched, setTouched] = useState(false)
  const { busy, errorNode, run } = useRun(onDone, reload)
  return (
    <Dialog title={approve ? 'Approve the cancellation' : 'Decline the cancellation'} onClose={onClose}>
      <p>The buyer asked to cancel: <strong>{reasonLabel(request.reason)}</strong>{request.note ? ` – “${request.note}”` : ''}</p>
      <form onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!approve && !note.trim()) return; void run(() => ordersApi.act(order.id, `cancellation-requests/${request.id}/${approve ? 'approve' : 'reject'}`, { version: order.version, note: note.trim() || undefined, restock })) }} noValidate>
        {approve
          ? <Toggle label="Put the items back in stock" checked={restock} onChange={setRestock} hint="The order is cancelled and the buyer is refunded in full." />
          : <AreaField label="Tell the buyer why" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} error={touched && !note.trim() ? 'Explain why the order can’t be cancelled.' : ''} />}
        {errorNode}
        <Actions><Button variant={approve ? 'destructive' : 'primary'} type="submit" loading={busy}>{approve ? 'Approve and cancel' : 'Decline request'}</Button><Button variant="ghost" type="button" onClick={onClose}>Back</Button></Actions>
      </form>
    </Dialog>
  )
}

// ---- refund ----------------------------------------------------------------------------------------------------------------
export function RefundDialog({ order, returnId, onClose, onDone, reload }: Common & { returnId?: string }) {
  const lines = order.lines.filter((l) => l.shippedQty - l.refundedQty > 0)
  const shippingLeft = Math.max(0, order.money.shippingCents - order.refunds.reduce((n, r) => n + r.shippingCents, 0))
  const ret = returnId ? order.returns.find((r) => r.id === returnId) : undefined
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, ret ? String(ret.lines.find((x) => x.lineId === l.id)?.quantity ?? 0) : '0'])))
  const [ship, setShip] = useState('0.00'); const [reason, setReason] = useState(ret ? 'returned_item' : ''); const [note, setNote] = useState('')
  // A preview only counts for the exact inputs it was computed for (`key`): while the debounced re-preview is pending the old number is stale and never shown or used.
  const [preview, setPreview] = useState<{ key: string; amountCents: number; maxCents: number } | null>(null)
  const [step, setStep] = useState<'form' | 'confirm'>('form'); const [touched, setTouched] = useState(false)
  const [confirmed, setConfirmed] = useState<{ body: object; amountCents: number } | null>(null); const [checking, setChecking] = useState(false); const [checkErr, setCheckErr] = useState('')
  const { busy, errorNode, run } = useRun(onDone, reload)
  const chosen = useMemo(() => lines.map((l) => ({ lineId: l.id, quantity: Number(qty[l.id] ?? 0) })).filter((x) => x.quantity > 0), [lines, qty])
  const shipCents = toCents(ship)
  const qErr = (l: (typeof lines)[number]) => { const n = Number(qty[l.id]); return !Number.isInteger(n) || n < 0 || n > l.shippedQty - l.refundedQty ? `Between 0 and ${l.shippedQty - l.refundedQty}` : '' }
  const shipErr = shipCents == null ? 'Enter an amount like 4.50.' : shipCents > shippingLeft ? `At most ${money(shippingLeft, order.currency)} of shipping can be refunded.` : ''
  const lineErr = lines.some(qErr) ? 'Fix the quantities.' : ''
  const bodyFor = () => ({ version: order.version, reason, note: note.trim() || undefined, lines: chosen, shippingCents: shipCents ?? 0, returnId })
  const valid = !lineErr && !shipErr && (chosen.length > 0 || (shipCents ?? 0) > 0)
  const key = JSON.stringify({ chosen, shipCents })
  const limit = order.actions.refundLimitCents
  useEffect(() => {
    if (!valid) { setPreview(null); return }
    let alive = true
    const t = setTimeout(() => { ordersApi.previewRefund(order.id, bodyFor()).then((p) => { if (alive) setPreview({ key, amountCents: p.amountCents, maxCents: p.maxCents }) }).catch(() => { if (alive) setPreview(null) }) }, 250)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, key, order.id])
  const fresh = preview && preview.key === key ? preview : null
  const total = fresh?.amountCents ?? null
  const overLimit = limit != null && total != null && total > limit
  const review = async () => {
    setTouched(true); setCheckErr('')
    if (!valid || !reason) return
    setChecking(true)
    try {
      const body = bodyFor()
      const p = await ordersApi.previewRefund(order.id, body)            // the confirmation shows what the server computes for exactly this request
      if (limit != null && p.amountCents > limit) { setPreview({ key, amountCents: p.amountCents, maxCents: p.maxCents }); setCheckErr(`Your role can refund up to ${money(limit, order.currency)} at a time. Ask an Owner or Admin for a bigger refund.`); return }
      setConfirmed({ body, amountCents: p.amountCents }); setStep('confirm')
    } catch (e) { setCheckErr(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Could not check the refund. Try again.') } finally { setChecking(false) }
  }
  if (step === 'confirm' && confirmed) {
    return (
      <Dialog title="Refund this amount?" onClose={onClose}>
        <p>You are refunding <strong>{money(confirmed.amountCents, order.currency)}</strong> to the buyer for order {order.number}. Solvelt sends the money back to the buyer. <strong>You can’t undo a refund.</strong></p>
        {errorNode}
        <Actions><Button variant="destructive" loading={busy} onClick={() => void run(() => ordersApi.act(order.id, 'refunds', confirmed.body))}>Yes, refund {money(confirmed.amountCents, order.currency)}</Button><Button variant="ghost" onClick={() => setStep('form')}>Go back</Button></Actions>
      </Dialog>
    )
  }
  return (
    <Dialog title={ret ? 'Refund the returned items' : `Refund order ${order.number}`} onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); void review() }} noValidate>
        <fieldset className="ship-items"><legend>Items to refund</legend>
          {lines.length === 0 && <p>Nothing that shipped is left to refund.</p>}
          {lines.map((l) => (
            <div key={l.id} className="ship-row">
              <div className="grow"><strong>{l.title}</strong>{l.options && <span className="sub"> · {l.options}</span>}<div className="sub">{money(l.unitPriceCents, order.currency)} each · {l.shippedQty - l.refundedQty} can be refunded</div></div>
              <TextField label={`Refund quantity of ${l.title}`} type="number" inputMode="numeric" min={0} max={l.shippedQty - l.refundedQty} value={qty[l.id] ?? ''} error={qErr(l)} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            </div>
          ))}
        </fieldset>
        {order.money.shippingCents > 0 && <TextField label={`Shipping to refund (up to ${money(shippingLeft, order.currency)})`} inputMode="decimal" value={ship} error={shipErr} onChange={(e) => setShip(e.target.value)} />}
        <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={touched && !reason ? 'Choose a reason.' : ''}>
          <option value="">Choose a reason</option>{order.reasons.refund.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
        </SelectField>
        <AreaField label="Note" optional rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="refund-total" aria-live="polite">{total != null ? <>Refund total: <strong>{money(total, order.currency)}</strong> <span className="sub">(the most you can refund on this order is {money(order.money.refundableCents, order.currency)})</span></> : valid ? 'Calculating the total…' : touched ? 'Choose items or shipping to refund.' : 'Choose what to refund to see the total.'}</p>
        {(overLimit || checkErr) && <Alert>{checkErr || `Your role can refund up to ${money(limit, order.currency)} at a time. Ask an Owner or Admin for a bigger refund.`}</Alert>}
        {touched && !valid && !lineErr && !shipErr && <Alert>Choose at least one item or some shipping to refund.</Alert>}
        {errorNode}
        <Actions><Button variant="primary" type="submit" loading={checking} disabled={lines.length === 0 && shippingLeft === 0}>Review refund</Button><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button></Actions>
      </form>
    </Dialog>
  )
}

// ---- returns ---------------------------------------------------------------------------------------------------------------
export function ReturnRejectDialog({ order, ret, onClose, onDone, reload }: Common & { ret: ReturnDto }) {
  const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [touched, setTouched] = useState(false)
  const { busy, errorNode, run } = useRun(onDone, reload)
  return (
    <Dialog title="Reject this return" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setTouched(true); if (reason) void run(() => ordersApi.act(order.id, `returns/${ret.id}/reject`, { version: order.version, reason, note: note.trim() || undefined })) }} noValidate>
        <SelectField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={touched && !reason ? 'Choose a reason.' : ''}>
          <option value="">Choose a reason</option>{order.reasons.rejectReturn.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
        </SelectField>
        <AreaField label="Note for the buyer" optional rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        {errorNode}
        <Actions><Button variant="destructive" type="submit" loading={busy}>Reject return</Button><Button variant="ghost" type="button" onClick={onClose}>Back</Button></Actions>
      </form>
    </Dialog>
  )
}

export function ReturnReceiveDialog({ order, ret, onClose, onDone, reload }: Common & { ret: ReturnDto }) {
  const [restock, setRestock] = useState(true); const { busy, errorNode, run } = useRun(onDone, reload)
  return (
    <Dialog title="Mark the return as received" onClose={onClose}>
      <p>Confirm the returned items arrived. After this you can refund them.</p>
      <Toggle label="Put the returned items back in stock" checked={restock} onChange={setRestock} hint="Turn this off if they can't be resold." />
      {errorNode}
      <Actions><Button variant="primary" loading={busy} onClick={() => void run(() => ordersApi.act(order.id, `returns/${ret.id}/receive`, { version: order.version, restock }))}>Items received</Button><Button variant="ghost" onClick={onClose}>Back</Button></Actions>
    </Dialog>
  )
}

export { fromCents }
