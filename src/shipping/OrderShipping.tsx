import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { Dialog, SelectField, TextField } from '../products/ui'
import { dt, money } from '../orders/format'
import { ConfirmDialog } from '../orders/Dialogs'
import type { OrderDetail } from '../orders/api'
import { CustomsFields, LabelActions, usePackage } from './BuyLabel'
import { errDetail, shippingApi, type Label, type OrderTracking, type ShippingConfig, type TrackEvent } from './api'
import { LABEL_STATUS, newKey, trackLabel, trackTone } from './format'

const err = (e: unknown, fallback = 'Something went wrong. Try again.') => (e instanceof ApiError ? e.message2 : fallback)

function Timeline({ events, label }: { events: TrackEvent[]; label: string }) {
  if (events.length === 0) return <p className="sub">No updates from the carrier yet. They will appear here as soon as the parcel is scanned.</p>
  return (
    <ol className="timeline track-tl" aria-label={label}>
      {[...events].reverse().map((e, i) => (
        <li key={`${e.at}-${e.status}-${i}`}><span className={`t-dot ${trackTone(e.status)}`} aria-hidden="true" />
          <div><strong>{e.label || trackLabel(e.status)}</strong>{e.detail && e.detail !== e.status && <span className="sub"> – {e.detail}</span>}<div className="sub">{dt(e.at)}{e.location ? ` · ${e.location}` : ''}</div></div></li>
      ))}
    </ol>
  )
}

