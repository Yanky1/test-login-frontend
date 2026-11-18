import { useEffect, useId, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { Dialog } from '../components/Dialog'
import { DemoPill } from '../demo/DemoPill'
import { money, toCents, fromCents, dt } from '../orders/format'
import { productsApi } from '../products/api'
import { ProductsFrame } from '../products/ProductsFrame'
import { useCanWrite } from '../products/usePermissions'
import { SelectField, TextField } from '../products/ui'
import type { Category, ListItem } from '../products/types'
import { useBrands } from '../pages/teams/BrandContext'
import { offersApi } from './api'
import { SCOPE_LABEL, STATE_LABEL, STATE_TONE } from './Offers'
import type { OfferDetail, OfferScope, OfferWrite, Preview } from './types'
import './offers.css'
import '../products/products.css'

export const MAX_TIERS = 10, MAX_GIFTS = 5
interface TierRow { min: string; price: string }
interface GiftRow { productId: string; min: string; qty: string }

/** "2026-11-18T10:30" for a datetime-local input, in the browser's time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN)

/** The editor rows as the API body. Input parsing only: no money maths happens here (the preview and the totals come from the server). */
export function toWrite(f: { name: string; status: 'draft' | 'active'; scope: OfferScope; categoryIds: string[]; productIds: string[]; tiers: TierRow[]; gifts: GiftRow[]; from: string; to: string }): OfferWrite {
  return {
    name: f.name.trim(), status: f.status, scope: f.scope, categoryIds: f.scope === 'category' ? f.categoryIds : [], productIds: f.scope === 'products' ? f.productIds : [],
    tiers: f.tiers.filter((t) => t.min.trim() || t.price.trim()).map((t) => ({ minQuantity: int(t.min), unitPriceCents: toCents(t.price) ?? NaN })),
    gifts: f.gifts.filter((g) => g.productId).map((g) => ({ productId: g.productId, minQuantity: int(g.min), quantity: int(g.qty || '1') })),
    activeFrom: fromLocalInput(f.from), activeTo: fromLocalInput(f.to),
  }
}

function problem(e: unknown) { return e instanceof ApiError ? e.message2 : 'Something went wrong. Please try again.' }

export default function OfferEditor() {
  const { id } = useParams(); const isNew = !id || id === 'new'
  const nav = useNavigate()
  const canWrite = useCanWrite()
  const { selected } = useBrands(); const brandId = selected === 'all' ? '' : selected
  const uid = useId()
  const [offer, setOffer] = useState<OfferDetail | null>(null)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<'draft' | 'active'>('active')
  const [scope, setScope] = useState<OfferScope>('products')
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [productIds, setProductIds] = useState<string[]>([])
  const [tiers, setTiers] = useState<TierRow[]>([{ min: '', price: '' }])
  const [gifts, setGifts] = useState<GiftRow[]>([])
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [products, setProducts] = useState<ListItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewNote, setPreviewNote] = useState('')
  const ended = offer?.status === 'ended'
  const readOnly = !canWrite || ended

  useEffect(() => {
    productsApi.list({ pageSize: 100, sort: 'title', dir: 'asc', brandId: offer?.brandId ?? brandId, type: 'product' }).then((r) => setProducts(r.items)).catch(() => undefined)
  }, [brandId, offer?.brandId])
  useEffect(() => { productsApi.categories().then(setCategories).catch(() => undefined) }, [])
  useEffect(() => {
    if (isNew) return
    offersApi.get(id!).then((o) => {
      setOffer(o); setName(o.name); setStatus(o.status === 'draft' ? 'draft' : 'active'); setScope(o.scope); setCategoryIds(o.categoryIds); setProductIds(o.productIds)
      setTiers((o.tiers ?? []).length ? o.tiers!.map((t) => ({ min: String(t.minQuantity), price: fromCents(t.unitPriceCents) })) : [{ min: '', price: '' }])
      setGifts((o.gifts ?? []).map((g) => ({ productId: g.productId, min: String(g.minQuantity), qty: String(g.quantity) })))
      setFrom(toLocalInput(o.activeFrom)); setTo(toLocalInput(o.activeTo))
    }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'This offer was not found.' : problem(e)))
  }, [id, isNew])

  const body = useMemo(() => toWrite({ name, status, scope, categoryIds, productIds, tiers, gifts, from, to }), [name, status, scope, categoryIds, productIds, tiers, gifts, from, to])
  const giftChoices = products.filter((p) => p.status === 'Active' && !p.hasVariants)

  // live preview from the server (debounced): every amount shown is computed there
  useEffect(() => {
    const ready = body.tiers.length > 0 || body.gifts.length > 0
    if (!ready) { setPreview(null); setPreviewNote('Add a price step or a gift to see what buyers pay.'); return }
    if (body.tiers.some((t) => Number.isNaN(t.minQuantity) || Number.isNaN(t.unitPriceCents)) || body.gifts.some((g) => Number.isNaN(g.minQuantity) || Number.isNaN(g.quantity))) {
      setPreviewNote('Fill in each step with a whole number and a price to see the preview.'); return
    }
    const t = setTimeout(() => {
      offersApi.preview({ ...body, brandId: offer?.brandId ?? (brandId || undefined), sampleProductId: body.productIds[0] })
        .then((p) => { setPreview(p); setPreviewNote('') })
        .catch((e) => { setPreview(null); setPreviewNote(e instanceof ApiError && e.status === 400 ? Object.values(e.fieldErrors())[0] ?? e.message2 : 'The preview is not available right now.') })
    }, 350)
    return () => clearTimeout(t)
  }, [body, brandId, offer?.brandId])

  const save = async () => {
    setBusy(true); setErrors({}); setError('')
    try {
      const b: OfferWrite = { ...body, brandId: offer?.brandId ?? (brandId || undefined), version: offer?.version }
      const saved = isNew ? await offersApi.create(b) : await offersApi.update(offer!.id, b)
      nav(`/offers/${saved.id}`, { replace: true, state: { saved: true } })
      setOffer(saved)
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setErrors(e.fieldErrors())
      setError(e instanceof ApiError && e.code === 'version_conflict' ? 'This offer was changed somewhere else. Reload the page to see the latest version.' : problem(e))
    } finally { setBusy(false) }
  }
  const end = async () => {
    setBusy(true)
    try { setOffer(await offersApi.end(offer!.id, offer!.version)); setConfirm(false) } catch (e) { setConfirm(false); setError(problem(e)) } finally { setBusy(false) }
  }
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const title = isNew ? 'New offer' : offer ? offer.name : 'Offer'

  return (
    <ProductsFrame>
      <main className="pwrap" aria-labelledby="page-title">
        <p className="crumb"><Link to="/offers">← All offers</Link></p>
        <div className="of-head">
          <h1 id="page-title" tabIndex={-1}>{title}</h1>
          {offer && <div className="of-acts"><span className={`chip ${STATE_TONE[offer.state]}`}>{STATE_LABEL[offer.state]}</span>{offer.demo && <DemoPill />}<span className="chip">Version {offer.version}</span></div>}
        </div>
        {ended && <Alert kind="info">This offer ended {dt(offer?.endedAt)}. Ended offers can't be changed; create a new offer instead.</Alert>}
        {!canWrite && <Alert kind="info">You can view offers. Ask an Owner, Admin or Manager to change them.</Alert>}
        <Alert>{error}</Alert>
        <form className="of-form" onSubmit={(e) => { e.preventDefault(); void save() }} aria-label="Offer">
          <fieldset disabled={readOnly}>
            <legend>Offer</legend>
            <TextField label="Name" id={`${uid}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={errors.name} hint="Only you see the name; buyers see the prices and gifts." />
            <SelectField label="Status" id={`${uid}-status`} value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'active')} error={errors.status}>
              <option value="active">Active: buyers get it</option><option value="draft">Draft: not offered yet</option>
            </SelectField>
          </fieldset>

          <fieldset disabled={readOnly}>
            <legend>Which products count</legend>
            <div className="of-scope" role="radiogroup" aria-label="Products in the offer">
              {(['products', 'category', 'all'] as const).map((s) => (
                <label key={s}><input type="radio" name={`${uid}-scope`} value={s} checked={scope === s} onChange={() => setScope(s)} /> {SCOPE_LABEL[s]}</label>
              ))}
            </div>
            {scope === 'products' && (
              <>
                <p className="sub" id={`${uid}-ph`}>Units of all chosen products count together, mixing designs.</p>
                {errors.productIds && <p className="field-error" role="alert">{errors.productIds}</p>}
                <ul className="of-pick" aria-describedby={`${uid}-ph`} aria-label="Products">
                  {products.map((p) => <li key={p.id}><label><input type="checkbox" checked={productIds.includes(p.id)} onChange={() => setProductIds((l) => toggle(l, p.id))} /> {p.title}</label></li>)}
                </ul>
              </>
            )}
            {scope === 'category' && (
              <>
                {errors.categoryIds && <p className="field-error" role="alert">{errors.categoryIds}</p>}
                <ul className="of-pick" aria-label="Categories">
                  {categories.filter((c) => c.parentId).map((c) => <li key={c.id}><label><input type="checkbox" checked={categoryIds.includes(c.id)} onChange={() => setCategoryIds((l) => toggle(l, c.id))} /> {c.path || c.name}</label></li>)}
                </ul>
              </>
            )}
            {scope === 'all' && <p className="sub">Every product of this brand counts.</p>}
          </fieldset>

          <fieldset disabled={readOnly}>
            <legend>Price steps</legend>
            <p className="sub">The highest step reached applies to every unit. A step never raises a price: a lower sale price stays.</p>
            {errors.tiers && <p className="field-error" role="alert">{errors.tiers}</p>}
            <table className="of-table">
              <caption className="sr-only">Price steps: minimum quantity and price each</caption>
              <thead><tr><th scope="col">From quantity</th><th scope="col">Price each ($)</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {tiers.map((t, i) => (
                  <tr key={i}>
                    <td><input aria-label={`Step ${i + 1}: from quantity`} inputMode="numeric" value={t.min} onChange={(e) => setTiers((l) => l.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} /></td>
                    <td><input aria-label={`Step ${i + 1}: price each in dollars`} inputMode="decimal" value={t.price} onChange={(e) => setTiers((l) => l.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} /></td>
                    <td><Button type="button" variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => setTiers((l) => l.filter((_, j) => j !== i))}>Remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button type="button" disabled={tiers.length >= MAX_TIERS} onClick={() => setTiers((l) => [...l, { min: '', price: '' }])}>Add price step</Button>
          </fieldset>

          <fieldset disabled={readOnly}>
            <legend>Free gifts</legend>
            <p className="sub">Added once per order at $0 when the order reaches the quantity. You ship them; they come off the gift's stock.</p>
            {errors.gifts && <p className="field-error" role="alert">{errors.gifts}</p>}
            {gifts.length > 0 && (
              <table className="of-table">
                <caption className="sr-only">Free gifts</caption>
                <thead><tr><th scope="col">Gift product</th><th scope="col">From quantity</th><th scope="col">How many</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
                <tbody>
                  {gifts.map((g, i) => (
                    <tr key={i}>
                      <td><select aria-label={`Gift ${i + 1}: product`} value={g.productId} onChange={(e) => setGifts((l) => l.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                        <option value="">Choose a product</option>
                        {giftChoices.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </select></td>
                      <td><input aria-label={`Gift ${i + 1}: from quantity`} inputMode="numeric" value={g.min} onChange={(e) => setGifts((l) => l.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} /></td>
                      <td><input aria-label={`Gift ${i + 1}: how many`} inputMode="numeric" value={g.qty} onChange={(e) => setGifts((l) => l.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                      <td><Button type="button" variant="ghost" aria-label={`Remove gift ${i + 1}`} onClick={() => setGifts((l) => l.filter((_, j) => j !== i))}>Remove</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Button type="button" disabled={gifts.length >= MAX_GIFTS} onClick={() => setGifts((l) => [...l, { productId: '', min: '10', qty: '1' }])}>Add gift</Button>
          </fieldset>

          <fieldset disabled={readOnly}>
            <legend>Dates</legend>
            <div className="of-dates">
              <TextField type="datetime-local" label="Starts" optional id={`${uid}-from`} value={from} onChange={(e) => setFrom(e.target.value)} error={errors.activeFrom} />
              <TextField type="datetime-local" label="Ends" optional id={`${uid}-to`} value={to} onChange={(e) => setTo(e.target.value)} error={errors.activeTo} />
            </div>
          </fieldset>

          <section className="of-preview" aria-labelledby={`${uid}-pv`} aria-live="polite">
            <h2 id={`${uid}-pv`}>What buyers pay</h2>
            {preview && preview.rows.length > 0 ? (
              <>
                <ul data-testid="offer-preview">
                  {preview.rows.map((r) => (
                    <li key={r.quantity}>
                      <strong>{r.quantity} items:</strong> {r.totalCents == null ? 'set a price on the products' : money(r.totalCents)}
                      {r.gifts.map((g) => <span key={g.productId}> + free {g.quantity > 1 ? `${g.quantity} × ` : ''}{g.title}</span>)}
                    </li>
                  ))}
                </ul>
                {preview.sample && <p className="sub">Priced with {preview.sample.title} at {money(preview.sample.unitPriceCents)} each. {preview.eligibleProducts} {preview.eligibleProducts === 1 ? 'product counts' : 'products count'}.</p>}
              </>
            ) : <p className="sub">{previewNote || 'Working out the preview…'}</p>}
          </section>

          {!readOnly && (
            <div className="of-acts">
              <Button type="submit" variant="primary" loading={busy}>{isNew ? 'Create offer' : 'Save changes'}</Button>
              {!isNew && offer && <Button type="button" variant="destructive" disabled={busy} onClick={() => setConfirm(true)}>End offer</Button>}
            </div>
          )}
        </form>

        {offer && offer.versions.length > 0 && (
          <section className="pcard" aria-labelledby={`${uid}-hist`}>
            <h2 id={`${uid}-hist`}>History</h2>
            <p className="sub">Every change makes a new version. Orders keep the version they were priced with.</p>
            <ul>{offer.versions.map((v) => <li key={v.version}>Version {v.version}: {STATE_LABEL[v.status]} · {dt(v.createdAt)}</li>)}</ul>
          </section>
        )}

        {confirm && offer && (
          <Dialog id={`end-${offer.id}`} title="End this offer?" onClose={() => setConfirm(false)}>
            <p>Buyers stop getting “{offer.name}” right away. Orders already placed keep their prices and gifts. An ended offer can't be restarted.</p>
            <div className="dialog-actions">
              <Button variant="destructive" data-autofocus loading={busy} onClick={() => void end()}>End offer</Button>
              <Button onClick={() => setConfirm(false)}>Keep offer</Button>
            </div>
          </Dialog>
        )}
      </main>
    </ProductsFrame>
  )
}
