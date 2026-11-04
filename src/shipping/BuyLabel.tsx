import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { Link } from 'react-router-dom'
import { money, dt, day } from '../orders/format'
import { ordersApi, type OrderDetail, type PackingSlip } from '../orders/api'
import { PackingSlips } from '../orders/PackingSlips'
import { PIcon, SelectField, TextField } from '../products/ui'
import { downloadLabel, printLabel, shippingApi, type Label, type Quote, type ShippingConfig } from './api'
import { CONTENTS, newKey } from './format'

const CUSTOM = '__custom'
const err = (e: unknown, fallback = 'Something went wrong. Try again.') => (e instanceof ApiError ? e.message2 : fallback)

/** Package picker shared by outbound and return labels. Returns the request body part. */
export function usePackage(cfg: ShippingConfig | null) {
  const [preset, setPreset] = useState(''); const [l, setL] = useState(''); const [w, setW] = useState(''); const [h, setH] = useState(''); const [weight, setWeight] = useState('')
  useEffect(() => { if (cfg && !preset) setPreset(cfg.packages.find((p) => p.isDefault)?.id ?? cfg.packages[0]?.id ?? CUSTOM) }, [cfg, preset])
  const custom = preset === CUSTOM
  const dims = [l, w, h].map((v) => (/^\d+$/.test(v) ? Number(v) : 0))
  const problem = custom && dims.some((d) => d < 1 || d > 2000) ? 'Enter the package length, width and height in millimetres.' : weight !== '' && !(/^\d+$/.test(weight) && Number(weight) >= 1 && Number(weight) <= 70000) ? 'Weight: grams, 1 to 70000.' : ''
  const body = () => ({ presetId: custom ? undefined : preset, lengthMm: custom ? dims[0] : undefined, widthMm: custom ? dims[1] : undefined, heightMm: custom ? dims[2] : undefined, weightGrams: weight === '' ? undefined : Number(weight) })
  const fields = (cfgNow: ShippingConfig, weightError?: string) => (
    <>
      <SelectField label="Package" value={preset} onChange={(e) => setPreset(e.target.value)}>
        {cfgNow.packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.lengthMm}×{p.widthMm}×{p.heightMm} mm){p.isDefault ? ' – default' : ''}</option>)}
        <option value={CUSTOM}>Custom size…</option>
      </SelectField>
      {custom && <div className="pgrid3"><TextField label="Length (mm)" inputMode="numeric" value={l} onChange={(e) => setL(e.target.value)} /><TextField label="Width (mm)" inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} /><TextField label="Height (mm)" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} /></div>}
      <TextField label="Weight of the items (g)" optional inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} error={weightError ?? ''} hint="The box's own weight is added. Leave empty to use the weights saved on your products." />
    </>
  )
  return { body, problem, fields }
}

