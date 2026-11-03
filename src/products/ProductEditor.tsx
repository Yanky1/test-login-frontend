import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api'
import { Alert, Button, Skeleton } from '../components/ui'
import { productsApi } from './api'
import { Checklist, focusIssue } from './Checklist'
import { BuyerPreview } from './Preview'
import { Dialog, PIcon, StatusChip } from './ui'
import { useLeaveGuard } from './useLeaveGuard'
import { useCanWrite } from './usePermissions'
import { useProductEditor } from './useProductEditor'
import type { ProductDetail } from './types'
import { SECTIONS, SERVICE_SECTIONS } from './sections/types'
import { useServiceDetails } from '../services/useServiceDetails'
import { ServiceBooking, ServiceLocation, ServicePolicies, ServicePricing, ServiceProviders, ServiceTiming } from '../services/ServiceSections'
import Basics from './sections/Basics'
import Media from './sections/Media'
import Description from './sections/Description'
import Price from './sections/Price'
import Identifiers from './sections/Identifiers'
import Variations from './sections/Variations'
import Details from './sections/Details'
import { Faqs, Policies, Seo, Shipping } from './sections/More'
import './products.css'

const HINTS: Record<string, string> = {
  pricing: 'How you charge, how long it takes and any add-ons.', timing: 'Notice, booking window and the gaps you keep free between jobs.', location: 'Where the service happens and who you serve.',
  booking: 'Instant booking or approval, what you ask the buyer and who does the job.', providers: 'Team members who can take these bookings. They need working hours too.',
  basics: 'Start with a clear title, the brand and the most specific category.', media: 'Great photos are the biggest driver of sales.', description: 'Features first, then the story.',
  price: 'Set what shoppers pay and how much you have.', identifiers: 'Barcodes help shoppers find an exact product.', variations: 'Only for products with options such as size or colour.',
  details: 'Specifications shoppers filter and compare by.', shipping: 'How and when it gets to the buyer.', faq: 'Answer the questions you hear most.', policies: 'Returns and warranty.', seo: 'Optional extras for search.',
}

export default function ProductEditorPage() {
  const { id = '' } = useParams()
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [failed, setFailed] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    productsApi.get(id).then((d) => alive && setDetail(d)).catch((e) => alive && setFailed(e instanceof ApiError ? e.status : 0))
    return () => { alive = false }
  }, [id])
  if (failed !== null) return <main className="pwrap"><h1 id="page-title" tabIndex={-1}>{failed === 404 ? 'Product not found' : 'Could not load this product'}</h1><p>{failed === 404 ? "It may have been deleted, or it belongs to a brand you can't access." : 'Check your connection and try again.'}</p><Link className="btn" to="/products">Back to products</Link></main>
  if (!detail) return <main className="pwrap"><h1 id="page-title" tabIndex={-1}>Edit product</h1><Skeleton lines={6} /></main>
  return <Editor key={detail.id} initial={detail} />
}

