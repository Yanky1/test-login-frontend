import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api'
import { useAuth } from '../../auth'
import { Alert, Field } from '../../components/ui'
import { StepFrame, useWizard } from './shared'

export default function VerifyStep() {
  const { user, setAccessToken } = useAuth()
  const { reload } = useWizard()
  const nav = useNavigate()
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [wait, setWait] = useState(60)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ emailConfirmed: boolean; resendAfterSeconds: number }>('/auth/verification-status')
      .then((s) => { if (s.emailConfirmed) nav('/signup/business', { replace: true }); else setWait(s.resendAfterSeconds) })
      .catch(() => undefined)
  }, [nav])
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null); setInfo(null)
    if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code from your email.'); return }
    setBusy(true)
    try {
      const r = await api<{ accessToken: string }>('/auth/verify-email', { body: { code } })
      setAccessToken(r.accessToken, { accountStatus: 'Active' })
      await reload()
      nav('/signup/business')
    } catch (ex) {
      setErr(ex instanceof ApiError ? ((ex.body?.detail ?? ex.body?.title) ?? 'That code did not work.') : 'Network error.')
    } finally { setBusy(false) }
  }

  const resend = async () => {
    setErr(null)
    try { const r = await api<{ resendAfterSeconds: number }>('/auth/resend-code', { body: {} }); setWait(r.resendAfterSeconds); setInfo('We sent you a new code.') }
    catch (ex) { if (ex instanceof ApiError && ex.status === 429) setWait(ex.body?.retryAfterSeconds ?? 60); else setErr('Could not resend the code.') }
  }

  return (
    <StepFrame index={1}>
      <h1 tabIndex={-1}>Verify your email</h1>
      <p>We sent a 6-digit code to <strong>{user?.email}</strong>. It is valid for 10 minutes.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Verification code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]*" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={undefined} />
        <Alert>{err}</Alert>
        <Alert kind="info">{info}</Alert>
        <button className="btn primary" disabled={busy}>Verify</button>{' '}
        <button type="button" className="btn" disabled={wait > 0} onClick={() => void resend()}>
          {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
      </form>
      <div className="nav-row"><button className="btn link" onClick={() => nav('/signup')}>← Back</button></div>
    </StepFrame>
  )
}
