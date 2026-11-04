import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { passwordChecks, passwordValid } from '../lib/password'
import { createCredential, passkeysSupported } from '../lib/passkeys'
import { renderSVG } from 'uqr'
import { normalizeStatus } from '../lib/status'
import { PhoneCards } from './PhoneSettings'
import { Alert, Field, Icon, PasswordField, SettingCard, Shell, Skeleton, StrengthMeter } from '../components/ui'
import { lazy, Suspense } from 'react'
import { can } from '../lib/teams'
const TeamPage = lazy(() => import('./teams/Team'))
const BrandsPage = lazy(() => import('./teams/Brands'))
const NotificationSettings = lazy(() => import('../orders/NotificationSettings'))
const ShippingSettings = lazy(() => import('../shipping/ShippingSettings'))
const AvailabilityPage = lazy(() => import('../services/AvailabilityPage'))
const DeliverySettingsPage = lazy(() => import('../delivery/DeliverySettings'))

interface Me { email: string; emailConfirmed: boolean; hasPassword: boolean; twoFactorEnabled: boolean; passkeyCount: number; logins: string[]; sellerStatus: string | null; vendorName: string | null }

export default function SettingsPage() {
  const { tab = 'profile' } = useParams()
  const { user } = useAuth()
  const teamTab = !!user?.activeAccountId && can(user.role, 'members.read')
  const brandsTab = !!user?.activeAccountId
  const [me, setMe] = useState<Me | null>(null)
  const reload = useCallback(async () => setMe(await api<Me>('/account/me')), [])
  useEffect(() => { reload().catch(() => undefined) }, [reload]) // a failure is surfaced by the global handlers (401 / lost account)
  return (
    <Shell><main className="card wide">
      <div className="acct-head">
        <span className="avatar" aria-hidden="true">{(me?.vendorName ?? me?.email ?? '?').trim().charAt(0).toUpperCase()}</span>
        <div><h1 tabIndex={-1}>Account settings</h1><p className="acct-sub">{me ? <>{me.vendorName ? <strong>{me.vendorName}</strong> : null}{me.vendorName ? ' · ' : ''}{me.email}</> : ' '}</p></div>
      </div>
      <nav className="tabs" aria-label="Settings">
        <NavLink to="/settings/profile">Profile</NavLink>
        <NavLink to="/settings/security">Security</NavLink>
        {teamTab && <NavLink to="/settings/team">Team</NavLink>}
        {brandsTab && <NavLink to="/settings/brands">Brands</NavLink>}
        {brandsTab && <NavLink to="/settings/shipping">Shipping</NavLink>}
        {brandsTab && <NavLink to="/settings/notifications">Notifications</NavLink>}
        {brandsTab && <NavLink to="/settings/availability">Availability</NavLink>}
        {brandsTab && user?.role !== 'Driver' && <NavLink to="/settings/delivery">Local delivery</NavLink>}
        <Link to="/">Back to application</Link>
      </nav>
      {!me ? <Skeleton lines={4} /> : tab === 'security' ? <Security me={me} reload={reload} />
        : tab === 'team' && teamTab ? <Suspense fallback={<Skeleton lines={4} />}><TeamPage hasPassword={me.hasPassword} twoFactorEnabled={me.twoFactorEnabled} /></Suspense>
        : tab === 'shipping' && brandsTab ? <Suspense fallback={<Skeleton lines={4} />}><ShippingSettings /></Suspense>
        : tab === 'notifications' && brandsTab ? <Suspense fallback={<Skeleton lines={4} />}><NotificationSettings /></Suspense>
        : tab === 'availability' && brandsTab ? <Suspense fallback={<Skeleton lines={4} />}><AvailabilityPage embedded /></Suspense>
        : tab === 'delivery' && brandsTab ? <Suspense fallback={<Skeleton lines={4} />}><DeliverySettingsPage canEdit={user?.role === 'Owner' || user?.role === 'Admin'} /></Suspense>
        : tab === 'brands' && brandsTab ? <Suspense fallback={<Skeleton lines={4} />}><BrandsPage /></Suspense>
        : <Profile me={me} />}
    </main></Shell>
  )
}

