import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { safeNext } from '../lib/safeNext'
import { useAuth } from '../auth'
import { IdleGuard } from './IdleGuard'
import { AppHeaderContext, Spinner, ThemeToggle } from './ui'
import { PasskeyOffer } from '../pages/PasskeyOffer'
import { AccountSwitcher } from '../pages/teams/AccountSwitcher'
import { BrandProvider, BrandSwitcher } from '../pages/teams/BrandContext'
import { Fragment, lazy } from 'react'
const ChooseAccount = lazy(() => import('../pages/teams/ChooseAccount'))

/** Route guard: anonymous visitors go to /login?next=<original path>. Mounts the inactivity guard for signed-in users. */
export function RequireAuth() {
  const { status, logoutReason, user } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <div className="center"><Spinner /></div>
  if (status === 'anon') return <Navigate to={`/login?${logoutReason === 'idle' ? 'reason=idle&' : ''}next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  // Several accounts (or none) and none selected yet: choose first. `accounts === null` means an old server without accounts.
  const needAccount = !!user?.accounts && !user.activeAccountId && !loc.pathname.startsWith('/accounts')
  return (
    <BrandProvider>
      <IdleGuard /><PasskeyOffer /><AppHeader />
      <AppHeaderContext.Provider value>
        {/* keyed by the active account so every page reloads its data after a switch */}
        <Fragment key={user?.activeAccountId ?? 'none'}>{needAccount ? <ChooseAccount /> : <Outlet />}</Fragment>
      </AppHeaderContext.Provider>
    </BrandProvider>
  )
}

function AppHeader() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  return (
    <header className="app-header">
      <Link to="/">Solvelt sellers</Link>
      <AccountSwitcher />
      <BrandSwitcher />
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
