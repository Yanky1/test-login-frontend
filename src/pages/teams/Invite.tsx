import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type LoginResponse } from '../../api'
import { useAuth } from '../../auth'
import { Alert, Card, Field, PasswordField, Skeleton, StrengthMeter } from '../../components/ui'
import { passwordChecks, passwordValid } from '../../lib/password'
import { fmtDate, ROLE_DESC, type InvitePreview } from '../../lib/teams'
import { RoleBadge } from './parts'

const GONE: Record<string, { title: string; text: string }> = {
  expired: { title: 'This invitation has expired', text: 'Invitations are valid for 7 days. Ask the account Owner or an Admin to send you a new one.' },
  revoked: { title: 'This invitation was withdrawn', text: 'The person who invited you cancelled it. Ask them to send a new invitation if you still need access.' },
  accepted: { title: 'This invitation was already used', text: 'It has already been accepted. If that was you, sign in to open the account.' },
  declined: { title: 'This invitation was declined', text: 'Ask the account Owner or an Admin to send a new one if you changed your mind.' },
}

/** /invite/:token for signed-in and signed-out visitors, including the new-user join flow (no seller sign-up wizard). */
export default function InvitePage() {
  const { token = '' } = useParams()
  const { status, user, applyLogin, switchAccount, refreshAccounts, logout } = useAuth()
  const nav = useNavigate()
  const [pv, setPv] = useState<InvitePreview | null | 'missing'>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [wrongEmail, setWrongEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [declined, setDeclined] = useState(false)

  useEffect(() => {
    let alive = true
    api<InvitePreview>(`/invitations/${encodeURIComponent(token)}`, { auth: false })
      .then((p) => { if (alive) setPv(p) }).catch(() => { if (alive) setPv('missing') })
    return () => { alive = false }
  }, [token])

  if (status === 'loading' || pv === null) return <Card title="Invitation"><Skeleton lines={3} /></Card>
  if (pv === 'missing') return <Card title="This invitation link isn't valid"><p>The link may be incomplete or was replaced by a newer invitation. Check your email for the latest one.</p><p className="links"><Link to="/login">Go to sign in</Link></p></Card>
  if (declined) return <Card title="Invitation declined"><p>We let the account know you declined. You can close this page.</p><p className="links"><Link to="/login">Go to sign in</Link></p></Card>
  if (pv.state !== 'pending') {
    const g = GONE[pv.state]
    return <Card title={g.title}><p>{g.text}</p><p className="links"><Link to="/login">Go to sign in</Link></p></Card>
  }

  const summary = (
    <div className="invite-summary">
      <p><strong>{pv.accountName || 'A seller account'}</strong> invited <strong>{pv.email}</strong> to join as <RoleBadge role={pv.role} />.</p>
      <p className="hint">{ROLE_DESC[pv.role]}</p>
      <p className="hint">Brand access: {pv.allBrands ? 'all brands' : pv.brands.join(', ')}. Expires {fmtDate(pv.expiresAt)}.</p>
    </div>
  )
  const decline = async () => {
    setBusy(true)
    try { await api(`/invitations/${encodeURIComponent(token)}/decline`, { method: 'POST', body: {}, auth: false }); setDeclined(true) } catch { setMsg('Something went wrong. Please try again.') } finally { setBusy(false) }
  }

  if (status === 'authed') {
    const accept = async () => {
      setBusy(true); setMsg(null)
      try {
        const r = await api<{ sellerId: string }>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} })
        await refreshAccounts()
        await switchAccount(r.sellerId)
        nav('/', { replace: true })
      } catch (e) {
        if (e instanceof ApiError && e.code === 'email_mismatch') setWrongEmail(true)
        else setMsg(e instanceof ApiError ? e.message2 : 'Something went wrong. Please try again.')
      } finally { setBusy(false) }
    }
    if (wrongEmail) {
      return (
        <Card title="Wrong email address">
          <Alert>{`This invitation was sent to ${pv.email}, but you are signed in as ${user?.email}.`}</Alert>
          <p>Sign out and sign in with <strong>{pv.email}</strong> to accept it.</p>
          <button type="button" className="btn primary" onClick={() => void logout().then(() => nav(`/login?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true }))}>Sign out and continue</button>
        </Card>
      )
    }
    return (
      <Card title="You're invited" lead="Review the invitation, then accept or decline.">
        {summary}
        <Alert>{msg}</Alert>
        <div className="row">
          <button type="button" className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void accept()}>Accept invitation</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void decline()}>Decline</button>
        </div>
        <p className="hint">Signed in as {user?.email}.</p>
      </Card>
    )
  }

  return <JoinForm token={token} pv={pv} summary={summary} onDecline={decline} busy={busy} onJoined={(r) => { applyLogin(r, 'password'); nav('/', { replace: true }) }} />
}

function JoinForm({ token, pv, summary, onDecline, busy: parentBusy, onJoined }: { token: string; pv: InvitePreview; summary: React.ReactNode; onDecline: () => void; busy: boolean; onJoined: (r: LoginResponse) => void }) {
  const [password, setPassword] = useState('')
  const [terms, setTerms] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [existing, setExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!passwordValid(password)) errs.password = 'Password does not meet the requirements'
    if (!terms) errs.terms = 'You must accept the Terms to continue'
    setErrors(errs); setMsg(null)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const r = await api<LoginResponse>(`/invitations/${encodeURIComponent(token)}/join`, { body: { password, acceptTerms: true }, auth: false })
      onJoined(r)
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === 'sign_in_required') setExisting(true)
      else if (e2 instanceof ApiError && e2.status === 400) { const fe = e2.fieldErrors(); if (Object.keys(fe).length) setErrors(fe); else setMsg(e2.message2) }
      else setMsg(e2 instanceof ApiError ? e2.message2 : 'Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }
  const signIn = `/login?next=${encodeURIComponent(`/invite/${token}`)}`
  if (existing) {
    return (
      <Card title="Sign in to accept" lead="This email already has a Solvelt login.">
        {summary}
        <Link className="btn primary block" to={signIn}>Sign in to accept the invitation</Link>
      </Card>
    )
  }
  return (
    <Card title="You're invited" lead="Create your login to join. You won't need to fill in the seller application.">
      {summary}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Email" type="email" value={pv.email} readOnly aria-readonly="true" hint="This is the address the invitation was sent to." />
        <PasswordField label="Choose a password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password}
          hint="At least 10 characters with upper and lower case, a number and a symbol." />
        <StrengthMeter value={password} />
        <ul className="checks" aria-label="Password requirements">{passwordChecks(password).map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul>
        <div className="field check">
          <label><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} aria-invalid={errors.terms ? true : undefined} /> I agree to the Terms</label>
          <div className="field-error" aria-live="polite">{errors.terms}</div>
        </div>
        <Alert>{msg}</Alert>
        <button className="btn primary block" type="submit" disabled={busy || parentBusy} aria-busy={busy || undefined}>Create login and join</button>
      </form>
      <p className="links"><Link to={signIn}>I already have a Solvelt login</Link><button type="button" className="btn link" onClick={onDecline}>Decline invitation</button></p>
    </Card>
  )
}
