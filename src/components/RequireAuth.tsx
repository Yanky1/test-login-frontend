import { Link, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { safeNext } from '../lib/safeNext'
import { useAuth } from '../auth'
import { tokenStore } from '../api'
import { IdleGuard } from './IdleGuard'
import { AppHeaderContext, Logo, Spinner, ThemeToggle } from './ui'
import { PasskeyOffer } from '../pages/PasskeyOffer'
import { AccountSwitcher } from '../pages/teams/AccountSwitcher'
import { BrandProvider, BrandSwitcher } from '../pages/teams/BrandContext'
import { AssistantProvider } from '../assistant/context'
import { AssistantButton, AssistantPanel } from '../assistant/AssistantPanel'
import { Fragment, lazy } from 'react'
const ChooseAccount = lazy(() => import('../pages/teams/ChooseAccount'))

/** Route guard: anonymous visitors go to /login?next=<original path>. Mounts the inactivity guard for signed-in users. */
export function RequireAuth() {
  const { status, logoutReason, user } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <div className="center"><Spinner /></div>
  if (status === 'anon') return <Navigate to={`/login?${logoutReason === 'idle' ? 'reason=idle&' : ''}next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  // Drivers only have the driver app: anything else goes there (the server enforces this too, default deny).
  if (user?.role === 'Driver' && !loc.pathname.startsWith('/driver') && !loc.pathname.startsWith('/settings/security')) return <Navigate to="/driver" replace />
  // Several accounts (or none) and none selected yet: choose first. `accounts === null` means an old server without accounts.
  const needAccount = !!user?.accounts && !user.activeAccountId && !loc.pathname.startsWith('/accounts')
  return (
    <BrandProvider>
      <AssistantProvider key={user?.activeAccountId ?? 'none'}>
      <IdleGuard /><PasskeyOffer /><AppHeader />
      <AppHeaderContext.Provider value>
        {/* keyed by the active account so every page reloads its data after a switch */}
        <Fragment key={user?.activeAccountId ?? 'none'}>{needAccount ? <ChooseAccount /> : <Outlet />}</Fragment>
      </AppHeaderContext.Provider>
      {!needAccount && <AssistantPanel />}
      </AssistantProvider>
    </BrandProvider>
  )
}

function AppHeader() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  return (
    <header className="app-header">
      <Logo />
      <AccountSwitcher />
      <BrandSwitcher />
      <span className="spacer" />
      <AssistantButton />
      <span className="who">{user?.email}</span>
      <Link to="/settings/security">Settings</Link>
      <ThemeToggle />
      <button className="btn link" onClick={async () => { await logout(); if (!tokenStore.get()) nav('/login', { replace: true }) }}>Log out</button>
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
