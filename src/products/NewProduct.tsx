import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { productsApi } from './api'
import { CategoryPicker } from './CategoryPicker'
import { ProductsFrame } from './ProductsFrame'
import { SelectField, TextField } from './ui'
import type { Brand } from './types'
import './products.css'

/** Step 1: "What are you selling?" - just a title and a category, then straight to the full editor. */
export default function NewProductPage() {
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [brandId, setBrandId] = useState('')
  const [err, setErr] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { productsApi.brands().then((b) => { setBrands(b); setBrandId((cur) => cur || (b.find((x) => x.isDefault) ?? b[0])?.id || '') }).catch(() => undefined) }, [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setErr({ title: 'Enter what you are selling.' }); return }
    setBusy(true); setErr({}); setMsg('')
    try { const d = await productsApi.create({ title: title.trim(), categoryId, brandId: brands.length > 1 ? brandId : undefined }); nav(`/products/${d.id}`, { replace: true }) }
    catch (x) { if (x instanceof ApiError) { setErr(x.fieldErrors()); if (!Object.keys(x.fieldErrors()).length) setMsg(x.message2) } else setMsg('Something went wrong.'); setBusy(false) }
  }
  return (
    <ProductsFrame>
      <main className="pwrap narrow" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>What are you selling?</h1>
        <p className="lead">Start with a name and a category. You can add photos, price and the rest on the next page - everything saves as a draft automatically.</p>
        <form onSubmit={submit} noValidate className="pcard">
          <TextField id="n-title" label="Product title" value={title} maxLength={200} error={err.title} autoFocus onChange={(e) => setTitle(e.target.value)} hint="Good titles are 60-150 characters: brand + product + key attribute." />
          <CategoryPicker id="n-category" value={categoryId} error={err.categoryId} onChange={(id) => setCategoryId(id)} />
          {brands.length > 1 && <SelectField id="n-brand" label="Brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} error={err.brandId}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</SelectField>}
          <Alert>{msg}</Alert>
          <div className="actions"><Button type="submit" variant="primary" loading={busy}>Continue</Button><Link className="btn link" to="/products">Cancel</Link></div>
        </form>
      </main>
    </ProductsFrame>
  )
}
