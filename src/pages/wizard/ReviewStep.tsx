import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { visibleKeys } from '../../lib/kosher'
import { Alert, Icon } from '../../components/ui'
import { StepFrame, useWizard, type Application } from './shared'

export default function ReviewStep() {
  const { app, fields, setApp } = useWizard()
  const nav = useNavigate()
  const [agree, setAgree] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const b = app.business
  const vis = visibleKeys(fields, app.kosher.answers)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agree) { setErr('You must accept the Seller Agreement to submit.'); return }
    setErr(null); setBusy(true)
    try {
      setApp(await api<Application>('/seller/application/submit', { body: { acceptSellerAgreement: true } }))
      nav('/signup/pending')
    } catch (ex) {
      setErr(ex instanceof ApiError && ex.status === 400 ? 'Some answers are missing. Please review the steps above.' : 'Could not submit. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <StepFrame index={4}>
      <h1 tabIndex={-1}>Review your application</h1>
      <p className="rv-lead">Check everything below. You can change any section before you submit.</p>
      <section aria-labelledby="rv-biz" className="rv-card">
        <h2><span id="rv-biz">Business</span> <Link className="edit-link" to="/signup/business" aria-describedby="rv-biz"><Icon name="pencil" />Edit</Link></h2>
        <dl>
          <dt>Business name</dt><dd>{b.vendorName}</dd>
          <dt>Contact</dt><dd>{b.contactName} · {b.contactPhone}</dd>
          <dt>Address</dt><dd>{[b.addressLine1, b.addressLine2, b.city, b.region, b.postalCode, b.country].filter(Boolean).join(', ')}</dd>
          <dt>Text messages</dt><dd>{b.smsOptIn ? 'Opted in' : 'Not opted in'}</dd>
        </dl>
      </section>
      <section aria-labelledby="rv-k" className="rv-card">
        <h2><span id="rv-k">Food &amp; kosher</span> <Link className="edit-link" to="/signup/kosher" aria-describedby="rv-k"><Icon name="pencil" />Edit</Link></h2>
        <dl>
          {fields.filter((f) => vis.has(f.key)).map((f) => (
            <div key={f.key}><dt>{f.label}</dt><dd>{f.type === 'file' ? (app.kosher.certificate?.name ?? '—') : (app.kosher.answers[f.key] ?? '—')}</dd></div>
          ))}
        </dl>
      </section>
      <form onSubmit={submit} noValidate>
        <div className="field check">
          <label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I accept the <a href="/seller-agreement" target="_blank" rel="noreferrer">Seller Agreement</a></label>
        </div>
        <Alert>{err}</Alert>
        <div className="nav-row">
          <button type="button" className="btn" onClick={() => nav('/signup/kosher')}>← Back</button>
          <button className="btn primary" disabled={busy}>Submit application</button>
        </div>
      </form>
    </StepFrame>
  )
}
