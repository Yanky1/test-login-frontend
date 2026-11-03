import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { safeNext } from '../lib/safeNext'
import { useAuth } from '../auth'
import { IdleGuard } from './IdleGuard'
import { AppHeaderContext, Spinner, ThemeToggle } from './ui'
import { PasskeyOffer } from '../pages/PasskeyOffer'

/** Route guard: anonymous visitors go to /login?next=<original path>. Mounts the inactivity guard for signed-in users. */
export function RequireAuth() {
  const { status, logoutReason } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <div className="center"><Spinner /></div>
  if (status === 'anon') return <Navigate to={`/login?${logoutReason === 'idle' ? 'reason=idle&' : ''}next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return (<><IdleGuard /><PasskeyOffer /><AppHeader /><AppHeaderContext.Provider value><Outlet /></AppHeaderContext.Provider></>)
}

function AppHeader() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  return (
    <header className="app-header">
      <Link to="/">Solvelt sellers</Link>
      <span className="spacer" />
      <span className="who">{user?.email}</span>
      <Link to="/settings/security">Settings</Link>
      <ThemeToggle />
      <button className="btn link" onClick={async () => { await logout(); nav('/login', { replace: true }) }}>Log out</button>
    </header>
  )
}

/** Public-only routes (login/signup account step) bounce signed-in users home. */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const [params] = useSearchParams()
  if (status === 'authed') return <Navigate to={safeNext(params.get('next')) ?? '/'} replace />
  return <>{children}</>
}