/** Shipping & tracking of one order: the problem banner, each shipment's tracking timeline, the labels (print, download, void) and return parcels. */
export function OrderShippingPanel({ order, canWrite, onChanged }: { order: OrderDetail; canWrite: boolean; onChanged: () => Promise<void> }) {
  const [t, setT] = useState<OrderTracking | null>(null); const [error, setError] = useState(''); const [flash, setFlash] = useState('')
  const [voiding, setVoiding] = useState<Label | null>(null)
  const load = useCallback(async () => { try { setT(await shippingApi.tracking(order.id)); setError('') } catch (e) { setError(err(e, 'Could not load the tracking.')) } }, [order.id])
  useEffect(() => { void load() }, [load, order.version, order.shipments.length, order.returnShipments?.length])
  if (!t) return <section className="pcard" aria-labelledby="trk-h"><h2 id="trk-h">Tracking and labels</h2><Alert>{error}</Alert><div aria-busy="true" aria-label="Loading tracking"><Skeleton lines={3} /></div></section>
  const labels = t.labels.filter((l) => l.status !== 'failed')
  const labelOf = (id: string | null) => labels.find((l) => l.id === id)
  return (
    <section className="pcard" aria-labelledby="trk-h">
      <h2 id="trk-h">Tracking and labels</h2>
      <div aria-live="polite">{flash && <Alert kind="success">{flash}</Alert>}</div>
      <Alert>{error}</Alert>
      {t.needsAttention && (
        <div className="alert attn" role="alert">
          <strong>This order needs attention.</strong> {t.attentionReason ?? 'The carrier reported a delivery problem.'}
          {canWrite && <div className="actions"><Button type="button" onClick={async () => { try { await shippingApi.dismiss(order.id); setFlash('Marked as handled.'); await load(); await onChanged() } catch (e) { setError(err(e)) } }}>Mark as handled</Button></div>}
        </div>
      )}
      {t.shipments.length === 0 && t.returns.length === 0 && <p className="sub">Nothing has shipped yet.</p>}
      {t.shipments.map((s) => {
        const l = labelOf(s.labelId)
        return (
          <article key={s.id} className="trk" aria-label={`Shipment ${s.trackingNumber}`}>
            <div className="trk-head">
              <div className="grow"><strong>{s.carrier}{s.service ? ` · ${s.service}` : ''}</strong>
                <div>{s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">{s.trackingNumber}<span className="sr-only"> (opens the carrier’s site)</span></a> : s.trackingNumber}</div></div>
              <span className={`chip ${trackTone(s.status)}`}>{s.statusLabel}</span>
            </div>
            {s.eta && !s.deliveredAt && <p className="sub">Estimated delivery {dt(s.eta)}</p>}
            {s.live && !s.deliveredAt && <p className="sub">Updates arrive automatically.</p>}
            <Timeline events={s.events} label={`Tracking history of ${s.trackingNumber}`} />
            {l && <LabelRow label={l} order={order} canWrite={canWrite} onVoid={() => setVoiding(l)} />}
          </article>
        )
      })}
      {labels.filter((l) => l.kind === 'outbound' && !t.shipments.some((s) => s.labelId === l.id)).map((l) => <LabelRow key={l.id} label={l} order={order} canWrite={canWrite} onVoid={() => setVoiding(l)} />)}
      {t.returns.map((r) => {
        const l = labelOf(r.labelId)
        return (
          <article key={r.id} className="trk return" aria-label={`Return parcel ${r.trackingNumber}`}>
            <div className="trk-head"><div className="grow"><strong>Return parcel · {r.carrier}{r.service ? ` · ${r.service}` : ''}</strong><div>{r.trackingNumber}</div></div><span className={`chip ${trackTone(r.status)}`}>{r.statusLabel}</span></div>
            {r.deliveredAt && <Alert kind="success">Return arrived – inspect the items and mark the return received below.</Alert>}
            <Timeline events={r.events} label={`Tracking history of return ${r.trackingNumber}`} />
            {l && <LabelRow label={l} order={order} canWrite={canWrite} onVoid={() => setVoiding(l)} />}
          </article>
        )
      })}
      {voiding && (
        <ConfirmDialog title="Void this label?" confirm="Yes, void the label" onClose={() => setVoiding(null)}
          body={<><p>We ask {voiding.carrier} to refund the label ({money(voiding.costCents, voiding.currency)}). The money is credited back to your seller balance only when the carrier confirms the refund.</p>{voiding.kind === 'outbound' && <p>The order goes back to “ready to ship” so you can buy a new label.</p>}<p>You can only void a label the carrier has not scanned yet.</p></>}
          onConfirm={async () => { const r = await shippingApi.voidLabel(voiding.id); setVoiding(null); setFlash(r.pending ? 'Refund requested. We credit your balance when the carrier confirms.' : 'Label voided and refunded.'); await load(); await onChanged() }} />
      )}
    </section>
  )
}

function LabelRow({ label, order, canWrite, onVoid }: { label: Label; order: OrderDetail; canWrite: boolean; onVoid: () => void }) {
  return (
    <div className="label-row">
      <div className="grow">
        <strong>{label.kind === 'return' ? 'Return label' : 'Shipping label'}</strong> <span className={`chip ${label.status === 'active' ? '' : label.status === 'refundfailed' ? 'bad' : 'warn'}`}>{LABEL_STATUS[label.status] ?? label.status}</span>
        <div className="sub">{label.carrier}{label.service ? ` · ${label.service}` : ''} · {money(label.costCents, label.currency)}{label.purchasedAt ? ` · bought ${dt(label.purchasedAt)}` : ''}</div>
        {label.status === 'voiding' && <div className="sub">Refund requested. We credit your balance when the carrier confirms.</div>}
        {label.status === 'refundfailed' && <div className="sub">The carrier refused the refund (the label may already be in use). Contact support if this looks wrong.</div>}
        {label.status === 'voided' && <div className="sub">Refunded to your seller balance.</div>}
      </div>
      {label.hasFile && label.status !== 'voided' && <LabelActions label={label} order={label.kind === 'outbound' ? order : undefined} />}
      {canWrite && label.canVoid && <Button type="button" variant="ghost" onClick={onVoid}>Void label<span className="sr-only"> {label.trackingNumber}</span></Button>}
    </div>
  )
}

// ---- prepaid return label ----------------------------------------------------------------------------------------------------------
export function ReturnLabelDialog({ order, returnId, onClose, onDone }: { order: OrderDetail; returnId: string; onClose: () => void; onDone: () => void }) {
  const [cfg, setCfg] = useState<ShippingConfig | null>(null); const pkg = usePackage(cfg)
  const [needCustoms, setNeedCustoms] = useState(false); const [customs, setCustoms] = useState({ contents: 'returned_goods', nonDelivery: 'return', hs: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState<Label | null>(null)
  const key = useState(newKey)[0]
  useEffect(() => { shippingApi.config().then(setCfg).catch((e) => setError(err(e, 'Could not load your shipping settings.'))) }, [])
  const submit = async () => {
    if (pkg.problem) { setError(pkg.problem); return }
    setBusy(true); setError('')
    try {
      const r = await shippingApi.returnLabel(order.id, returnId, { package: pkg.body(), customs: needCustoms ? { contentsType: customs.contents, nonDeliveryOption: customs.nonDelivery, hsCode: customs.hs.trim() || undefined } : undefined, idempotencyKey: key })
      setDone(r.label); onDone()
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'customs_required' || errDetail(e).customsRequired)) { setNeedCustoms(true); setError('This return crosses a border. Fill in the customs information and try again.') }
      else setError(err(e))
    } finally { setBusy(false) }
  }
  return (
    <Dialog title="Send a prepaid return label" onClose={onClose} wide>
      {done ? (
        <div role="status">
          <Alert kind="success">Return label bought for {money(done.costCents, done.currency)}. Solvelt emails it to the buyer.</Alert>
          <dl className="sum"><div><dt>Carrier</dt><dd>{done.carrier}{done.service ? ` · ${done.service}` : ''}</dd></div><div><dt>Tracking number</dt><dd>{done.trackingNumber}</dd></div></dl>
          <LabelActions label={done} />
          <div className="actions dlg-actions"><Button type="button" variant="primary" onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <>
          <p>We buy a label from the buyer’s address to your return address and send it to the buyer. <strong>You pay for this label</strong>; it is taken from your seller balance like any other label.</p>
          {cfg && pkg.fields(cfg)}
          {needCustoms && <CustomsFields value={customs} onChange={setCustoms} />}
          <div aria-live="polite"><Alert>{error}</Alert></div>
          <div className="actions dlg-actions"><Button type="button" variant="primary" loading={busy} disabled={!cfg} onClick={() => void submit()}>Buy and send the return label</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
        </>
      )}
    </Dialog>
  )
}

// ---- bulk ------------------------------------------------------------------------------------------------------------------------------
export function BulkLabelsDialog({ orderIds, onClose, onDone }: { orderIds: string[]; onClose: () => void; onDone: (bought: number) => void }) {
  const [cfg, setCfg] = useState<ShippingConfig | null>(null); const [preset, setPreset] = useState(''); const [weight, setWeight] = useState(''); const [strategy, setStrategy] = useState<'recommended' | 'cheapest'>('recommended')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [res, setRes] = useState<{ results: { orderId: string; number?: string; ok: boolean; message: string }[]; bought: number; total: number } | null>(null)
  const key = useState(newKey)[0]
  useEffect(() => { shippingApi.config().then((c) => { setCfg(c); setPreset(c.packages.find((p) => p.isDefault)?.id ?? c.packages[0]?.id ?? '') }).catch((e) => setError(err(e, 'Could not load your shipping settings.'))) }, [])
  const run = async () => {
    if (weight !== '' && !(/^\d+$/.test(weight) && Number(weight) >= 1 && Number(weight) <= 70000)) { setError('Weight: grams, 1 to 70000.'); return }
    setBusy(true); setError('')
    try { setRes(await shippingApi.bulk({ orderIds, packageId: preset || undefined, weightGrams: weight === '' ? undefined : Number(weight), strategy, idempotencyKey: key })) } catch (e) { setError(err(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog title={`Buy labels for ${orderIds.length} order${orderIds.length === 1 ? '' : 's'}`} onClose={() => { if (res) onDone(res.bought); onClose() }} wide>
      {res ? (
        <div role="status">
          <Alert kind={res.bought === res.total ? 'success' : 'info'}>{res.bought} of {res.total} label{res.total === 1 ? '' : 's'} bought.</Alert>
          <ul className="plain bulk-res">{res.results.map((r) => <li key={r.orderId}><span className={`chip ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? 'Bought' : 'Not bought'}</span> <strong>{r.number ?? 'Order'}</strong>{!r.ok && <span className="sub"> – {r.message}</span>}</li>)}</ul>
          <p className="sub">Open each order to print its label. Orders that were not bought stay as they were.</p>
          <div className="actions dlg-actions"><Button type="button" variant="primary" onClick={() => { onDone(res.bought); onClose() }}>Done</Button></div>
        </div>
      ) : (
        <>
          <p>We use your default ship-from address and buy the same package for every selected order. Orders with an unverified address or an international destination are skipped; ship those one by one.</p>
          {cfg && cfg.packages.length === 0 && <Alert kind="info">Add a package preset in Settings → Shipping first.</Alert>}
          {cfg && (
            <div className="pgrid2">
              <SelectField label="Package" value={preset} onChange={(e) => setPreset(e.target.value)}>{cfg.packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.lengthMm}×{p.widthMm}×{p.heightMm} mm){p.isDefault ? ' – default' : ''}</option>)}</SelectField>
              <SelectField label="Which rate?" value={strategy} onChange={(e) => setStrategy(e.target.value as 'recommended' | 'cheapest')}><option value="recommended">Recommended (cheapest that arrives in time)</option><option value="cheapest">Cheapest</option></SelectField>
              <TextField label="Weight of the items in each parcel (g)" optional inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} hint="Leave empty to use the weights saved on your products." />
            </div>
          )}
          <div aria-live="polite"><Alert>{error}</Alert></div>
          <div className="actions dlg-actions"><Button type="button" variant="primary" loading={busy} disabled={!cfg || !preset} onClick={() => void run()}>Buy {orderIds.length} label{orderIds.length === 1 ? '' : 's'}</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
        </>
      )}
    </Dialog>
  )
}