function Profile({ me }: { me: Me }) {
  return (
    <SettingCard id="prof" icon="user" title="Profile" desc="How you appear to the marketplace team." badge={{ text: normalizeStatus(me.sellerStatus) ?? 'No application', tone: 'muted' }}>
      <dl><dt>Email</dt><dd>{me.email}</dd><dt>Business</dt><dd>{me.vendorName ?? '—'}</dd><dt>Application status</dt><dd>{normalizeStatus(me.sellerStatus) ?? '—'}</dd></dl>
    </SettingCard>
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
      <PhoneCards me={me} />
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
        else setError('currentPassword', { message: (e.body?.detail ?? e.body?.title) ?? 'Could not change password' })
      }
    }
  }
  return (
    <SettingCard id="cp" icon="lock" title="Change password" desc="Use a long, unique password. Changing it signs your other devices out.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <PasswordField label="Current password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
        <PasswordField label="New password" autoComplete="new-password" error={errors.newPassword?.message} {...register('newPassword')}
          hint={<><StrengthMeter value={pw} /><ul className="checks">{passwordChecks(pw).map((c) => <li key={c.label} className={c.ok ? 'ok' : ''}>{c.ok ? '✓' : '○'} {c.label}</li>)}</ul></>} />
        <Alert kind="success">{ok ? 'Password changed. Your other devices were signed out.' : undefined}</Alert>
        <button className="btn primary" disabled={isSubmitting}>Change password</button>
      </form>
    </SettingCard>
  )
}