function Editor({ initial }: { initial: ProductDetail }) {
  const ed = useProductEditor(initial)
  const { detail, form, save } = ed
  const nav = useNavigate()
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null)
  const [current, setCurrent] = useState<string>('basics')
  const isService = detail.type === 'Service'
  const sf = useServiceDetails(ed)
  const sections = isService ? SERVICE_SECTIONS : SECTIONS
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const guard = useLeaveGuard(save.unsaved || sf.save.unsaved, async () => { await save.flush(); await sf.save.flush() }, () => { save.discard(); sf.save.discard() })
  const readOnly = !useCanWrite()

  useEffect(() => { document.title = `${form.title || 'New product'} - Solvelt` }, [form.title])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setCurrent(v.target.id.replace('sec-', '')) }, { rootMargin: '-20% 0px -65% 0px' })
    Object.values(refs.current).forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [form.hasVariants])

  const go = (s: string) => {
    const el = document.getElementById(`sec-${s}`); if (!el) return
    el.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
  }

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setMsg(null)
    try { await fn() } catch (e) {
      if (e instanceof ApiError) {
        const code = e.body?.code
        if (code === 'seller_not_approved') setMsg({ kind: 'info', text: 'Your seller account is still being reviewed. You can keep saving drafts - listings can be activated as soon as you are approved.' })
        else if (e.status === 422 && Array.isArray(e.body?.extra)) { ed.patchDetail({ issues: e.body.extra, canPublish: false }); setMsg({ kind: 'error', text: 'This listing is not ready yet. Finish the items in the checklist.' }); const first = e.body.extra.find((i: { severity: string }) => i.severity === 'required'); if (first) focusIssue(first) }
        else setMsg({ kind: 'error', text: e.message2 })
      } else setMsg({ kind: 'error', text: 'Something went wrong. Try again.' })
    } finally { setBusy('') }
  }
  const setStatus = (status: string, ok: string) => run(status, async () => {
    await save.flush(); await sf.save.flush()
    const d = await productsApi.setStatus(detail.id, status)
    ed.patchDetail({ status: d.status, version: d.version, handle: d.handle, publishedAt: d.publishedAt, issues: d.issues, canPublish: d.canPublish, qualityScore: d.qualityScore })
    setMsg({ kind: 'success', text: ok })
  })

  const ORDER = ['error', 'saving', 'dirty', 'saved', 'idle'] as const
  const status = ORDER.find((o) => save.status === o || sf.save.status === o) ?? 'idle'   // the worst state of the listing form and the service sections
  const flushAll = async () => { await save.flush(); await sf.save.flush() }
  const indicator = status === 'saving' ? 'Saving…' : status === 'dirty' ? (ed.live ? 'Unsaved changes' : 'Saving soon…') : status === 'saved' ? 'All changes saved' : status === 'error' ? "Couldn't save" : 'No changes yet'

  return (
    <main className="pwrap editor" aria-labelledby="page-title">
      <header className="ed-bar">
        <div className="ed-title">
          <Link to="/products" className="btn link back">← Products</Link>
          <h1 id="page-title" tabIndex={-1}>{form.title || (isService ? 'New service' : 'New product')}</h1>{isService && <span className="chip svc-chip">Service</span>}
          <StatusChip status={detail.status} />
        </div>
        <div className="ed-actions">
          <span className={`save-ind ${status}`} role="status" aria-live="polite" data-testid="save-indicator">{indicator}</span>
          {status === 'error' && <Button variant="ghost" onClick={() => void (sf.save.status === 'error' ? sf.save.retry() : save.retry())}>Retry</Button>}
          {ed.live && <Button variant="primary" loading={status === 'saving'} disabled={status === 'idle' || status === 'saved'} onClick={() => void flushAll()}>Save changes</Button>}
          {!isService && <Button type="button" onClick={() => setPreview(true)}><PIcon name="eye" /> Preview as buyer</Button>}
          {readOnly ? null : detail.status === 'Active'
            ? <Button loading={busy === 'inactive'} onClick={() => void setStatus('inactive', 'The listing is now inactive and hidden from shoppers.')}>Deactivate</Button>
            : detail.status === 'Archived'
              ? <Button loading={busy === 'inactive'} onClick={() => void setStatus('inactive', 'Restored as inactive.')}>Restore</Button>
              : <Button variant="primary" loading={busy === 'active'} onClick={() => void setStatus('active', 'Your listing is live.')}>Activate</Button>}
        </div>
      </header>
      <Alert kind={msg?.kind}>{msg?.text}</Alert>
      {Object.keys(ed.errors).length > 0 && <Alert>Some fields need attention: {Object.values(ed.errors).slice(0, 3).join(' ')} Your input is kept.</Alert>}
      {status === 'error' && !Object.keys(ed.errors).length && !ed.conflict && <Alert>We couldn't save your latest changes. Your input is still here; we'll retry as you keep editing.</Alert>}
      {ed.conflict && (
        <div className="alert error" role="alert">
          <p>This listing was changed somewhere else (another tab or teammate).</p>
          <Button onClick={() => void ed.resolveConflict(true)}>Keep my version</Button> <Button onClick={() => void ed.resolveConflict(false)}>Load the latest</Button>
        </div>
      )}
      {readOnly && <Alert kind="info">You have view-only access to this listing.</Alert>}
      {ed.live && !readOnly && <Alert kind="info">This listing is live: changes apply when you press "Save changes", and it must stay complete.</Alert>}

      <div className="ed-grid">
        <nav className="secnav" aria-label="Sections">
          <ol>
            {sections.map((s) => {
              const n = ed.issues.filter((i) => i.severity === 'required' && i.section === s.id).length
              return <li key={s.id}><button type="button" aria-current={current === s.id ? 'true' : undefined} onClick={() => go(s.id)}>{s.label}{n > 0 && <span className="dot" aria-label={`${n} required item${n === 1 ? '' : 's'} missing`}>{n}</span>}</button></li>
            })}
          </ol>
        </nav>
        <form className="sections" onSubmit={(e) => e.preventDefault()} noValidate>
          <fieldset disabled={readOnly} className="plain">
            {sections.map((s) => (
              <section key={s.id} id={`sec-${s.id}`} ref={(el) => { refs.current[s.id] = el }} tabIndex={-1} aria-labelledby={`h-${s.id}`} className="psec">
                <h2 id={`h-${s.id}`}>{s.label}</h2>
                <p className="sec-hint">{HINTS[s.id]}</p>
                {s.id === 'pricing' && <ServicePricing sf={sf} />}
                {s.id === 'timing' && <ServiceTiming sf={sf} />}
                {s.id === 'location' && <ServiceLocation sf={sf} />}
                {s.id === 'booking' && <ServiceBooking sf={sf} />}
                {s.id === 'policies' && isService && <ServicePolicies sf={sf} />}
                {s.id === 'providers' && <ServiceProviders serviceId={detail.id} readOnly={readOnly} onChanged={() => void ed.refreshReadiness()} />}
                {s.id === 'basics' && <Basics ed={ed} />}
                {s.id === 'media' && <Media ed={ed} />}
                {s.id === 'description' && <Description ed={ed} />}
                {s.id === 'price' && <Price ed={ed} />}
                {s.id === 'identifiers' && <Identifiers ed={ed} />}
                {s.id === 'variations' && <Variations ed={ed} />}
                {s.id === 'details' && <Details ed={ed} />}
                {s.id === 'shipping' && <Shipping ed={ed} />}
                {s.id === 'faq' && <Faqs ed={ed} />}
                {s.id === 'policies' && !isService && <Policies ed={ed} />}
                {s.id === 'seo' && <Seo ed={ed} />}
              </section>
            ))}
          </fieldset>
          {!readOnly && <footer className="danger-zone">
            <Button onClick={() => void run('dup', async () => { await save.flush(); const d = await productsApi.duplicate(detail.id); nav(`/products/${d.id}`) })} loading={busy === 'dup'}><PIcon name="copy" /> Duplicate</Button>
            {detail.status !== 'Archived' && <Button onClick={() => void setStatus('archived', 'Archived. You can restore it from the Archived tab.')}>Archive</Button>}
            {detail.status !== 'Active' && <Button variant="destructive" onClick={() => void run('del', async () => { if (!window.confirm('Delete this product permanently?')) return; await productsApi.remove(detail.id); nav('/products') })}>Delete</Button>}
          </footer>}
        </form>
        <aside className="ed-side" aria-label="Listing quality">
          <Checklist issues={ed.issues} score={ed.score} canPublish={ed.canPublish} />
        </aside>
      </div>
      {preview && (
        <Dialog title="Preview as buyer" wide onClose={() => setPreview(false)}>
          <p className="hint">This is how shoppers will see your listing. It updates as you type.</p>
          <BuyerPreview ed={ed} />
          <div className="dialog-actions"><Button variant="primary" onClick={() => setPreview(false)}>Close preview</Button></div>
        </Dialog>
      )}
      {guard}
    </main>
  )
}
