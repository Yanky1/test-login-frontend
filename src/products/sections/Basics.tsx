import { useEffect, useState } from 'react'
import { productsApi } from '../api'
import { CategoryPicker } from '../CategoryPicker'
import { AreaField, SelectField, TextField } from '../ui'
import type { Brand } from '../types'
import type { SectionProps } from './types'

export default function Basics({ ed }: SectionProps) {
  const { form, set, errors } = ed
  const [brands, setBrands] = useState<Brand[]>([])
  useEffect(() => { productsApi.brands().then(setBrands).catch(() => undefined) }, [])
  const len = form.title.trim().length
  return (
    <>
      <TextField id="f-title" label="Title" value={form.title} maxLength={200} error={errors.title} onChange={(e) => set({ title: e.target.value })}
        hint={<>Good titles are 60-150 characters: brand + product + key attribute. <span className={len >= 60 && len <= 150 ? 'ok-text' : ''}>{len}/200</span></>} />
      {brands.length > 1 ? (
        <SelectField id="f-brand" label="Brand" value={form.brandId} error={errors.brandId} onChange={(e) => set({ brandId: e.target.value })} hint="The brand this listing is sold under.">
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
      ) : <p className="hint brand-line">Brand: <strong>{brands[0]?.name ?? ed.detail.brandName ?? '-'}</strong></p>}
      <CategoryPicker id="f-category" value={form.categoryId} error={errors.categoryId} onChange={(id) => void ed.changeCategory(id)} />
      <SelectField id="f-condition" label="Condition" value={form.condition} onChange={(e) => set({ condition: e.target.value as 'New' | 'Used' | 'Refurbished' })} error={errors.condition}>
        <option>New</option><option>Used</option><option>Refurbished</option>
      </SelectField>
      {form.condition !== 'New' && (
        <AreaField id="f-conditionNote" label="Condition notes" rows={3} maxLength={300} value={form.conditionNote ?? ''} error={errors.conditionNote}
          onChange={(e) => set({ conditionNote: e.target.value })} hint="Be specific: wear, missing parts, what was refurbished. Honest notes mean fewer returns." />
      )}
    </>
  )
}
