import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { passwordChecks, passwordValid } from '../lib/password'
import { createCredential, passkeysSupported } from '../lib/passkeys'
import { Alert, Field, PasswordField } from '../components/ui'

interface Me { email: string; emailConfirmed: boolean; hasPassword: boolean; twoFactorEnabled: boolean; passkeyCount: number; logins: string[]; sellerStatus: string | null; vendorName: string | null }

export default function SettingsPage() {
  const { tab = 'profile' } = useParams()
  const [me, setMe] = useState<Me | null>(null)
  const reload = useCallback(async () => setMe(await api<Me>('/account/me')), [])
  useEffect(() => { void reload() }, [reload])
  return (
    <main className="card wide">
      <h1 tabIndex={-1}>Account settings</h1>
      <nav className="tabs" aria-label="Settings">
        <NavLink to="/settings/profile">Profile</NavLink>
        <NavLink to="/settings/security">Security</NavLink>
        <Link to="/">Back to application</Link>
      </nav>
      {!me ? <p>Loading…</p> : tab === 'security' ? <Security me={me} reload={reload} /> : <Profile me={me} />}
    </main>
  )
}

function Profile({ me }: { me: Me }) {
  return (
    <section aria-labelledby="prof">
      <h2 id="prof">Profile</h2>
      <dl><dt>Email</dt><dd>{me.email}</dd><dt>Business</dt><dd>{me.vendorName ?? '—'}</dd><dt>Application status</dt><dd>{me.sellerStatus ?? '—'}</dd></dl>
    </section>
  )
}

function Security({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  return (
    <>
      {me.hasPassword && <ChangePassword />}
      <ChangeEmail me={me} reload={reload} />
      <Passkeys reload={reload} />
      <Logins me={me} reload={reload} />
      <TwoFactor me={me} reload={reload} />
      <Sessions />
    </>
  )
}

const pwSchema = z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: z.string().refine(passwordValid, 'Password does not meet the requirements') })
function ChangePassword() {
  const { register, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(pwSchema), mode: 'onBlur' })
  const [ok, setOk] = useState(false)
  const pw = watch('newPassword') ?? ''
  const onSubmit = async (v: z.infer<typeof pwSchema>) => {
    setOk(false)
    try { await api('/account/change-password', { body: v }); setOk(true); reset() }
    catch (e) {
      if (e instanceof ApiError) {
        const fe = e.fieldErrors()
        if (fe.newPassword) setError('newPassword', { message: fe.newPassword })
        else setError('currentPassword', { message: e.body?.title ?? 'Could not change password' })
      }
    }
  }
  return (
    <section aria-labelledby="cp"><h2 id="cp">Change password</h2>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <PasswordField label="Current password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
        <PasswordField label="New password" autoComplete="new-password" error={errors.newPassword?.message} {...register('newPassword')}
          hint={<ul className="checks">{passwordChecks(pw).map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul>} />
        <Alert kind="success">{ok ? 'Password changed. Your other devices were signed out.' : undefined}</Alert>
        <button className="btn primary" disabled={isSubmitting}>Change password</button>
      </form>
    </section>
  )
}

function ChangeEmail({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const { setAccessToken } = useAuth()
  const [newEmail, setNewEmail] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    try { await api('/account/email/change', { body: { newEmail, currentPassword: me.hasPassword ? pw : undefined } }); setSent(true) }
    catch (ex) { setMsg(ex instanceof ApiError ? (ex.fieldErrors().newEmail ?? ex.body?.title ?? 'Could not start the change') : 'Network error') }
  }
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    try {
      const r = await api<{ accessToken: string; email: string }>('/account/email/confirm', { body: { code } })
      setAccessToken(r.accessToken, { email: r.email }); setOk(`Email changed to ${r.email}. We notified your previous address.`); setSent(false); setNewEmail(''); setCode(''); setPw(''); await reload()
    } catch (ex) { setMsg(ex instanceof ApiError ? (ex.body?.title ?? 'That code did not work') : 'Network error') }
  }
  return (
    <section aria-labelledby="ce"><h2 id="ce">Change email</h2>
      <p>Current email: <strong>{me.email}</strong></p>
      {!sent ? (
        <form onSubmit={request} noValidate>
          <Field label="New email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          {me.hasPassword && <PasswordField label="Current password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
          <button className="btn primary">Send verification code</button>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate>
          <p>We sent a code to {newEmail}.</p>
          <Field label="Verification code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn primary">Confirm new email</button>
        </form>
      )}
      <Alert>{msg}</Alert><Alert kind="success">{ok}</Alert>
    </section>
  )
}

