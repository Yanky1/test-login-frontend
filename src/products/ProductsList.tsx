import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { productsApi } from './api'
import { AuthImage } from './AuthImage'
import { money, numStr, toNum } from './lib/format'
import { ProductsFrame } from './ProductsFrame'
import { useBrands } from '../pages/teams/BrandContext'
import { useCanWrite } from './usePermissions'
import { PIcon, QualityBadge, SelectField, StatusChip } from './ui'
import type { ListItem, ListResult } from './types'
import './products.css'

const TABS = [
  { id: '', label: 'All', key: 'all' }, { id: 'Draft', label: 'Drafts', key: 'draft' }, { id: 'Active', label: 'Active', key: 'active' }, { id: 'Inactive', label: 'Inactive', key: 'inactive' },
  { id: 'Archived', label: 'Archived', key: 'archived' }, { id: 'outofstock', label: 'Out of stock', key: 'outOfStock' }, { id: 'attention', label: 'Needs attention', key: 'attention' },
] as const

function QuickEdit({ item, field, onSaved, onError, readOnly }: { readOnly?: boolean; item: ListItem; field: 'price' | 'quantity'; onSaved: (i: Partial<ListItem> & { id: string }) => void; onError: (m: string) => void }) {
  const [val, setVal] = useState(numStr(field === 'price' ? item.price : item.quantity))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setVal(numStr(field === 'price' ? item.price : item.quantity)) }, [item.price, item.quantity, field])
  if (field === 'quantity' && item.hasVariants) return <span title="Edit stock per variation">{item.quantity}</span>
  const commit = async () => {
    const n = toNum(val); const cur = field === 'price' ? item.price : item.quantity
    if (n == null || n === cur) { setVal(numStr(cur)); return }
    setBusy(true)
    try {
      const d = await productsApi.quick(item.id, { version: item.version, ...(field === 'price' ? { price: n } : { quantity: n }) })
      onSaved({ id: item.id, price: d.price, currentPrice: d.currentPrice, quantity: d.available, version: d.version, qualityScore: d.qualityScore, canPublish: d.canPublish })
    } catch (e) { setVal(numStr(cur)); onError(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Could not save.') } finally { setBusy(false) }
  }
  return <input className="qe" inputMode="decimal" aria-label={`${field === 'price' ? 'Price' : 'Quantity'} for ${item.title}`} value={val} disabled={busy || readOnly} onChange={(e) => setVal(e.target.value)} onBlur={() => void commit()}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setVal(numStr(field === 'price' ? item.price : item.quantity)); (e.target as HTMLInputElement).blur() } }} />
}

