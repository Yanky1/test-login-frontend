import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { safeNext } from '../lib/safeNext'
import { useAuth } from '../auth'
import { IdleGuard } from './IdleGuard'
import { Spinner } from './ui'

/** Route guard: anonymous visitors go to /login?next=<original path>. Mounts the inactivity guard for signed-in users. */
export function RequireAuth() {
  const { status, logoutReason } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <div className="center"><Spinner /></div>
  if (status === 'anon') return <Navigate to={`/login?${logoutReason === 'idle' ? 'reason=idle&' : ''}next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return (<><IdleGuard /><Outlet /></>)
}

/** Public-only routes (login/signup account step) bounce signed-in users home. */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const [params] = useSearchParams()
  if (status === 'authed') return <Navigate to={safeNext(params.get('next')) ?? '/'} replace />
  return <>{children}</>
}
