import type { Issue } from './types'
import { scoreLabel } from './lib/format'

const SECTION_OF: Record<string, string> = { basics: 'basics', media: 'media', description: 'description', price: 'price', identifiers: 'identifiers', variations: 'variations', details: 'details', shipping: 'shipping', policies: 'policies', seo: 'seo' }
const FIELD_OF: Record<string, string> = { title: 'f-title', title_length: 'f-title', category: 'f-category', condition_note: 'f-conditionNote', price: 'f-price', stock: 'f-quantity', sku: 'f-sku', barcode: 'f-barcode',
  weight: 'f-weight', handling: 'f-handling', returns: 'f-returns', search_terms: 'f-searchTerms', bullets: 'f-bullet-0', description: 'f-description', images: 'sec-media', images_more: 'sec-media', images_resolution: 'sec-media', images_alt: 'sec-media', price_model: 'f-svc-model', duration: 'f-svc-duration', location: 'sec-location', online_instructions: 'f-svc-instr', service_area: 'f-svc-area', seller_address: 'f-svc-address', providers: 'sec-providers', intake: 'f-svc-mode', requirements: 'f-svc-req', service: 'sec-pricing' }

export function focusIssue(i: Issue) {
  const id = i.key.startsWith('attr:') ? `f-attr-${i.key.slice(5)}` : FIELD_OF[i.key]
  const el = (id && document.getElementById(id)) || document.getElementById(`sec-${SECTION_OF[i.section] ?? i.section}`)
  if (!el) return
  el.scrollIntoView?.({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  ;(el as HTMLElement).focus?.({ preventScroll: true })
}

export function Checklist({ issues, score, canPublish }: { issues: Issue[]; score: number; canPublish: boolean }) {
  const req = issues.filter((i) => i.severity === 'required'); const rec = issues.filter((i) => i.severity === 'recommended')
  return (
    <section className="checklist" aria-labelledby="ck-title">
      <h2 id="ck-title">Ready to publish?</h2>
      <div className="score" role="img" aria-label={`Listing quality ${score} out of 100: ${scoreLabel(score)}`}>
        <div className="bar"><i style={{ width: `${score}%` }} /></div><strong>{score}</strong><span>/100 · {scoreLabel(score)}</span>
      </div>
      {canPublish ? <p className="ok-text" role="status">All required items are done. You can activate this listing.</p> : <p role="status">Finish these to publish:</p>}
      {req.length > 0 && <ul aria-label="Required">{req.map((i) => <li key={i.key}><button type="button" className="btn link" onClick={() => focusIssue(i)}><span aria-hidden="true">⚠</span> {i.message}</button></li>)}</ul>}
      {rec.length > 0 && (
        <details className="ck-more">
          <summary>{rec.length} suggestion{rec.length === 1 ? '' : 's'} to improve your listing</summary>
          <ul aria-label="Suggestions">{rec.map((i) => <li key={i.key}><button type="button" className="btn link" onClick={() => focusIssue(i)}>{i.message}</button></li>)}</ul>
        </details>
      )}
    </section>
  )
}
