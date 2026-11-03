import { Link } from 'react-router-dom'
import { money, numStr, toNum } from '../lib/format'
import { AreaField, PIcon, SelectField, TextField, Toggle } from '../ui'
import type { Faq } from '../types'
import type { SectionProps } from './types'

export function Shipping({ ed }: SectionProps) {
  const { form, set, errors } = ed
  const sh = form.shipping
  const setSh = (p: Partial<typeof sh>) => set({ shipping: { ...sh, ...p } })
  return (
    <>
      <div className="grid2">
        <TextField id="f-weight" label="Package weight (grams)" inputMode="numeric" value={numStr(form.weightGrams)} error={errors.weightGrams} onChange={(e) => set({ weightGrams: toNum(e.target.value) })} hint="Include the packaging." />
        <TextField id="f-handling" label="Handling time (days)" inputMode="numeric" value={numStr(form.handlingDays)} error={errors.handlingDays} onChange={(e) => set({ handlingDays: toNum(e.target.value) })} hint="Days you need to pack and hand over the parcel. 0 = same day." />
      </div>
      <fieldset className="dims">
        <legend>Package size (cm) <span className="opt">(optional)</span></legend>
        <div className="grid3">
          <TextField id="f-length" label="Length" inputMode="decimal" value={numStr(form.lengthCm)} error={errors.lengthCm} onChange={(e) => set({ lengthCm: toNum(e.target.value) })} />
          <TextField id="f-width" label="Width" inputMode="decimal" value={numStr(form.widthCm)} error={errors.widthCm} onChange={(e) => set({ widthCm: toNum(e.target.value) })} />
          <TextField id="f-height" label="Height" inputMode="decimal" value={numStr(form.heightCm)} error={errors.heightCm} onChange={(e) => set({ heightCm: toNum(e.target.value) })} />
        </div>
      </fieldset>
      <fieldset className="shipopts">
        <legend>Shipping options</legend>
        <Toggle label="Standard shipping" checked={sh.standardEnabled} onChange={(v) => setSh({ standardEnabled: v })} />
        {sh.standardEnabled && <TextField id="f-stdPrice" label="Standard price (USD)" inputMode="decimal" value={numStr(sh.standardPrice)} error={errors['shipping.standardPrice']} onChange={(e) => setSh({ standardPrice: toNum(e.target.value) })} hint="0 or empty = free." />}
        <Toggle label="Express shipping" checked={sh.expressEnabled} onChange={(v) => setSh({ expressEnabled: v })} />
        {sh.expressEnabled && <TextField id="f-expPrice" label="Express price (USD)" inputMode="decimal" value={numStr(sh.expressPrice)} error={errors['shipping.expressPrice']} onChange={(e) => setSh({ expressPrice: toNum(e.target.value) })} />}
        <TextField id="f-freeOver" label="Free shipping on orders over (USD)" optional inputMode="decimal" value={numStr(sh.freeOver)} error={errors['shipping.freeOver']} onChange={(e) => setSh({ freeOver: toNum(e.target.value) })} hint={sh.freeOver ? `Orders of ${money(sh.freeOver)} or more ship free.` : undefined} />
        <Toggle label="Local pickup available" checked={form.localPickup} onChange={(v) => set({ localPickup: v })} />
      </fieldset>
    </>
  )
}

export function Policies({ ed }: SectionProps) {
  const { form, set, errors } = ed
  return (
    <>
      <SelectField id="f-returns" label="Returns window" value={form.returnsDays == null ? '' : String(form.returnsDays)} error={errors.returnsDays} onChange={(e) => set({ returnsDays: e.target.value === '' ? null : Number(e.target.value) })}>
        <option value="">Not set</option><option value="0">No returns</option>{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
      </SelectField>
      {(form.returnsDays ?? 0) > 0 && <AreaField id="f-returnsCond" label="Return conditions" optional rows={2} maxLength={300} value={form.returnsCondition ?? ''} error={errors.returnsCondition} onChange={(e) => set({ returnsCondition: e.target.value || null })} hint='For example "Unused and in original packaging."' />}
      <div className="grid2">
        <TextField id="f-warranty" label="Warranty (months)" optional inputMode="numeric" value={numStr(form.warrantyMonths)} error={errors.warrantyMonths} onChange={(e) => set({ warrantyMonths: toNum(e.target.value) })} />
        <TextField id="f-warrantyNote" label="Warranty details" optional maxLength={300} value={form.warrantyNote ?? ''} error={errors.warrantyNote} onChange={(e) => set({ warrantyNote: e.target.value || null })} />
      </div>
    </>
  )
}

export function Seo({ ed }: SectionProps) {
  const { form, set, errors } = ed
  return (
    <details className="more adv" open={Boolean(form.searchTerms || form.handle || form.metaTitle || form.metaDescription) || undefined}>
      <summary>Advanced: keywords and SEO</summary>
      <TextField id="f-searchTerms" label="Search terms" optional maxLength={250} value={form.searchTerms ?? ''} error={errors.searchTerms} onChange={(e) => set({ searchTerms: e.target.value || null })} hint="Backend keywords shoppers might type that aren't in your title. Never shown on the page." />
      <TextField id="f-handle" label="URL handle" optional maxLength={100} value={form.handle ?? ''} error={errors.handle} onChange={(e) => set({ handle: e.target.value || null })} hint="Lowercase letters, numbers and hyphens. Generated from the title when you publish if left empty." />
      <TextField id="f-metaTitle" label="Page title for search engines" optional maxLength={70} value={form.metaTitle ?? ''} error={errors.metaTitle} onChange={(e) => set({ metaTitle: e.target.value || null })} hint={`${(form.metaTitle ?? '').length}/70`} />
      <AreaField id="f-metaDesc" label="Page description for search engines" optional rows={2} maxLength={160} value={form.metaDescription ?? ''} error={errors.metaDescription} onChange={(e) => set({ metaDescription: e.target.value || null })} hint={`${(form.metaDescription ?? '').length}/160`} />
    </details>
  )
}

export function Faqs({ ed }: SectionProps) {
  const { faqs, setFaqs } = ed
  const upd = (i: number, p: Partial<Faq>) => setFaqs(faqs.map((f, j) => (j === i ? { ...f, ...p } : f)))
  const move = (i: number, d: -1 | 1) => { const n = [...faqs]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setFaqs(n) }
  return (
    <>
      <p className="hint">Answer the questions shoppers ask most - sizing, compatibility, care. These appear on your listing. Customer questions you receive are in the <Link to="/questions">Questions inbox</Link>.</p>
      <ol className="faqs">
        {faqs.map((f, i) => (
          <li key={f.id ?? i}>
            <div className="faq-head"><strong>Question {i + 1}</strong>
              <span>
                <button type="button" className="btn link" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><PIcon name="up" /></button>
                <button type="button" className="btn link" aria-label={`Move question ${i + 1} down`} disabled={i === faqs.length - 1} onClick={() => move(i, 1)}><PIcon name="down" /></button>
                <button type="button" className="btn link danger-text" aria-label={`Delete question ${i + 1}`} onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}><PIcon name="trash" /></button>
              </span></div>
            <TextField label="Question" value={f.question} maxLength={200} onChange={(e) => upd(i, { question: e.target.value })} />
            <AreaField label="Answer" rows={2} maxLength={1000} value={f.answer} onChange={(e) => upd(i, { answer: e.target.value })} />
          </li>
        ))}
      </ol>
      {faqs.length < 20 && <button type="button" className="btn" onClick={() => setFaqs([...faqs, { question: '', answer: '' }])}><PIcon name="plus" /> Add a question</button>}
    </>
  )
}