export function CustomsFields({ value, onChange }: { value: { contents: string; nonDelivery: string; hs: string }; onChange: (v: { contents: string; nonDelivery: string; hs: string }) => void }) {
  return (
    <fieldset className="customs"><legend>Customs information</legend>
      <p className="sub">This parcel crosses a border. The value of each item comes from the order.</p>
      <div className="pgrid3">
        <SelectField label="What is in the parcel?" value={value.contents} onChange={(e) => onChange({ ...value, contents: e.target.value })}>{CONTENTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
        <SelectField label="If it can't be delivered" value={value.nonDelivery} onChange={(e) => onChange({ ...value, nonDelivery: e.target.value })}><option value="return">Send it back to me</option><option value="abandon">Abandon it</option></SelectField>
        <TextField label="HS code" optional value={value.hs} onChange={(e) => onChange({ ...value, hs: e.target.value })} hint="4 to 10 digits. Optional." />
      </div>
    </fieldset>
  )
}

export function LabelActions({ label, order }: { label: Label; order?: OrderDetail }) {
  const [withSlip, setWithSlip] = useState(false); const [slip, setSlip] = useState<PackingSlip | null>(null); const [error, setError] = useState('')
  const print = async () => {
    setError('')
    try { await printLabel(label); if (withSlip && order) setSlip(await ordersApi.packingSlip(order.id)) } catch { setError('Could not open the label. Try Download instead.') }
  }
  return (
    <div className="label-actions">
      <div className="actions">
        <Button type="button" variant="primary" onClick={() => void print()}><PIcon name="download" /> {label.format === 'ZPLII' ? 'Download label for printer' : 'Print label'}</Button>
        {label.format !== 'ZPLII' && <Button type="button" onClick={() => void downloadLabel(label).catch(() => setError('Could not download the label.'))}>Download</Button>}
      </div>
      {order && <div className="field check"><label><input type="checkbox" checked={withSlip} onChange={(e) => setWithSlip(e.target.checked)} /> Print the packing slip together with the label</label></div>}
      <Alert>{error}</Alert>
      {slip && <PackingSlips slips={[slip]} onClose={() => setSlip(null)} />}
    </div>
  )
}

/** The "Buy label" tab of the ship dialog: choose package and ship-from, see live rates, buy once, print. */
export default function BuyLabel({ order, lines, partial, onFinished, reload, onManual, onNoSetup }: {
  order: OrderDetail; lines: { lineId: string; quantity: number }[]; partial: boolean; onFinished: (o: OrderDetail) => void; reload?: () => Promise<void>; onManual: () => void; onNoSetup?: () => void
}) {
  const [cfg, setCfg] = useState<ShippingConfig | null>(null); const [loadErr, setLoadErr] = useState('')
  const [from, setFrom] = useState(''); const pkg = usePackage(cfg)
  const [customs, setCustoms] = useState({ contents: 'merchandise', nonDelivery: 'return', hs: '' })
  const [quote, setQuote] = useState<Quote | null>(null); const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false); const [buying, setBuying] = useState(false); const [error, setError] = useState(''); const [weightErr, setWeightErr] = useState('')
  const [anyway, setAnyway] = useState(false); const [reason, setReason] = useState('')
  const [bought, setBought] = useState<Label | null>(null)
  const key = useRef(newKey())
  useEffect(() => {
    shippingApi.config().then((c) => {
      setCfg(c)
      const usable = c.addresses.filter((a) => a.brandId === null || a.brandId === order.brandId)
      setFrom((usable.find((a) => a.isDefault) ?? usable[0])?.id ?? '')
    }).catch((e) => setLoadErr(err(e, 'Could not load your shipping settings.')))
  }, [order.brandId])
  const noSetup = !!cfg && !cfg.addresses.some((a) => a.brandId === null || a.brandId === order.brandId)
  useEffect(() => { if (noSetup) onNoSetup?.() }, [noSetup, onNoSetup])   // nothing to buy with yet: the dialog falls back to the manual form (with a hint)
  const fromAddr = cfg?.addresses.find((a) => a.id === from)
  const international = !!fromAddr && fromAddr.country.toUpperCase() !== order.shippingAddress.country.toUpperCase()
  const usableAddrs = useMemo(() => (cfg?.addresses ?? []).filter((a) => a.brandId === null || a.brandId === order.brandId), [cfg, order.brandId])
  const reset = () => { setQuote(null); setRate(''); setAnyway(false); setReason(''); key.current = newKey() }

  const getRates = async () => {
    if (pkg.problem) { setError(pkg.problem); return }
    setBusy(true); setError(''); setWeightErr(''); reset()
    try {
      const q = await shippingApi.rates(order.id, { fromAddressId: from || undefined, package: pkg.body(), lines: lines.length ? lines : undefined, customs: international ? { contentsType: customs.contents, nonDeliveryOption: customs.nonDelivery, hsCode: customs.hs.trim() || undefined } : undefined })
      setQuote(q); setRate(q.rates.find((r) => r.recommended)?.rateId ?? q.rates[0]?.rateId ?? '')
    } catch (e) {
      if (e instanceof ApiError && e.code === 'weight_required') setWeightErr(e.message2); else setError(err(e))
    } finally { setBusy(false) }
  }

  const needsReason = !!quote && quote.addressStatus !== 'valid'
  const chosen = quote?.rates.find((r) => r.rateId === rate)
  const buy = async () => {
    if (!quote || !chosen) return
    if (needsReason && (!anyway || reason.trim().length < 5)) { setError('Check the address, or tick "Ship anyway" and say why (at least 5 characters).'); return }
    setBuying(true); setError('')
    try {
      const r = await shippingApi.buy(order.id, { quoteId: quote.quoteId, rateId: chosen.rateId, idempotencyKey: key.current, shipAnyway: needsReason ? { reason: reason.trim() } : undefined })
      setBought(r.label); void reload?.()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'rate_expired') { setError('These rates expired. We are not charging you. Get new rates to continue.'); setQuote(null); setRate('') }
      else if (e instanceof ApiError && e.code === 'address_unverified') setError('The buyer’s address could not be verified. Tick "Ship anyway" and say why, or fix the address first.')
      else if (e instanceof ApiError && e.code === 'spend_limit') setError(`${e.message2}`)
      else setError(err(e))
    } finally { setBuying(false) }
  }

  if (bought) {
    return (
      <div className="label-done" role="status">
        <Alert kind="success">Label bought for {money(bought.costCents, bought.currency)}. The order is marked as shipped{partial ? ' (partial shipment)' : ''}.</Alert>
        <dl className="sum"><div><dt>Carrier</dt><dd>{bought.carrier}{bought.service ? ` · ${bought.service}` : ''}</dd></div><div><dt>Tracking number</dt><dd>{bought.trackingNumber}</dd></div>{bought.estimatedDelivery && <div><dt>Estimated delivery</dt><dd>{day(bought.estimatedDelivery)}</dd></div>}</dl>
        <LabelActions label={bought} order={order} />
        <p className="sub">Changed your mind? You can void an unused label from the order page; the cost is credited back when the carrier confirms.</p>
        <div className="actions dlg-actions"><Button type="button" variant="primary" onClick={() => void ordersApi.get(order.id).then(onFinished)}>Done</Button></div>
      </div>
    )
  }
  if (loadErr) return <Alert>{loadErr}</Alert>
  if (!cfg) return <div aria-busy="true" aria-label="Loading shipping settings"><Skeleton lines={3} /></div>
  if (usableAddrs.length === 0) return (
    <div><Alert kind="info">Add a ship-from address in <Link to="/settings/shipping">Settings → Shipping</Link> to buy labels here. Until then you can <button type="button" className="linklike" onClick={onManual}>enter a tracking number yourself</button>.</Alert></div>
  )

  return (
    <div className="buy-label">
      <div className="pgrid2">
        <SelectField label="Ship from" value={from} onChange={(e) => { setFrom(e.target.value); reset() }}>
          {usableAddrs.map((a) => <option key={a.id} value={a.id}>{a.label || a.name} – {a.line1}, {a.city}{a.isDefault ? ' (default)' : ''}</option>)}
        </SelectField>
        <div className="ship-to"><strong>Ship to</strong><address>{order.shippingAddress.name}<br />{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}<br />{order.shippingAddress.city}{order.shippingAddress.region ? `, ${order.shippingAddress.region}` : ''} {order.shippingAddress.postalCode} · {order.shippingAddress.country}</address></div>
      </div>
      {fromAddr && fromAddr.validation !== 'valid' && <Alert kind="info">This ship-from address isn't verified yet. Labels can still be bought, but check it in Settings → Shipping.</Alert>}
      {pkg.fields(cfg, weightErr)}
      {international && <CustomsFields value={customs} onChange={(v) => { setCustoms(v); reset() }} />}
      <div className="actions"><Button type="button" variant="primary" loading={busy} onClick={() => void getRates()}>{quote ? 'Refresh rates' : 'Get shipping rates'}</Button></div>
      <div aria-live="polite"><Alert>{error}</Alert></div>

      {quote && (
        <>
          {quote.addressStatus !== 'valid' && (
            <div className="alert info address-warn" role="alert">
              <strong>{quote.addressStatus === 'invalid' ? 'We couldn’t find this address.' : 'We couldn’t fully verify this address.'}</strong> {quote.addressMessage}
              <div className="field check"><label><input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} /> Ship anyway</label></div>
              {anyway && <TextField label="Why are you shipping to this address?" value={reason} onChange={(e) => setReason(e.target.value)} hint="For example: the buyer confirmed it by message. This is saved with the label." />}
            </div>
          )}
          <fieldset className="rates"><legend>Choose a shipping service</legend>
            <p className="sub">Deliver by {day(quote.deliverBy)}. Prices are what the carrier charges you; they are taken from your seller balance.</p>
            <ul className="plain">
              {quote.rates.map((r) => (
                <li key={r.rateId} className={r.rateId === rate ? 'on' : ''}>
                  <label>
                    <input type="radio" name="rate" value={r.rateId} checked={r.rateId === rate} onChange={() => setRate(r.rateId)} />
                    <span className="grow"><strong>{r.carrier} {r.service}</strong>
                      <span className="sub"> {r.estimatedDelivery ? `Estimated delivery ${day(r.estimatedDelivery)}` : r.estimatedDays ? `About ${r.estimatedDays} days` : 'Delivery time not given'}{r.meetsDeliverBy ? ' · arrives in time' : ' · after the deliver-by date'}</span></span>
                    {r.recommended && <span className="chip ok">Recommended</span>}
                    <span className="num"><strong>{money(r.amountCents, r.currency)}</strong></span>
                  </label>
                </li>
              ))}
            </ul>
            {!quote.rates.some((r) => r.recommended) && <p className="sub">None of these arrives by the deliver-by date, so none is recommended.</p>}
          </fieldset>
          <p className="sub">{partial ? 'This is a partial shipment. ' : ''}Quote valid until {dt(quote.expiresAt)}.</p>
          <div className="actions dlg-actions">
            <Button type="button" variant="primary" loading={buying} disabled={!chosen || buying} onClick={() => void buy()}>{chosen ? `Buy label · ${money(chosen.amountCents, chosen.currency)}` : 'Buy label'}</Button>
          </div>
        </>
      )}
    </div>
  )
}