export default function ProductsListPage() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { brands, selected } = useBrands()
  const canWrite = useCanWrite()
  const tab = sp.get('tab') ?? ''; const q = sp.get('q') ?? ''; const brandId = selected === 'all' ? '' : selected
  const sort = sp.get('sort') ?? 'updated'; const dir = sp.get('dir') ?? 'desc'; const page = Number(sp.get('page') ?? 1) || 1
  const [data, setData] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState(q)
  const req = useRef(0)

  const params = useCallback(() => {
    const p: Record<string, string | number> = { sort, dir, page, pageSize: 20 }
    if (q) p.q = q; if (brandId) p.brandId = brandId
    if (tab === 'outofstock' || tab === 'attention') p.filter = tab; else if (tab) p.status = tab
    return p
  }, [q, brandId, tab, sort, dir, page])
  const load = useCallback(async () => {
    const my = ++req.current
    setLoading(true); setError('')
    try { const d = await productsApi.list(params()); if (my === req.current) { setData(d); setSel(new Set()) } }
    catch (e) { if (my === req.current) setError(e instanceof ApiError ? e.message2 : 'Could not load your products.') }
    finally { if (my === req.current) setLoading(false) }
  }, [params])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const t = setTimeout(() => { if (search !== q) update({ q: search, page: '' }) }, 350); return () => clearTimeout(t) }, [search]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = (o: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k) }; setSp(n, { replace: true }) }
  const patchItem = (p: Partial<ListItem> & { id: string }) => setData((d) => d && { ...d, items: d.items.map((i) => (i.id === p.id ? { ...i, ...p } : i)) })

  const bulk = async (status: string, label: string) => {
    const ids = [...sel]
    try {
      const r = await productsApi.bulkStatus(ids, status)
      setNotice({ kind: r.failed.length ? 'info' : 'success', text: `${r.updated} listing${r.updated === 1 ? '' : 's'} ${label}.${r.failed.length ? ` ${r.failed.length} couldn't be changed: ${r.failed.slice(0, 3).map((f) => `${f.title ?? 'a listing'} (${f.message})`).join('; ')}` : ''}` })
      await load()
    } catch (e) { setNotice({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not update the listings.' }) }
  }
  const dup = async (id: string) => { try { const d = await productsApi.duplicate(id); nav(`/products/${d.id}`) } catch (e) { setNotice({ kind: 'error', text: e instanceof ApiError ? e.message2 : 'Could not duplicate.' }) } }

  const items = data?.items ?? []
  const all = items.length > 0 && items.every((i) => sel.has(i.id))
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const empty = !loading && !error && data && data.total === 0
  const firstEver = empty && !q && !tab && !brandId && data!.counts.all === 0 && data!.counts.archived === 0

  return (
    <ProductsFrame>
      <main className="pwrap" aria-labelledby="page-title">
        <header className="plist-head">
          <div><h1 id="page-title" tabIndex={-1}>Products</h1><p className="lead">{data ? `${data.counts.all} listing${data.counts.all === 1 ? '' : 's'}` : ' '}</p></div>
          <div className="plist-cta">
            <Link className="btn" to="/products/import"><PIcon name="upload" /> Bulk upload</Link>
            {canWrite && <Link className="btn primary" to="/products/new"><PIcon name="plus" /> Add product</Link>}
          </div>
        </header>
        <div className="stabs" role="tablist" aria-label="Filter by status">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => update({ tab: t.id, page: '' })}>
              {t.label}{data && <span className="pcount"> {data.counts[t.key as keyof ListResult['counts']]}</span>}
            </button>
          ))}
        </div>
        <div className="filters">
          <div className="field search"><label htmlFor="p-search" className="sr-only">Search products</label><PIcon name="search" /><input id="p-search" type="search" placeholder="Search by title or SKU" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {brandId && <p className="hint brand-note" role="status">Showing {brands.find((b) => b.id === brandId)?.name ?? 'one brand'} only. Change it with the brand switcher in the header.</p>}
          <SelectField label="Sort by" id="p-sort" value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(':'); update({ sort: s, dir: d }) }}>
            <option value="updated:desc">Recently updated</option><option value="title:asc">Title A-Z</option><option value="title:desc">Title Z-A</option><option value="price:asc">Price: low to high</option>
            <option value="price:desc">Price: high to low</option><option value="stock:asc">Stock: low to high</option><option value="quality:asc">Quality: lowest first</option>
          </SelectField>
        </div>
        <Alert kind={notice?.kind}>{notice?.text}</Alert>
        <Alert>{error}</Alert>
        {canWrite && sel.size > 0 && (
          <div className="bulkbar-sel" role="region" aria-label="Bulk actions">
            <strong>{sel.size} selected</strong>
            <Button onClick={() => void bulk('active', 'activated')}>Activate</Button>
            <Button onClick={() => void bulk('inactive', 'deactivated')}>Deactivate</Button>
            <Button onClick={() => void bulk('archived', 'archived')}>Archive</Button>
            <Button variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
          </div>
        )}
        {loading && !data && <div className="skel-table" aria-busy="true" aria-label="Loading products">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton row-sk" />)}</div>}
        {firstEver && (
          <div className="pempty">
            <PIcon name="box" /><h2>Add your first product</h2>
            <p>Create a listing with photos, a price and a description. You can save it as a draft and publish when you're ready.</p>
            {canWrite && <Link className="btn primary" to="/products/new">Add your first product</Link>}
            <p className="hint">Have many products? <Link to="/products/import">Upload a CSV</Link> instead.</p>
          </div>
        )}
        {empty && !firstEver && <div className="pempty"><h2>No products match</h2><p>Try a different search or filter.</p><Button onClick={() => { setSearch(''); setSp(new URLSearchParams(), { replace: true }) }}>Clear filters</Button></div>}
        {items.length > 0 && (
          <>
            <div className="tablewrap desk">
              <table className="ptable" aria-busy={loading || undefined}>
                <caption className="sr-only">Your products</caption>
                <thead><tr>
                  <th scope="col">{canWrite && <input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setSel(all ? new Set() : new Set(items.map((i) => i.id)))} />}{!canWrite && <span className="sr-only">Selection</span>}</th>
                  <th scope="col">Product</th><th scope="col">Price</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col">Quality</th><th scope="col"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{canWrite && <input type="checkbox" aria-label={`Select ${i.title}`} checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n })} />}</td>
                      <td><div className="pcell"><AuthImage src={i.thumbnailUrl} alt="" className="pthumb" /><div><Link to={`/products/${i.id}`} className="ptitle">{i.title}</Link><div className="sub">{i.sku ? `SKU ${i.sku}` : 'No SKU'}{i.brandName && brands.length > 1 && !brandId ? ` · ${i.brandName}` : ''}{i.hasVariants ? ` · ${i.variantCount} variations` : ''}</div></div></div></td>
                      <td><QuickEdit readOnly={!canWrite} item={i} field="price" onSaved={patchItem} onError={(m) => setNotice({ kind: 'error', text: m })} />{i.onSale && <div className="sub ok-text">Sale {money(i.currentPrice)}</div>}</td>
                      <td><QuickEdit readOnly={!canWrite} item={i} field="quantity" onSaved={patchItem} onError={(m) => setNotice({ kind: 'error', text: m })} />{i.lowStock && <div className="sub warn-text">Low stock</div>}</td>
                      <td><StatusChip status={i.status} />{i.needsAttention && <div className="sub warn-text">Needs attention</div>}</td>
                      <td><QualityBadge score={i.qualityScore} /></td>
                      <td className="acts"><Link className="btn link" to={`/products/${i.id}`}>Edit<span className="sr-only"> {i.title}</span></Link>{canWrite && <button className="btn link" onClick={() => void dup(i.id)}>Duplicate<span className="sr-only"> {i.title}</span></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="pcards mob" aria-label="Products">
              {items.map((i) => (
                <li key={i.id} className="pcard-item">
                  {canWrite && <label className="selbox"><input type="checkbox" aria-label={`Select ${i.title}`} checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n })} /></label>}
                  <AuthImage src={i.thumbnailUrl} alt="" className="pthumb" />
                  <div className="pc-body">
                    <Link to={`/products/${i.id}`} className="ptitle">{i.title}</Link>
                    <div className="sub">{i.sku ? `SKU ${i.sku}` : 'No SKU'}</div>
                    <div className="pc-meta"><StatusChip status={i.status} /><QualityBadge score={i.qualityScore} /></div>
                    <div className="pc-meta"><span>{money(i.currentPrice ?? i.price) || 'No price'}</span><span>{i.quantity} in stock</span></div>
                  </div>
                </li>
              ))}
            </ul>
            <nav className="pager" aria-label="Pagination">
              <Button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</Button>
              <span>Page {page} of {totalPages}</span>
              <Button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>Next</Button>
            </nav>
          </>
        )}
      </main>
    </ProductsFrame>
  )
}
