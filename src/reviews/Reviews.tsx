import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api'
import { useAuth } from '../auth'
import { Alert, Button } from '../components/ui'
import { Dialog } from '../components/Dialog'
import { DemoPill } from '../demo/DemoPill'
import { productsApi } from '../products/api'
import { ProductsFrame } from '../products/ProductsFrame'
import { useCanWrite } from '../products/usePermissions'
import { AreaField, PIcon, SelectField } from '../products/ui'
import { useBrands } from '../pages/teams/BrandContext'
import type { ListItem } from '../products/types'
import { reviewsApi } from './api'
import { ratingText, Stars } from './Stars'
import type { Review, ReviewList } from './types'
import './reviews.css'
import '../products/products.css'

export const REPLY_MAX = 2000
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function problem(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'You have posted a lot of replies in the last hour. Please try again later.'
    return e.message2
  }
  return 'Something went wrong. Please try again.'
}

function ReplyEditor({ review, initial, onSaved, onCancel }: { review: Review; initial: string; onSaved: () => void; onCancel: () => void }) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const id = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const trimmed = text.trim()
  const save = async () => {
    setBusy(true); setErr('')
    try { await reviewsApi.reply(review.id, trimmed); onSaved() } catch (e) { setErr(problem(e)) } finally { setBusy(false) }
  }
  return (
    <form className="rv-editor" onSubmit={(e) => { e.preventDefault(); void save() }} aria-label={`Reply to ${review.buyerDisplayName ?? 'this review'}`}>
      <AreaField ref={ref} id={`${id}-reply`} label="Your reply" rows={4} maxLength={REPLY_MAX} value={text} error={err} onChange={(e) => setText(e.target.value)}
        hint="Public. Please don't include email addresses, phone numbers or links." />
      <p className="rv-count" id={`${id}-count`} aria-live="polite" data-testid="reply-count">{text.length} / {REPLY_MAX}</p>
      <div className="rv-acts">
        <Button type="submit" variant="primary" loading={busy} disabled={!trimmed || trimmed === initial}>{initial ? 'Save reply' : 'Post reply'}</Button>
        <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  )
}

function ReviewCard({ r, canWrite, onChanged, onError }: { r: Review; canWrite: boolean; onChanged: () => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const visible = r.state === 'visible'
  const remove = async () => {
    setBusy(true)
    try { await reviewsApi.removeReply(r.id); setConfirm(false); onChanged() } catch (e) { setConfirm(false); onError(problem(e)) } finally { setBusy(false) }
  }
  return (
    <li className="rv-card">
      <header>
        <div className="rv-rating">
          <Stars rating={r.rating} decorative />
          <span className="rv-rating-text">{ratingText(r.rating)}</span>
        </div>
        <span className="rv-meta">
          <strong>{r.buyerDisplayName ?? 'Anonymous'}</strong> · <time dateTime={r.createdAt}>{fmt(r.createdAt)}</time>
          {r.editedAt && <span className="rv-edited"> (edited)</span>}
          {r.demo && <DemoPill />}
        </span>
      </header>
      <p className="rv-product"><Link to={`/products/${r.productId}`}>{r.productTitle}</Link></p>
      {!visible && <p><span className={`chip ${r.state === 'removed' ? 'st-archived' : 'warn'}`}>{r.state === 'removed' ? 'Removed by marketplace' : 'Hidden by marketplace'}</span>{r.stateReason ? <span className="rv-reason"> {r.stateReason}</span> : null}</p>}
      {r.text ? <p className="rv-text">{r.text}</p> : <p className="rv-text rv-none">{r.state === 'removed' ? 'The text of this review was removed.' : 'No written review.'}</p>}

      {r.reply && !editing && (
        <section className="rv-reply" aria-label="Your public reply">
          <h3>Your reply</h3>
          <p>{r.reply.text}</p>
          <p className="rv-meta"><time dateTime={r.reply.createdAt}>{fmt(r.reply.createdAt)}</time>{r.reply.editedAt && ' (edited)'}</p>
          {canWrite && (
            <div className="rv-acts">
              <Button onClick={() => setEditing(true)}>Edit reply<span className="sr-only"> to {r.buyerDisplayName ?? 'this review'}</span></Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirm(true)}>Delete reply<span className="sr-only"> to {r.buyerDisplayName ?? 'this review'}</span></Button>
            </div>
          )}
        </section>
      )}
      {editing && <ReplyEditor review={r} initial={r.reply?.text ?? ''} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} />}
      {!r.reply && !editing && visible && canWrite && <div className="rv-acts"><Button variant="primary" onClick={() => setEditing(true)}>Reply<span className="sr-only"> to {r.buyerDisplayName ?? 'this review'}</span></Button></div>}

      {confirm && (
        <Dialog id={`del-${r.id}`} title="Delete your reply?" onClose={() => setConfirm(false)}>
          <p>The reply will be removed from the review on Solvelt. You can write a new one later.</p>
          <div className="dialog-actions">
            <Button variant="primary" data-autofocus loading={busy} onClick={() => void remove()}>Delete reply</Button>
            <Button onClick={() => setConfirm(false)}>Keep reply</Button>
          </div>
        </Dialog>
      )}
    </li>
  )
}

