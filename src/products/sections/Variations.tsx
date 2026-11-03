import { useState } from 'react'
import { Button } from '../../components/ui'
import { checkBarcode } from '../lib/barcode'
import { comboKey, MAX_OPTIONS, MAX_VALUES, MAX_VARIANTS, syncVariants, variantCount } from '../lib/variants'
import { numStr, toNum } from '../lib/format'
import { TextField, Toggle } from '../ui'
import { ImageManager } from './Media'
import type { OptionDto, VariantDto } from '../types'
import type { SectionProps } from './types'

const SUGGEST = ['Size', 'Color', 'Material', 'Style']

export default function Variations({ ed }: SectionProps) {
  const { form, set, options, variants, setVariantState, errors } = ed
  const [valueDraft, setValueDraft] = useState<Record<number, string>>({})
  const apply = (o: OptionDto[], v?: VariantDto[]) => setVariantState(o, syncVariants(o, v ?? variants))
  const count = variantCount(options)

  const addValue = (i: number, raw: string) => {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    const have = new Set(options[i].values.map((v) => v.toLowerCase()))
    const vals = [...options[i].values]
    for (const p of parts) if (!have.has(p.toLowerCase()) && vals.length < MAX_VALUES) { vals.push(p); have.add(p.toLowerCase()) }
    apply(options.map((o, j) => (j === i ? { ...o, values: vals } : o)))
    setValueDraft((d) => ({ ...d, [i]: '' }))
  }
  const patchVar = (key: string, p: Partial<VariantDto>) => setVariantState(options, variants.map((v) => (comboKey(v.values) === key ? { ...v, ...p } : v)))
  const bulk = (p: Partial<VariantDto>) => setVariantState(options, variants.map((v) => ({ ...v, ...p })))

  return (
    <>
      <Toggle label="This product comes in different options" checked={form.hasVariants} hint="For example sizes, colours or materials." onChange={(v) => {
        set({ hasVariants: v })
        if (v && options.length === 0) apply([{ name: 'Size', values: [] }], [])
        else if (v) setVariantState(options, variants)
      }} />
      {form.hasVariants && (
        <div className="reveal">
          {options.map((o, i) => (
            <fieldset key={i} className="option">
              <legend>Option {i + 1}</legend>
              <div className="row">
                <TextField id={`f-opt-${i}`} label="Option name" value={o.name} maxLength={40} error={errors[`options[${i}].name`]} onChange={(e) => apply(options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button type="button" className="btn link" onClick={() => apply(options.filter((_, j) => j !== i))}>Remove option<span className="sr-only"> {o.name}</span></button>
              </div>
              <ul className="chips" aria-label={`${o.name || 'Option'} values`}>
                {o.values.map((v) => (
                  <li key={v} className="vchip">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => apply(options.map((x, j) => (j === i ? { ...x, values: x.values.filter((y) => y !== v) } : x)))}>×</button></li>
                ))}
              </ul>
              <TextField id={`f-optv-${i}`} label={`Add ${o.name || 'option'} values`} value={valueDraft[i] ?? ''} placeholder="Type a value and press Enter (or paste a comma list)" error={errors[`options[${i}].values`]}
                onChange={(e) => setValueDraft((d) => ({ ...d, [i]: e.target.value }))} onBlur={(e) => addValue(i, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(i, (e.target as HTMLInputElement).value) } }} />
            </fieldset>
          ))}
          {options.length < MAX_OPTIONS && (
            <div className="suggest">
              <span className="hint">Add an option:</span>
              {SUGGEST.filter((s) => !options.some((o) => o.name.toLowerCase() === s.toLowerCase())).map((s) => <button key={s} type="button" className="btn" onClick={() => apply([...options, { name: s, values: [] }])}>{s}</button>)}
              <button type="button" className="btn" onClick={() => apply([...options, { name: '', values: [] }])}>Custom</button>
            </div>
          )}
          {count > MAX_VARIANTS && <p className="field-error" role="alert">These options make {count} variations; the maximum is {MAX_VARIANTS}. Remove some values.</p>}
          {variants.length > 0 && (
            <>
              <h3>{variants.length} variation{variants.length === 1 ? '' : 's'}</h3>
              <div className="bulkbar">
                <span className="hint">Fill every row:</span>
                <label>Price <input aria-label="Price for all variations" inputMode="decimal" onBlur={(e) => { const n = toNum(e.target.value); if (n != null) bulk({ price: n }) }} /></label>
                <label>Quantity <input aria-label="Quantity for all variations" inputMode="numeric" onBlur={(e) => { const n = toNum(e.target.value); if (n != null) bulk({ quantity: n }) }} /></label>
              </div>
              <div className="tablewrap">
                <table className="vgrid">
                  <caption className="sr-only">Variations: price, SKU, stock, barcode and photo for each combination</caption>
                  <thead><tr><th scope="col">On</th><th scope="col">Variation</th><th scope="col">SKU</th><th scope="col">Price</th><th scope="col">Stock</th><th scope="col">Barcode</th><th scope="col">Photo</th></tr></thead>
                  <tbody>
                    {variants.map((v, idx) => {
                      const key = comboKey(v.values); const label = v.values.join(' / ')
                      const bc = v.barcode ? checkBarcode(v.barcode) : null
                      return (
                        <tr key={key} className={v.enabled ? '' : 'off'}>
                          <td><input type="checkbox" aria-label={`${label} enabled`} checked={v.enabled} onChange={(e) => patchVar(key, { enabled: e.target.checked })} /></td>
                          <th scope="row">{label}</th>
                          <td><input aria-label={`SKU for ${label}`} value={v.sku ?? ''} maxLength={64} aria-invalid={errors[`variants[${idx}].sku`] ? true : undefined} onChange={(e) => patchVar(key, { sku: e.target.value || null })} />
                            <div className="field-error" aria-live="polite">{errors[`variants[${idx}].sku`]}</div></td>
                          <td><input aria-label={`Price for ${label}`} inputMode="decimal" value={numStr(v.price)} placeholder={numStr(form.price)} onChange={(e) => patchVar(key, { price: toNum(e.target.value) })} /></td>
                          <td><input aria-label={`Stock for ${label}`} inputMode="numeric" value={numStr(v.quantity)} onChange={(e) => patchVar(key, { quantity: toNum(e.target.value) ?? 0 })} /></td>
                          <td><input aria-label={`Barcode for ${label}`} inputMode="numeric" value={v.barcode ?? ''} aria-invalid={bc && !bc.valid ? true : undefined} onChange={(e) => patchVar(key, { barcode: e.target.value || null })} />
                            {bc && !bc.valid && <div className="field-error">{bc.error}</div>}</td>
                          <td className="vphoto">{v.id ? <VariantPhoto ed={ed} variantId={v.id} label={label} /> : <span className="hint">Saved soon…</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function VariantPhoto({ ed, variantId, label }: { ed: SectionProps['ed']; variantId: string; label: string }) {
  const [open, setOpen] = useState(false)
  const n = ed.images.filter((i) => i.variantId === variantId).length
  return (
    <>
      <Button variant="ghost" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{n ? `${n} photo${n === 1 ? '' : 's'}` : 'Add photo'}<span className="sr-only"> for {label}</span></Button>
      {open && <div className="vphoto-pop"><ImageManager ed={ed} variantId={variantId} compact /></div>}
    </>
  )
}
