import { lazy, Suspense, useState, type FormEvent } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { renderSVG } from 'uqr'
import { Alert, Button, Field, Icon, PasswordField, Spinner, ThemeToggle, type IconName } from '../components/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { AdminError, adminApi, type Permission } from './api'
import { AdminProvider, useAdmin } from './AdminAuth'
import { RoleBadge } from './components'
import './admin.css'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Applications = lazy(() => import('./pages/Applications'))
const Sellers = lazy(() => import('./pages/Sellers'))
const Users = lazy(() => import('./pages/Users'))
const Moderation = lazy(() => import('./pages/Moderation'))
const Lookups = lazy(() => import('./pages/Lookups'))
const Integrations = lazy(() => import('./pages/Integrations'))
const Audit = lazy(() => import('./pages/Audit'))
const Settings = lazy(() => import('./pages/Settings'))
const Staff = lazy(() => import('./pages/Staff'))

const NAV: { to: string; label: string; perm: Permission; icon: IconName; end?: boolean }[] = [
  { to: '/admin', label: 'Dashboard', perm: 'DashboardView', icon: 'star', end: true },
  { to: '/admin/applications', label: 'Applications', perm: 'ApplicationsView', icon: 'check' },
  { to: '/admin/sellers', label: 'Sellers', perm: 'SellersView', icon: 'store' },
  { to: '/admin/users', label: 'Users', perm: 'UsersView', icon: 'user' },
  { to: '/admin/moderation', label: 'Moderation', perm: 'ModerationView', icon: 'shield' },
  { to: '/admin/lookups', label: 'Support lookups', perm: 'LookupsView', icon: 'mail' },
  { to: '/admin/integrations', label: 'Integrations', perm: 'IntegrationsView', icon: 'laptop' },
  { to: '/admin/audit', label: 'Audit log', perm: 'AuditView', icon: 'clock' },
  { to: '/admin/settings', label: 'Platform settings', perm: 'SettingsView', icon: 'pencil' },
  { to: '/admin/staff', label: 'Staff', perm: 'StaffView', icon: 'users' },
]

function Brand() {
  return <Link to="/admin" className="logo" aria-label="Solvelt staff home"><span className="logo-mark"><Icon name="shield" /></span><span>Solvelt <small className="adm-stafftag">Staff</small></span></Link>
}

