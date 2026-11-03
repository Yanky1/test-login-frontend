import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type LoginResponse } from '../../api'
import { useAuth } from '../../auth'
import { Alert, Field, OtpInput } from '../../components/ui'
import { forgetPendingEmail, pendingEmail, rememberPendingEmail } from './pending'
import { StepFrame } from './shared'

/** Step 2 is public: the account has no session until the mailbox is proven (the response to sign-up never reveals if an address exists). */
export default function VerifyStep() {
  const { applyLogin, status, user } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState(pendingEmail())
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [wait, setWait] = useState(60)
  const [busy, setBusy] = useState(false)
  const justVerified = useRef(false)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  // Already signed in (Back from the business step, or opened by hand): sessions exist only after verification, so this step is done
  if (status === 'authed' && !justVerified.current) {
    return (
      <StepFrame index={1}>
        <h1 tabIndex={-1}>Verify your email</h1>
        <Alert kind="success">Your email {user?.email} is verified.</Alert>
        <div className="nav-row">
          <button type="button" className="btn" onClick={() => nav('/signup')}>← Back</button>
          <button type="button" className="btn primary" onClick={() => nav('/')}>Continue</button>
        </div>
      </StepFrame>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null); setInfo(null)
    if (!email.includes('@')) { setErr('Enter the email address you signed up with.'); return }
    if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code from your email.'); return }
    setBusy(true)
    try {
      const r = await api<LoginResponse>('/auth/verify-email', { auth: false, body: { email, code } })
      forgetPendingEmail()
      justVerified.current = true
      applyLogin(r, 'other')
      nav('/signup/business')
    } catch (ex) {
      setErr(ex instanceof ApiError ? (ex.body?.detail ?? ex.body?.title ?? 'That code did not work.') : 'Network error.')
    } finally { setBusy(false) }
  }

  const resend = async () => {
    setErr(null)
    if (!email.includes('@')) { setErr('Enter your email address first.'); return }
    try {
      rememberPendingEmail(email)
      const r = await api<{ resendAfterSeconds: number }>('/auth/resend-code', { auth: false, body: { email } })
      setWait(r.resendAfterSeconds ?? 60)
      setInfo('If that address is waiting for verification, we sent a new code.')
    } catch (ex) { setErr(ex instanceof ApiError && ex.status === 429 ? 'Please wait a moment before asking again.' : 'Could not resend the code.') }
  }

  return (
    <StepFrame index={1}>
      <h1 tabIndex={-1}>Verify your email</h1>
      <p>If this address can be used, we sent a 6-digit code to it. It is valid for 10 minutes.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <OtpInput label="Verification code" value={code} onChange={setCode} />
        <Alert>{err}</Alert>
        <Alert kind="info">{info}</Alert>
        <button className="btn primary" disabled={busy} aria-busy={busy || undefined}>Verify</button>{' '}
        <button type="button" className="btn" disabled={wait > 0} onClick={() => void resend()}>
          {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
      </form>
      <div className="nav-row"><button className="btn link" onClick={() => nav('/signup')}>← Back</button></div>
    </StepFrame>
  )
}
