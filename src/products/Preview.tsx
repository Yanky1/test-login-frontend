import { useMemo, useState } from 'react'
import { AuthImage } from './AuthImage'
import { Markdown } from './lib/markdown'
import { comboKey } from './lib/variants'
import { money } from './lib/format'
import type { EditorApi } from './useProductEditor'

/** "Preview as buyer": a plain rendering of the listing as a shopper would see it, built from the live (unsaved) form state. */
export function BuyerPreview({ ed }: { ed: EditorApi }) {
  const { form, options, variants, faqs, attrConfig, detail } = ed
  const [pick, setPick] = useState<Record<number, string>>({})
  const [shot, setShot] = useState(0)
  const enabled = variants.filter((v) => v.enabled)
  const chosen = useMemo(() => (form.hasVariants && options.length && options.every((_, i) => pick[i]) ? enabled.find((v) => comboKey(v.values) === comboKey(options.map((_, i) => pick[i]))) : undefined), [form.hasVariants, options, pick, enabled])
  const variantImgs = chosen?.id ? ed.images.filter((i) => i.variantId === chosen.id) : []
  const imgs = variantImgs.length ? variantImgs : ed.images.filter((i) => !i.variantId)
  const base = chosen?.price ?? form.price
  const sale = form.salePrice != null && (base === form.price) ? form.salePrice : null
  const cur = detail.onSale && sale != null ? sale : base
  const list = form.compareAtPrice && cur != null && form.compareAtPrice > cur ? form.compareAtPrice : sale != null && base != null && !detail.onSale ? null : null
  const stock = chosen ? chosen.quantity : form.hasVariants ? enabled.reduce((s, v) => s + v.quantity, 0) : (form.quantity ?? 0)
  const inStock = stock > 0 || form.allowBackorder
  const details = attrConfig.filter((a) => { const v = form.attributes[a.key]; return v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) })
  const shown = imgs[Math.min(shot, Math.max(imgs.length - 1, 0))]
  const sh = form.shipping
  return (
    <article className="buyer" aria-label="Buyer preview">
      <div className="b-gallery">
        {shown ? <AuthImage src={shown.url} alt={shown.alt || form.title || 'Product photo'} className="b-main" /> : <div className="b-main img-ph" role="img" aria-label="No photo yet" />}
        {imgs.length > 1 && <ul className="b-thumbs" aria-label="Photos">{imgs.map((im, i) => <li key={im.id}><button type="button" aria-label={`Show photo ${i + 1}`} aria-current={i === shot} onClick={() => setShot(i)}><AuthImage src={im.url} alt="" className="b-thumb" /></button></li>)}</ul>}
      </div>
      <div className="b-info">
        <p className="b-brand">{detail.brandName ?? ''}</p>
        <h3 className="b-title">{form.title || 'Your product title'}</h3>
        <p className="b-price" aria-label="Price">
          <strong>{cur != null ? money(cur) : 'No price yet'}</strong>
          {list != null && <s className="b-was">{money(list)}</s>}
          {detail.onSale && <span className="chip warn">Sale</span>}
        </p>
        {form.condition !== 'New' && <p className="b-cond"><strong>{form.condition}</strong>{form.conditionNote ? ` - ${form.conditionNote}` : ''}</p>}
        {form.hasVariants && options.map((o, i) => (
          <div className="field" key={i}>
            <label htmlFor={`pv-${i}`}>{o.name || `Option ${i + 1}`}</label>
            <select id={`pv-${i}`} value={pick[i] ?? ''} onChange={(e) => { setPick({ ...pick, [i]: e.target.value }); setShot(0) }}>
              <option value="">Choose…</option>{o.values.map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
        ))}
        <p className={inStock ? 'ok-text' : 'field-error'}>{inStock ? (form.allowBackorder && stock <= 0 ? 'Available on backorder' : 'In stock') : 'Out of stock'}</p>
        <button type="button" className="btn primary" disabled>Add to cart</button>
        {form.bullets.filter(Boolean).length > 0 && <ul className="b-bullets">{form.bullets.filter(Boolean).map((b, i) => <li key={i}>{b}</li>)}</ul>}
        <p className="b-ship">{sh.standardEnabled ? `Standard shipping ${sh.standardPrice ? money(sh.standardPrice) : 'free'}` : ''}{sh.expressEnabled ? ` · Express ${money(sh.expressPrice)}` : ''}{sh.freeOver ? ` · Free over ${money(sh.freeOver)}` : ''}{form.localPickup ? ' · Local pickup' : ''}{form.handlingDays != null ? ` · Ships in ${form.handlingDays} day${form.handlingDays === 1 ? '' : 's'}` : ''}</p>
        {form.returnsDays != null && <p className="b-ship">{form.returnsDays > 0 ? `${form.returnsDays}-day returns` : 'No returns'}{form.warrantyMonths ? ` · ${form.warrantyMonths}-month warranty` : ''}</p>}
      </div>
      {form.description?.trim() && <section className="b-sec"><h4>About this item</h4><Markdown source={form.description} /></section>}
      {details.length > 0 && (
        <section className="b-sec"><h4>Product details</h4>
          <table className="b-table"><tbody>{details.map((a) => { const v = form.attributes[a.key]; return <tr key={a.key}><th scope="row">{a.label}</th><td>{Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : `${v}${a.unit ? ` ${a.unit}` : ''}`}</td></tr> })}
            {form.weightGrams ? <tr><th scope="row">Weight</th><td>{form.weightGrams} g</td></tr> : null}</tbody></table>
        </section>
      )}
      {faqs.filter((f) => f.question && f.answer).length > 0 && (
        <section className="b-sec"><h4>Questions &amp; answers</h4>
          <dl>{faqs.filter((f) => f.question && f.answer).map((f, i) => <div key={i}><dt>{f.question}</dt><dd>{f.answer}</dd></div>)}</dl>
        </section>
      )}
    </article>
  )
}