function Layout() {
  const { me, can, logout, signedOut } = useAdmin()
  const loc = useLocation()
  if (!me) return <Navigate to="/admin/login" replace state={signedOut ? undefined : { from: loc.pathname + loc.search }} />
  return (
    <div className="adm">
      <header className="adm-top">
        <Brand />
        <span className="adm-spacer" />
        <span className="adm-who"><span className="sr-only">Signed in as </span>{me.email} <RoleBadge role={me.role} /></span>
        <ThemeToggle />
        <Button onClick={() => void logout()}>Sign out</Button>
      </header>
      <div className="adm-body">
        <nav className="adm-nav" aria-label="Staff areas">
          <ul>
            {NAV.filter((n) => can(n.perm)).map((n) => (
              <li key={n.to}><NavLink to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={n.icon} /> <span>{n.label}</span></NavLink></li>
            ))}
          </ul>
        </nav>
        <main className="adm-main" id="main">
          <ErrorBoundary><Suspense fallback={<div className="center"><Spinner /></div>}><Outlet /></Suspense></ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

export function NoAccess() {
  return (
    <div className="adm-noaccess" role="alert">
      <h1 tabIndex={-1} id="page-title">You don’t have access to this page</h1>
      <p>Your staff role doesn’t include it. If you need it, ask a Super admin.</p>
      <Link to="/admin" className="btn">Back to the dashboard</Link>
    </div>
  )
}
const Guard = ({ perm, children }: { perm: Permission; children: React.ReactNode }) => (useAdmin().can(perm) ? <>{children}</> : <NoAccess />)

/* ------------------------------------------------------------------------------------------------ sign-in with two-factor */
type Step = 'credentials' | 'code' | 'enrol' | 'enrolled'

function SignIn() {
  const { me, login, endedReason } = useAdmin()
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const [step, setStep] = useState<Step>('credentials')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [setup, setSetup] = useState<{ sharedKey: string; otpAuthUri: string } | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const from = (loc.state as { from?: string } | null)?.from
  const target = from && from.startsWith('/admin') ? from : '/admin'
  if (me) return <Navigate to={target} replace />

  const attempt = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      await login(email.trim(), password, step === 'code' ? (recovery ? { recovery: code } : { totp: code.replace(/\s/g, '') }) : undefined)
      nav(target, { replace: true })
    } catch (x) {
      const ex = x as AdminError
      if (ex instanceof AdminError && ex.body?.twoFactorRequired) { setStep('code'); setCode('') }
      else if (ex instanceof AdminError && ex.code === 'two_factor_setup_required') setStep('enrol')
      else if (ex instanceof AdminError && ex.status === 429) setErr('Too many attempts. Wait a minute and try again.')
      else if (ex instanceof AdminError && ex.code === 'ip_not_allowed') setErr('Staff sign-in is not allowed from this network.')
      else setErr(step === 'code' ? 'That code isn’t right, or the sign-in details are wrong.' : 'Sign-in failed. Check your email and password.')
    } finally { setBusy(false) }
  }

  const startSetup = async () => {
    setBusy(true); setErr(null)
    try { setSetup(await adminApi('/auth/2fa/setup', { auth: false, body: { email: email.trim(), password } })) }
    catch (x) { setErr(x instanceof AdminError && x.status === 401 ? 'Check your email and password.' : 'Could not start the setup.') }
    finally { setBusy(false) }
  }
  const finishSetup = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const r = await adminApi<{ recoveryCodes: string[] }>('/auth/2fa/enable', { auth: false, body: { email: email.trim(), password, code: code.replace(/\s/g, '') } })
      setCodes(r.recoveryCodes); setStep('enrolled'); setCode('')
    } catch (x) { setErr(x instanceof AdminError ? 'That code isn’t right. Check the time on your phone and try the next code.' : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  return (
    <div className="adm adm-login">
      <header className="adm-top"><Brand /><span className="adm-spacer" /><ThemeToggle /></header>
      <main className="adm-logincard" id="main">
        <h1 tabIndex={-1} id="page-title">{step === 'enrol' || step === 'enrolled' ? 'Set up two-factor authentication' : 'Staff sign-in'}</h1>
        {step === 'credentials' && <p className="adm-lead">For Solvelt staff only. Two-factor authentication is required.</p>}
        {endedReason && step === 'credentials' && <Alert kind="info">{endedReason}</Alert>}
        {params.get('invited') && step === 'credentials' && <Alert kind="success">Your staff account is ready. Sign in to set up two-factor authentication.</Alert>}

        {(step === 'credentials' || step === 'code') && (
          <form onSubmit={attempt} noValidate>
            <Field label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={step === 'code'} required />
            <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} readOnly={step === 'code'} required />
            {step === 'code' && (
              <>
                <Field label={recovery ? 'Recovery code' : 'Authenticator code'} inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} data-autofocus required hint={recovery ? 'One of the recovery codes you saved. Each works once.' : '6 digits from your authenticator app.'} />
                <Button type="button" variant="ghost" onClick={() => { setRecovery(!recovery); setCode('') }}>{recovery ? 'Use my authenticator app' : 'Use a recovery code'}</Button>
              </>
            )}
            <Alert>{err}</Alert>
            <Button type="submit" variant="primary" loading={busy}>{step === 'code' ? 'Verify and sign in' : 'Continue'}</Button>
          </form>
        )}

        {step === 'enrol' && (
          <div>
            <p>This staff account has no second factor yet. Set one up with an authenticator app (Google Authenticator, 1Password, Authy, …).</p>
            {!setup ? (
              <><Alert>{err}</Alert><Button variant="primary" loading={busy} onClick={startSetup}>Show my setup code</Button></>
            ) : (
              <form onSubmit={finishSetup} noValidate>
                <div className="qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: renderSVG(setup.otpAuthUri, { border: 1 }) }} />
                <p>Can’t scan? Enter this key by hand: <code className="adm-key">{setup.sharedKey}</code></p>
                <Field label="Code from the app" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} data-autofocus required />
                <Alert>{err}</Alert>
                <Button type="submit" variant="primary" loading={busy}>Turn on two-factor</Button>
              </form>
            )}
          </div>
        )}

        {step === 'enrolled' && (
          <div>
            <Alert kind="success">Two-factor authentication is on.</Alert>
            <p><strong>Save these recovery codes now.</strong> They are shown once. Each one works a single time if you lose your phone.</p>
            <ul className="adm-codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
            <Button variant="primary" onClick={() => { setStep('code'); setRecovery(false); setCode('') }}>I saved them — sign in</Button>
          </div>
        )}
      </main>
    </div>
  )
}