function Summary({ data, rating, onRating }: { data: ReviewList; rating: string; onRating: (r: string) => void }) {
  const s = data.summary
  return (
    <section className="rv-summary" aria-label="Rating summary">
      <div className="rv-avg">
        <p className="rv-avg-num" aria-label={s.average == null ? 'No rating yet' : `Average rating ${s.average.toFixed(1)} out of 5`}>{s.average == null ? '–' : s.average.toFixed(1)}</p>
        {s.average != null && <Stars rating={s.average} size="lg" decorative />}
        <p className="rv-avg-count">{s.count} {s.count === 1 ? 'review' : 'reviews'}</p>
      </div>
      <ul className="rv-bars" aria-label="Reviews by rating">
        {([5, 4, 3, 2, 1] as const).map((n) => {
          const c = s.counts[String(n) as '1']; const pct = s.count ? Math.round((c / s.count) * 100) : 0
          return (
            <li key={n}>
              <button type="button" aria-pressed={rating === String(n)} onClick={() => onRating(rating === String(n) ? '' : String(n))}>
                <span className="rv-bar-label">{n} {n === 1 ? 'star' : 'stars'}</span>{' '}
                <span className="rv-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                <span className="rv-bar-n">{c}{' '}<span className="sr-only">{c === 1 ? 'review' : 'reviews'}</span></span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function ReviewsPage() {
  const canWrite = useCanWrite()
  const { user } = useAuth()
  const isAdmin = user?.role === 'Owner' || user?.role === 'Admin'      // the hidden view is for the Owner and Admin only (the server enforces it too)
  const { selected } = useBrands(); const brandId = selected === 'all' ? '' : selected
  const [sp, setSp] = useSearchParams()
  const view = sp.get('view') === 'hidden' && isAdmin ? 'hidden' : 'visible'
  const rating = sp.get('rating') ?? ''; const replied = sp.get('replied') ?? ''; const productId = sp.get('product') ?? ''
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1)
  const [data, setData] = useState<ReviewList | null>(null)
  const [products, setProducts] = useState<ListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const signedInUser = !!user
  const load = useCallback(async () => {
    if (!signedInUser) return              // the role decides which view may be asked for: wait until the session is known
    setLoading(true); setError('')
    try { setData(await reviewsApi.list({ rating, replied, productId, brandId, view: view === 'hidden' ? 'hidden' : '', page, pageSize: 20 })) } catch (e) { setError(e instanceof ApiError ? e.message2 : 'Could not load reviews.') } finally { setLoading(false) }
  }, [signedInUser, rating, replied, productId, brandId, view, page])
  useEffect(() => { void load() }, [load])
  useEffect(() => { productsApi.list({ pageSize: 100, sort: 'title', dir: 'asc', brandId }).then((r) => setProducts(r.items)).catch(() => undefined) }, [brandId])
  const set = (o: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k) }; if (!('page' in o)) n.delete('page'); setSp(n, { replace: true }) }
  const filtered = !!(rating || replied || productId)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  return (
    <ProductsFrame>
      <main className="pwrap" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>Reviews</h1>
        <p className="lead">What buyers say about your products. A friendly, public reply shows you care.</p>
        {isAdmin && (
          <div className="stabs" role="tablist" aria-label="Review view">
            <button role="tab" aria-selected={view === 'visible'} className={view === 'visible' ? 'on' : ''} onClick={() => set({ view: '' })}>Reviews</button>
            <button role="tab" aria-selected={view === 'hidden'} className={view === 'hidden' ? 'on' : ''} onClick={() => set({ view: 'hidden' })}>Hidden by marketplace{data?.hiddenCount != null && <span className="pcount"> {data.hiddenCount}</span>}</button>
          </div>
        )}
        {data && view === 'visible' && <Summary data={data} rating={rating} onRating={(r) => set({ rating: r })} />}
        <div className="filters">
          <SelectField label="Rating" id="rv-rating" value={rating} onChange={(e) => set({ rating: e.target.value })}>
            <option value="">All ratings</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{ratingText(n)}</option>)}
          </SelectField>
          <SelectField label="Replies" id="rv-replied" value={replied} onChange={(e) => set({ replied: e.target.value })}>
            <option value="">All</option><option value="false">Needs a reply</option><option value="true">Replied</option>
          </SelectField>
          <SelectField label="Product" id="rv-product" value={productId} onChange={(e) => set({ product: e.target.value })}>
            <option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </SelectField>
        </div>
        <Alert>{error}</Alert>
        {loading && !data && <div className="skel-table" aria-busy="true" aria-label="Loading reviews">{[0, 1, 2].map((i) => <div key={i} className="skeleton row-sk" />)}</div>}
        {data && data.items.length === 0 && !loading && (
          <div className="pempty">
            <PIcon name="star" />
            <h2>{view === 'hidden' ? 'Nothing is hidden' : filtered ? 'No reviews match these filters' : 'No reviews yet'}</h2>
            <p>{view === 'hidden' ? 'Reviews the marketplace hides or removes will be listed here.' : filtered ? 'Try a different rating, product or reply filter.' : 'When buyers review your products, their reviews appear here and you can reply.'}</p>
          </div>
        )}
        <ul className="rv-list" aria-label={view === 'hidden' ? 'Hidden reviews' : 'Reviews'}>
          {data?.items.map((r) => <ReviewCard key={r.id} r={r} canWrite={canWrite} onChanged={() => void load()} onError={setError} />)}
        </ul>
        {data && pages > 1 && (
          <nav className="rv-pager" aria-label="Review pages">
            <Button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</Button>
            <span aria-live="polite">Page {page} of {pages}</span>
            <Button disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</Button>
          </nav>
        )}
      </main>
    </ProductsFrame>
  )
}