interface Passkey { id: string; name: string; createdAt: string }
function Passkeys({ reload }: { reload: () => Promise<void> }) {
  const [list, setList] = useState<Passkey[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [name, setName] = useState('')
  const load = useCallback(async () => setList(await api<Passkey[]>('/account/passkeys')), [])
  useEffect(() => { void load() }, [load])
  const add = async () => {
    setMsg(null)
    try {
      const opts = await api('/account/passkeys/options', { body: {} })
      const credential = await createCredential(opts)
      await api('/account/passkeys', { body: { credential, name: name || 'Passkey' } })
      setName(''); await load(); await reload()
    } catch { setMsg('Could not add a passkey.') }
  }
  const rename = async (p: Passkey) => {
    const n = window.prompt('New name', p.name)
    if (n?.trim()) { await api(`/account/passkeys/${p.id}`, { method: 'PATCH', body: { name: n.trim() } }); await load() }
  }
  const del = async (p: Passkey) => {
    try { await api(`/account/passkeys/${p.id}`, { method: 'DELETE' }); await load(); await reload() }
    catch (e) { setMsg(e instanceof ApiError && e.status === 409 ? "You can't remove your last sign-in method." : 'Could not remove the passkey.') }
  }
  return (
    <section aria-labelledby="pk"><h2 id="pk">Passkeys</h2>
      {list.length === 0 ? <p>No passkeys yet.</p> : (
        <ul className="list">{list.map((p) => (
          <li key={p.id}><span>{p.name} <small>added {new Date(p.createdAt).toLocaleDateString()}</small></span>
            <span><button className="btn link" onClick={() => void rename(p)}>Rename</button> <button className="btn link" onClick={() => void del(p)}>Delete</button></span></li>
        ))}</ul>
      )}
      {passkeysSupported() && (<div className="row"><Field label="Passkey name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" onClick={() => void add()}>Add a passkey</button></div>)}
      <Alert>{msg}</Alert>
    </section>
  )
}

function Logins({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null)
  const unlink = async (p: string) => {
    try { await api(`/account/logins/${p}`, { method: 'DELETE' }); await reload() }
    catch (e) { setMsg(e instanceof ApiError && e.status === 409 ? "You can't remove your last sign-in method." : 'Could not unlink.') }
  }
  return (
    <section aria-labelledby="lg"><h2 id="lg">Linked logins</h2>
      {me.logins.length === 0 ? <p>No linked providers.</p> : <ul className="list">{me.logins.map((p) => <li key={p}><span>{p}</span><button className="btn link" onClick={() => void unlink(p)}>Unlink</button></li>)}</ul>}
      {!me.logins.includes('Google') && <a className="btn" href="/api/v1/auth/external/google/start?returnUrl=%2Fsettings%2Fsecurity">Link Google (same verified email)</a>}
      <Alert>{msg}</Alert>
    </section>
  )
}

function TwoFactor({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ sharedKey: string; otpAuthUri: string } | null>(null)
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [recovery, setRecovery] = useState<string[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const start = async () => { setMsg(null); setSetup(await api('/account/2fa/setup', { body: {} })) }
  const enable = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    try { const r = await api<{ recoveryCodes: string[] }>('/account/2fa/enable', { body: { code } }); setRecovery(r.recoveryCodes); setSetup(null); setCode(''); await reload() }
    catch { setMsg('That code is not right.') }
  }
  const disable = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    try { await api('/account/2fa/disable', { body: { code, currentPassword: me.hasPassword ? pw : undefined } }); setCode(''); setPw(''); await reload() }
    catch { setMsg('Password or code is not right.') }
  }
  return (
    <section aria-labelledby="tf"><h2 id="tf">Two-factor authentication (authenticator app)</h2>
      {recovery && (<div className="alert info"><p>Save these recovery codes somewhere safe. Each works once.</p><pre aria-label="Recovery codes">{recovery.join('\n')}</pre></div>)}
      {!me.twoFactorEnabled && !setup && <button className="btn" onClick={() => void start()}>Set up 2FA</button>}
      {setup && (
        <form onSubmit={enable} noValidate>
          <p>Add this key to your authenticator app, then enter the 6-digit code.</p>
          <p><code>{setup.sharedKey}</code></p>
          <Field label="Authentication code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn primary">Enable 2FA</button>
        </form>
      )}
      {me.twoFactorEnabled && (
        <form onSubmit={disable} noValidate>
          <p>2FA is on.</p>
          {me.hasPassword && <PasswordField label="Current password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
          <Field label="Authentication code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn">Disable 2FA</button>
        </form>
      )}
      <Alert>{msg}</Alert>
    </section>
  )
}

interface Sess { id: string; createdAt: string; lastActivityAt: string; userAgent: string | null; ipAddress: string | null; current: boolean }
function Sessions() {
  const { logout } = useAuth()
  const nav = useNavigate()
  const [list, setList] = useState<Sess[]>([])
  const load = useCallback(async () => setList(await api<Sess[]>('/account/sessions')), [])
  useEffect(() => { void load() }, [load])
  const all = async () => { await api('/auth/logout-all', { body: {} }); await logout(); nav('/login', { replace: true }) }
  return (
    <section aria-labelledby="ss"><h2 id="ss">Active sessions</h2>
      <ul className="list">{list.map((s) => (
        <li key={s.id}><span>{s.current ? 'This device' : (s.userAgent ?? 'Unknown device').slice(0, 60)} <small>last active {new Date(s.lastActivityAt).toLocaleString()}</small></span>
          {!s.current && <button className="btn link" onClick={async () => { await api(`/account/sessions/${s.id}`, { method: 'DELETE' }); await load() }}>Sign out</button>}</li>
      ))}</ul>
      <div className="row"><button className="btn" onClick={async () => { await logout(); nav('/login', { replace: true }) }}>Sign out</button>
        <button className="btn danger" onClick={() => void all()}>Sign out of all devices</button></div>
    </section>
  )
}