/** Public: a staff invitation link (/admin/accept-invite?email=…&token=…). */
function AcceptInvite() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const email = params.get('email') ?? ''
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await adminApi('/auth/accept-invite', { auth: false, body: { email, token, password } }); nav(`/admin/login?email=${encodeURIComponent(email)}&invited=1`, { replace: true }) }
    catch (x) { setErr(x instanceof AdminError ? x.text : 'Something went wrong') }
    finally { setBusy(false) }
  }
  return (
    <div className="adm adm-login">
      <header className="adm-top"><Brand /><span className="adm-spacer" /><ThemeToggle /></header>
      <main className="adm-logincard" id="main">
        <h1 tabIndex={-1} id="page-title">Join the Solvelt staff team</h1>
        {!email || !token ? <Alert>This invitation link is incomplete. Ask the Super admin who invited you for a new one.</Alert> : (
          <form onSubmit={submit} noValidate>
            <p className="adm-lead">Choose a password for <strong>{email}</strong>. If you already have a Solvelt login, enter its current password instead. Two-factor authentication is set up at your first sign-in.</p>
            <input type="email" value={email} autoComplete="username" readOnly hidden />
            <PasswordField label="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters with upper and lower case, a number and a symbol." required />
            <Alert>{err}</Alert>
            <Button type="submit" variant="primary" loading={busy}>Accept invitation</Button>
          </form>
        )}
      </main>
    </div>
  )
}

export default function AdminApp() {
  return (
    <AdminProvider>
      <Routes>
        <Route path="login" element={<SignIn />} />
        <Route path="accept-invite" element={<AcceptInvite />} />
        <Route element={<Layout />}>
          <Route index element={<Guard perm="DashboardView"><Dashboard /></Guard>} />
          <Route path="applications/:id?" element={<Guard perm="ApplicationsView"><Applications /></Guard>} />
          <Route path="sellers/:id?" element={<Guard perm="SellersView"><Sellers /></Guard>} />
          <Route path="users/:id?" element={<Guard perm="UsersView"><Users /></Guard>} />
          <Route path="moderation/:id?" element={<Guard perm="ModerationView"><Moderation /></Guard>} />
          <Route path="lookups/:kind?/:id?" element={<Guard perm="LookupsView"><Lookups /></Guard>} />
          <Route path="integrations/:tab?" element={<Guard perm="IntegrationsView"><Integrations /></Guard>} />
          <Route path="audit" element={<Guard perm="AuditView"><Audit /></Guard>} />
          <Route path="settings" element={<Guard perm="SettingsView"><Settings /></Guard>} />
          <Route path="staff" element={<Guard perm="StaffView"><Staff /></Guard>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </AdminProvider>
  )
}