function ChangeEmail({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const { setAccessToken } = useAuth()
  const [newEmail, setNewEmail] = useState('')
  const [pw, setPw] = useState('')
  const [stepUp, setStepUp] = useState(false) // passwordless accounts confirm with a code sent to the CURRENT address
  const [stepUpCode, setStepUpCode] = useState('')
  const [totp, setTotp] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    try {
      const r = await api<{ stepUpRequired?: boolean }>('/account/email/change', {
        body: { newEmail, currentPassword: me.hasPassword ? pw : undefined, stepUpCode: stepUp ? stepUpCode : undefined, totpCode: me.twoFactorEnabled && stepUp ? totp : undefined },
      })
      if (r?.stepUpRequired) { setStepUp(true); setMsg(null) } else { setSent(true); setStepUp(false) }
    } catch (ex) { setMsg(ex instanceof ApiError ? (ex.fieldErrors().newEmail ?? ex.body?.detail ?? ex.body?.title ?? 'Could not start the change') : 'Network error') }
  }
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    try {
      const r = await api<{ accessToken: string; email: string }>('/account/email/confirm', { body: { code } })
      setAccessToken(r.accessToken, { email: r.email }); setOk(`Email changed to ${r.email}. We notified your previous address.`); setSent(false); setStepUp(false); setNewEmail(''); setCode(''); setPw(''); setStepUpCode(''); await reload()
    } catch (ex) { setMsg(ex instanceof ApiError ? (ex.body?.detail ?? ex.body?.title ?? 'That code did not work') : 'Network error') }
  }
  return (
    <SettingCard id="ce" icon="mail" title="Change email" desc="We confirm the new address with a code before switching.">
      <p>Current email: <strong>{me.email}</strong></p>
      {!sent ? (
        <form onSubmit={request} noValidate>
          <Field label="New email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          {me.hasPassword && <PasswordField label="Current password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
          {stepUp && (
            <>
              <p role="status">We sent a confirmation code to <strong>{me.email}</strong>. Enter it to continue.</p>
              <Field label="Confirmation code (from your current email)" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={stepUpCode} onChange={(e) => setStepUpCode(e.target.value.replace(/\D/g, ''))} />
              {me.twoFactorEnabled && <Field label="Authentication code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} />}
            </>
          )}
          <button className="btn primary">{stepUp ? 'Continue' : 'Send verification code'}</button>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate>
          <p>We sent a code to {newEmail}.</p>
          <Field label="Verification code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn primary">Confirm new email</button>
        </form>
      )}
      <Alert>{msg}</Alert><Alert kind="success">{ok}</Alert>
    </SettingCard>
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
    <SettingCard id="pk" icon="key" title="Passkeys" desc="Sign in with your fingerprint, face or device PIN. Faster and phishing-resistant." badge={{ text: list.length ? `${list.length} saved` : 'None yet', tone: list.length ? 'ok' : 'muted' }}>
      {list.length === 0 ? <p className="empty">No passkeys yet. Add one to sign in without typing a password.</p> : (
        <ul className="list">{list.map((p) => (
          <li key={p.id}><span>{p.name} <small>added {new Date(p.createdAt).toLocaleDateString()}</small></span>
            <span><button className="btn link" onClick={() => void rename(p)}>Rename</button> <button className="btn link" onClick={() => void del(p)}>Delete</button></span></li>
        ))}</ul>
      )}
      {passkeysSupported() && (<div className="row"><Field label="Passkey name" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn" onClick={() => void add()}>Add a passkey</button></div>)}
      <Alert>{msg}</Alert>
    </SettingCard>
  )
}

function Logins({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null)
  const unlink = async (p: string) => {
    try { await api(`/account/logins/${p}`, { method: 'DELETE' }); await reload() }
    catch (e) { setMsg(e instanceof ApiError && e.status === 409 ? "You can't remove your last sign-in method." : 'Could not unlink.') }
  }
  return (
    <SettingCard id="lg" icon="users" title="Linked logins" desc="Sign-in providers connected to this account." badge={{ text: me.logins.length ? `${me.logins.length} linked` : 'None', tone: me.logins.length ? 'ok' : 'muted' }}>
      {me.logins.length === 0 ? <p className="empty">No linked providers.</p> : <ul className="list">{me.logins.map((p) => <li key={p}><span>{p}</span><button className="btn link" onClick={() => void unlink(p)}>Unlink</button></li>)}</ul>}
      {!me.logins.includes('Google') && <a className="btn" href="/api/v1/auth/external/google/start?returnUrl=%2Fsettings%2Fsecurity">Link Google (same verified email)</a>}
      <Alert>{msg}</Alert>
    </SettingCard>
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
    <SettingCard id="tf" icon="shield" title="Two-factor authentication (authenticator app)" desc="A second step at sign-in protects your payouts even if your password leaks." badge={{ text: me.twoFactorEnabled ? 'On' : 'Off', tone: me.twoFactorEnabled ? 'ok' : 'muted' }}>
      {recovery && <RecoveryCodes codes={recovery} onDone={() => setRecovery(null)} />}
      {!me.twoFactorEnabled && !setup && <button className="btn" onClick={() => void start()}>Set up 2FA</button>}
      {setup && (
        <form onSubmit={enable} noValidate className="twofa-setup">
          <ol className="how">
            <li>Scan this QR code with your authenticator app (1Password, Authy, Google Authenticator…).</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: renderSVG(setup.otpAuthUri, { border: 1 }) }} />
          <p className="hint">Can’t scan it? Enter this key instead: <code>{setup.sharedKey}</code></p>
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
    </SettingCard>
  )
}

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const text = codes.join('\n')
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) } }
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Solvelt recovery codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' }))
    const a = document.createElement('a'); a.href = url; a.download = 'solvelt-recovery-codes.txt'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000) // revoking synchronously can cancel the download in some browsers
  }
  return (
    <div className="alert info recovery">
      <p><strong>Save these recovery codes somewhere safe.</strong> Each works once, and they are the only way in if you lose your phone. We will not show them again.</p>
      <pre aria-label="Recovery codes" className="codes">{text}</pre>
      <div className="row">
        <button type="button" className="btn" onClick={() => void copy()}><Icon name="copy" /> {copied ? 'Copied' : 'Copy codes'}</button>
        <button type="button" className="btn" onClick={download}><Icon name="download" /> Download .txt</button>
      </div>
      <div className="field check"><label><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery codes</label></div>
      <button type="button" className="btn primary" disabled={!saved} onClick={onDone}>Done</button>
    </div>
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
    <SettingCard id="ss" icon="laptop" title="Active sessions" desc="Devices currently signed in to your account.">
      <ul className="list">{list.map((s) => (
        <li key={s.id}><span>{s.current ? <>This device <span className="chip ok">Current</span></> : (s.userAgent ?? 'Unknown device').slice(0, 60)} <small>last active {Number.isNaN(Date.parse(s.lastActivityAt)) ? 'recently' : new Date(s.lastActivityAt).toLocaleString()}</small></span>
          {!s.current && <button className="btn link" onClick={async () => { await api(`/account/sessions/${s.id}`, { method: 'DELETE' }); await load() }}>Sign out</button>}</li>
      ))}</ul>
      <div className="row"><button className="btn" onClick={async () => { await logout(); nav('/login', { replace: true }) }}>Sign out</button>
        <button className="btn danger" onClick={() => void all()}>Sign out of all devices</button></div>
    </SettingCard>
  )
}
