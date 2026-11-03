import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { passwordChecks, passwordValid } from '../lib/password'
import { Alert, Card, Field, PasswordField, Spinner, StrengthMeter } from '../components/ui'
import { rememberPendingEmail } from './wizard/pending'

type Redeemed = { purpose: 'reset'; email: string; token: string } | { purpose: 'signup'; phoneEnding: string }

// A reset link is single use: React StrictMode runs effects twice in development, so one request per token is shared.
const inflight = new Map<string, Promise<Redeemed>>()
const redeem = (token: string) => {
  let p = inflight.get(token)
  if (!p) { p = api<Redeemed>('/channels/links/redeem', { auth: false, body: { token } }); inflight.set(token, p) }
  return p
}

/** Landing page of the links we text: `/l/<token>`. Password reset → the normal reset page; phone sign-up → finish with email + password. */
export default function PhoneLinkPage() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const [r, setR] = useState<Redeemed | null>(null)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    let live = true
    redeem(token).then((x) => {
      if (!live) return
      if (x.purpose === 'reset') nav(`/reset-password?email=${encodeURIComponent(x.email)}&token=${encodeURIComponent(x.token)}`, { replace: true })
      else setR(x)
    }).catch(() => { if (live) setBad(true) })
    return () => { live = false }
  }, [token, nav])

  if (bad) return (
    <Card title="This link can't be used">
      <Alert>This link is invalid, has expired or was already used. Links work once and expire after 30 minutes.</Alert>
      <p><Link to="/forgot-password">Reset your password</Link> · <Link to="/signup">Start sign-up again</Link> · <Link to="/login">Sign in</Link></p>
    </Card>
  )
  if (!r) return <div className="center" role="status" aria-label="Checking your link"><Spinner /></div>
  return <FinishSignup token={token} phoneEnding={r.purpose === 'signup' ? r.phoneEnding : ''} />
}

function FinishSignup({ token, phoneEnding }: { token: string; phoneEnding: string }) {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [terms, setTerms] = useState(false)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setErrs({})
    const local: Record<string, string> = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) local.email = 'Enter a valid email address.'
    if (!passwordValid(pw)) local.password = 'Password does not meet the requirements'
    if (!terms) local.terms = 'You must accept the Terms.'
    if (Object.keys(local).length) { setErrs(local); return }
    setBusy(true)
    try {
      await api('/channels/links/complete-signup', { auth: false, body: { token, email, password: pw, acceptTerms: terms } })
      rememberPendingEmail(email)
      nav('/signup/verify')
    } catch (ex) {
      if (ex instanceof ApiError) {
        const fe = ex.fieldErrors()
        if (Object.keys(fe).length) setErrs({ email: fe.email, password: fe.password, terms: fe.acceptTerms }) // eslint-disable-line
        else setMsg(ex.status === 400 ? 'This link is invalid or has expired.' : ex.status === 429 ? 'Too many attempts. Please wait a minute.' : 'Something went wrong. Please try again.')
      } else setMsg('Network error. Please try again.')
    } finally { setBusy(false) }
  }
  return (
    <Card title="Finish creating your account" lead={`Your mobile number ending ${phoneEnding} is already verified and your phone PIN is saved. Add your email and a password.`}>
      <form onSubmit={submit} noValidate>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errs.email} />
        <PasswordField label="Password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={errs.password}
          hint={<><StrengthMeter value={pw} /><ul className="checks">{passwordChecks(pw).map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul></>} />
        <div className="field check"><label><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> I accept the Terms of Service</label>
          {errs.terms && <div className="field-error" role="alert">{errs.terms}</div>}</div>
        <Alert>{msg}</Alert>
        <button className="btn primary" disabled={busy}>Create account</button>
      </form>
    </Card>
  )
}
