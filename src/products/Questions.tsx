import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button } from '../components/ui'
import { productsApi } from './api'
import { ProductsFrame } from './ProductsFrame'
import { useBrands } from '../pages/teams/BrandContext'
import { useCanWrite } from './usePermissions'
import { AreaField, PIcon, SelectField } from './ui'
import type { ListItem, Question, QuestionList } from './types'
import './products.css'

function QuestionCard({ q, onChange, onError, readOnly }: { readOnly?: boolean; q: Question; onChange: (q: Question) => void; onError: (m: string) => void }) {
  const [text, setText] = useState(q.answer ?? '')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const act = async (name: string, fn: () => Promise<Question>) => {
    setBusy(name); setErr('')
    try { onChange(await fn()) } catch (e) { const m = e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message2) : 'Something went wrong.'; setErr(m); onError(m) } finally { setBusy('') }
  }
  const dirty = text.trim() !== (q.answer ?? '')
  return (
    <li className="qcard">
      <header>
        <Link to={`/products/${q.productId}`}>{q.productTitle}</Link>
        <span className={`chip ${q.state === 'Published' ? 'ok' : q.state === 'Hidden' ? 'st-archived' : 'warn'}`}>{q.answered ? q.state : 'Unanswered'}</span>
      </header>
      <p className="qtext"><strong>{q.askerName}</strong> asked <time dateTime={q.askedAt}>{new Date(q.askedAt).toLocaleDateString()}</time>:<br />{q.text}</p>
      <AreaField label="Your answer" disabled={readOnly} id={`ans-${q.id}`} rows={3} maxLength={2000} value={text} error={err} onChange={(e) => setText(e.target.value)} hint="Be clear and friendly. Published answers appear on the listing." />
      {!readOnly && <div className="qacts">
        <Button variant="primary" loading={busy === 'pub'} disabled={!text.trim() || (!dirty && q.state === 'Published')} onClick={() => void act('pub', () => productsApi.answer(q.id, text.trim(), true))}>{q.state === 'Published' ? 'Update answer' : 'Publish answer'}</Button>
        <Button loading={busy === 'draft'} disabled={!text.trim() || !dirty} onClick={() => void act('draft', () => productsApi.answer(q.id, text.trim(), false))}>Save as draft</Button>
        {q.state === 'Hidden'
          ? <Button disabled={!q.answered} loading={busy === 'show'} onClick={() => void act('show', () => productsApi.publishQuestion(q.id))}>Show on listing</Button>
          : <Button variant="ghost" loading={busy === 'hide'} onClick={() => void act('hide', () => productsApi.hideQuestion(q.id))}>Hide<span className="sr-only"> this question</span></Button>}
      </div>}
    </li>
  )
}

export default function QuestionsPage() {
  const canWrite = useCanWrite()
  const { selected } = useBrands(); const brandId = selected === 'all' ? '' : selected
  const [sp, setSp] = useSearchParams()
  const state = sp.get('state') ?? 'unanswered'; const productId = sp.get('product') ?? ''
  const [data, setData] = useState<QuestionList | null>(null)
  const [products, setProducts] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await productsApi.questions({ state, productId, brandId, pageSize: 50 })) } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not load questions.') } finally { setLoading(false) }
  }, [state, productId, brandId])
  useEffect(() => { void load() }, [load])
  useEffect(() => { productsApi.list({ pageSize: 100, sort: 'title', dir: 'asc', brandId }).then((r) => setProducts(r.items)).catch(() => undefined) }, [])
  const set = (o: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k) }; setSp(n, { replace: true }) }
  const TABS = [['unanswered', 'Unanswered', data?.counts.unanswered], ['answered', 'Answered', data?.counts.answered], ['hidden', 'Hidden', data?.counts.hidden], ['all', 'All', undefined]] as const
  return (
    <ProductsFrame>
      <main className="pwrap" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>Questions</h1>
        <p className="lead">Questions from shoppers about your products. Quick answers build trust and help sales.</p>
        <div className="stabs" role="tablist" aria-label="Filter questions">
          {TABS.map(([id, label, n]) => <button key={id} role="tab" aria-selected={state === id} className={state === id ? 'on' : ''} onClick={() => set({ state: id })}>{label}{n != null && <span className="pcount"> {n}</span>}</button>)}
        </div>
        <div className="filters"><SelectField label="Product" id="q-product" value={productId} onChange={(e) => set({ product: e.target.value })}><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</SelectField></div>
        <Alert>{error}</Alert>
        {loading && !data && <div className="skel-table" aria-busy="true" aria-label="Loading questions">{[0, 1, 2].map((i) => <div key={i} className="skeleton row-sk" />)}</div>}
        {data && data.items.length === 0 && !loading && <div className="pempty"><PIcon name="msg" /><h2>{state === 'unanswered' ? "You're all caught up" : 'Nothing here'}</h2><p>{state === 'unanswered' ? 'No shopper questions are waiting for an answer.' : 'No questions match this view.'}</p></div>}
        <ul className="qlist" aria-label="Questions">
          {data?.items.map((q) => <QuestionCard key={q.id} readOnly={!canWrite} q={q} onError={() => undefined} onChange={() => void load()} />)}
        </ul>
      </main>
    </ProductsFrame>
  )
}
