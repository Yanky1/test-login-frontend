import { useState } from 'react'
import { money, numStr, toNum } from '../lib/format'
import { TextField, Toggle } from '../ui'
import type { SectionProps } from './types'

const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v + ':00Z').toISOString() : null)

export default function Price({ ed }: SectionProps) {
  const { form, set, errors, detail } = ed
  const [sale, setSale] = useState(form.salePrice != null)
  const margin = form.cost != null && form.price ? Math.round(((form.price - form.cost) * 1000) / form.price) / 10 : null
  return (
    <>
      <div className="pgrid2">
        <TextField id="f-price" label={form.hasVariants ? 'Base price (USD)' : 'Price (USD)'} inputMode="decimal" value={numStr(form.price)} error={errors.price}
          onChange={(e) => set({ price: toNum(e.target.value) })} hint={form.hasVariants ? 'Used by every variation that has no price of its own.' : undefined} />
        <TextField id="f-compare" label="List / compare-at price" optional inputMode="decimal" value={numStr(form.compareAtPrice)} error={errors.compareAtPrice}
          onChange={(e) => set({ compareAtPrice: toNum(e.target.value) })} hint="Shown crossed out. Must be higher than your price." />
      </div>
      <Toggle label="Put this product on sale" checked={sale} onChange={(v) => { setSale(v); if (!v) set({ salePrice: null, saleStart: null, saleEnd: null }) }} />
      {sale && (
        <div className="pgrid3 reveal">
          <TextField id="f-sale" label="Sale price (USD)" inputMode="decimal" value={numStr(form.salePrice)} error={errors.salePrice} onChange={(e) => set({ salePrice: toNum(e.target.value) })} />
          <TextField id="f-saleStart" label="Starts" optional type="datetime-local" value={toLocal(form.saleStart)} error={errors.saleStart} onChange={(e) => set({ saleStart: fromLocal(e.target.value) })} />
          <TextField id="f-saleEnd" label="Ends" optional type="datetime-local" value={toLocal(form.saleEnd)} error={errors.saleEnd} onChange={(e) => set({ saleEnd: fromLocal(e.target.value) })} hint="Leave empty for no end date. Times are UTC." />
        </div>
      )}
      {detail.onSale && <p className="hint ok-text">The sale price {money(detail.currentPrice)} is in effect right now.</p>}
      <div className="pgrid2">
        <TextField id="f-sku" label="SKU" optional value={form.sku ?? ''} maxLength={64} error={errors.sku} onChange={(e) => set({ sku: e.target.value || null })} hint="Your own code for this product. Must be unique in your account." />
        {!form.hasVariants && <TextField id="f-quantity" label="Quantity in stock" inputMode="numeric" value={numStr(form.quantity)} error={errors.quantity} onChange={(e) => set({ quantity: toNum(e.target.value) })} />}
      </div>
      <details className="more">
        <summary>More stock and cost options</summary>
        <div className="pgrid3">
          <TextField id="f-lowStock" label="Low-stock alert at" optional inputMode="numeric" value={numStr(form.lowStockAlert)} error={errors.lowStockAlert} onChange={(e) => set({ lowStockAlert: toNum(e.target.value) })} hint="We flag the listing when stock drops to this number." />
          <TextField id="f-maxPer" label="Max per order" optional inputMode="numeric" value={numStr(form.maxPerOrder)} error={errors.maxPerOrder} onChange={(e) => set({ maxPerOrder: toNum(e.target.value) })} />
          <TextField id="f-cost" label="Your cost per item (private)" optional inputMode="decimal" value={numStr(form.cost)} error={errors.cost} onChange={(e) => set({ cost: toNum(e.target.value) })}
            hint={margin != null ? <>Shoppers never see this. Margin at your price: <strong>{margin}%</strong></> : 'Shoppers never see this. Used to show your margin.'} />
        </div>
        <Toggle label="Allow backorders (keep selling at zero stock)" checked={form.allowBackorder} onChange={(v) => set({ allowBackorder: v })} />
      </details>
    </>
  )
}
